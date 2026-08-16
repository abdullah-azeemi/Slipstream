"""
Read-only agent tools — deterministic functions that query Postgres.

Rules:
- SQL lives here, inside these functions. It never comes from the LLM.
- Each tool takes one typed input dataclass and returns one typed output.
- Tools never write to the database.
"""

from __future__ import annotations
import gzip
import io
import json
from pathlib import Path

from sqlalchemy import text

from backend import extensions
from backend.config import settings
from backend.agent import types


def resolve_session(inp: types.ResolveSessionInput) -> types.ResolvedSession:
    """Find the most recent session matching the given year, GP name, and session type."""
    with extensions.engine.connect() as conn:
        row = (
            conn.execute(
                text(
                    """
                    SELECT session_key, year, gp_name, session_type, session_name 
                    FROM sessions
                    WHERE year = :year AND gp_name ILIKE :gp_pattern AND session_type = :stype
                    ORDER BY date_start DESC NULLS LAST
                    LIMIT 1
                    """
                ),
                {
                    "year": inp.year,
                    "gp_pattern": f"%{inp.gp_name}%",
                    "stype": inp.session_type.value,
                },
            )
            .mappings()
            .first()
        )
    if row is None:
        raise types.NotFoundError(
            f"No {inp.session_type.value} session found for {inp.gp_name} {inp.year}"
        )

    return types.ResolvedSession(
        session_key=row["session_key"],
        year=row["year"],
        gp_name=row["gp_name"],
        session_type=types.SessionType(row["session_type"]),
        session_name=row["session_name"],
    )


def resolve_driver(inp: types.ResolveDriverInput) -> types.ResolvedDriver:
    """Resolve a driver title by its abbervaition, name, or number to a session specific driver.

    It uses a signle query with three OR conditions to find the driver. If multiple drivers match, it returns the one with the lowest driver number.
    """

    term = inp.name_or_abbreviation.strip()
    if term.isdigit():
        numeric = int(term)
    else:
        numeric = None

    params = {
        "sk": inp.session_key,
        "num": numeric,
        "abbr": term,
        "name": f"%{term}%",
    }

    with extensions.engine.connect() as conn:
        row = (
            conn.execute(
                text(
                    """
                    SELECT d.driver_number, d.abbreviation, d.full_name, d.team_name
                    FROM drivers d
                    WHERE d.session_key = :sk
                      AND (
                        d.driver_number = :num
                        OR d.abbreviation ILIKE :abbr
                        OR d.full_name ILIKE :name
                      )
                    ORDER BY d.driver_number
                    LIMIT 1
                    """
                ),
                params,
            )
            .mappings()
            .first()
        )

    if row is None:
        raise types.NotFoundError(
            f"Driver '{inp.name_or_abbreviation}' not found in session {inp.session_key}"
        )

    return types.ResolvedDriver(
        driver_number=row["driver_number"],
        abbreviation=row["abbreviation"],
        full_name=row["full_name"],
        team_name=row["team_name"],
    )


def _derive_pit_stops(laps: list[dict]) -> list[types.PitStop]:
    """
    Derive pit stops from a list of lap dictionaries.
    """
    stops: list[types.PitStop] = []
    for i, lap in enumerate(laps):
        if lap["pit_in_time_ms"] is None:
            continue

        pit_in_lap = lap["lap_number"]

        pit_out_lap = None
        for following in laps[i + 1 :]:
            if following["pit_out_time_ms"] is not None:
                pit_out_lap = following["lap_number"]
                break
        if pit_out_lap is None:
            pit_out_lap = pit_in_lap + 1

        compound_before = next(
            (p["compound"] for p in reversed(laps[:i]) if p["compound"]), None
        )
        compound_after = next(
            (p["compound"] for p in laps[i + 1 :] if p["compound"]), None
        )

        stops.append(
            types.PitStop(
                stop_index=len(stops) + 1,
                pit_in_lap=pit_in_lap,
                pit_out_lap=pit_out_lap,
                compound_before=compound_before,
                compound_after=compound_after,
            )
        )
    return stops


