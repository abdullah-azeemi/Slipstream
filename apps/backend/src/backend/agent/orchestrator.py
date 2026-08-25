"""
Agent orchestrator — routes with the LLM, executes read-only tools, composes.

Pipeline: route -> plan -> execute -> verify -> compose.
Every tool call is recorded in the trace for debugging and the future UI.
"""

from __future__ import annotations
import time
from dataclasses import asdict, replace

from backend.agent import llm, tools, types


def _build_plan(question: str, routed: types.RoutedQuestion) -> types.Plan:
    """Turn routed entities into a concrete executable plan."""
    return types.Plan(
        intent=routed.intent,
        question=question,
        session_selector=types.ResolveSessionInput(
            year=routed.year,
            gp_name=routed.gp_name,
            session_type=types.SessionType.RACE,
        ),
        driver_selector=routed.driver_name,
        laps_before=routed.laps_window,
        laps_after=routed.laps_window,
    )


def _execute(plan: types.Plan) -> tuple[tuple[types.ToolCallRecord, ...], dict]:
    """Run the tools for a plan. Returns (trace, partial results)."""
    trace: list[types.ToolCallRecord] = []
    partial: dict = {}

    def record(tool_name, fn, **kwargs):
        start = time.perf_counter()
        try:
            result = fn(**kwargs)
            duration_ms = round((time.perf_counter() - start) * 1000, 2)
            trace.append(
                types.ToolCallRecord(
                    tool_name=tool_name,
                    status="ok",
                    input_summary=str(kwargs),
                    output_summary=str(result),
                    duration_ms=duration_ms,
                )
            )
            return result
        except (types.NotFoundError, types.DataError) as exc:
            duration_ms = round((time.perf_counter() - start) * 1000, 2)
            trace.append(
                types.ToolCallRecord(
                    tool_name=tool_name,
                    status="error",
                    input_summary=str(kwargs),
                    error=str(exc),
                    duration_ms=duration_ms,
                )
            )
            raise

    try:
        session = record(
            types.ToolName.RESOLVE_SESSION,
            tools.resolve_session,
            inp=plan.session_selector,
        )
        partial["session"] = session

        driver = record(
            types.ToolName.RESOLVE_DRIVER,
            tools.resolve_driver,
            inp=types.ResolveDriverInput(
                name_or_abbreviation=plan.driver_selector,
                session_key=session.session_key,
            ),
        )
        partial["driver"] = driver

        pits = record(
            types.ToolName.FIND_PIT_STOPS,
            tools.find_pit_stops,
            inp=types.FindPitStopsInput(
                session_key=session.session_key, driver_number=driver.driver_number
            ),
        )
        if not pits.pit_stops:
            raise types.DataError("no pit stops found for this driver")
        stop = pits.pit_stops[0]
        partial["pit_stop"] = stop

        before_laps = tuple(range(stop.pit_in_lap - plan.laps_before, stop.pit_in_lap))
        after_laps = tuple(
            range(stop.pit_out_lap + 1, stop.pit_out_lap + 1 + plan.laps_after)
        )
        required_laps = tuple(sorted(set(before_laps) | set(after_laps)))

        record(
            types.ToolName.GET_LAP_TELEMETRY_ARTIFACTS,
            tools.get_lap_telemetry_artifacts,
            inp=types.GetLapTelemetryArtifactsInput(
                session_key=session.session_key,
                driver_number=driver.driver_number,
                lap_numbers=required_laps,
            ),
        )

        window = record(
            types.ToolName.COMPUTE_SPEED_WINDOW,
            tools.compute_speed_window,
            inp=types.ComputeSpeedWindowInput(
                session_key=session.session_key,
                driver_number=driver.driver_number,
                before_laps=before_laps,
                after_laps=after_laps,
                metric=types.SpeedMetric.DISTANCE_WEIGHTED_TELEMETRY,
            ),
        )
        partial["window"] = window

        evidence = record(
            types.ToolName.VERIFY_EVIDENCE,
            tools.verify_evidence,
            inp=types.VerifyEvidenceInput(
                session_key=session.session_key,
                driver_number=driver.driver_number,
                required_laps=required_laps,
                required_tool_names=tuple(t.tool_name for t in trace),
            ),
        )
        partial["evidence"] = evidence
    except (types.NotFoundError, types.DataError) as exc:
        partial["error"] = exc

    return tuple(trace), partial


