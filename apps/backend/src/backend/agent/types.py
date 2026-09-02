"""
Typed contracts shared by all agent tools.

Every tool has a dataclass input and a dataclass output. This is the API
between the planner (LLM or rule-based) and the executor (deterministic Python).
"""

from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class Intent(str, Enum):
    """The categories of the question, v1 agent knows how to answer that."""

    PIT_STOP_SPEED_DELTA = "pit_stop_speed_delta"
    LAP_EVENT_INVESTIGATION = "lap_event_investigation"
    TYRE_DEGRADATION_ANALYSIS = "tyre_degradation_analysis"
    TELEMETRY_COMPARISON = "telemetry_comparison"
    POSITION_GAP_TRACKING = "position_gap_tracking"
    RACE_CONTROL_EVENTS = "race_control_events"
    QUALIFYING_LAP_ANALYSIS = "qualifying_lap_analysis"
    TEAM_RADIO = "team_radio"
    WEATHER_CORRELATION = "weather_correlation"
    UNSUPPORTED = "unsupported"


class SessionType(str, Enum):
    RACE = "R"
    QUALIFYING = "Q"
    SPRINT_QUALIFYING = "SQ"
    SPRINT = "S"
    PRACTICE_1 = "FP1"
    PRACTICE_2 = "FP2"
    PRACTICE_3 = "FP3"


class ToolName(str, Enum):
    RESOLVE_SESSION = "resolve_session"
    RESOLVE_DRIVER = "resolve_driver"
    FIND_PIT_STOPS = "find_pit_stops"
    GET_LAP_TELEMETRY_ARTIFACTS = "get_lap_telemetry_artifacts"
    COMPUTE_SPEED_WINDOW = "compute_speed_window"
    INSPECT_LAP_EVENTS = "inspect_lap_events"
    STINT_DEGRADATION_SCANNER = "stint_degradation_scanner"
    TELEMETRY_INSPECTOR = "telemetry_inspector"
    VERIFY_EVIDENCE = "verify_evidence"
    FETCH_RACE_CONTROL_WINDOW = "fetch_race_control_window"
    GAP_POSITION_SNAPSHOT = "gap_position_snapshot"
    FETCH_RADIO_MESSAGES = "fetch_radio_messages"
    FETCH_WEATHER_WINDOW = "fetch_weather_window"


@dataclass(frozen=True)
class DAGNode:
    """One node in the execuation graph = one tool call"""

    id: str
    tool_name: ToolName
    label: str
    description: str = ""
    depends_on: tuple[str, ...] = ()
    input_params: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class DAGEdge:
    """A directed dependency: source must finish before the target starts"""

    source: str
    target: str
    label: str = ""


@dataclass(frozen=True)
class ExecutionDAG:
    """The whole graph. Edges are usually derived from each node's depends_on,
    but storing them explicitly lets the UI render the graph without re-deriving"""

    nodes: tuple[DAGNode, ...]
    edges: tuple[DAGEdge, ...] = ()


class AgentError(Exception):
    """Base class for all agent pipeline failures."""


class NotFoundError(AgentError):
    """Raised when a tool cannot find the requested data."""


class DataError(AgentError):
    """Raised when data exists but is unusable (e.g. missing columns)."""


class LLMError(AgentError):
    """Raised when the OpenRouter/LLM adapter cannot produce output."""


# Tool Inputs ---------------------
@dataclass(frozen=True)
class ResolveSessionInput:
    """A human friendly session name, e.g. "2023 Bahrain GP FP1" or "2023 Bahrain GP Sprint"."""

    year: int
    gp_name: str
    session_type: SessionType = SessionType.RACE

    def __post_init__(self):
        if not isinstance(self.gp_name, str) or not self.gp_name.strip():
            raise ValueError("gp_name must be a non-empty string")
        if self.year < 1950:
            raise ValueError("year must be 1950 or later")


@dataclass(frozen=True)
class ResolveDriverInput:
    """Resolve "HAM" , "Lewis Hamilton", "44" to a session specific driver."""

    name_or_abbreviation: str
    session_key: int


@dataclass(frozen=True)
class FindPitStopsInput:
    session_key: int
    driver_number: int


@dataclass(frozen=True)
class GetLapTelemetryArtifactsInput:
    session_key: int
    driver_number: int
    lap_numbers: tuple[int, ...] = ()


class SpeedMetric(str, Enum):
    TELEMETRY_SAMPLE_MEAN = "telemetry_sample_mean"
    LAP_TIME_DERIVED = "lap_time_derived"
    DISTANCE_WEIGHTED_TELEMETRY = "distance_weighted_telemetry"


@dataclass(frozen=True)
class ComputeSpeedWindowInput:
    session_key: int
    driver_number: int
    before_laps: tuple[int, ...] = ()
    after_laps: tuple[int, ...] = ()
    metric: SpeedMetric = SpeedMetric.TELEMETRY_SAMPLE_MEAN


