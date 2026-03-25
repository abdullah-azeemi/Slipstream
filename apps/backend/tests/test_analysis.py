"""Tests for qualifying segment analysis."""

from sqlalchemy import text


def test_quali_segments_uses_stored_quali_segment(client, db_engine, seed_session):
    with db_engine.begin() as conn:
        conn.execute(text("DELETE FROM lap_times WHERE session_key = :sk"), {"sk": seed_session})
        conn.execute(text("""
            INSERT INTO lap_times (
                session_key, driver_number, lap_number, lap_time_ms,
                s1_ms, s2_ms, s3_ms, compound, is_personal_best,
                deleted, recorded_at, quali_segment
            ) VALUES
                (99999, 44, 2, 88000, 27500, 35000, 25500, 'SOFT', true, false, NOW(), 1),
                (99999, 63, 2, 87000, 27000, 34500, 25500, 'SOFT', true, false, NOW(), 1),
                (99999, 44, 6, 86000, 26800, 34000, 25200, 'SOFT', true, false, NOW(), 2),
                (99999, 63, 5, 85800, 26700, 33900, 25200, 'SOFT', true, false, NOW(), 2),
                (99999, 44, 9, 85000, 26500, 33500, 25000, 'SOFT', true, false, NOW(), 3),
                (99999, 63, 8, 84800, 26400, 33400, 25000, 'SOFT', true, false, NOW(), 3)
        """))

    data = client.get(f"/api/v1/sessions/{seed_session}/analysis/quali-segments").get_json()

    assert data["boundaries"]["Q2_start_lap"] == 5
    assert data["boundaries"]["Q3_start_lap"] == 8
    assert {row["driver_number"] for row in data["segments"]["Q1"]} == {44, 63}
    assert {row["driver_number"] for row in data["segments"]["Q2"]} == {44, 63}
    assert {row["driver_number"] for row in data["segments"]["Q3"]} == {44, 63}
    assert {row["driver_number"]: row["lap_number"] for row in data["segments"]["Q2"]} == {44: 6, 63: 5}
    assert {row["driver_number"]: row["lap_number"] for row in data["segments"]["Q3"]} == {44: 9, 63: 8}
