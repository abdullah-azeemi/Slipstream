"""
Agent orchestrator — routes with the LLM, executes read-only tools, composes.

Pipeline: route -> plan -> execute -> verify -> compose.
Every tool call is recorded in the trace for debugging and the future UI.
"""

from __future__ import annotations
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import asdict, replace
from typing import Any, Callable

from backend.agent import llm, tools, types

ProgressCallback = Callable[[dict], None]


def _emit(progress: ProgressCallback | None, **payload) -> None:
    """Best-effort progress events for streaming clients."""
    if progress is None:
        return
    try:
        progress(payload)
    except Exception:
        return


_TOOLS: dict[types.ToolName, Callable] = {
    types.ToolName.RESOLVE_SESSION: tools.resolve_session,
    types.ToolName.RESOLVE_DRIVER: tools.resolve_driver,
    types.ToolName.FIND_PIT_STOPS: tools.find_pit_stops,
    types.ToolName.GET_LAP_TELEMETRY_ARTIFACTS: tools.get_lap_telemetry_artifacts,
    types.ToolName.COMPUTE_SPEED_WINDOW: tools.compute_speed_window,
    types.ToolName.INSPECT_LAP_EVENTS: tools.inspect_lap_events,
    types.ToolName.STINT_DEGRADATION_SCANNER: tools.stint_degradation_scanner,
    types.ToolName.TELEMETRY_INSPECTOR: tools.telemetry_inspector,
    types.ToolName.VERIFY_EVIDENCE: tools.verify_evidence,
}
_MAX_WORKERS = 4

_BINDERS: dict[types.ToolName, Callable[[dict, dict], Any]] = {}


def _bind(tool_name: types.ToolName, params: dict, env: dict) -> Any:
    return _BINDERS[tool_name](params, env)


def _register(tool_name: types.ToolName):
    def wrap(fn):
        _BINDERS[tool_name] = fn
        return fn

    return wrap


@_register(types.ToolName.RESOLVE_SESSION)
def _bind_session(params, env):
    return types.ResolveSessionInput(
        year=params["year"],
        gp_name=params["gp_name"],
        session_type=types.SessionType.RACE,
    )


@_register(types.ToolName.RESOLVE_DRIVER)
def _bind_driver(params, env):
    return types.ResolveDriverInput(
        name_or_abbreviation=params["name"],
        session_key=env["session"].session_key,
    )


@_register(types.ToolName.FIND_PIT_STOPS)
def _bind_pit_stops(params, env):
    return types.FindPitStopsInput(
        session_key=env["session"].session_key,
        driver_number=env["driver"].driver_number,
    )


@_register(types.ToolName.GET_LAP_TELEMETRY_ARTIFACTS)
def _bind_artifacts(params, env):
    laps = _pit_laps(env["pits"].pit_stops[0], env["routed"].laps_window)
    return types.GetLapTelemetryArtifactsInput(
        session_key=env["session"].session_key,
        driver_number=env["driver"].driver_number,
        lap_numbers=laps,
    )


@_register(types.ToolName.COMPUTE_SPEED_WINDOW)
def _bind_window(params, env):
    stop = env["pits"].pit_stops[0]
    laps = _pit_laps(stop, params["laps_window"])
    before = tuple(lap for lap in laps if lap < stop.pit_in_lap)
    after = tuple(lap for lap in laps if lap > stop.pit_out_lap)
    return types.ComputeSpeedWindowInput(
        session_key=env["session"].session_key,
        driver_number=env["driver"].driver_number,
        before_laps=before,
        after_laps=after,
        metric=types.SpeedMetric(params["metric"]),
    )


@_register(types.ToolName.VERIFY_EVIDENCE)
def _bind_verify(params, env):
    required_laps: tuple[int, ...] = ()
    if "pits" in env:
        required_laps = _pit_laps(env["pits"].pit_stops[0], env["routed"].laps_window)
    return types.VerifyEvidenceInput(
        session_key=env["session"].session_key,
        driver_number=env["driver"].driver_number,
        required_laps=required_laps,
    )


