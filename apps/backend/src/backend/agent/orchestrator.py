"""
Agent orchestrator — routes with the LLM, executes read-only tools, composes.

Pipeline: route -> plan -> execute -> verify -> compose.
Every tool call is recorded in the trace for debugging and the future UI.
"""

from __future__ import annotations
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import asdict, replace
import time
from typing import Any, Callable

from backend.agent import circuit_breaker, context as agent_context
from backend.agent import llm, tools, types
from backend.config import settings

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
    types.ToolName.GAP_POSITION_SNAPSHOT: tools.gap_and_position_snapshot,
    types.ToolName.FETCH_RACE_CONTROL_WINDOW: tools.fetch_race_control_window,
    types.ToolName.FETCH_RADIO_MESSAGES: tools.fetch_radio_messages,
    types.ToolName.FETCH_WEATHER_WINDOW: tools.fetch_weather_window,
    types.ToolName.VERIFY_EVIDENCE: tools.verify_evidence,
}
_MAX_WORKERS = 4
MAX_DAG_NODES = 8


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
        session_type=env["routed"].session_type or types.SessionType.RACE,
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
    routed = env["routed"]
    if (
        "pits" in env
        and env["pits"].pit_stops
        and routed.intent
        in (
            types.Intent.PIT_STOP_SPEED_DELTA,
            types.Intent.RACE_CONTROL_EVENTS,
        )
    ):
        required_laps = _pit_laps(env["pits"].pit_stops[0], routed.laps_window)
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


def _bind_gap(params, env):
    target_lap = params.get("target_lap") or env["routed"].target_lap
    if target_lap is None and env.get("pits") and env["pits"].pit_stops:
        target_lap = env["pits"].pit_stops[0].pit_in_lap
    return types.GapPositionInput(
        session_key=env["session"].session_key,
        driver_number=env["driver"].driver_number,
        target_lap=target_lap,
    )


@_register(types.ToolName.FETCH_RACE_CONTROL_WINDOW)
def _bind_race_control(params, env):

    pits = env.get("pits")
    stop = pits.pit_stops[0] if pits and pits.pit_stops else None
    target = env["routed"].target_lap
    from_lap = params.get("from_lap") or (target or (stop.pit_in_lap if stop else None))
    to_lap = params.get("to_lap")
    if to_lap is None and stop:
        to_lap = stop.pit_out_lap

    return types.RaceControlWindowInput(
        session_key=env["session"].session_key,
        driver_number=env["driver"].driver_number,
        from_lap=from_lap,
        to_lap=to_lap,
    )


@_register(types.ToolName.FETCH_RADIO_MESSAGES)
def _bind_radio(params, env):
    pits = env.get("pits")
    stop = pits.pit_stops[0] if pits and pits.pit_stops else None
    target = env["routed"].target_lap
    from_lap = params.get("from_lap") or (target or (stop.pit_in_lap if stop else None))
    to_lap = params.get("to_lap")
    if to_lap is None and stop:
        to_lap = stop.pit_out_lap

    return types.RadioWindowInput(
        session_key=env["session"].session_key,
        driver_number=env["driver"].driver_number,
        from_lap=from_lap,
        to_lap=to_lap,
    )