def _compose(
    plan: types.Plan,
    partial: dict,
    trace: tuple[types.ToolCallRecord, ...],
) -> types.AgentAnswer:
    """Build the final structured answer from tool results."""
    refusals: list[str] = []
    if partial.get("error"):
        refusals.append(str(partial["error"]))
    evidence = partial.get("evidence")
    if evidence is not None and not evidence.passed and evidence.refusal_reason:
        refusals.append(evidence.refusal_reason)

    if refusals:
        return types.AgentAnswer(
            question=plan.question,
            intent=plan.intent,
            answer=(
                "I could not fully answer that question. "
                + " ".join(refusals)
                + " No numbers were invented from missing data."
            ),
            refusals=tuple(refusals),
            session=partial.get("session"),
            driver=partial.get("driver"),
            pit_stop=partial.get("pit_stop"),
            speed_window=partial.get("window"),
            evidence=evidence,
            trace=trace,
        )

    session = partial["session"]
    driver = partial["driver"]
    stop = partial["pit_stop"]
    window = partial["window"]

    fallback_lines = [
        f"{driver.full_name} made a pit stop across lap {stop.pit_in_lap} "
        f"into lap {stop.pit_out_lap}.",
        "",
        f"Using telemetry sample average speed, the {plan.laps_before}-lap pre-stop "
        f"window averaged {window.before_avg_speed_kmh} km/h, while the "
        f"{plan.laps_after}-lap post-stop window averaged {window.after_avg_speed_kmh} km/h. "
        f"That is a {window.delta_kmh:+.1f} km/h change.",
    ]
    if stop.compound_before and stop.compound_after:
        fallback_lines.append(
            f"He switched from {stop.compound_before} to {stop.compound_after} tyres."
        )
    fallback_text = "\n".join(fallback_lines)

    evidence_payload = {
        "session": asdict(session),
        "driver": asdict(driver),
        "pit_stop": asdict(stop),
        "speed_window": asdict(window),
        "metric_definition": (
            "average of telemetry speed samples (speed_kmh) over each lap window"
        ),
    }
    compose_cost = 0.0
    try:
        answer_text, compose_cost = llm.compose_answer(plan.question, evidence_payload)
    except types.LLMError:
        answer_text = fallback_text

    return types.AgentAnswer(
        question=plan.question,
        intent=plan.intent,
        answer=answer_text,
        session=session,
        driver=driver,
        pit_stop=stop,
        speed_window=window,
        evidence=evidence,
        trace=trace,
        cost_usd=compose_cost,
    )


def run(question: str) -> types.AgentAnswer:
    """Public entry point: one question in, one structured answer out."""
    try:
        routed, routing_cost = llm.route_question(question)
    except types.LLMError as exc:
        return types.AgentAnswer(
            question=question,
            intent=types.Intent.UNSUPPORTED,
            answer=(
                "I could not process that question because the question "
                f"router is unavailable {exc}"
            ),
            refusals=("llm router unavailable",),
        )

    if routed.intent is types.Intent.UNSUPPORTED:
        return types.AgentAnswer(
            question=question,
            intent=routed.intent,
            answer="I cannot answer that yet. v1 only supports the pit-stop speed question.",
            refusals=("unsupported question",),
        )

    if not routed.driver_name:
        return types.AgentAnswer(
            question=question,
            intent=routed.intent,
            answer="Which driver should I look at? Name one, e.g. 'Sainz'.",
            refusals=("missing_driver",),
        )

    if not routed.gp_name or routed.year is None:
        return types.AgentAnswer(
            question=question,
            intent=routed.intent,
            answer=(
                "Which race should I use? Name the year and Grand Prix, "
                "e.g. '2026 Monaco GP'."
            ),
            refusals=("missing_race",),
        )

    plan = _build_plan(question, routed)
    trace, partial = _execute(plan)
    answer = _compose(plan, partial, trace)
    return replace(answer, cost_usd=round(routing_cost + answer.cost_usd, 6))
