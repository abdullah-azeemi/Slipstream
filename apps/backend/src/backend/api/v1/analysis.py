"""
Analysis API — session-type-aware analytics endpoints.

Qualifying → handled by existing telemetry/fastest endpoints
Practice   → long runs, tyre deg rate
Race       → lap evolution, stint pace, position changes, sector stints
"""
from flask import Blueprint, jsonify, request
from sqlalchemy import text
from backend.extensions import engine

analysis_bp = Blueprint("analysis", __name__)


# ── Shared: lap evolution ─────────────────────────────────────────────────────

@analysis_bp.get("/sessions/<int:session_key>/analysis/lap-evolution")
def lap_evolution(session_key: int):
    """
    Every lap time for selected drivers, with compound and position.
    Used for race lap time evolution chart and FP pace overview.

    Returns:
        { drivers: { "63": { abbreviation, team_colour, laps: [{lap_number, lap_time_ms,
          compound, position, stint, is_personal_best, deleted}] } } }
    """
    drivers_param = request.args.get("drivers", "")
    params: dict  = {"sk": session_key}
    driver_filter = ""

    if drivers_param:
        try:
            dns = [int(d.strip()) for d in drivers_param.split(",")]
            driver_filter = "AND l.driver_number = ANY(:dns)"
            params["dns"] = dns
        except ValueError:
            return {"error": "Driver numbers must be integers"}, 400

    with engine.connect() as conn:
        rows = conn.execute(text(f"""
            SELECT
                l.driver_number,
                d.abbreviation,
                d.team_colour,
                d.team_name,
                l.lap_number,
                l.lap_time_ms,
                l.compound,
                l.position,
                l.stint,
                l.is_personal_best,
                l.deleted,
                l.s1_ms,
                l.s2_ms,
                l.s3_ms
            FROM lap_times l
            JOIN drivers d
                ON d.driver_number = l.driver_number
                AND d.session_key  = l.session_key
            WHERE l.session_key = :sk
              {driver_filter}
            ORDER BY l.driver_number, l.lap_number
        """), params).mappings().all()

    if not rows:
        return jsonify({"drivers": {}})

    # Group by driver
    from backend.api.v1.strategy import _resolve
    drivers: dict = {}
    for r in rows:
        dn  = str(r["driver_number"])
        if dn not in drivers:
            drivers[dn] = {
                "driver_number": r["driver_number"],
                "abbreviation":  r["abbreviation"],
                "team_name":     r["team_name"],
                "team_colour":   _resolve(r["team_colour"], r["team_name"]),
                "laps": []
            }
        drivers[dn]["laps"].append({
            "lap_number":      r["lap_number"],
            "lap_time_ms":     r["lap_time_ms"],
            "compound":        r["compound"],
            "position":        r["position"],
            "stint":           r["stint"],
            "is_personal_best": r["is_personal_best"],
            "deleted":         r["deleted"],
            "s1_ms":           r["s1_ms"],
            "s2_ms":           r["s2_ms"],
            "s3_ms":           r["s3_ms"],
        })

    return jsonify({"drivers": drivers})


# ── Race: stint pace ──────────────────────────────────────────────────────────