def find_pit_stops(inp: types.FindPitStopsInput) -> types.PitStopsResult:
    """Detect pit stops for one driver in one session."""
    with extensions.engine.connect() as conn:
        rows = (
            conn.execute(
                text("""
                    SELECT lap_number, pit_in_time_ms, pit_out_time_ms, compound
                    FROM lap_times
                    WHERE session_key = :sk
                      AND driver_number = :dn
                      AND deleted = FALSE
                    ORDER BY lap_number ASC
                """),
                {"sk": inp.session_key, "dn": inp.driver_number},
            )
            .mappings()
            .all()
        )

    stops = _derive_pit_stops([dict(r) for r in rows])
    return types.PitStopsResult(driver_number=inp.driver_number, pit_stops=tuple(stops))


def get_lap_telemetry_artifacts(
    inp: types.GetLapTelemetryArtifactsInput,
) -> types.LapTelemetryResult:
    """
    Return artifact metadata (not raw samples) for the requested laps.
    This proves telemetry exists before we compute speed from it.
    """
    if not inp.lap_numbers:
        raise types.DataError("lap_numbers is required to load telemetry artifacts")

    with extensions.engine.connect() as conn:
        rows = (
            conn.execute(
                text("""
                    SELECT
                        session_key, driver_number, lap_number,
                        storage_key, storage_backend, format,
                        sample_count, size_bytes, checksum_sha256
                    FROM telemetry_artifacts
                    WHERE session_key = :sk
                      AND driver_number = :dn
                      AND lap_number = ANY(:laps)
                    ORDER BY lap_number ASC
                """),
                {
                    "sk": inp.session_key,
                    "dn": inp.driver_number,
                    "laps": list(inp.lap_numbers),
                },
            )
            .mappings()
            .all()
        )

    artifacts = tuple(types.TelemetryArtifact(**dict(r)) for r in rows)
    return types.LapTelemetryResult(
        session_key=inp.session_key,
        driver_number=inp.driver_number,
        artifacts=artifacts,
    )


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _read_artifact_speed_samples(artifact: types.TelemetryArtifact) -> list[float]:
    """Read speed kmph values from a telemtry artifact (local file or S3) and return them as a list of floats."""

    if artifact.storage_backend == "local" and artifact.format == "json.gz":
        path = Path(settings.telemetry_artifact_dir) / artifact.storage_key
        if not path.exists():
            raise types.DataError(f"artifact file not found : {path}")
        with gzip.open(path, "rb") as f:
            payload = json.loads(f.read().decode("utf-8"))
        speeds = [
            float(s["speed_kmh"])
            for s in payload.get("samples", [])
            if s.get("speed_kmh") is not None
        ]

    elif artifact.storage_backend == "local" and artifact.format == "parquet":
        import pyarrow.parquet as pq

        path = Path(settings.telemetry_artifact_dir) / artifact.storage_key
        if not path.exists():
            raise types.DataError(f"artifact file not found : {path}")
        table = pq.read_parquet(path)
        speeds = [
            float(v) for v in table.column("speed_kmh").to_pylist() if v is not None
        ]

    elif artifact.storage_backend == "r2" and artifact.format == "parquet":
        import boto3
        import pyarrow.parquet as pq

        client = boto3.client(
            "s3",
            endpoint_url=settings.r2_endpoint_url,
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            region_name="auto",
        )
        obj = client.get_object(
            Bucket=settings.telemetry_artifact_bucket,
            Key=artifact.storage_key,
        )
        table = pq.read_table(io.BytesIO(obj["Body"].read()))
        speeds = [
            float(v) for v in table.column("speed_kmh").to_pylist() if v is not None
        ]

    else:
        raise types.DataError(
            f"unsupported artifact: {artifact.storage_backend}/{artifact.format}"
        )

    return speeds


