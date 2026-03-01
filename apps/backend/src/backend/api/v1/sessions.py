"""
Sessions API endpoints.

GET /api/v1/sessions           → list all sessions
GET /api/v1/sessions/<key>     → one session with driver list
"""
from flask import Blueprint, jsonify
from sqlalchemy import text

from backend.extensions import engine

sessions_bp = Blueprint("sessions", __name__)


@sessions_bp.get("/sessions")
def list_sessions():
    """
    Return all sessions ordered by most recent first.
    Frontend uses this to populate the session picker.
    """
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT
                session_key,
                year,
                gp_name,
                country,
                session_type,
                session_name,
                date_start
            FROM sessions
            ORDER BY date_start DESC NULLS LAST
        """)).mappings().all()

    return jsonify([dict(r) for r in rows])


@sessions_bp.get("/sessions/<int:session_key>")
def get_session(session_key: int):
    """
    Return one session with its driver list.
    """
    with engine.connect() as conn:
        # Session metadata
        session = conn.execute(text("""
            SELECT
                session_key, year, gp_name, country,
                session_type, session_name, date_start
            FROM sessions
            WHERE session_key = :key
        """), {"key": session_key}).mappings().first()

        if session is None:
            return {"error": "Session not found"}, 404

        # Drivers in this session
        drivers = conn.execute(text("""
            SELECT
                driver_number, full_name, abbreviation,
                team_name, team_colour
            FROM drivers
            WHERE session_key = :key
            ORDER BY driver_number
        """), {"key": session_key}).mappings().all()

    return jsonify({
        **dict(session),
        "drivers": [dict(d) for d in drivers],
    })