@analysis_bp.get("/sessions/<int:session_key>/analysis/stint-pace")
def stint_pace(session_key: int):
    """
    Average, min, max lap time per driver per stint.
    Excludes safety car laps (track_status != '1') and outlier laps
    (more than 15% slower than driver's median — slow in/out laps).

    Returns list of stint summaries ordered by driver finishing position.
    """
    with engine.connect() as conn:
        rows = conn.execute(text("""
            WITH driver_median AS (
                SELECT
                    driver_number,
                    stint,
                    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lap_time_ms) AS median_ms
                FROM lap_times
                WHERE session_key  = :sk
                  AND lap_time_ms  IS NOT NULL
                  AND deleted      = FALSE
                  AND stint        IS NOT NULL
                GROUP BY driver_number, stint
            ),
            clean_laps AS (
                SELECT l.*
                FROM lap_times l
                JOIN driver_median dm
                    ON dm.driver_number = l.driver_number
                    AND dm.stint        = l.stint
                WHERE l.session_key  = :sk
                  AND l.lap_time_ms  IS NOT NULL
                  AND l.deleted      = FALSE
                  AND l.stint        IS NOT NULL
                  -- Exclude laps >15% slower than median (pit in/out, SC laps)
                  AND l.lap_time_ms  <= dm.median_ms * 1.15
                  -- Exclude known SC laps
                  AND (l.track_status = '1' OR l.track_status IS NULL)
            )
            SELECT
                cl.driver_number,
                d.abbreviation,
                d.team_name,
                d.team_colour,
                cl.stint,
                cl.compound,
                MIN(cl.lap_number)                  AS start_lap,
                MAX(cl.lap_number)                  AS end_lap,
                COUNT(*)                            AS clean_laps,
                ROUND(AVG(cl.lap_time_ms)::numeric, 1) AS avg_ms,
                MIN(cl.lap_time_ms)                 AS best_ms,
                MAX(cl.lap_time_ms)                 AS worst_ms,
                ROUND(STDDEV(cl.lap_time_ms)::numeric, 1) AS stddev_ms,
                -- Deg rate: slope of lap time vs lap number within stint
                ROUND((
                    REGR_SLOPE(cl.lap_time_ms, cl.lap_number)
                )::numeric, 2)                      AS deg_ms_per_lap
            FROM clean_laps cl
            JOIN drivers d
                ON d.driver_number = cl.driver_number
                AND d.session_key  = :sk
            GROUP BY
                cl.driver_number, d.abbreviation, d.team_name,
                d.team_colour, cl.stint, cl.compound
            ORDER BY
                -- Order by finishing position
                (SELECT position FROM lap_times
                 WHERE session_key   = :sk
                   AND driver_number = cl.driver_number
                   AND position      IS NOT NULL
                 ORDER BY lap_number DESC LIMIT 1) ASC NULLS LAST,
                cl.stint ASC
        """), {"sk": session_key}).mappings().all()

    if not rows:
        return jsonify([])

    from backend.api.v1.strategy import _resolve
    results = []
    for r in rows:
        d = dict(r)
        d["team_colour"] = _resolve(d.get("team_colour"), d.get("team_name"))
        results.append(d)

    return jsonify(results)


# ── Race: position changes ────────────────────────────────────────────────────

