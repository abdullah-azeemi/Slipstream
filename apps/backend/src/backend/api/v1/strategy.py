"""
Tyre strategy endpoints.

GET /api/v1/sessions/<key>/strategy
→ Returns every driver's stint breakdown:
  driver, stint number, compound, start lap, end lap, lap count

This is exactly what the Gantt chart on the frontend needs.
"""
from flask import Blueprint, jsonify
from sqlalchemy import text
from backend.extensions import engine

strategy_bp = Blueprint("strategy", __name__)


@strategy_bp.get("/sessions/<int:session_key>/strategy")
def get_strategy(session_key: int):
    """
    Build stint data from lap_times.

    We don't have a separate stints table — we derive stints by detecting
    compound changes within each driver's lap sequence.
    A new stint starts when: compound changes OR pit_out_time is not null.
    """
    with engine.connect() as conn:
        # Pull every lap with compound + stint info, ordered correctly
        laps = conn.execute(text("""
            SELECT
                l.driver_number,
                d.abbreviation,
                d.team_colour,
                l.lap_number,
                l.compound,
                l.stint,
                l.tyre_life_laps,
                l.pit_in_time_ms,
                l.pit_out_time_ms
            FROM lap_times l
            JOIN drivers d
                ON d.driver_number = l.driver_number
                AND d.session_key  = l.session_key
            WHERE l.session_key = :key
              AND l.lap_number  IS NOT NULL
            ORDER BY l.driver_number, l.lap_number
        """), {"key": session_key}).mappings().all()

    if not laps:
        return jsonify([])

    # Group into stints per driver
    # A stint = contiguous sequence of same compound for same driver
    stints = []
    current: dict | None = None

    for lap in laps:
        lap = dict(lap)
        key = (lap["driver_number"], lap["compound"], lap.get("stint"))

        if current is None or (
            lap["driver_number"] != current["driver_number"] or
            lap["compound"]      != current["compound"] or
            (lap.get("stint") and lap["stint"] != current["stint_num"])
        ):
            if current:
                stints.append(current)
            current = {
                "driver_number": lap["driver_number"],
                "abbreviation":  lap["abbreviation"],
                "team_colour":   lap["team_colour"],
                "compound":      lap["compound"],
                "stint_num":     lap.get("stint") or 1,
                "lap_start":     lap["lap_number"],
                "lap_end":       lap["lap_number"],
                "lap_count":     1,
            }
        else:
            current["lap_end"]   = lap["lap_number"]
            current["lap_count"] += 1

    if current:
        stints.append(current)

    return jsonify(stints)


@strategy_bp.get("/sessions/<int:session_key>/race-order")
def race_order(session_key: int):
    """
    Final race finishing order — last recorded position per driver.
    Used to order drivers on the strategy diagram (P1 at top).
    """
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT DISTINCT ON (l.driver_number)
                l.driver_number,
                d.abbreviation,
                d.team_colour,
                d.team_name,
                l.position
            FROM lap_times l
            JOIN drivers d
                ON d.driver_number = l.driver_number
                AND d.session_key  = l.session_key
            WHERE l.session_key = :key
              AND l.position    IS NOT NULL
            ORDER BY l.driver_number, l.lap_number DESC
        """), {"key": session_key}).mappings().all()

    sorted_rows = sorted(
        [dict(r) for r in rows],
        key=lambda x: x["position"] or 99
    )
    return jsonify(sorted_rows)