def compute_speed_window(inp: types.ComputeSpeedWindowInput) -> types.SpeedWindowResult:
    """
    Average telemetry speed before and after a given lap window for a driver in a session.
    """
    if inp.metric is not types.SpeedMetric.TELEMETRY_SAMPLE_MEAN:
        raise types.DataError(f"unsupported metric: {inp.metric}")
    if not inp.before_laps and not inp.after_laps:
        raise types.DataError("before_laps and after_laps cannot both be empty")

    laps_needed = tuple(sorted(set(inp.before_laps) | set(inp.after_laps)))
    artifacts = get_lap_telemetry_artifacts(
        types.GetLapTelemetryArtifactsInput(
            session_key=inp.session_key,
            driver_number=inp.driver_number,
            lap_numbers=laps_needed,
        )
    ).artifacts
    by_lap = {a.lap_number: a for a in artifacts}

    def _window_mean(lap_window: tuple[int, ...]) -> tuple[float, int]:
        missing = [ln for ln in lap_window if ln not in by_lap]
        if missing:
            raise types.DataError(f"no telemetry artifact for laps {missing}")
        flat = [
            v for lap in lap_window for v in _read_artifact_speed_samples(by_lap[lap])
        ]
        if not flat:
            raise types.DataError("telemetry artifacts contain zero speed samples")
        return _mean(flat), len(flat)

    before_avg, before_count = (
        _window_mean(tuple(inp.before_laps)) if inp.before_laps else (None, 0)
    )
    after_avg, after_count = (
        _window_mean(tuple(inp.after_laps)) if inp.after_laps else (None, 0)
    )

    delta = None
    if before_avg is not None and after_avg is not None:
        delta = round(after_avg - before_avg, 2)

    return types.SpeedWindowResult(
        session_key=inp.session_key,
        driver_number=inp.driver_number,
        metric=inp.metric,
        before_laps=inp.before_laps,
        after_laps=inp.after_laps,
        before_avg_speed_kmh=round(before_avg, 2) if before_avg is not None else None,
        after_avg_speed_kmh=round(after_avg, 2) if after_avg is not None else None,
        delta_kmh=delta,
        sample_count_before=before_count,
        sample_count_after=after_count,
    )


def _assess(checks: list[types.EvidenceCheck]) -> types.VerifyEvidenceResult:
    """Pure verdict: any failed check becomes a refusal with a readable reason."""
    failed = [c for c in checks if not c.passed]
    if not failed:
        return types.VerifyEvidenceResult(passed=True, checks=tuple(checks))
    reasons = "; ".join(f"{c.name}: {c.detail or 'failed'}" for c in failed)
    return types.VerifyEvidenceResult(
        passed=False,
        checks=tuple(checks),
        refusal_reason=reasons,
    )


def verify_evidence(inp: types.VerifyEvidenceInput) -> types.VerifyEvidenceResult:
    """Check the evidence exists before we trust the computed answer.

    required_tool_names is reserved for the planner trace (Lesson 5+).
    """
    checks: list[types.EvidenceCheck] = []

    with extensions.engine.connect() as conn:
        session_found = (
            conn.execute(
                text("SELECT 1 FROM sessions WHERE session_key = :sk LIMIT 1"),
                {"sk": inp.session_key},
            ).first()
            is not None
        )
        checks.append(
            types.EvidenceCheck(
                "session_exists", session_found, detail=f"session {inp.session_key}"
            )
        )

        driver_found = (
            conn.execute(
                text(
                    "SELECT 1 FROM drivers WHERE session_key = :sk AND driver_number = :dn LIMIT 1"
                ),
                {"sk": inp.session_key, "dn": inp.driver_number},
            ).first()
            is not None
        )
        checks.append(
            types.EvidenceCheck(
                "driver_exists", driver_found, detail=f"driver {inp.driver_number}"
            )
        )

    if inp.required_laps:
        artifacts = get_lap_telemetry_artifacts(
            types.GetLapTelemetryArtifactsInput(
                session_key=inp.session_key,
                driver_number=inp.driver_number,
                lap_numbers=inp.required_laps,
            )
        ).artifacts
        found_laps = {a.lap_number for a in artifacts}
        missing = sorted(set(inp.required_laps) - found_laps)
        checks.append(
            types.EvidenceCheck(
                "artifacts_cover_required_laps",
                not missing,
                detail=f"missing laps {missing}"
                if missing
                else "all required laps present",
            )
        )

    return _assess(checks)