@_register(types.ToolName.FETCH_WEATHER_WINDOW)
def _bind_weather(params, env):
    pits = env.get("pits")
    stop = pits.pit_stops[0] if pits and pits.pit_stops else None
    target = env["routed"].target_lap
    from_lap = params.get("from_lap") or (target or (stop.pit_in_lap if stop else None))
    to_lap = params.get("to_lap")
    if to_lap is None and stop:
        to_lap = stop.pit_out_lap

    return types.WeatherWindowInput(
        session_key=env["session"].session_key,
        from_lap=from_lap,
        to_lap=to_lap,
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


def _build_template_dag(routed: types.RoutedQuestion) -> types.ExecutionDAG:
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

    elif routed.intent is types.Intent.POSITION_GAP_TRACKING:
        nodes.append(
            types.DAGNode(
                id="pits",
                tool_name=types.ToolName.FIND_PIT_STOPS,
                label="Find Pit Stops",
                description="Locate the driver's pitstop laps",
                depends_on=("session", "driver"),
            )
        )
        nodes.append(
            types.DAGNode(
                id="gap",
                tool_name=types.ToolName.GAP_POSITION_SNAPSHOT,
                label="Gap and. Position Snapshot",
                description="Commulative-time ranking at one lap",
                depends_on=("pits",),
                input_params={"target_lap": routed.target_lap},
            )
        )
        nodes.append(_verify_node(depends_on=("pits", "gap")))

    elif routed.intent is types.Intent.RACE_CONTROL_EVENTS:
        nodes.append(
            types.DAGNode(
                id="pits",
                tool_name=types.ToolName.FIND_PIT_STOPS,
                label="Find Pit Stops",
                description="Locate the driver's pitstop laps to bound the race-control window",
                depends_on=("session", "driver"),
            )
        )
        nodes.append(
            types.DAGNode(
                id="rc",
                tool_name=types.ToolName.FETCH_RACE_CONTROL_WINDOW,
                label="Race Control Window",
                description="Scan flag/SC/VSC events around the pit window",
                depends_on=("pits",),
            )
        )
        nodes.append(_verify_node(depends_on=("pits", "rc")))

    elif routed.intent is types.Intent.TEAM_RADIO:
        nodes.append(
            types.DAGNode(
                id="pits",
                tool_name=types.ToolName.FIND_PIT_STOPS,
                label="Find Pit Stops",
                description="Locate the driver's pitstop laps to bound the radio window",
                depends_on=("session", "driver"),
            )
        )
        nodes.append(
            types.DAGNode(
                id="radio",
                tool_name=types.ToolName.FETCH_RADIO_MESSAGES,
                label="Team Radio Clips",
                description="Fetch team radio clips around the pit window",
                depends_on=("pits",),
            )
        )
        nodes.append(_verify_node(depends_on=("pits", "radio")))

    elif routed.intent is types.Intent.WEATHER_CORRELATION:
        nodes.append(
            types.DAGNode(
                id="pits",
                tool_name=types.ToolName.FIND_PIT_STOPS,
                label="Find Pit Stops",
                description="Locate the driver's pitstop laps to bound the weather window",
                depends_on=("session", "driver"),
            )
        )
        nodes.append(
            types.DAGNode(
                id="weather",
                tool_name=types.ToolName.FETCH_WEATHER_WINDOW,
                label="Weather Window",
                description="Fetch weather events around the pit window",
                depends_on=("pits",),
            )
        )
        nodes.append(_verify_node(depends_on=("pits", "weather")))

    elif routed.intent is types.Intent.QUALIFYING_LAP_ANALYSIS:
        nodes.append(
            types.DAGNode(
                id="qlaps",
                tool_name=types.ToolName.INSPECT_LAP_EVENTS,
                label="Qualifying Lap Events",
                description="Flag qualifying laps and sectors for the driver",
                depends_on=("session", "driver"),
                input_params={
                    "target_lap": routed.target_lap,
                    "laps_window": routed.laps_window,
                },
            )
        )
        nodes.append(
            types.DAGNode(
                id="telemetry",
                tool_name=types.ToolName.TELEMETRY_INSPECTOR,
                label="Inspect Telemetry",
                description="Lap trace for the driver's best qualifying lap",
                depends_on=("session", "driver"),
                input_params={
                    "lap_numbers": (routed.target_lap,) if routed.target_lap else (),
                },
            )
        )
        nodes.append(_verify_node(depends_on=("qlaps", "telemetry")))

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

    if len(nodes) > MAX_DAG_NODES:
        raise types.DataError(f"plan exceeds MAX_DAG_NODES={MAX_DAG_NODES}: got {len(nodes)} nodes")

    edges = tuple(
        types.DAGEdge(source=dep, target=node.id)
        for node in nodes
        for dep in node.depends_on
    )

    return types.ExecutionDAG(nodes=tuple(nodes), edges=edges)

def build_dag(routed: types.RoutedQuestion) -> types.ExecutionDAG:
    """Dispatch between the deterministic template planner and the LLM planner, gated by settings.agent_planner_mode.
    The LLM path can never take the request down: anything that isn't a valid
    completed plan degrades to the template DAG. 
    """
    if settings.agent_planner_mode == "llm":
        try:
            return _build_llm_dag(routed)
        except NotImplementedError:
            pass 
    return _build_template_dag(routed)

def _build_llm_dag(routed: types.RoutedQuestion) -> types.ExecutionDAG:
    try:
        from backend.agent import planner
    except ImportError as exc:
        raise NotImplementedError("T1.1 planner not shipped yet") from exc
    return planner.plan_dag(routed)

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
        stop = outputs["pits"].pit_stops[0]
        window = outputs["window"]
        fallback_lines.extend(
            [
                f"{driver.full_name} made a pit stop across lap {stop.pit_in_lap} "
                f"into lap {stop.pit_out_lap}.",
                "",
                f"Using telemetry sample average speed, the {routed.laps_window}-lap pre-stop "
                f"window averaged {window.before_avg_speed_kmh} km/h, while the "
                f"{routed.laps_window}-lap post-stop window averaged {window.after_avg_speed_kmh} km/h. "
                f"That is a {window.delta_kmh:+.1f} km/h change.",
            ]
        )
        if stop.compound_before and stop.compound_after:
            fallback_lines.append(
                f"He switched from {stop.compound_before} to {stop.compound_after} tyres."
            )

    elif routed.intent is types.Intent.LAP_EVENT_INVESTIGATION:
        laps = outputs["laps"]
        fallback_lines.append(
            f"{driver.full_name} had {laps.anomaly_count} off-pace lap(s) in that session; median clean pace was {laps.median_pace_ms} ms."
        )

    elif routed.intent is types.Intent.TYRE_DEGRADATION_ANALYSIS:
        stints = outputs["stints"]
        fallback_lines.append(
            f"Found {len(stints.stints)} stint(s); the worst degradation stint was stint {stints.worst_degradation_stint}."
        )

    elif routed.intent is types.Intent.POSITION_GAP_TRACKING:
        gap = outputs["gap"]
        pos = gap.position if gap.position is not None else "?"
        fallback_lines.append(
            f"At lap {gap.lap_number}, {driver.full_name} was P{pos}."
        )
        if gap.gap_to_leader_ms is not None:
            fallback_lines.append(
                f"On cumulative race time he was {gap.gap_to_leader_ms} ms behind the leader (#{gap.leader_number})."
            )
        if gap.car_ahead_number is not None:
            fallback_lines.append(
                f"The car ahead (#{gap.car_ahead_number}) was {gap.car_ahead_gap_ms} ms ahead; the car behind (#{gap.car_behind_number}) trailed by {gap.car_behind_gap_ms} ms."
            )

    elif routed.intent is types.Intent.RACE_CONTROL_EVENTS:
        rc = outputs["rc"]
        if rc.events:
            flags = ", ".join(
                sorted({f"{e.flag or e.category}@{e.lap_number}" for e in rc.events})
            )
            fallback_lines.append(
                f"Between laps {rc.from_lap} and {rc.to_lap}, race control reported: {flags}. Distinct safety-car/VSC periods: {rc.safety_car_periods} "
            )
        else:
            fallback_lines.append(
                f"No race control events found between laps {rc.from_lap} and {rc.to_lap}."
            )

    elif routed.intent is types.Intent.TEAM_RADIO:
        radio = outputs["radio"]
        if radio.messages:
            clips = len(radio.messages)
            first_date = radio.messages[0].date
            fallback_lines.append(
                f"Found {clips} team radio clip(s) for {driver.full_name} (first at {first_date})."
            )
            fallback_lines.append(
                f"The recordings are attached below — from_lap {radio.from_lap} to lap {radio.to_lap}."
            )
        else:
            fallback_lines.append(
                f"No team radio clips found for {driver.full_name} between laps {radio.from_lap} and {radio.to_lap}."
            )

    elif routed.intent is types.Intent.WEATHER_CORRELATION:
        weather = outputs["weather"]
        if weather.samples:
            fallback_lines.append(
                f"Across {weather.total_laps} lap(s) in the window, rain was present on {weather.rainfall_laps} "
                f"(~{weather.rain_share_pct}% of laps)."
            )
            if weather.track_temp_delta_c is not None:
                fallback_lines.append(
                    f"Track temperature swung {weather.track_temp_delta_c:+.1f}\u00b0C across the window."
                )
        else:
            fallback_lines.append(
                f"No weather events found between laps {weather.from_lap} and {weather.to_lap}."
            )

    elif routed.intent is types.Intent.QUALIFYING_LAP_ANALYSIS:
        laps = outputs["qlaps"]
        fallback_lines.append(
            f"{driver.full_name} had {laps.anomaly_count} off-pace qualifying lap(s); median clean pace was {laps.median_pace_ms} ms."
        )

    else:
        telemetry = outputs["telemetry"]
        fallback_lines.append(
            f"Compared {len(telemetry.traces)} telemetry trace(s); full-throttle share was {telemetry.full_throttle_pct}%."
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
        gap_position=outputs.get("gap"),
        race_control=outputs.get("rc"),
        team_radio=outputs.get("radio"),
        weather=outputs.get("weather"),
        trace=trace,
        cost_usd=compose_cost,
    )
    _emit(progress, type="stage", stage="compose", status="ok", label="Answer composed")
    return answer


def _clarify(
    question: str, routed: types.RoutedQuestion, missing: str, text: str, refusal: str
) -> types.AgentAnswer:
    """A structured counter question, No DAG runs here, the pipeline halts to ask the user for one missing enitity.

    The reply carries:
        - clarification -> {missing, question} rendered by the UI
        - routing_context -> entities resolved so far plus the missing spot, the next agent turn merges it
    """
    return types.AgentAnswer(
        question=question,
        intent=routed.intent,
        answer=text,
        refusals=(refusal,),
        clarification={"missing": [missing], "question": text},
        routing_context=agent_context.routed_to_context(routed, missing=[missing]),
    )


def run(question: str, progress: ProgressCallback | None = None, context: dict[str, Any] | None = None ) -> types.AgentAnswer:
    """Public entry point: one question in, one structured answer out"""
    if circuit_breaker.breaker.is_open():
        _emit(
            progress,
            type="stage",
            stage="route",
            status="error",
            label="LLM provider unavailable (circuit open)",
        )
        return types.AgentAnswer(
            question=question,
            intent=types.Intent.UNSUPPORTED,
            answer="The AI service is temporarily unavailable. Try again in a few minutes.",
            refusals=("llm_provider_unavailable",),
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
                f"I could not process that question because the question router is unavailable {exc}"
            ),
            refusals=("llm_router_unavailable",),
        )
    _emit(progress, type="stage", stage="route", status="ok", label="Question routed")

    if context is not None:
        routed = agent_context.merge_context(context, routed)

    if routed.intent is types.Intent.UNSUPPORTED:
        return types.AgentAnswer(
            question=question,
            intent=routed.intent,
            answer="I cannot answer that yet. v1 supports pit-stop, lap event, tyre degradation, telemetry comparison, position/gap, race control, qualifying, team radio, and weather questions.",
            refusals=("unsupported question",),
            routing_context=agent_context.routed_to_context(routed),
        )

    if not routed.driver_name:
        return _clarify(
            question,
            routed,
            missing="driver",
            text="Which driver should I look at? Name one, e.g. 'Sainz'.",
            refusal="missing_driver",
        )

    if not routed.gp_name or routed.year is None:
        return _clarify(
            question,
            routed,
            missing="race",
            text="Which race should I use? Name the year and Grand Prix, e.g. '2026 Monaco GP'.",
            refusal="missing_race",
        )

    if routed.intent is types.Intent.TELEMETRY_COMPARISON:
        if not routed.target_lap:
            return _clarify(
                question,
                routed,
                missing="target_lap",
                text="Which lap should I compare? Name a lap number, e.g. 'lap 34'.",
                refusal="missing_lap",
            )
        if not routed.compare_driver_name:
            return _clarify(
                question,
                routed,
                missing="compare_driver",
                text="Which second driver should I compare against?",
                refusal="missing_compare_driver",
            )
        
    try:
        dag = build_dag(routed)
    except types.DataError:
        return _clarify(
            question, routed, missing="race", text="That question needs too many steps. Ask me something more focused.",
            refusal="plan_too_large")
    
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
    return replace(
        answer,
        cost_usd=round(routing_cost + answer.cost_usd, 6),
        routing_context=agent_context.routed_to_context(routed),
    )