@_register(types.ToolName.INSPECT_LAP_EVENTS)
def _bind_lap_events(params, env):
    return types.InspectLapEventsInput(
        session_key=env["session"].session_key,
        driver_number=env["driver"].driver_number,
        target_lap=params.get("target_lap"),
        window_laps=params.get("laps_window", 5),
    )


@_register(types.ToolName.STINT_DEGRADATION_SCANNER)
def _bind_stints(params, env):
    return types.StintDegradationInput(
        session_key=env["session"].session_key,
        driver_number=env["driver"].driver_number,
    )


@_register(types.ToolName.TELEMETRY_INSPECTOR)
def _bind_telemetry(params, env):
    return types.TelemetryInspectorInput(
        session_key=env["session"].session_key,
        driver_number=env["driver"].driver_number,
        lap_numbers=params.get("lap_numbers") or (),
        compare_driver_number=env["driver_cmp"].driver_number
        if "driver_cmp" in env
        else None,
        compare_lap_numbers=params.get("compare_lap_numbers") or (),
    )


def _pit_laps(stop: types.PitStop, laps_window: int) -> tuple[int, ...]:
    """Clean laps around a pitstop (pit in / pit out laps excluded)"""
    before = tuple(range(stop.pit_in_lap - laps_window, stop.pit_in_lap))
    after = tuple(range(stop.pit_out_lap + 1, stop.pit_out_lap + 1 + laps_window))
    return tuple(sorted(set(before) | set(after)))


def _session_node(routed: types.RoutedQuestion) -> types.DAGNode:
    return types.DAGNode(
        id="session",
        tool_name=types.ToolName.RESOLVE_SESSION,
        label="Resolve Session",
        description=f"Find the {routed.year} {routed.gp_name} race session",
        input_params={"year": routed.year, "gp_name": routed.gp_name},
    )


def _driver_node(routed: types.RoutedQuestion) -> types.DAGNode:
    return types.DAGNode(
        id="driver",
        tool_name=types.ToolName.RESOLVE_DRIVER,
        label="Resolve Driver",
        description=f"Resolve Driver {routed.driver_name}",
        depends_on=("session",),
        input_params={"name": routed.driver_name},
    )


def _verify_node(depends_on: tuple[str, ...]) -> types.DAGNode:
    return types.DAGNode(
        id="verify",
        tool_name=types.ToolName.VERIFY_EVIDENCE,
        label="Verify Evidence",
        description="Confirm the facts we are about to report exist",
        depends_on=depends_on,
    )


def build_dag(routed: types.RoutedQuestion) -> types.ExecutionDAG:
    """Turn a routed question into a concrete execution graph"""

    nodes: list[types.DAGNode] = [_session_node(routed), _driver_node(routed)]

    if routed.intent is types.Intent.PIT_STOP_SPEED_DELTA:
        nodes.append(
            types.DAGNode(
                id="pits",
                tool_name=types.ToolName.FIND_PIT_STOPS,
                label="Find Pit stops",
                description="Locate the driver's Pitstop",
                depends_on=(
                    "session",
                    "driver",
                ),
            )
        )
        nodes.append(
            types.DAGNode(
                id="artifacts",
                tool_name=types.ToolName.GET_LAP_TELEMETRY_ARTIFACTS,
                label="Fetch lap telemetry",
                description="Check weather telemetry artifacts exist around the stop",
                depends_on=("pits",),
            )
        )
        nodes.append(
            types.DAGNode(
                id="window",
                tool_name=types.ToolName.COMPUTE_SPEED_WINDOW,
                label="Compute Speed Window",
                description="Average Speed before and after the pitstop",
                depends_on=("pits",),
                input_params={
                    "laps_window": routed.laps_window,
                    "metric": types.SpeedMetric.DISTANCE_WEIGHTED_TELEMETRY.value,
                },
            )
        )
        nodes.append(_verify_node(depends_on=("artifacts", "window")))

    elif routed.intent is types.Intent.LAP_EVENT_INVESTIGATION:
        nodes.append(
            types.DAGNode(
                id="laps",
                tool_name=types.ToolName.INSPECT_LAP_EVENTS,
                label="Inspect Lap Events",
                description="Flag off-pace laps with a reason",
                depends_on=(
                    "session",
                    "driver",
                ),
                input_params={
                    "target_lap": routed.target_lap,
                    "laps_window": routed.laps_window,
                },
            )
        )
        nodes.append(_verify_node(depends_on=("session", "driver")))

    elif routed.intent is types.Intent.TYRE_DEGRADATION_ANALYSIS:
        nodes.append(
            types.DAGNode(
                id="stints",
                tool_name=types.ToolName.STINT_DEGRADATION_SCANNER,
                label="Scan stint degradation",
                description="Fit degradation slopes per tyre stint",
                depends_on=("session", "driver"),
            )
        )
        nodes.append(_verify_node(depends_on=("session", "driver")))

    else:  # The telemetry comparison
        nodes.append(
            types.DAGNode(
                id="driver_cmp",
                tool_name=types.ToolName.RESOLVE_DRIVER,
                label="Resolve Compare Driver",
                description=f"Resolve {routed.compare_driver_name}",
                depends_on=("session",),
                input_params={"name": routed.compare_driver_name},
            )
        )

        nodes.append(
            types.DAGNode(
                id="telemetry",
                tool_name=types.ToolName.TELEMETRY_INSPECTOR,
                label="Compare telemetry",
                description="Resampled lap traces for both drivers",
                depends_on=("session", "driver", "driver_cmp"),
                input_params={
                    "lap_numbers": (routed.target_lap,) if routed.target_lap else (),
                    "compare_lap_numbers": (routed.target_lap,)
                    if routed.target_lap
                    else (),
                },
            )
        )
        nodes.append(_verify_node(depends_on=("session", "driver", "driver_cmp")))

    edges = tuple(
        types.DAGEdge(source=dep, target=node.id)
        for node in nodes
        for dep in node.depends_on
    )

    return types.ExecutionDAG(nodes=tuple(nodes), edges=edges)