@dataclass(frozen=True)
class VerifyEvidenceInput:
    session_key: int
    driver_number: int
    required_laps: tuple[int, ...] = ()
    required_tool_names: tuple[ToolName, ...] = ()


# Tool Outputs ---------------------
@dataclass(frozen=True)
class ResolvedSession:
    session_key: int
    year: int
    gp_name: str
    session_type: SessionType
    session_name: str | None = None


@dataclass(frozen=True)
class ResolvedDriver:
    driver_number: int
    abbreviation: str
    full_name: str
    team_name: str | None = None


@dataclass(frozen=True)
class PitStop:
    stop_index: int
    pit_in_lap: int
    pit_out_lap: int
    compound_before: str | None = None
    compound_after: str | None = None


@dataclass(frozen=True)
class PitStopsResult:
    driver_number: int
    pit_stops: tuple[PitStop, ...] = ()


@dataclass(frozen=True)
class TelemetryArtifact:
    session_key: int
    driver_number: int
    lap_number: int
    storage_key: str
    storage_backend: str
    format: str
    sample_count: int
    size_bytes: int
    checksum_sha256: str


@dataclass(frozen=True)
class LapTelemetryResult:
    session_key: int
    driver_number: int
    artifacts: tuple[TelemetryArtifact, ...] = ()


@dataclass(frozen=True)
class SpeedWindowResult:
    session_key: int
    driver_number: int
    metric: SpeedMetric
    before_laps: tuple[int, ...]
    after_laps: tuple[int, ...]
    before_avg_speed_kmh: float | None
    after_avg_speed_kmh: float | None
    delta_kmh: float | None
    sample_count_before: int = 0
    sample_count_after: int = 0


@dataclass(frozen=True)
class GapPositionInput:
    session_key: int
    driver_number: int
    target_lap: int | None = None


@dataclass(frozen=True)
class GapPositionSnapshot:
    lap_number: int
    position: int | None
    cumulative_ms: int | None
    leader_number: int | None
    leader_cumulative_ms: int | None
    gap_to_leader_ms: int | None
    car_ahead_number: int | None
    car_ahead_gap_ms: int | None
    car_behind_number: int | None
    car_behind_gap_ms: int | None


@dataclass(frozen=True)
class RaceControlWindowInput:
    """A lap window (inclusive) to scan for flag/SC events."""

    session_key: int
    driver_number: int | None = None
    from_lap: int | None = None
    to_lap: int | None = None


@dataclass(frozen=True)
class RaceControlEvent:
    """One flag / safety car / VSC event."""

    category: str | None
    flag: str | None
    scope: str | None
    driver_number: int | None
    sector: int | None
    lap_number: int | None
    message: str | None


@dataclass(frozen=True)
class RaceControlWindowResult:
    """All events intersecting the requested window."""

    from_lap: int | None
    to_lap: int | None
    events: tuple[RaceControlEvent, ...]
    safety_car_periods: int = 0


@dataclass(frozen=True)
class RadioWindowInput:
    """A lap window (inclusive) to scan for team radio clips for a driver."""

    session_key: int
    driver_number: int
    from_lap: int | None = None
    to_lap: int | None = None


@dataclass(frozen=True)
class RadioMessage:
    """One team radio clip, optionally with a transcript."""

    date: str | None
    recording_url: str | None
    transcript: str | None = None


@dataclass(frozen=True)
class RadioWindowResult:
    """All radio clips intersecting the requested window."""

    driver_number: int
    from_lap: int | None
    to_lap: int | None
    messages: tuple[RadioMessage, ...]
    clip_count: int = 0


@dataclass(frozen=True)
class WeatherWindowInput:
    """A lap window (inclusive) to scan for weather events in a session."""

    session_key: int
    from_lap: int | None = None
    to_lap: int | None = None


@dataclass(frozen=True)
class WeatherEventSample:
    """One weather sample, correlated to a lap where possible."""

    timestamp: str | None
    lap_number: int | None
    track_temp_c: float | None
    air_temp_c: float | None
    humidity_pct: float | None
    rainfall: bool
    wind_speed_ms: float | None


@dataclass(frozen=True)
class WeatherWindowResult:
    """All weather events intersecting the requested window, plus derived rain stats."""

    from_lap: int | None
    to_lap: int | None
    samples: tuple[WeatherEventSample, ...]
    rainfall_laps: int = 0
    total_laps: int = 0
    rain_share_pct: float = 0.0
    track_temp_delta_c: float | None = None


@dataclass(frozen=True)
class RoutedQuestion:
    """Entities the LLM Router extracted form the raw question"""

    intent: Intent
    question: str = ""
    driver_name: str | None = None
    compare_driver_name: str | None = None
    gp_name: str | None = None
    year: int | None = None
    laps_window: int = 3
    target_lap: int | None = None
    session_type: SessionType | None = None


@dataclass(frozen=True)
class EvidenceCheck:
    name: str
    passed: bool
    detail: str | None = None


