"""
Telemetry endpoints.

Route order matters in Flask — /telemetry/compare must be registered
BEFORE /telemetry/<int:driver_number> otherwise Flask tries to cast
the string "compare" as an int and 404s.
"""
from flask import Blueprint, jsonify, request
from sqlalchemy import text
from backend.extensions import engine

telemetry_bp = Blueprint("telemetry", __name__)


@telemetry_bp.get("/sessions/<int:session_key>/telemetry/compare")
def compare_telemetry(session_key: int):
    """
    Speed traces for multiple drivers — aligned by distance for spatial overlay.
    Query param: ?drivers=44,63
    """
    drivers_param = request.args.get("drivers", "")
    if not drivers_param:
        return {"error": "Provide ?drivers=44,63"}, 400

    try:
        driver_nums = [int(d.strip()) for d in drivers_param.split(",")]
    except ValueError:
        return {"error": "Driver numbers must be integers"}, 400

    result = {}
    with engine.connect() as conn:
        for num in driver_nums:
            lap_row = conn.execute(text("""
                SELECT DISTINCT lap_number FROM telemetry
                WHERE session_key = :sk AND driver_number = :dn
                ORDER BY lap_number LIMIT 1
            """), {"sk": session_key, "dn": num}).first()

            if not lap_row:
                continue

            rows = conn.execute(text("""
                SELECT speed, throttle, brake, gear, drs,
                       distance, x, y
                FROM telemetry
                WHERE session_key   = :sk
                  AND driver_number = :dn
                  AND lap_number    = :ln
                ORDER BY distance ASC NULLS LAST, id
            """), {"sk": session_key, "dn": num, "ln": lap_row[0]}
            ).mappings().all()

            samples = [dict(r) for r in rows]
            n = len(samples)
            for i, s in enumerate(samples):
                s["distance_pct"] = round(i / n * 100, 2) if n > 0 else 0

            result[str(num)] = {
                "lap_number": lap_row[0],
                "samples":    samples,
            }

    if not result:
        return {"error": "No telemetry found for these drivers in this session"}, 404

    return jsonify(result)


@telemetry_bp.get("/sessions/<int:session_key>/telemetry/<int:driver_number>")
def driver_telemetry(session_key: int, driver_number: int):
    """Single driver telemetry."""
    with engine.connect() as conn:
        lap_row = conn.execute(text("""
            SELECT DISTINCT lap_number FROM telemetry
            WHERE session_key   = :session_key
              AND driver_number = :driver_number
            ORDER BY lap_number LIMIT 1
        """), {"session_key": session_key, "driver_number": driver_number}).first()

        if not lap_row:
            return {"error": "No telemetry for this driver in this session"}, 404

        rows = conn.execute(text("""
            SELECT speed, rpm, gear, throttle, brake, drs,
                   distance, x, y
            FROM telemetry
            WHERE session_key   = :session_key
              AND driver_number = :driver_number
              AND lap_number    = :lap_number
            ORDER BY distance ASC NULLS LAST, id
        """), {
            "session_key":   session_key,
            "driver_number": driver_number,
            "lap_number":    lap_row[0],
        }).mappings().all()

    return jsonify({
        "driver_number": driver_number,
        "lap_number":    lap_row[0],
        "samples":       [dict(r) for r in rows],
    })