def topo_sort(dag: types.ExecutionDAG) -> tuple[str, ...]:
    """The node id's where the every node comes afterwards after its dependencies
    Kahn's algorithm: repeatedly emit the nodes whose dependencies are already emitted."""
    node_map = {n.id: n for n in dag.nodes}
    if len(node_map) != len(dag.nodes):
        raise types.DataError("duplicate node ids in the execution DAG")

    order: list[str] = []
    emitted: set[str] = set()
    while len(order) < len(dag.nodes):
        progressed = False
        for node in dag.nodes:
            if node.id in emitted:
                continue
            if all(dep in emitted for dep in node.depends_on):
                order.append(node.id)
                emitted.add(node.id)
                progressed = True
        if not progressed:
            raise types.DataError(
                "the execution DAG has a dependency cycle; every query graph must be acyclic"
            )

    return tuple(order)


def _execute_dag(
    dag: types.ExecutionDAG,
    routed: types.RoutedQuestion,
    progress: ProgressCallback | None = None,
) -> tuple[tuple[types.ToolCallRecord, ...], dict[str, Any], set[str]]:
    """Run any DAG. Independent branches run in parallel.
    Returns (trace, outputs, failed_ids). A node whose dependency failed is never executed"""

    node_map = {n.id: n for n in dag.nodes}
    order = topo_sort(dag)
    position = {nid: i for i, nid in enumerate(order)}

    env: dict[str, Any] = {"routed": routed}
    trace: list[types.ToolCallRecord] = []
    failed_ids: set[str] = set()

    def run_node(
        node: types.DAGNode,
    ) -> tuple[types.ToolCallRecord, Any | None, str | None]:
        _emit(
            progress,
            type="node_start",
            node_id=node.id,
            tool_name=node.tool_name.value,
            label=node.label,
        )
        start = time.perf_counter()
        try:
            inp = _bind(node.tool_name, node.input_params, env)
            result = _TOOLS[node.tool_name](inp)
            duration_ms = round((time.perf_counter() - start) * 1000, 2)
            call = types.ToolCallRecord(
                tool_name=node.tool_name,
                status="ok",
                input_summary=str(inp),
                output_summary=str(result)[:400],
                duration_ms=duration_ms,
                node_id=node.id,
            )
            _emit(
                progress,
                type="node_complete",
                node_id=node.id,
                status="ok",
                duration_ms=duration_ms,
                label=node.label,
                summary=str(result)[:200],
            )
            return call, result, None

        except Exception as exc:
            duration_ms = round((time.perf_counter() - start) * 1000, 2)
            call = types.ToolCallRecord(
                tool_name=node.tool_name,
                status="error",
                input_summary=str(env.get("routed")),
                error=str(exc),
                duration_ms=duration_ms,
                node_id=node.id,
            )
            _emit(
                progress,
                type="node_error",
                node_id=node.id,
                status="error",
                duration_ms=duration_ms,
                label=node.label,
            )
            return call, None, str(exc)

    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
        pending = set(node_map)
        in_flight: dict[str, tuple[Any, types.DAGNode]] = {}

        while pending or in_flight:
            # 1. submit every node whose dependencies are all done
            for nid in sorted(pending):
                node = node_map[nid]
                if all(dep in env for dep in node.depends_on):
                    pending.discard(nid)
                    in_flight[nid] = (pool.submit(run_node, node), node)

            # 2. if nothing can run, the rest are blocked by failed deps → fail-closed
            if not in_flight:
                for nid in sorted(pending):
                    node = node_map[nid]
                    blocked_by = [d for d in node.depends_on if d in failed_ids]
                    call = types.ToolCallRecord(
                        tool_name=node.tool_name,
                        status="error",
                        input_summary="",
                        error=f"dependency failed: {', '.join(blocked_by)}",
                        node_id=node.id,
                    )
                    trace.append(call)
                    failed_ids.add(nid)
                pending.clear()
                break

            # 3. wait for at least one future and harvest the completions
            futures = [f for f, _ in in_flight.values()]
            completed, _ = wait(futures, return_when=FIRST_COMPLETED)
            for nid, (fut, node) in list(in_flight.items()):
                if fut in completed:
                    del in_flight[nid]
                    call, result, error = fut.result()
                    trace.append(call)
                    if error is not None:
                        failed_ids.add(nid)
                    else:
                        env[nid] = result

    # 4. determinism: report the trace in graph order, not completion order
    trace.sort(key=lambda c: position[c.node_id])
    return tuple(trace), env, failed_ids