@dataclass(frozen=True)
class VerifyEvidenceResult:
    passed: bool
    checks: tuple[EvidenceCheck, ...] = ()
    refusal_reason: str | None = None


# Orchestrator


@dataclass(frozen=True)
class Plan:
    """The structured plan produced by the planner . v1 is only rule based."""

    intent: Intent
    question: str
    session_selector: ResolveSessionInput | None = None
    driver_selector: str | None = None
    laps_before: int = 3
    laps_after: int = 3


@dataclass(frozen=True)
class InspectLapEventsInput:
    session_key: int
    driver_number: int
    target_lap: int | None = None
    window_laps: int = 5


@dataclass(frozen=True)
class LapEvent:
    """One lap summary, sector time, compound, degradation, anomalies."""

    lap_number: int
    lap_time_ms: int | None
    delta_to_median_ms: int | None
    sector1_ms: int | None
    sector2_ms: int | None
    sector3_ms: int | None
    compound: str | None
    stint: int | None
    is_pit_in: bool
    is_pit_out: bool
    is_anomaly: bool
    rainfall: bool
    track_status: str | None
    anomaly_reason: str | None = None  # pit_stop / rain_onset / yellow_flag_vsc / ...
    quali_segment: int | None = None


@dataclass(frozen=True)
class InspectLapEventsResult:
    """Every lap of the driver, each marked with whether it was off-pace."""

    session_key: int
    driver_number: int
    target_lap: int | None
    median_pace_ms: int
    events: tuple[LapEvent, ...]
    anomaly_count: int


# -- Stint degradation


@dataclass(frozen=True)
class StintDegradationInput:
    """The parameters for the stint_degradation_scanner tool"""

    session_key: int
    driver_number: int
    stint_index: int | None = None


@dataclass(frozen=True)
class StintSummary:
    """Degradation metrics for one tyre stint"""

    stint_index: int
    compound: str
    start_lap: int
    end_lap: int
    total_laps: int
    initial_pace_ms: int
    final_pace_ms: int
    degradation_slope_ms_per_lap: float
    cliff_detected: bool
    cliff_lap: int | None
    laps: tuple["StintLapPoint", ...] = ()


@dataclass(frozen=True)
class StintLapPoint:
    """One clean lap inside a stint — the raw (tyre_age, lap_time) scatter point."""

    lap_number: int
    tyre_age: int
    lap_time_ms: int


@dataclass(frozen=True)
class StintDegradationResult:
    """Output of the stint_degradation_scanner tool"""

    session_key: int
    driver_number: int
    stints: tuple[StintSummary, ...]
    worst_degradation_stint: int | None


# Telemetry Inspector


@dataclass(frozen=True)
class TelemetryInspectorInput:
    """Parameters for the telemetry inspector tool"""

    session_key: int
    driver_number: int
    lap_numbers: tuple[int, ...]
    compare_driver_number: int | None = None
    compare_lap_numbers: tuple[int, ...] = ()
    max_samples_per_lap: int = 600


@dataclass(frozen=True)
class TelemetrySamplePoint:
    """One resampled telmetry sample"""

    distance_m: float
    speed_kmh: float
    throttle_pct: float
    brake: bool
    gear: int
    drs: int
    x_pos: float | None
    y_pos: float | None


@dataclass(frozen=True)
class TelemetryLapTrace:
    """One lap's full telemetry trace, resampled to max_samples_per_lap points."""

    driver_number: int
    driver_abbreviation: str
    lap_number: int
    samples: tuple[TelemetrySamplePoint, ...]


@dataclass(frozen=True)
class TelemetryInspectorResult:
    """The output of the telemetry inspector"""

    session_key: int
    traces: tuple[TelemetryLapTrace, ...]
    speed_delta_apex_kmh: float | None
    full_throttle_pct: float
    heavy_braking_zones_count: int


@dataclass(frozen=True)
class ToolCallRecord:
    """One record of a tool call, produced by the orchestrator and consumed by the executor."""

    tool_name: ToolName
    status: str  # "ok" or "error"
    input_summary: str
    output_summary: str | None = None
    error: str | None = None
    duration_ms: int | None = None
    node_id: str | None = None


@dataclass(frozen=True)
class AgentAnswer:
    """The final answer produced by the orchestrator, after executing the plan."""

    question: str
    intent: Intent
    answer: str
    refusals: tuple[str, ...] = ()
    session: ResolvedSession | None = None
    driver: ResolvedDriver | None = None
    pit_stop: PitStop | None = None
    speed_window: SpeedWindowResult | None = None
    evidence: VerifyEvidenceResult | None = None
    telemetry_overlay: TelemetryInspectorResult | None = None
    stint_degradation: StintDegradationResult | None = None
    gap_position: GapPositionSnapshot | None = None
    trace: tuple[ToolCallRecord, ...] = ()
    cost_usd: float = 0.0
    clarification: dict | None = None
    routing_context: dict | None = None
    race_control: RaceControlWindowResult | None = None
    team_radio: RadioWindowResult | None = None
    weather: WeatherWindowResult | None = None
