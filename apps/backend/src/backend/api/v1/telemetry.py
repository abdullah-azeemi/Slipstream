"""
Telemetry endpoints.

Column names match the actual DB schema:
  speed_kmh, throttle_pct, distance_m, x_pos, y_pos

Route order matters — /telemetry/compare must come BEFORE
/telemetry/<int:driver_number> or Flask tries to cast "compare"
as an int and 404s.
"""
from flask import Blueprint, jsonify, request
from sqlalchemy import text
from backend.extensions import engine

telemetry_bp = Blueprint("telemetry", __name__)


@telemetry_bp.get("/sessions/<int:session_key>/telemetry/compare")
def compare_telemetry(session_key: int):
    """
    Speed traces for multiple drivers aligned by distance.
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
            # Find the lap number that has telemetry stored for this driver
            lap_row = conn.execute(text("""
                SELECT DISTINCT lap_number FROM telemetry
                WHERE session_key = :sk AND driver_number = :dn
                ORDER BY lap_number LIMIT 1
            """), {"sk": session_key, "dn": num}).first()

            if not lap_row:
                continue

            rows = conn.execute(text("""
                SELECT
                    speed_kmh,
                    throttle_pct,
                    brake,
                    gear,
                    drs,
                    distance_m,
                    x_pos,
                    y_pos
                FROM telemetry
                WHERE session_key   = :sk
                  AND driver_number = :dn
                  AND lap_number    = :ln
                ORDER BY distance_m ASC NULLS LAST, sample_order
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
    """Single driver telemetry — full detail including RPM."""
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
            SELECT
                speed_kmh,
                rpm,
                gear,
                throttle_pct,
                brake,
                drs,
                distance_m,
                x_pos,
                y_pos
            FROM telemetry
            WHERE session_key   = :session_key
              AND driver_number = :driver_number
              AND lap_number    = :lap_number
            ORDER BY distance_m ASC NULLS LAST, sample_order
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