def _compose(
    question: str,
    routed: types.RoutedQuestion,
    outputs: dict[str, Any],
    failed_ids: set[str],
    trace: tuple[types.ToolCallRecord, ...],
    progress: ProgressCallback | None = None,
) -> types.AgentAnswer:
    """Build the final structured answer from the DAG's node outputs."""
    _emit(
        progress,
        type="stage",
        stage="compose",
        status="running",
        label="Composing evidence-backed answer",
    )

    refusals: list[str] = []
    if failed_ids:
        refusals.append("one or more evidence steps failed; the answer was not trusted")
    verify = outputs.get("verify")
    if verify is not None and not verify.passed and verify.refusal_reason:
        refusals.append(verify.refusal_reason)

    pit_stop = None
    if outputs.get("pits") and outputs["pits"].pit_stops:
        pit_stop = outputs["pits"].pit_stops[0]

    if refusals:
        answer = types.AgentAnswer(
            question=question,
            intent=routed.intent,
            answer=(
                "I could not fully answer that question. "
                + " ".join(refusals)
                + " No numbers were invented from missing data."
            ),
            refusals=tuple(refusals),
            session=outputs.get("session"),
            driver=outputs.get("driver"),
            pit_stop=pit_stop,
            speed_window=None,
            evidence=verify,
            trace=trace,
        )
        _emit(
            progress,
            type="stage",
            stage="compose",
            status="ok",
            label="Prepared refusal with available evidence",
        )
        return answer

    session = outputs["session"]
    driver = outputs["driver"]

    fallback_lines: list[str] = []
    if routed.intent is types.Intent.PIT_STOP_SPEED_DELTA:
        window = outputs["window"]
        fallback_lines.extend(
            [
                f"{driver.full_name} made a pit stop across lap {pit_stop.pit_in_lap} "
                f"into lap {pit_stop.pit_out_lap}.",
                "",
                f"Using telemetry sample average speed, the {routed.laps_window}-lap pre-stop "
                f"window averaged {window.before_avg_speed_kmh} km/h, while the "
                f"{routed.laps_window}-lap post-stop window averaged {window.after_avg_speed_kmh} km/h. "
                f"That is a {window.delta_kmh:+.1f} km/h change.",
            ]
        )
        if pit_stop.compound_before and pit_stop.compound_after:
            fallback_lines.append(
                f"He switched from {pit_stop.compound_before} to {pit_stop.compound_after} tyres."
            )
    elif routed.intent is types.Intent.LAP_EVENT_INVESTIGATION:
        laps = outputs["laps"]
        fallback_lines.append(
            f"{driver.full_name} had {laps.anomaly_count} off-pace lap(s) in that "
            f"session; median clean pace was {laps.median_pace_ms} ms."
        )
    elif routed.intent is types.Intent.TYRE_DEGRADATION_ANALYSIS:
        stints = outputs["stints"]
        fallback_lines.append(
            f"Found {len(stints.stints)} stint(s); the worst degradation stint was "
            f"stint {stints.worst_degradation_stint}."
        )
    else:  # TELEMETRY_COMPARISON
        telemetry = outputs["telemetry"]
        fallback_lines.append(
            f"Compared {len(telemetry.traces)} telemetry trace(s); full-throttle "
            f"share was {telemetry.full_throttle_pct}%."
        )
    fallback_text = "\n".join(fallback_lines)

    evidence_payload = {
        nid: asdict(val)
        for nid, val in outputs.items()
        if hasattr(val, "__dataclass_fields__")
    }
    compose_cost = 0.0
    try:
        answer_text, compose_cost = llm.compose_answer(question, evidence_payload)
    except types.LLMError:
        answer_text = fallback_text

    answer = types.AgentAnswer(
        question=question,
        intent=routed.intent,
        answer=answer_text,
        session=session,
        driver=driver,
        pit_stop=pit_stop,
        speed_window=outputs.get("window"),
        evidence=verify,
        telemetry_overlay=outputs.get("telemetry"),
        stint_degradation=outputs.get("stints"),
        trace=trace,
        cost_usd=compose_cost,
    )
    _emit(
        progress,
        type="stage",
        stage="compose",
        status="ok",
        label="Answer composed",
    )
    return answer


