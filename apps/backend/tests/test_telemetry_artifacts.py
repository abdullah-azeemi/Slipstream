"""Tests for artifact-backed telemetry."""

import gzip
import json
from pathlib import Path

from sqlalchemy import text

from backend.config import settings


def test_telemetry_compare_reads_json_gz_artifact(client, db_engine, monkeypatch, tmp_path):
    session_key = 99997
    storage_key = "telemetry/session_99997/driver_44/lap_2.json.gz"
    artifact_path = Path(tmp_path) / storage_key
    artifact_path.parent.mkdir(parents=True)

    samples = [
        {
            "distance_m": 0.0,
            "speed_kmh": 120.0,
            "throttle_pct": 50.0,
            "brake": False,
            "gear": 3,
            "rpm": 9000.0,
            "drs": 0,
            "x_pos": 1.0,
            "y_pos": 2.0,
            "sample_order": 0,
        },
        {
            "distance_m": 100.0,
            "speed_kmh": 180.0,
            "throttle_pct": 100.0,
            "brake": False,
            "gear": 5,
            "rpm": 11000.0,
            "drs": 12,
            "x_pos": 3.0,
            "y_pos": 4.0,
            "sample_order": 1,
        },
    ]
    with gzip.open(artifact_path, "wb") as f:
        f.write(json.dumps({
            "session_key": session_key,
            "driver_number": 44,
            "lap_number": 2,
            "samples": samples,
        }).encode("utf-8"))

    monkeypatch.setattr(settings, "telemetry_artifact_dir", str(tmp_path))

    with db_engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO sessions (
                session_key, year, gp_name, country, session_type, session_name
            ) VALUES (
                :sk, 2024, 'Artifact Grand Prix', 'Testland', 'Q', 'Qualifying'
            )
        """), {"sk": session_key})
        conn.execute(text("""
            INSERT INTO drivers (
                driver_number, session_key, full_name, abbreviation, team_name, team_colour
            ) VALUES (
                44, :sk, 'Lewis Hamilton', 'HAM', 'Mercedes', '27F4D2'
            )
        """), {"sk": session_key})
        conn.execute(text("""
            INSERT INTO lap_times (
                session_key, driver_number, lap_number, lap_time_ms,
                compound, is_personal_best, deleted, recorded_at
            ) VALUES (
                :sk, 44, 2, 88000, 'SOFT', true, false, NOW()
            )
        """), {"sk": session_key})
        conn.execute(text("""
            INSERT INTO telemetry_artifacts (
                session_key, driver_number, lap_number,
                storage_key, storage_backend, format,
                sample_count, size_bytes, checksum_sha256
            ) VALUES (
                :sk, 44, 2,
                :storage_key, 'local', 'json.gz',
                2, :size_bytes, 'test-checksum'
            )
        """), {
            "sk": session_key,
            "storage_key": storage_key,
            "size_bytes": artifact_path.stat().st_size,
        })

    try:
        response = client.get(f"/api/v1/sessions/{session_key}/telemetry/compare?drivers=44")

        assert response.status_code == 200
        payload = response.get_json()
        assert payload["44"]["lap_number"] == 2
        assert len(payload["44"]["samples"]) == 2
        assert payload["44"]["samples"][1]["distance_pct"] == 100.0
    finally:
        with db_engine.begin() as conn:
            conn.execute(text("DELETE FROM telemetry_artifacts WHERE session_key = :sk"), {"sk": session_key})
            conn.execute(text("DELETE FROM lap_times WHERE session_key = :sk"), {"sk": session_key})
            conn.execute(text("DELETE FROM drivers WHERE session_key = :sk"), {"sk": session_key})
            conn.execute(text("DELETE FROM sessions WHERE session_key = :sk"), {"sk": session_key})