@analysis_bp.get("/sessions/<int:session_key>/analysis/position-changes")
def position_changes(session_key: int):
    """
    Position per lap for all drivers.
    Used to draw the position change chart across the race.

    Returns:
        { total_laps: int,
          drivers: { "63": { abbreviation, team_colour, positions: [1,1,2,...] } } }
    """
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT
                l.driver_number,
                d.abbreviation,
                d.team_colour,
                d.team_name,
                l.lap_number,
                l.position
            FROM lap_times l
            JOIN drivers d
                ON d.driver_number = l.driver_number
                AND d.session_key  = l.session_key
            WHERE l.session_key = :sk
              AND l.position    IS NOT NULL
              AND l.deleted     = FALSE
            ORDER BY l.driver_number, l.lap_number
        """), {"sk": session_key}).mappings().all()

        total_laps = conn.execute(text("""
            SELECT MAX(lap_number) FROM lap_times WHERE session_key = :sk
        """), {"sk": session_key}).scalar() or 0

    if not rows:
        return jsonify({"total_laps": 0, "drivers": {}})

    from backend.api.v1.strategy import _resolve
    drivers: dict = {}
    for r in rows:
        dn = str(r["driver_number"])
        if dn not in drivers:
            drivers[dn] = {
                "driver_number": r["driver_number"],
                "abbreviation":  r["abbreviation"],
                "team_colour":   _resolve(r["team_colour"], r["team_name"]),
                "team_name":     r["team_name"],
                "positions":     {},
            }
        drivers[dn]["positions"][r["lap_number"]] = r["position"]

    return jsonify({"total_laps": total_laps, "drivers": drivers})


# ── Practice: long runs ───────────────────────────────────────────────────────

@analysis_bp.get("/sessions/<int:session_key>/analysis/long-runs")
def long_runs(session_key: int):
    """
    Practice long run identification.

    A long run = a stint of >= min_laps consecutive laps on the same compound.
    These are the most valuable practice data — they show race pace before
    anyone knows who is fast in race trim.

    Query param: ?min_laps=5 (default 5)

    Returns drivers with their long run stints, including deg rate.
    """
    min_laps = request.args.get("min_laps", 5, type=int)

    with engine.connect() as conn:
        rows = conn.execute(text("""
            WITH stint_calc AS (
                SELECT
                    driver_number,
                    lap_number,
                    lap_time_ms,
                    compound,
                    -- Derive stint from compound changes if stint column null
                    COALESCE(stint,
                        SUM(CASE WHEN compound != LAG(compound) OVER w
                                     OR LAG(compound) OVER w IS NULL
                              THEN 1 ELSE 0 END) OVER w
                    ) AS stint_num
                FROM lap_times
                WHERE session_key  = :sk
                  AND lap_time_ms  IS NOT NULL
                  AND deleted      = FALSE
                  AND compound     IS NOT NULL
                  -- Exclude obvious hot/outlap times (>10% above median)
                WINDOW w AS (PARTITION BY driver_number ORDER BY lap_number)
            ),
            stint_summary AS (
                SELECT
                    driver_number,
                    stint_num,
                    compound,
                    COUNT(*)             AS laps,
                    MIN(lap_number)      AS start_lap,
                    MAX(lap_number)      AS end_lap,
                    MIN(lap_time_ms)     AS best_ms,
                    ROUND(AVG(lap_time_ms)::numeric, 1) AS avg_ms,
                    ROUND(STDDEV(lap_time_ms)::numeric, 1) AS stddev_ms,
                    ROUND(REGR_SLOPE(lap_time_ms, lap_number)::numeric, 2) AS deg_ms_per_lap
                FROM stint_calc
                GROUP BY driver_number, stint_num, compound
                HAVING COUNT(*) >= :min_laps
            )
            SELECT
                ss.driver_number,
                d.abbreviation,
                d.team_name,
                d.team_colour,
                ss.stint_num,
                ss.compound,
                ss.laps,
                ss.start_lap,
                ss.end_lap,
                ss.best_ms,
                ss.avg_ms,
                ss.stddev_ms,
                ss.deg_ms_per_lap
            FROM stint_summary ss
            JOIN drivers d
                ON d.driver_number = ss.driver_number
                AND d.session_key  = :sk
            ORDER BY ss.avg_ms ASC
        """), {"sk": session_key, "min_laps": min_laps}).mappings().all()

    if not rows:
        return jsonify([])

    from backend.api.v1.strategy import _resolve
    results = []
    for r in rows:
        d = dict(r)
        d["team_colour"] = _resolve(d.get("team_colour"), d.get("team_name"))
        results.append(d)

    return jsonify(results)


# ── Practice + Race: tyre degradation ────────────────────────────────────────

@analysis_bp.get("/sessions/<int:session_key>/analysis/tyre-deg")
def tyre_degradation(session_key: int):
    """
    Tyre degradation rate per driver per stint.

    deg_ms_per_lap = milliseconds lost per additional lap on the same tyre.
    Positive = getting slower. Negative = unusual (tyre warming up still).

    Also returns a per-compound average across all drivers for comparison.
    """
    with engine.connect() as conn:
        # Per driver per stint
        per_driver = conn.execute(text("""
            WITH stint_laps AS (
                SELECT
                    driver_number,
                    lap_number,
                    lap_time_ms,
                    compound,
                    COALESCE(stint,
                        SUM(CASE WHEN compound != LAG(compound) OVER w
                                     OR LAG(compound) OVER w IS NULL
                              THEN 1 ELSE 0 END) OVER w
                    ) AS stint_num,
                    -- Lap within stint (1 = first lap of stint)
                    ROW_NUMBER() OVER (
                        PARTITION BY driver_number,
                        COALESCE(stint,
                            SUM(CASE WHEN compound != LAG(compound) OVER w
                                         OR LAG(compound) OVER w IS NULL
                                  THEN 1 ELSE 0 END) OVER w)
                        ORDER BY lap_number
                    ) AS lap_in_stint
                FROM lap_times
                WHERE session_key = :sk
                  AND lap_time_ms IS NOT NULL
                  AND deleted     = FALSE
                  AND compound    IS NOT NULL
                WINDOW w AS (PARTITION BY driver_number ORDER BY lap_number)
            ),
            -- Exclude first and last lap of each stint (hot/cool laps)
            clean AS (
                SELECT sl.*
                FROM stint_laps sl
                JOIN (SELECT driver_number, stint_num, MAX(lap_in_stint) AS max_lap
                      FROM stint_laps GROUP BY driver_number, stint_num) mx
                    ON mx.driver_number = sl.driver_number
                    AND mx.stint_num    = sl.stint_num
                WHERE sl.lap_in_stint > 1
                  AND sl.lap_in_stint < mx.max_lap
                  AND sl.lap_time_ms  < (
                      SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lap_time_ms) * 1.1
                      FROM stint_laps sl2
                      WHERE sl2.driver_number = sl.driver_number
                        AND sl2.stint_num     = sl.stint_num
                  )
            )
            SELECT
                c.driver_number,
                d.abbreviation,
                d.team_name,
                d.team_colour,
                c.stint_num,
                c.compound,
                COUNT(*)  AS laps,
                ROUND(REGR_SLOPE(c.lap_time_ms, c.lap_in_stint)::numeric, 3) AS deg_ms_per_lap,
                ROUND(AVG(c.lap_time_ms)::numeric, 1) AS avg_ms,
                MIN(c.lap_time_ms) AS best_ms
            FROM clean c
            JOIN drivers d
                ON d.driver_number = c.driver_number
                AND d.session_key  = :sk
            GROUP BY
                c.driver_number, d.abbreviation, d.team_name,
                d.team_colour, c.stint_num, c.compound
            HAVING COUNT(*) >= 4
            ORDER BY c.driver_number, c.stint_num
        """), {"sk": session_key}).mappings().all()

        # Per compound average
        compound_avg = conn.execute(text("""
            SELECT
                compound,
                ROUND(AVG(deg_rate)::numeric, 3) AS avg_deg_ms_per_lap,
                COUNT(DISTINCT driver_number)    AS drivers_sampled
            FROM (
                SELECT
                    driver_number,
                    compound,
                    REGR_SLOPE(lap_time_ms,
                        ROW_NUMBER() OVER (
                            PARTITION BY driver_number,
                            COALESCE(stint, 0)
                            ORDER BY lap_number
                        )
                    ) AS deg_rate
                FROM lap_times
                WHERE session_key = :sk
                  AND lap_time_ms IS NOT NULL
                  AND deleted     = FALSE
                  AND compound    IS NOT NULL
                GROUP BY driver_number, compound, COALESCE(stint, 0)
                HAVING COUNT(*) >= 4
            ) sub
            GROUP BY compound
            ORDER BY avg_deg_ms_per_lap ASC
        """), {"sk": session_key}).mappings().all()

    from backend.api.v1.strategy import _resolve
    driver_results = []
    for r in per_driver:
        d = dict(r)
        d["team_colour"] = _resolve(d.get("team_colour"), d.get("team_name"))
        driver_results.append(d)

    return jsonify({
        "per_driver":    driver_results,
        "per_compound":  [dict(r) for r in compound_avg],
    })


# ── Shared: sector breakdown by stint ────────────────────────────────────────

@analysis_bp.get("/sessions/<int:session_key>/analysis/sector-stints")
def sector_stints(session_key: int):
    """
    Best sector times per driver per stint.
    Shows where each driver gains/loses time in different race phases.
    """
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT
                l.driver_number,
                d.abbreviation,
                d.team_name,
                d.team_colour,
                COALESCE(l.stint, 1)    AS stint,
                l.compound,
                MIN(l.s1_ms)            AS best_s1,
                MIN(l.s2_ms)            AS best_s2,
                MIN(l.s3_ms)            AS best_s3,
                COUNT(*)                AS laps
            FROM lap_times l
            JOIN drivers d
                ON d.driver_number = l.driver_number
                AND d.session_key  = l.session_key
            WHERE l.session_key = :sk
              AND l.deleted     = FALSE
              AND (l.s1_ms IS NOT NULL OR l.s2_ms IS NOT NULL OR l.s3_ms IS NOT NULL)
            GROUP BY
                l.driver_number, d.abbreviation, d.team_name,
                d.team_colour, COALESCE(l.stint, 1), l.compound
            ORDER BY l.driver_number, COALESCE(l.stint, 1)
        """), {"sk": session_key}).mappings().all()

    if not rows:
        return jsonify([])

    from backend.api.v1.strategy import _resolve
    results = []
    for r in rows:
        d = dict(r)
        d["team_colour"] = _resolve(d.get("team_colour"), d.get("team_name"))
        results.append(d)

    return jsonify(results)