def run(question: str, progress: ProgressCallback | None = None) -> types.AgentAnswer:
    """Public entry point: one question in, one structured answer out."""
    _emit(
        progress,
        type="stage",
        stage="route",
        status="running",
        label="Routing question and extracting race entities",
    )
    try:
        routed, routing_cost = llm.route_question(question)
    except types.LLMError as exc:
        _emit(
            progress,
            type="stage",
            stage="route",
            status="error",
            label="Question router unavailable",
        )
        return types.AgentAnswer(
            question=question,
            intent=types.Intent.UNSUPPORTED,
            answer=(
                "I could not process that question because the question "
                f"router is unavailable {exc}"
            ),
            refusals=("llm_router_unavailable",),
        )
    _emit(
        progress,
        type="stage",
        stage="route",
        status="ok",
        label="Question routed",
    )

    if routed.intent is types.Intent.UNSUPPORTED:
        return types.AgentAnswer(
            question=question,
            intent=routed.intent,
            answer="I cannot answer that yet. v1 supports pit-stop, lap event, tyre degradation, and telemetry comparison questions.",
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

    if routed.intent is types.Intent.TELEMETRY_COMPARISON:
        if not routed.target_lap:
            return types.AgentAnswer(
                question=question,
                intent=routed.intent,
                answer="Which lap should I compare? Name a lap number, e.g. 'lap 34'.",
                refusals=("missing_lap",),
            )
        if not routed.compare_driver_name:
            return types.AgentAnswer(
                question=question,
                intent=routed.intent,
                answer="Which second driver should I compare against?",
                refusals=("missing_compare_driver",),
            )

    dag = build_dag(routed)
    _emit(
        progress,
        type="dag_init",
        status="ok",
        nodes=[asdict(n) for n in dag.nodes],
        edges=[asdict(e) for e in dag.edges],
        label="Execution graph prepared",
    )
    trace, outputs, failed_ids = _execute_dag(dag, routed, progress)
    answer = _compose(question, routed, outputs, failed_ids, trace, progress)
    return replace(answer, cost_usd=round(routing_cost + answer.cost_usd, 6))
