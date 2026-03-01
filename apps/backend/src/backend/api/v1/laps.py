"""
Laps API endpoints.

GET /api/v1/sessions/<key>/laps                     → all laps in session
GET /api/v1/sessions/<key>/drivers/<num>/laps        → one driver's laps
GET /api/v1/sessions/<key>/fastest                   → top 5 fastest laps
"""
from flask import Blueprint, jsonify, request
from sqlalchemy import text

from backend.extensions import engine

laps_bp = Blueprint("laps", __name__)


@laps_bp.get("/sessions/<int:session_key>/laps")
def list_laps(session_key: int):
    """
    All laps for a session, joined with driver abbreviation.
    Optional query param: ?driver=44 to filter by driver number.
    """
    driver_filter = request.args.get("driver", type=int)

    query = """
        SELECT
            l.driver_number,
            d.abbreviation,
            d.team_name,
            d.team_colour,
            l.lap_number,
            l.lap_time_ms,
            l.s1_ms,
            l.s2_ms,
            l.s3_ms,
            l.compound,
            l.tyre_life_laps,
            l.is_personal_best,
            l.track_status,
            l.deleted
        FROM lap_times l
        JOIN drivers d
            ON d.driver_number = l.driver_number
            AND d.session_key  = l.session_key
        WHERE l.session_key = :session_key
    """

    params: dict = {"session_key": session_key}

    if driver_filter:
        query += " AND l.driver_number = :driver"
        params["driver"] = driver_filter

    query += " ORDER BY l.driver_number, l.lap_number"

    with engine.connect() as conn:
        rows = conn.execute(text(query), params).mappings().all()

    return jsonify([dict(r) for r in rows])


@laps_bp.get("/sessions/<int:session_key>/drivers/<int:driver_number>/laps")
def driver_laps(session_key: int, driver_number: int):
    """
    All laps for one specific driver in a session.
    Also returns their theoretical best lap (sum of best sectors).
    """
    with engine.connect() as conn:
        laps = conn.execute(text("""
            SELECT
                lap_number, lap_time_ms, s1_ms, s2_ms, s3_ms,
                compound, tyre_life_laps, is_personal_best,
                pit_in_time_ms, pit_out_time_ms, track_status, deleted
            FROM lap_times
            WHERE session_key   = :session_key
              AND driver_number = :driver_number
              AND deleted       = FALSE
            ORDER BY lap_number
        """), {"session_key": session_key, "driver_number": driver_number}
        ).mappings().all()

        # Theoretical best = sum of each driver's best individual sector
        # This is the "perfect lap" concept — no driver achieves it in practice
        theoretical = conn.execute(text("""
            SELECT
                MIN(s1_ms) AS best_s1,
                MIN(s2_ms) AS best_s2,
                MIN(s3_ms) AS best_s3,
                MIN(s1_ms) + MIN(s2_ms) + MIN(s3_ms) AS theoretical_best_ms
            FROM lap_times
            WHERE session_key   = :session_key
              AND driver_number = :driver_number
              AND s1_ms IS NOT NULL
              AND s2_ms IS NOT NULL
              AND s3_ms IS NOT NULL
              AND deleted = FALSE
        """), {"session_key": session_key, "driver_number": driver_number}
        ).mappings().first()

    return jsonify({
        "laps": [dict(r) for r in laps],
        "theoretical_best": dict(theoretical) if theoretical else None,
    })


@laps_bp.get("/sessions/<int:session_key>/fastest")
def fastest_laps(session_key: int):
    """
    Top 10 fastest laps in the session — one per driver.
    This is what the frontend uses for the fastest lap leaderboard.
    """
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT DISTINCT ON (l.driver_number)
                l.driver_number,
                d.abbreviation,
                d.team_name,
                d.team_colour,
                l.lap_number,
                l.lap_time_ms,
                l.compound
            FROM lap_times l
            JOIN drivers d
                ON d.driver_number = l.driver_number
                AND d.session_key  = l.session_key
            WHERE l.session_key  = :session_key
              AND l.lap_time_ms  IS NOT NULL
              AND l.deleted      = FALSE
            ORDER BY l.driver_number, l.lap_time_ms ASC
        """), {"session_key": session_key}).mappings().all()

    # Sort by lap time after deduplication
    sorted_rows = sorted([dict(r) for r in rows], key=lambda x: x["lap_time_ms"])

    return jsonify(sorted_rows[:10])
