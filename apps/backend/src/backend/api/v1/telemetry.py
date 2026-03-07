"""
Telemetry endpoints — speed traces for the qualifying deep dive page.

GET /api/v1/sessions/<key>/telemetry/<driver_number>
→ Speed, throttle, brake, gear for the driver's fastest lap telemetry
"""
from flask import Blueprint, jsonify
from sqlalchemy import text
from backend.extensions import engine

telemetry_bp = Blueprint("telemetry", __name__)


@telemetry_bp.get("/sessions/<int:session_key>/telemetry/<int:driver_number>")
def driver_telemetry(session_key: int, driver_number: int):
    with engine.connect() as conn:
        # Find which lap number has telemetry stored
        lap_row = conn.execute(text("""
            SELECT DISTINCT lap_number
            FROM telemetry
            WHERE session_key   = :session_key
              AND driver_number = :driver_number
            ORDER BY lap_number
            LIMIT 1
        """), {"session_key": session_key, "driver_number": driver_number}
        ).first()

        if not lap_row:
            return {"error": "No telemetry for this driver"}, 404

        lap_number = lap_row[0]

        rows = conn.execute(text("""
            SELECT
                speed, rpm, gear, throttle, brake, drs
            FROM telemetry
            WHERE session_key   = :session_key
              AND driver_number = :driver_number
              AND lap_number    = :lap_number
            ORDER BY id
        """), {
            "session_key":   session_key,
            "driver_number": driver_number,
            "lap_number":    lap_number,
        }).mappings().all()

    return jsonify({
        "driver_number": driver_number,
        "lap_number":    lap_number,
        "samples":       [dict(r) for r in rows],
    })


@telemetry_bp.get("/sessions/<int:session_key>/telemetry/compare")
def compare_telemetry(session_key: int):
    """
    Speed traces for multiple drivers on their fastest laps.
    Query param: ?drivers=44,63
    Returns normalised 0-1 distance axis so traces are comparable.
    """
    from flask import request
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
                SELECT speed, throttle, brake, gear, drs
                FROM telemetry
                WHERE session_key   = :sk
                  AND driver_number = :dn
                  AND lap_number    = :ln
                ORDER BY id
            """), {"sk": session_key, "dn": num, "ln": lap_row[0]}
            ).mappings().all()

            samples = [dict(r) for r in rows]
            # Normalise to 0-100% distance for overlay comparison
            n = len(samples)
            for i, s in enumerate(samples):
                s["distance_pct"] = round(i / n * 100, 2)

            result[str(num)] = {
                "lap_number": lap_row[0],
                "samples":    samples,
            }

    return jsonify(result)
