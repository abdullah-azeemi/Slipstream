"""
Typed contracts shared by all agent tools.

Every tool has a dataclass input and a dataclass output. This is the API
between the planner (LLM or rule-based) and the executor (deterministic Python).
"""

from __future__ import annotations
from dataclasses import dataclass
from enum import Enum


class Intent(str, Enum):
    """The categories of the question, v1 agent knows how to answer that."""

    PIT_STOP_SPEED_DELTA = "pit_stop_speed_delta"
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
    VERIFY_EVIDENCE = "verify_evidence"


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
class EvidenceCheck:
    name: str
    passed: bool
    detail: str | None = None


@dataclass(frozen=True)
class VerifyEvidenceResult:
    passed: bool
    checks: tuple[EvidenceCheck, ...] = ()
    refusal_reason: str | None = None


@dataclass(frozen=True)
class RoutedQuestion:
    """Entities the LLM router extracted from the raw question."""

    intent: Intent
    driver_name: str | None = None
    gp_name: str | None = None
    year: int | None = None
    laps_window: int = 3


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
class ToolCallRecord:
    """One record of a tool call, produced by the orchestrator and consumed by the executor."""

    tool_name: ToolName
    status: str  # "ok" or "error"
    input_summary: str
    output_summary: str | None = None
    error: str | None = None
    duration_ms: int | None = None


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
    trace: tuple[ToolCallRecord, ...] = ()
    cost_usd: float = 0.0
