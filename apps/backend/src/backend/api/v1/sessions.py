from flask import Blueprint, jsonify
from sqlalchemy import text
from backend.extensions import engine

sessions_bp = Blueprint("sessions", __name__)


@sessions_bp.get("/sessions")
def list_sessions():
    """
    List all sessions ordered by date descending.
    Qualifying sessions appear before Race sessions on the same date
    so the home page hero shows the most recent qualifying.
    """
    with engine.connect() as conn:
        rows = (
            conn.execute(
                text("""
            SELECT
                session_key, year, gp_name, country,
                session_type, session_name,
                date_start, date_end,
                track_temp_c, air_temp_c, humidity_pct,
                rainfall, wind_speed_ms
            FROM sessions
            ORDER BY
                date_start DESC NULLS LAST,
                -- Within same date: Q before R so home hero shows qualifying
                CASE session_type
                    WHEN 'Q'  THEN 1
                    WHEN 'SQ' THEN 2
                    WHEN 'S'  THEN 3
                    WHEN 'R'  THEN 4
                    ELSE 5
                END ASC
        """)
            )
            .mappings()
            .all()
        )
    return jsonify([dict(r) for r in rows])


@sessions_bp.get("/sessions/<int:session_key>")
def get_session(session_key: int):
    with engine.connect() as conn:
        row = (
            conn.execute(
                text("""
            SELECT
                session_key, year, gp_name, country,
                session_type, session_name,
                date_start, date_end,
                track_temp_c, air_temp_c, humidity_pct,
                rainfall, wind_speed_ms
            FROM sessions
            WHERE session_key = :sk
        """),
                {"sk": session_key},
            )
            .mappings()
            .first()
        )

    if not row:
        return {"error": "Session not found"}, 404
    return jsonify(dict(row))
