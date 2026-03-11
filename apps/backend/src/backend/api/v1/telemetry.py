"""
Telemetry API endpoints.

GET /api/v1/sessions/<key>/telemetry/<driver_number>
    → fastest lap telemetry samples for one driver

GET /api/v1/sessions/<key>/telemetry/compare?drivers=44,63
    → fastest lap telemetry for multiple drivers, distance-normalised

GET /api/v1/sessions/<key>/telemetry/stats?drivers=44,63
    → aggregated stats: max speed, avg throttle, braking zones etc.
"""
from flask import Blueprint, jsonify, request
from sqlalchemy import text
from backend.extensions import engine

telemetry_bp = Blueprint("telemetry", __name__)


def _get_fastest_lap_number(conn, session_key: int, driver_number: int) -> int | None:
    """Return the lap_number of the driver's fastest clean lap."""
    row = conn.execute(text("""
        SELECT lap_number
        FROM lap_times
        WHERE session_key   = :sk
          AND driver_number = :dn
          AND lap_time_ms   IS NOT NULL
          AND deleted       = FALSE
        ORDER BY lap_time_ms ASC
        LIMIT 1
    """), {"sk": session_key, "dn": driver_number}).first()
    return row[0] if row else None


def _get_telemetry_samples(conn, session_key: int, driver_number: int, lap_number: int) -> list[dict]:
    """Return all telemetry samples for a specific lap, ordered by distance."""
    rows = conn.execute(text("""
        SELECT
            distance_m,
            speed_kmh,
            throttle_pct,
            brake,
            gear,
            rpm,
            drs,
            x_pos,
            y_pos
        FROM telemetry
        WHERE session_key   = :sk
          AND driver_number = :dn
          AND lap_number    = :ln
        ORDER BY distance_m ASC NULLS LAST
    """), {"sk": session_key, "dn": driver_number, "ln": lap_number}).mappings().all()
    return [dict(r) for r in rows]


@telemetry_bp.get("/sessions/<int:session_key>/telemetry/<int:driver_number>")
def driver_telemetry(session_key: int, driver_number: int):
    """Fastest lap telemetry for one driver."""
    with engine.connect() as conn:
        lap_number = _get_fastest_lap_number(conn, session_key, driver_number)
        if lap_number is None:
            return {"error": "No telemetry found"}, 404

        samples = _get_telemetry_samples(conn, session_key, driver_number, lap_number)

    return jsonify({
        "driver_number": driver_number,
        "lap_number":    lap_number,
        "samples":       samples,
    })


