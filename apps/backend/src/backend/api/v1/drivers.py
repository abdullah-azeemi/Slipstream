"""
Drivers API endpoints.

GET /api/v1/sessions/<key>/drivers                → all drivers
GET /api/v1/sessions/<key>/drivers/<num>/compare  → head-to-head stats
GET /api/v1/drivers/<num>/profile                 → driver profile (ML data)
"""
from flask import Blueprint, jsonify
from sqlalchemy import text

from backend.extensions import engine

drivers_bp = Blueprint("drivers", __name__)


@drivers_bp.get("/sessions/<int:session_key>/drivers")
def list_drivers(session_key: int):
    """All drivers in a session with their best lap time."""
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT
                d.driver_number,
                d.full_name,
                d.abbreviation,
                d.team_name,
                d.team_colour,
                MIN(l.lap_time_ms) AS best_lap_ms,
                COUNT(l.lap_number) AS total_laps
            FROM drivers d
            LEFT JOIN lap_times l
                ON l.driver_number = d.driver_number
                AND l.session_key  = d.session_key
                AND l.deleted      = FALSE
            WHERE d.session_key = :key
            GROUP BY
                d.driver_number, d.full_name, d.abbreviation,
                d.team_name, d.team_colour
            ORDER BY best_lap_ms ASC NULLS LAST
        """), {"key": session_key}).mappings().all()

    return jsonify([dict(r) for r in rows])


@drivers_bp.get("/sessions/<int:session_key>/drivers/compare")
def compare_drivers(session_key: int):
    """
    Compare multiple drivers side by side.
    Query param: ?drivers=44,63,4  (comma-separated driver numbers)

    Returns best lap, sector bests, theoretical best, and
    sector-by-sector delta vs the fastest driver.
    """
    from flask import request
    drivers_param = request.args.get("drivers", "")

    if not drivers_param:
        return {"error": "Provide ?drivers=44,63,4"}, 400

    try:
        driver_nums = [int(d.strip()) for d in drivers_param.split(",")]
    except ValueError:
        return {"error": "Driver numbers must be integers"}, 400

    if len(driver_nums) < 2:
        return {"error": "Provide at least 2 driver numbers"}, 400

    results = []

    with engine.connect() as conn:
        for num in driver_nums:
            stats = conn.execute(text("""
                SELECT
                    d.driver_number,
                    d.abbreviation,
                    d.team_name,
                    d.team_colour,
                    MIN(l.lap_time_ms)                           AS best_lap_ms,
                    MIN(l.s1_ms)                                 AS best_s1_ms,
                    MIN(l.s2_ms)                                 AS best_s2_ms,
                    MIN(l.s3_ms)                                 AS best_s3_ms,
                    MIN(l.s1_ms) + MIN(l.s2_ms) + MIN(l.s3_ms) AS theoretical_best_ms,
                    STDDEV(l.lap_time_ms)                        AS lap_time_stddev,
                    COUNT(l.lap_number)                          AS total_laps
                FROM drivers d
                JOIN lap_times l
                    ON l.driver_number = d.driver_number
                    AND l.session_key  = d.session_key
                WHERE d.session_key   = :session_key
                  AND d.driver_number = :driver_number
                  AND l.lap_time_ms   IS NOT NULL
                  AND l.deleted       = FALSE
                GROUP BY d.driver_number, d.abbreviation, d.team_name, d.team_colour
            """), {"session_key": session_key, "driver_number": num}
            ).mappings().first()

            if stats:
                results.append(dict(stats))

    if not results:
        return {"error": "No data found for given drivers"}, 404

    best_lap = min(float(r["best_lap_ms"]) for r in results if r["best_lap_ms"])
    for r in results:
        if r["best_lap_ms"]:
            r["gap_to_fastest_ms"] = round(float(r["best_lap_ms"]) - best_lap, 3)
            r["theoretical_best_ms"] = float(r["theoretical_best_ms"]) if r.get("theoretical_best_ms") else None
        else:
            r["gap_to_fastest_ms"] = None


    return jsonify(results)


@drivers_bp.get("/drivers/<int:driver_number>/profile")
def driver_profile(driver_number: int):
    """
    Full driver profile for the ML driver page.
    Returns: driver info, features, embeddings, all embeddings for scatter,
    lap times by compound, recent results.
    """
    from flask import request
    year = request.args.get("year", 2024, type=int)

    result = {
        "driver": None,
        "features": None,
        "embedding": None,
        "all_embeddings": [],
        "compound_laps": [],
        "recent_results": [],
    }

    with engine.connect() as conn:
        # Driver info
        driver = conn.execute(text("""
            SELECT
                d.driver_number,
                d.full_name,
                d.abbreviation,
                d.team_name,
                d.team_colour
            FROM drivers d
            JOIN sessions s ON s.session_key = d.session_key
            WHERE d.driver_number = :num
            ORDER BY s.date_start DESC
            LIMIT 1
        """), {"num": driver_number}).mappings().first()

        if driver:
            result["driver"] = dict(driver)

        # Features
        features = conn.execute(text("""
            SELECT * FROM driver_features
            WHERE driver_number = :num AND season = :year
        """), {"num": driver_number, "year": year}).mappings().first()
        if features:
            result["features"] = dict(features)

        # Embedding
        embedding = conn.execute(text("""
            SELECT * FROM driver_embeddings
            WHERE driver_number = :num AND season = :year
        """), {"num": driver_number, "year": year}).mappings().first()
        if embedding:
            result["embedding"] = dict(embedding)

        # All embeddings for scatter plot
        all_emb = conn.execute(text("""
            SELECT
                de.driver_number,
                de.season,
                de.embedding,
                de.archetype,
                d.full_name,
                d.abbreviation,
                d.team_colour
            FROM driver_embeddings de
            JOIN drivers d ON d.driver_number = de.driver_number
            WHERE de.season = :year
        """), {"year": year}).mappings().all()
        result["all_embeddings"] = [dict(r) for r in all_emb]

        # Lap times by compound for violin plot
        compound_laps = conn.execute(text("""
            SELECT
                lt.driver_number,
                lt.compound,
                lt.lap_time_ms
            FROM lap_times lt
            JOIN sessions s ON s.session_key = lt.session_key
            WHERE lt.driver_number = :num
              AND s.session_type = 'R'
              AND lt.deleted = FALSE
              AND lt.lap_time_ms IS NOT NULL
              AND lt.compound IN ('SOFT', 'MEDIUM', 'HARD')
        """), {"num": driver_number}).mappings().all()
        result["compound_laps"] = [dict(r) for r in compound_laps]

        # Recent race results
        recent = conn.execute(text("""
            SELECT
                s.gp_name,
                s.date_start,
                rr.position,
                rr.grid_position,
                rr.points,
                rr.status
            FROM race_results rr
            JOIN sessions s ON s.session_key = rr.session_key
            WHERE rr.driver_number = :num
              AND s.session_type = 'R'
            ORDER BY s.date_start DESC
            LIMIT 5
        """), {"num": driver_number}).mappings().all()
        result["recent_results"] = [dict(r) for r in recent]

    return jsonify(result)