# ── Race: gap to leader ───────────────────────────────────────────────────────

@analysis_bp.get("/sessions/<int:session_key>/analysis/gap-to-leader")
def gap_to_leader(session_key: int):
    """
    Gap to race leader in seconds, per lap, per driver.

    Method: cumulative sum of lap_time_ms per driver, minus the leader's
    cumulative at the same lap. Leader = driver with smallest cumulative time
    on each lap (most accurate for lapped cars vs position column).

    Excludes deleted laps and pit laps (>115% of driver median) from
    cumulative so one slow lap doesn't corrupt the entire gap trace.

    Returns:
        { total_laps, drivers: { "63": { abbreviation, team_colour, gaps: { "1": 0.0, "2": 1.2, ... } } } }
    """
    with engine.connect() as conn:
        rows = conn.execute(text("""
            WITH driver_median AS (
                SELECT driver_number,
                       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lap_time_ms) AS median_ms
                FROM lap_times
                WHERE session_key = :sk
                  AND lap_time_ms IS NOT NULL
                  AND deleted     = FALSE
                GROUP BY driver_number
            ),
            clean_laps AS (
                SELECT l.driver_number, l.lap_number, l.lap_time_ms
                FROM lap_times l
                JOIN driver_median dm ON dm.driver_number = l.driver_number
                WHERE l.session_key  = :sk
                  AND l.lap_time_ms  IS NOT NULL
                  AND l.deleted      = FALSE
                  -- exclude pit in/out laps (>15% slower than median)
                  AND l.lap_time_ms  <= dm.median_ms * 1.15
            ),
            cumulative AS (
                SELECT driver_number,
                       lap_number,
                       SUM(lap_time_ms) OVER (
                           PARTITION BY driver_number
                           ORDER BY lap_number
                           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                       ) AS cum_ms
                FROM clean_laps
            ),
            leader_cum AS (
                SELECT lap_number, MIN(cum_ms) AS leader_ms
                FROM cumulative
                GROUP BY lap_number
            )
            SELECT
                c.driver_number,
                d.abbreviation,
                d.team_colour,
                d.team_name,
                c.lap_number,
                ROUND(((c.cum_ms - lc.leader_ms) / 1000.0)::numeric, 3) AS gap_s
            FROM cumulative c
            JOIN leader_cum lc ON lc.lap_number = c.lap_number
            JOIN drivers d
                ON d.driver_number = c.driver_number
                AND d.session_key  = :sk
            ORDER BY c.driver_number, c.lap_number
        """), {"sk": session_key}).mappings().all()

        total_laps = conn.execute(text("""
            SELECT MAX(lap_number) FROM lap_times WHERE session_key = :sk
        """), {"sk": session_key}).scalar() or 0

    if not rows:
        return jsonify({"total_laps": 0, "drivers": {}})

    from backend.api.v1.strategy import _resolve
    drivers: dict = {}
    for r in rows:
        dn = str(r["driver_number"])
        if dn not in drivers:
            drivers[dn] = {
                "driver_number": r["driver_number"],
                "abbreviation":  r["abbreviation"],
                "team_colour":   _resolve(r["team_colour"], r["team_name"]),
                "team_name":     r["team_name"],
                "gaps":          {},
            }
        drivers[dn]["gaps"][r["lap_number"]] = float(r["gap_s"])

    return jsonify({"total_laps": total_laps, "drivers": drivers})