@telemetry_bp.get("/sessions/<int:session_key>/telemetry/compare")
def telemetry_compare(session_key: int):
    """
    Fastest lap telemetry for multiple drivers, distance-normalised to 0-100%.

    Distance normalisation means all drivers' laps are stretched/compressed
    to the same 0-100% scale so you can overlay them on one chart regardless
    of small lap distance differences.

    Returns shape: { "44": { lap_number: 24, samples: [...] }, "63": {...} }
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
        for dn in driver_nums:
            lap_number = _get_fastest_lap_number(conn, session_key, dn)
            if lap_number is None:
                continue

            samples = _get_telemetry_samples(conn, session_key, dn, lap_number)
            if not samples:
                continue

            # Normalise distance to 0-100%
            distances = [s["distance_m"] for s in samples if s["distance_m"] is not None]
            if distances:
                min_d = min(distances)
                max_d = max(distances)
                span  = max_d - min_d or 1
                for s in samples:
                    if s["distance_m"] is not None:
                        s["distance_pct"] = round((s["distance_m"] - min_d) / span * 100, 3)
                    else:
                        s["distance_pct"] = None

            result[str(dn)] = {
                "lap_number": lap_number,
                "samples":    samples,
            }

    if not result:
        return {"error": "No telemetry found for given drivers"}, 404

    return jsonify(result)


@telemetry_bp.get("/sessions/<int:session_key>/telemetry/stats")
def telemetry_stats(session_key: int):
    """
    Aggregated telemetry stats per driver for their fastest lap.
    Used by the corner analysis and stats panels.
    """
    drivers_param = request.args.get("drivers", "")
    driver_filter = ""
    params: dict = {"sk": session_key}

    if drivers_param:
        try:
            dns = [int(d.strip()) for d in drivers_param.split(",")]
            driver_filter = "AND t.driver_number = ANY(:dns)"
            params["dns"] = dns
        except ValueError:
            return {"error": "Driver numbers must be integers"}, 400

    with engine.connect() as conn:
        # Get fastest lap per driver first
        fastest = conn.execute(text("""
            SELECT DISTINCT ON (driver_number)
                driver_number, lap_number, lap_time_ms
            FROM lap_times
            WHERE session_key = :sk
              AND lap_time_ms  IS NOT NULL
              AND deleted      = FALSE
            ORDER BY driver_number, lap_time_ms ASC
        """), {"sk": session_key}).mappings().all()

        results = []
        for lap in fastest:
            dn  = lap["driver_number"]
            ln  = lap["lap_number"]

            if drivers_param and dn not in params.get("dns", []):
                continue

            stats = conn.execute(text("""
                SELECT
                    MAX(speed_kmh)                              AS max_speed,
                    AVG(speed_kmh)                             AS avg_speed,
                    AVG(throttle_pct) FILTER (WHERE throttle_pct IS NOT NULL) AS avg_throttle,
                    -- % of lap at full throttle (throttle >= 98)
                    ROUND(
                        100.0 * COUNT(*) FILTER (WHERE throttle_pct >= 98)
                        / NULLIF(COUNT(*), 0), 1
                    )                                          AS full_throttle_pct,
                    -- % of lap braking
                    ROUND(
                        100.0 * COUNT(*) FILTER (WHERE brake = TRUE)
                        / NULLIF(COUNT(*), 0), 1
                    )                                          AS braking_pct,
                    -- DRS usage
                    ROUND(
                        100.0 * COUNT(*) FILTER (WHERE drs >= 10)
                        / NULLIF(COUNT(*), 0), 1
                    )                                          AS drs_pct,
                    MAX(rpm)                                   AS max_rpm,
                    MAX(gear)                                  AS max_gear,
                    -- Approx late braking: avg distance_m into corner where brake first applied
                    -- We use the average distance between throttle-off and brake-on as a proxy
                    COUNT(*) FILTER (WHERE brake = TRUE)       AS brake_sample_count
                FROM telemetry
                WHERE session_key   = :sk
                  AND driver_number = :dn
                  AND lap_number    = :ln
            """), {"sk": session_key, "dn": dn, "ln": ln}).mappings().first()

            # Speed trap data from lap_times
            traps = conn.execute(text("""
                SELECT speed_i1, speed_i2, speed_fl, speed_st
                FROM lap_times
                WHERE session_key   = :sk
                  AND driver_number = :dn
                  AND lap_number    = :ln
            """), {"sk": session_key, "dn": dn, "ln": ln}).mappings().first()

            # Driver info
            driver = conn.execute(text("""
                SELECT abbreviation, team_name, team_colour
                FROM drivers
                WHERE session_key   = :sk
                  AND driver_number = :dn
            """), {"sk": session_key, "dn": dn}).mappings().first()

            if not driver:
                continue

            results.append({
                "driver_number":    dn,
                "abbreviation":     driver["abbreviation"],
                "team_name":        driver["team_name"],
                "team_colour":      driver["team_colour"],
                "lap_number":       ln,
                "lap_time_ms":      lap["lap_time_ms"],
                **(dict(stats) if stats else {}),
                "speed_i1":         traps["speed_i1"]  if traps else None,
                "speed_i2":         traps["speed_i2"]  if traps else None,
                "speed_fl":         traps["speed_fl"]  if traps else None,
                "speed_st":         traps["speed_st"]  if traps else None,
            })

    return jsonify(results)
