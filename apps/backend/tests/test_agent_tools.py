"""Unit tests for the pure (DB-free) agent tool helpers."""

import gzip
import json
from pathlib import Path

from backend.agent import tools, types
from backend.config import settings


def _lap(lap_number, pit_in=None, pit_out=None, compound=None):
    return {
        "lap_number": lap_number,
        "pit_in_time_ms": pit_in,
        "pit_out_time_ms": pit_out,
        "compound": compound,
    }


def test_derive_pit_stops_handles_single_stop():
    laps = [
        _lap(1, compound="MEDIUM"),
        _lap(2, compound="MEDIUM"),
        _lap(3, pit_in=123456.0, compound="MEDIUM"),
        _lap(4, pit_out=234567.0, compound="HARD"),
        _lap(5, compound="HARD"),
    ]
    stops = tools._derive_pit_stops(laps)

    assert len(stops) == 1
    assert stops[0].stop_index == 1
    assert stops[0].pit_in_lap == 3
    assert stops[0].pit_out_lap == 4
    assert stops[0].compound_before == "MEDIUM"
    assert stops[0].compound_after == "HARD"


def test_derive_pit_stops_multiple_stops_are_numbered():
    laps = [
        _lap(1, compound="SOFT"),
        _lap(2, pit_in=1.0, compound="SOFT"),
        _lap(3, pit_out=2.0, compound="MEDIUM"),
        _lap(4, compound="MEDIUM"),
        _lap(5, pit_in=3.0, compound="MEDIUM"),
        _lap(6, pit_out=4.0, compound="HARD"),
    ]
    stops = tools._derive_pit_stops(laps)

    assert [s.stop_index for s in stops] == [1, 2]
    assert [s.pit_in_lap for s in stops] == [2, 5]
    assert [s.pit_out_lap for s in stops] == [3, 6]
    assert stops[1].compound_before == "MEDIUM"
    assert stops[1].compound_after == "HARD"


def test_derive_pit_stops_missing_pit_out_defaults_to_next_lap():
    laps = [
        _lap(10, compound="MEDIUM"),
        _lap(11, pit_in=1.0, compound="MEDIUM"),
    ]
    stops = tools._derive_pit_stops(laps)

    assert len(stops) == 1
    assert stops[0].pit_in_lap == 11
    assert stops[0].pit_out_lap == 12
    assert stops[0].compound_before == "MEDIUM"
    assert stops[0].compound_after is None


def test_derive_pit_stops_no_pit_laps_returns_empty():
    laps = [_lap(1, compound="SOFT"), _lap(2, compound="SOFT")]
    assert tools._derive_pit_stops(laps) == []


# ── _mean ─────────────────────────────────────────────────────────────────────


def test_mean_averages_values():
    assert tools._mean([100.0, 200.0, 300.0]) == 200.0


def test_mean_empty_returns_zero():
    assert tools._mean([]) == 0.0


# ── _read_artifact_speed_samples ──────────────────────────────────────────────


def _write_json_gz_artifact(path: Path, samples: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wb") as f:
        f.write(
            json.dumps(
                {
                    "session_key": 1,
                    "driver_number": 1,
                    "lap_number": 1,
                    "samples": samples,
                }
            ).encode("utf-8")
        )


def test_read_artifact_speed_samples_json_gz(monkeypatch, tmp_path):
    artifact = types.TelemetryArtifact(
        session_key=1,
        driver_number=1,
        lap_number=1,
        storage_key="telemetry/session_1/driver_1/lap_1.json.gz",
        storage_backend="local",
        format="json.gz",
        sample_count=3,
        size_bytes=100,
        checksum_sha256="x",
    )
    _write_json_gz_artifact(
        Path(tmp_path) / artifact.storage_key,
        [
            {"speed_kmh": 200.0},
            {"speed_kmh": 220.0},
            {"speed_kmh": None},
        ],
    )
    monkeypatch.setattr(settings, "telemetry_artifact_dir", str(tmp_path))

    speeds = tools._read_artifact_speed_samples(artifact)

    assert speeds == [200.0, 220.0]


def test_read_artifact_speed_samples_missing_file_raises(monkeypatch, tmp_path):
    artifact = types.TelemetryArtifact(
        session_key=1,
        driver_number=1,
        lap_number=999,
        storage_key="nonexistent.json.gz",
        storage_backend="local",
        format="json.gz",
        sample_count=0,
        size_bytes=0,
        checksum_sha256="x",
    )
    monkeypatch.setattr(settings, "telemetry_artifact_dir", str(tmp_path))

    try:
        tools._read_artifact_speed_samples(artifact)
    except types.DataError as exc:
        assert "not found" in str(exc)
    else:
        raise AssertionError("expected DataError for missing artifact file")


def test_read_artifact_speed_samples_unsupported_raises():
    artifact = types.TelemetryArtifact(
        session_key=1,
        driver_number=1,
        lap_number=1,
        storage_key="x.parquet",
        storage_backend="r2",
        format="json.gz",
        sample_count=0,
        size_bytes=0,
        checksum_sha256="x",
    )
    try:
        tools._read_artifact_speed_samples(artifact)
    except types.DataError as exc:
        assert "unsupported" in str(exc)
    else:
        raise AssertionError("expected DataError for unsupported artifact")


# ── _assess ───────────────────────────────────────────────────────────────────


def test_assess_all_passing_returns_passed():
    checks = [
        types.EvidenceCheck("a", True),
        types.EvidenceCheck("b", True),
    ]
    result = tools._assess(checks)
    assert result.passed is True
    assert result.refusal_reason is None
    assert len(result.checks) == 2


def test_assess_one_failure_returns_refusal():
    checks = [
        types.EvidenceCheck("a", True),
        types.EvidenceCheck("b", False, detail="missing telemetry"),
    ]
    result = tools._assess(checks)
    assert result.passed is False
    assert "b: missing telemetry" in result.refusal_reason


# ── compute_speed_window refusal paths (no DB needed) ─────────────────────────


def test_compute_speed_window_rejects_unsupported_metric():
    inp = types.ComputeSpeedWindowInput(
        session_key=1,
        driver_number=1,
        before_laps=(1, 2),
        metric=types.SpeedMetric.LAP_TIME_DERIVED,
    )
    try:
        tools.compute_speed_window(inp)
    except types.DataError as exc:
        assert "unsupported metric" in str(exc)
    else:
        raise AssertionError("expected DataError for unsupported metric")


def test_weighted_mean_basic():
    assert tools._weighted_mean([200.0, 200.0, 200.0], [100.0, 100.0, 100.0]) == 200.0


def test_weighted_mean_skews_toward_heavier():
    result = tools._weighted_mean([100.0, 200.0], [900.0, 100.0])
    assert round(result, 2) == 110.0


def test_weighted_mean_zero_weights_returns_zero():
    assert tools._weighted_mean([100.0, 200.0], [0.0, 0.0]) == 0.0


def test_compute_speed_window_rejects_empty_windows():
    inp = types.ComputeSpeedWindowInput(session_key=1, driver_number=1)
    try:
        tools.compute_speed_window(inp)
    except types.DataError as exc:
        assert "cannot both be empty" in str(exc)
    else:
        raise AssertionError("expected DataError for empty windows")