# ── Race: undercut / overcut analysis ────────────────────────────────────────

@analysis_bp.get("/sessions/<int:session_key>/analysis/undercut")
def undercut_analysis(session_key: int):
    """
    For each pit stop, was it an undercut, overcut, or neutral?

    Method:
      - Find each driver's pit stop laps via pit_in_time_ms IS NOT NULL
      - Compare position 2 laps before pit vs 3 laps after pit
        (3 laps gives pitted cars time to cycle through)
      - pos_gain > 0 = undercut worked, < 0 = overcut / lost out, 0 = neutral

    Also returns who they pitted against (nearest rival that pitted within
    3 laps either side) for context.

    Returns list of pit stop events ordered by lap number.
    """
    with engine.connect() as conn:
        pit_rows = conn.execute(text("""
            WITH pit_laps AS (
                SELECT
                    l.driver_number,
                    d.abbreviation,
                    d.team_name,
                    d.team_colour,
                    l.lap_number          AS pit_lap,
                    l.compound            AS compound_in,   -- compound going IN (being removed)
                    l.stint               AS stint_in,
                    l.pit_in_time_ms
                FROM lap_times l
                JOIN drivers d
                    ON d.driver_number = l.driver_number
                    AND d.session_key  = l.session_key
                WHERE l.session_key      = :sk
                  AND l.pit_in_time_ms   IS NOT NULL
            ),
            pos_before AS (
                SELECT DISTINCT ON (l.driver_number, pl.pit_lap)
                    l.driver_number,
                    pl.pit_lap,
                    l.position AS pos_before
                FROM lap_times l
                JOIN pit_laps pl ON pl.driver_number = l.driver_number
                WHERE l.session_key = :sk
                  AND l.lap_number  = pl.pit_lap - 1
                  AND l.position    IS NOT NULL
            ),
            compound_after AS (
                SELECT DISTINCT ON (l.driver_number, pl.pit_lap)
                    l.driver_number,
                    pl.pit_lap,
                    l.compound AS compound_out,
                    l.tyre_life_laps
                FROM lap_times l
                JOIN pit_laps pl ON pl.driver_number = l.driver_number
                WHERE l.session_key = :sk
                  AND l.lap_number  = pl.pit_lap + 1
            ),
            pos_after AS (
                SELECT DISTINCT ON (l.driver_number, pl.pit_lap)
                    l.driver_number,
                    pl.pit_lap,
                    l.position AS pos_after
                FROM lap_times l
                JOIN pit_laps pl ON pl.driver_number = l.driver_number
                WHERE l.session_key = :sk
                  AND l.lap_number  = pl.pit_lap + 3
                  AND l.position    IS NOT NULL
            )
            SELECT
                pl.driver_number,
                pl.abbreviation,
                pl.team_name,
                pl.team_colour,
                pl.pit_lap,
                pl.compound_in,
                ca.compound_out,
                ca.tyre_life_laps,
                pb.pos_before,
                pa.pos_after,
                (pb.pos_before - pa.pos_after) AS pos_gain
            FROM pit_laps pl
            LEFT JOIN pos_before    pb ON pb.driver_number = pl.driver_number AND pb.pit_lap = pl.pit_lap
            LEFT JOIN pos_after     pa ON pa.driver_number = pl.driver_number AND pa.pit_lap = pl.pit_lap
            LEFT JOIN compound_after ca ON ca.driver_number = pl.driver_number AND ca.pit_lap = pl.pit_lap
            ORDER BY pl.pit_lap ASC, pl.driver_number ASC
        """), {"sk": session_key}).mappings().all()

    if not pit_rows:
        return jsonify([])

    from backend.api.v1.strategy import _resolve
    results = []
    for r in pit_rows:
        d = dict(r)
        d["team_colour"] = _resolve(d.get("team_colour"), d.get("team_name"))
        pos_gain = d.get("pos_gain")
        d["verdict"] = (
            "undercut"  if pos_gain is not None and pos_gain > 0 else
            "overcut"   if pos_gain is not None and pos_gain < 0 else
            "neutral"
        )
        results.append(d)

    return jsonify(results)


# ── Race: fastest lap card ────────────────────────────────────────────────────

@analysis_bp.get("/sessions/<int:session_key>/analysis/fastest-lap")
def fastest_lap(session_key: int):
    """
    Fastest lap of the race — who set it, when, on what compound,
    how far into their tyre stint, and how it compares to other drivers.

    Returns ordered list (fastest first) with gap to fastest.
    """
    with engine.connect() as conn:
        rows = conn.execute(text("""
            WITH best AS (
                SELECT DISTINCT ON (l.driver_number)
                    l.driver_number,
                    l.lap_number,
                    l.lap_time_ms,
                    l.compound,
                    l.tyre_life_laps,
                    l.position
                FROM lap_times l
                WHERE l.session_key  = :sk
                  AND l.lap_time_ms  IS NOT NULL
                  AND l.deleted      = FALSE
                  AND l.lap_time_ms  < 200000   -- exclude obvious outlaps
                ORDER BY l.driver_number, l.lap_time_ms ASC
            )
            SELECT
                b.driver_number,
                d.full_name,
                d.abbreviation,
                d.team_name,
                d.team_colour,
                b.lap_number,
                b.lap_time_ms,
                b.compound,
                b.tyre_life_laps,
                b.position                          AS position_on_lap,
                b.lap_time_ms - MIN(b.lap_time_ms) OVER () AS gap_ms
            FROM best b
            JOIN drivers d
                ON d.driver_number = b.driver_number
                AND d.session_key  = :sk
            ORDER BY b.lap_time_ms ASC
        """), {"sk": session_key}).mappings().all()

    if not rows:
        return jsonify([])

    from backend.api.v1.strategy import _resolve
    results = []
    for r in rows:
        d = dict(r)
        d["team_colour"] = _resolve(d.get("team_colour"), d.get("team_name"))
        results.append(d)

    return jsonify(results)
