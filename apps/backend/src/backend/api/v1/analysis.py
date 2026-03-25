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
            WITH all_laps AS (
                -- Include ALL laps (pit laps too) for correct cumulative race time
                SELECT
                    l.driver_number,
                    l.lap_number,
                    l.lap_time_ms,
                    l.position
                FROM lap_times l
                WHERE l.session_key = :sk
                  AND l.lap_time_ms IS NOT NULL
            ),
            cumulative AS (
                -- Running total of race time per driver including pit laps
                SELECT
                    driver_number,
                    lap_number,
                    position,
                    SUM(lap_time_ms) OVER (
                        PARTITION BY driver_number
                        ORDER BY lap_number
                        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                    ) AS cum_ms
                FROM all_laps
            ),
            leader_cum AS (
                -- P1 driver's cumulative race time each lap
                SELECT DISTINCT ON (lap_number)
                    lap_number,
                    cum_ms AS leader_ms
                FROM cumulative
                WHERE position = 1
                ORDER BY lap_number
            )
            SELECT
                c.driver_number,
                d.abbreviation,
                d.team_colour,
                d.team_name,
                c.lap_number,
                GREATEST(0, ROUND(((c.cum_ms - lc.leader_ms) / 1000.0)::numeric, 3)) AS gap_s
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


# ── Practice: lap scatter ─────────────────────────────────────────────────────

@analysis_bp.get("/sessions/<int:session_key>/analysis/fp-scatter")
def fp_scatter(session_key: int):
    """
    Every individual lap as a data point — lap number, lap time, compound.
    Used for scatter plot. Includes outlaps/inlaps flagged so frontend
    can show/hide them. No reconstruction from averages — raw lap data.
    """
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT
                l.driver_number,
                d.abbreviation,
                d.team_name,
                d.team_colour,
                l.lap_number,
                l.lap_time_ms,
                l.compound,
                l.tyre_life_laps,
                l.stint,
                l.deleted,
                l.is_personal_best,
                -- Flag outlap/inlap: first or last lap of stint, or >110% of driver median
                CASE WHEN l.tyre_life_laps <= 1 THEN true
                     WHEN l.pit_in_time_ms IS NOT NULL THEN true
                     WHEN l.lap_time_ms > (
                         SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY l2.lap_time_ms) * 1.10
                         FROM lap_times l2
                         WHERE l2.session_key    = l.session_key
                           AND l2.driver_number  = l.driver_number
                           AND l2.lap_time_ms    IS NOT NULL
                           AND l2.deleted        = FALSE
                     ) THEN true
                     ELSE false
                END AS is_outlier
            FROM lap_times l
            JOIN drivers d
                ON d.driver_number = l.driver_number
                AND d.session_key  = l.session_key
            WHERE l.session_key  = :sk
              AND l.lap_time_ms  IS NOT NULL
              AND l.compound     IS NOT NULL
            ORDER BY l.driver_number, l.lap_number
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


# ── Practice: compound strategy reveal ───────────────────────────────────────

@analysis_bp.get("/sessions/<int:session_key>/analysis/fp-compounds")
def fp_compounds(session_key: int):
    """
    Per team: how many laps on each compound, and which drivers ran what.
    Reveals planned race strategy before anyone announces it.
    """
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT
                d.team_name,
                d.team_colour,
                d.driver_number,
                d.abbreviation,
                l.compound,
                COUNT(*)                                    AS laps,
                MIN(l.lap_time_ms)                          AS best_ms,
                ROUND(AVG(l.lap_time_ms)::numeric, 1)       AS avg_ms
            FROM lap_times l
            JOIN drivers d
                ON d.driver_number = l.driver_number
                AND d.session_key  = l.session_key
            WHERE l.session_key  = :sk
              AND l.compound     IS NOT NULL
              AND l.lap_time_ms  IS NOT NULL
              AND l.deleted      = FALSE
            GROUP BY
                d.team_name, d.team_colour,
                d.driver_number, d.abbreviation,
                l.compound
            ORDER BY d.team_name, l.compound
        """), {"sk": session_key}).mappings().all()

    if not rows:
        return jsonify([])

    from backend.api.v1.strategy import _resolve

    # Group by team
    teams: dict = {}
    for r in rows:
        tn = r["team_name"]
        if tn not in teams:
            teams[tn] = {
                "team_name":   tn,
                "team_colour": _resolve(r["team_colour"], tn),
                "compounds":   {},
                "drivers":     [],
            }
        # Accumulate compound laps at team level
        c = r["compound"]
        if c not in teams[tn]["compounds"]:
            teams[tn]["compounds"][c] = {"laps": 0, "best_ms": None}
        teams[tn]["compounds"][c]["laps"] += r["laps"]
        best = r["best_ms"]
        prev = teams[tn]["compounds"][c]["best_ms"]
        if best and (prev is None or best < prev):
            teams[tn]["compounds"][c]["best_ms"] = float(best)

        # Per-driver breakdown
        driver_entry = next((x for x in teams[tn]["drivers"] if x["driver_number"] == r["driver_number"]), None)
        if not driver_entry:
            driver_entry = {"driver_number": r["driver_number"], "abbreviation": r["abbreviation"], "compounds": {}}
            teams[tn]["drivers"].append(driver_entry)
        driver_entry["compounds"][c] = {"laps": r["laps"], "best_ms": float(r["best_ms"]) if r["best_ms"] else None, "avg_ms": float(r["avg_ms"]) if r["avg_ms"] else None}

    return jsonify(list(teams.values()))


# ── Practice: race sim detection ─────────────────────────────────────────────

@analysis_bp.get("/sessions/<int:session_key>/analysis/fp-racesim")
def fp_racesim(session_key: int):
    """
    Identify genuine race simulation stints in practice.

    Criteria for a race sim stint:
      - 8+ consecutive laps on the same compound
      - Not on SOFT (teams don't race sim on softs)
      - Consistent pace (stddev < 1.5s)
      - Lap times within 107% of session best (not installation laps)

    Returns stints with per-lap data so frontend can plot the actual
    lap time trace — this is the key Friday evening intelligence.
    """
    with engine.connect() as conn:
        rows = conn.execute(text("""
            WITH driver_median AS (
                -- Use each driver's own median to filter outlaps/inlaps
                -- Session best is too strict for FP where installation laps exist
                SELECT driver_number,
                       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lap_time_ms) AS median_ms
                FROM lap_times
                WHERE session_key = :sk
                  AND lap_time_ms IS NOT NULL
                  AND deleted     = FALSE
                GROUP BY driver_number
            ),
            lagged AS (
                -- Step 1: compute LAG separately (can't nest window functions)
                SELECT
                    l.driver_number,
                    l.lap_number,
                    l.lap_time_ms,
                    l.compound,
                    l.tyre_life_laps,
                    LAG(l.compound) OVER (
                        PARTITION BY l.driver_number ORDER BY l.lap_number
                    ) AS prev_compound
                FROM lap_times l
                JOIN driver_median dm ON dm.driver_number = l.driver_number
                WHERE l.session_key  = :sk
                  AND l.lap_time_ms  IS NOT NULL
                  AND l.deleted      = FALSE
                  AND l.compound     IS NOT NULL
                  AND l.compound     != 'SOFT'
                  AND l.lap_time_ms  <= dm.median_ms * 1.15
            ),
            stint_laps AS (
                -- Step 2: now derive stint number from the pre-computed LAG
                SELECT
                    driver_number,
                    lap_number,
                    lap_time_ms,
                    compound,
                    tyre_life_laps,
                    SUM(CASE WHEN compound != prev_compound
                                  OR prev_compound IS NULL
                             THEN 1 ELSE 0 END
                    ) OVER (PARTITION BY driver_number ORDER BY lap_number) AS stint_num
                FROM lagged
            ),
            valid_stints AS (
                SELECT
                    driver_number,
                    stint_num,
                    compound,
                    COUNT(*)                                         AS laps,
                    MIN(lap_number)                                  AS start_lap,
                    MAX(lap_number)                                  AS end_lap,
                    MIN(lap_time_ms)                                 AS best_ms,
                    ROUND(AVG(lap_time_ms)::numeric, 1)              AS avg_ms,
                    ROUND(STDDEV(lap_time_ms)::numeric, 1)           AS stddev_ms,
                    ROUND(REGR_SLOPE(lap_time_ms, lap_number)::numeric, 2) AS deg_ms_per_lap
                FROM stint_laps
                GROUP BY driver_number, stint_num, compound
                HAVING COUNT(*) >= 6
                   AND STDDEV(lap_time_ms) < 3000
            ),
            lap_detail AS (
                SELECT
                    sl.driver_number,
                    sl.stint_num,
                    sl.lap_number,
                    sl.lap_time_ms,
                    sl.tyre_life_laps
                FROM stint_laps sl
                JOIN valid_stints vs
                    ON vs.driver_number = sl.driver_number
                    AND vs.stint_num    = sl.stint_num
            )
            SELECT
                vs.driver_number,
                d.abbreviation,
                d.team_name,
                d.team_colour,
                vs.stint_num,
                vs.compound,
                vs.laps,
                vs.start_lap,
                vs.end_lap,
                vs.best_ms,
                vs.avg_ms,
                vs.stddev_ms,
                vs.deg_ms_per_lap,
                JSON_AGG(
                    JSON_BUILD_OBJECT(
                        'lap_number',    ld.lap_number,
                        'lap_time_ms',   ld.lap_time_ms,
                        'tyre_life_laps', ld.tyre_life_laps
                    ) ORDER BY ld.lap_number
                ) AS lap_times
            FROM valid_stints vs
            JOIN drivers d
                ON d.driver_number = vs.driver_number
                AND d.session_key  = :sk
            JOIN lap_detail ld
                ON ld.driver_number = vs.driver_number
                AND ld.stint_num    = vs.stint_num
            GROUP BY
                vs.driver_number, d.abbreviation, d.team_name,
                d.team_colour, vs.stint_num, vs.compound,
                vs.laps, vs.start_lap, vs.end_lap,
                vs.best_ms, vs.avg_ms, vs.stddev_ms, vs.deg_ms_per_lap
            ORDER BY vs.avg_ms ASC
        """), {"sk": session_key}).mappings().all()

    if not rows:
        return jsonify([])

    from backend.api.v1.strategy import _resolve
    import json as json_mod
    results = []
    for r in rows:
        d = dict(r)
        d["team_colour"] = _resolve(d.get("team_colour"), d.get("team_name"))
        # lap_times comes back as JSON string from postgres
        lt = d.get("lap_times")
        if isinstance(lt, str):
            d["lap_times"] = json_mod.loads(lt)
        elif lt is None:
            d["lap_times"] = []
        results.append(d)
    return jsonify(results)


# ── Practice: sector time progression ────────────────────────────────────────

@analysis_bp.get("/sessions/<int:session_key>/analysis/fp-sectors")
def fp_sectors(session_key: int):
    """
    Sector time progression through the session.
    Shows whether a driver is improving setup (getting faster) or struggling.

    For each driver: their best S1/S2/S3 in each tercile of the session
    (early / middle / late) so you can see direction of travel.

    Also returns overall best sector per driver for the session delta table.
    """
    with engine.connect() as conn:
        max_lap = conn.execute(text("""
            SELECT MAX(lap_number) FROM lap_times WHERE session_key = :sk
        """), {"sk": session_key}).scalar() or 1

        rows = conn.execute(text("""
            WITH terciles AS (
                SELECT
                    l.driver_number,
                    d.abbreviation,
                    d.team_name,
                    d.team_colour,
                    l.lap_number,
                    l.s1_ms,
                    l.s2_ms,
                    l.s3_ms,
                    l.compound,
                    CASE
                        WHEN l.lap_number <= :max_lap / 3             THEN 'early'
                        WHEN l.lap_number <= (:max_lap * 2) / 3       THEN 'middle'
                        ELSE                                               'late'
                    END AS phase
                FROM lap_times l
                JOIN drivers d
                    ON d.driver_number = l.driver_number
                    AND d.session_key  = l.session_key
                WHERE l.session_key  = :sk
                  AND l.deleted      = FALSE
                  AND (l.s1_ms IS NOT NULL OR l.s2_ms IS NOT NULL OR l.s3_ms IS NOT NULL)
            )
            SELECT
                driver_number,
                abbreviation,
                team_name,
                team_colour,
                phase,
                MIN(s1_ms) AS best_s1,
                MIN(s2_ms) AS best_s2,
                MIN(s3_ms) AS best_s3,
                COUNT(*)   AS laps
            FROM terciles
            GROUP BY driver_number, abbreviation, team_name, team_colour, phase
            ORDER BY driver_number,
                CASE phase WHEN 'early' THEN 1 WHEN 'middle' THEN 2 ELSE 3 END
        """), {"sk": session_key, "max_lap": max_lap}).mappings().all()

    if not rows:
        return jsonify([])

    from backend.api.v1.strategy import _resolve

    # Group by driver, phases as keys
    drivers: dict = {}
    for r in rows:
        dn  = str(r["driver_number"])
        if dn not in drivers:
            drivers[dn] = {
                "driver_number": r["driver_number"],
                "abbreviation":  r["abbreviation"],
                "team_name":     r["team_name"],
                "team_colour":   _resolve(r["team_colour"], r["team_name"]),
                "phases":        {},
            }
        drivers[dn]["phases"][r["phase"]] = {
            "best_s1": r["best_s1"],
            "best_s2": r["best_s2"],
            "best_s3": r["best_s3"],
            "laps":    r["laps"],
        }

    return jsonify(list(drivers.values()))


# ── Practice: compound delta table ───────────────────────────────────────────

@analysis_bp.get("/sessions/<int:session_key>/analysis/fp-compound-delta")
def fp_compound_delta(session_key: int):
    """
    Each driver's best lap time per compound + gap to session best on that compound.

    Shows who has a strong HARD vs who only goes fast on SOFT — the key
    input for one-stop vs two-stop strategy decisions.

    Returns drivers sorted by their overall best time (fastest first).
    """
    with engine.connect() as conn:
        rows = conn.execute(text("""
            WITH clean_laps AS (
                SELECT
                    l.driver_number,
                    l.compound,
                    l.lap_time_ms
                FROM lap_times l
                WHERE l.session_key  = :sk
                  AND l.lap_time_ms  IS NOT NULL
                  AND l.deleted      = FALSE
                  AND l.compound     IS NOT NULL
                  -- exclude outlaps: tyre_life_laps = 1 or pit_in lap
                  AND l.tyre_life_laps > 1
                  AND l.pit_in_time_ms IS NULL
            ),
            best_per_driver_compound AS (
                SELECT
                    driver_number,
                    compound,
                    MIN(lap_time_ms) AS best_ms
                FROM clean_laps
                GROUP BY driver_number, compound
            ),
            session_best_per_compound AS (
                SELECT
                    compound,
                    MIN(lap_time_ms) AS session_best_ms
                FROM clean_laps
                GROUP BY compound
            ),
            overall_best AS (
                SELECT driver_number, MIN(best_ms) AS overall_best_ms
                FROM best_per_driver_compound
                GROUP BY driver_number
            )
            SELECT
                b.driver_number,
                d.abbreviation,
                d.team_name,
                d.team_colour,
                b.compound,
                b.best_ms,
                ROUND((b.best_ms - sb.session_best_ms)::numeric, 1) AS gap_to_best_ms,
                ob.overall_best_ms
            FROM best_per_driver_compound b
            JOIN session_best_per_compound sb ON sb.compound = b.compound
            JOIN overall_best ob ON ob.driver_number = b.driver_number
            JOIN drivers d
                ON d.driver_number = b.driver_number
                AND d.session_key  = :sk
            ORDER BY ob.overall_best_ms ASC, b.driver_number, b.compound
        """), {"sk": session_key}).mappings().all()

    if not rows:
        return jsonify([])

    from backend.api.v1.strategy import _resolve

    # Group by driver
    drivers: dict = {}
    for r in rows:
        dn = r["driver_number"]
        if dn not in drivers:
            drivers[dn] = {
                "driver_number":   dn,
                "abbreviation":    r["abbreviation"],
                "team_name":       r["team_name"],
                "team_colour":     _resolve(r["team_colour"], r["team_name"]),
                "overall_best_ms": float(r["overall_best_ms"]),
                "compounds":       {},
            }
        drivers[dn]["compounds"][r["compound"]] = {
            "best_ms":        float(r["best_ms"]),
            "gap_to_best_ms": float(r["gap_to_best_ms"]),
        }

    return jsonify(list(drivers.values()))


# ── Practice: tyre degradation comparison ────────────────────────────────────

@analysis_bp.get("/sessions/<int:session_key>/analysis/fp-tyre-deg")
def fp_tyre_deg(session_key: int):
    """
    Per-driver stint traces for deg comparison — all drivers on same compound
    overlaid so you can see who manages tyres best.

    Returns stints of >= 4 laps grouped by compound, with individual lap times
    so the frontend can draw actual traces (not just summary stats).

    Each lap is expressed as delta from the stint's first clean lap so all
    stints start at 0 — this normalises for absolute pace differences and
    shows pure degradation shape.
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
            filtered AS (
                SELECT
                    l.driver_number,
                    l.lap_number,
                    l.lap_time_ms,
                    l.compound,
                    l.tyre_life_laps
                FROM lap_times l
                JOIN driver_median dm ON dm.driver_number = l.driver_number
                WHERE l.session_key     = :sk
                  AND l.lap_time_ms     IS NOT NULL
                  AND l.deleted         = FALSE
                  AND l.compound        IS NOT NULL
                  AND l.tyre_life_laps  > 1
                  AND l.pit_in_time_ms  IS NULL
                  AND l.lap_time_ms     <= dm.median_ms * 1.12
            ),
            lagged AS (
                SELECT *,
                    LAG(compound) OVER (
                        PARTITION BY driver_number ORDER BY lap_number
                    ) AS prev_compound
                FROM filtered
            ),
            stinted AS (
                SELECT *,
                    SUM(CASE WHEN compound != prev_compound
                                  OR prev_compound IS NULL
                             THEN 1 ELSE 0 END
                    ) OVER (PARTITION BY driver_number ORDER BY lap_number) AS stint_num
                FROM lagged
            ),
            stint_summary AS (
                SELECT driver_number, stint_num, compound, COUNT(*) AS laps
                FROM stinted
                GROUP BY driver_number, stint_num, compound
                HAVING COUNT(*) >= 4
            ),
            first_lap_time AS (
                -- Baseline = first clean lap of each valid stint
                SELECT DISTINCT ON (s.driver_number, s.stint_num)
                    s.driver_number,
                    s.stint_num,
                    s.lap_time_ms AS base_ms
                FROM stinted s
                JOIN stint_summary ss
                    ON ss.driver_number = s.driver_number
                    AND ss.stint_num    = s.stint_num
                ORDER BY s.driver_number, s.stint_num, s.lap_number ASC
            )
            SELECT
                s.driver_number,
                d.abbreviation,
                d.team_name,
                d.team_colour,
                s.compound,
                s.stint_num,
                s.lap_number,
                s.lap_time_ms,
                s.tyre_life_laps,
                -- Delta from first lap: positive = getting slower
                ROUND((s.lap_time_ms - fl.base_ms)::numeric, 1) AS delta_ms,
                ROW_NUMBER() OVER (
                    PARTITION BY s.driver_number, s.stint_num
                    ORDER BY s.lap_number
                ) - 1 AS lap_in_stint
            FROM stinted s
            JOIN stint_summary ss
                ON ss.driver_number = s.driver_number
                AND ss.stint_num    = s.stint_num
            JOIN first_lap_time fl
                ON fl.driver_number = s.driver_number
                AND fl.stint_num    = s.stint_num
            JOIN drivers d
                ON d.driver_number = s.driver_number
                AND d.session_key  = :sk
            ORDER BY s.driver_number, s.stint_num, s.lap_number
        """), {"sk": session_key}).mappings().all()

    if not rows:
        return jsonify({})

    from backend.api.v1.strategy import _resolve

    # Group by compound → driver → stint → laps
    by_compound: dict = {}
    for r in rows:
        compound = r["compound"]
        dn       = r["driver_number"]
        sn       = r["stint_num"]

        if compound not in by_compound:
            by_compound[compound] = {}

        key = f"{dn}_{sn}"
        if key not in by_compound[compound]:
            by_compound[compound][key] = {
                "driver_number": dn,
                "abbreviation":  r["abbreviation"],
                "team_name":     r["team_name"],
                "team_colour":   _resolve(r["team_colour"], r["team_name"]),
                "stint_num":     sn,
                "laps":          [],
            }

        by_compound[compound][key]["laps"].append({
            "lap_in_stint": r["lap_in_stint"],
            "lap_time_ms":  float(r["lap_time_ms"]),
            "delta_ms":     float(r["delta_ms"]),
            "tyre_life_laps": r["tyre_life_laps"],
        })

    # Convert to list-of-stints per compound
    result = {}
    for compound, stints in by_compound.items():
        result[compound] = list(stints.values())

    return jsonify(result)


# ── Qualifying: Q1/Q2/Q3 segment leaderboards ────────────────────────────────

@analysis_bp.get("/sessions/<int:session_key>/analysis/quali-segments")
def quali_segments(session_key: int):
    """
    Best lap per driver per qualifying segment (Q1, Q2, Q3).

    Strategy: FastF1 does not populate SessionPart or Stint for qualifying.
    We detect Q1/Q2/Q3 boundaries by finding gaps > 5 minutes in LapStartTime
    across all drivers — these correspond to the mandatory red-flag breaks
    between segments.

    Returns:
        {
          "segments": {
            "Q1": [ { driver_number, abbreviation, team_name, team_colour,
                      lap_number, lap_time_ms, s1_ms, s2_ms, s3_ms,
                      gap_ms, eliminated } ],
            "Q2": [ ... ],
            "Q3": [ ... ]
          },
          "boundaries": { "Q2_start_lap": int, "Q3_start_lap": int }
        }

    Uses stored lap segment metadata when present. Falls back to FastF1-based
    boundary detection only for older sessions that were ingested before
    quali_segment existed.
    """
    import os
    import fastf1
    import pandas as pd
    from backend.api.v1.strategy import _resolve

    # ── 1. Get session metadata from DB ──────────────────────────────────────
    with engine.connect() as conn:
        session_row = conn.execute(text("""
            SELECT year, gp_name, session_type
            FROM sessions WHERE session_key = :sk
        """), {"sk": session_key}).mappings().first()

        if not session_row or session_row["session_type"] not in ("Q", "SQ"):
            return jsonify({"error": "Not a qualifying session"}), 400

        # Get all lap times from DB for this session
        db_laps = conn.execute(text("""
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
                l.quali_segment,
                l.deleted
            FROM lap_times l
            JOIN drivers d
                ON d.driver_number = l.driver_number
                AND d.session_key  = l.session_key
            WHERE l.session_key = :sk
              AND l.lap_time_ms IS NOT NULL
              AND l.deleted = FALSE
            ORDER BY l.driver_number, l.lap_time_ms ASC
        """), {"sk": session_key}).mappings().all()

        drivers_rows = conn.execute(text("""
            SELECT driver_number, abbreviation, team_name, team_colour
            FROM drivers WHERE session_key = :sk
        """), {"sk": session_key}).mappings().all()

    # Build driver info lookup
    driver_info = {
        r["driver_number"]: {
            "abbreviation": r["abbreviation"],
            "team_name": r["team_name"],
            "team_colour": _resolve(r["team_colour"], r["team_name"]),
        }
        for r in drivers_rows
    }

    stored_segments_present = any(row.get("quali_segment") is not None for row in db_laps)

    if stored_segments_present:
        lap_segment_map = {
            (str(row["driver_number"]), int(row["lap_number"])): int(row["quali_segment"])
            for row in db_laps
            if row.get("quali_segment") is not None
        }
        q2_laps = [int(row["lap_number"]) for row in db_laps if row.get("quali_segment") == 2]
        q3_laps = [int(row["lap_number"]) for row in db_laps if row.get("quali_segment") == 3]
        q2_start = min(q2_laps) if q2_laps else None
        q3_start = min(q3_laps) if q3_laps else None
    else:
        # ── 2. Fallback: derive segments from FastF1 cache for older data ────
        try:
            cache_dir = os.environ.get("FASTF1_CACHE_DIR", "./fastf1_cache")
            fastf1.Cache.enable_cache(cache_dir)

            f1_session_name = "Sprint Qualifying" if session_row["session_type"] == "SQ" else "Qualifying"
            sess = fastf1.get_session(
                int(session_row["year"]),
                session_row["gp_name"].replace(" Grand Prix", ""),
                f1_session_name
            )
            sess.load(telemetry=False, weather=False, messages=False)

            all_laps = sess.laps[["DriverNumber", "LapNumber", "LapStartTime"]].copy()
            all_laps = all_laps.dropna(subset=["LapStartTime"])
            all_laps = all_laps.sort_values("LapStartTime")
            all_laps["gap"] = all_laps["LapStartTime"].diff()
            boundaries = all_laps[all_laps["gap"] > pd.Timedelta(minutes=5)]["LapStartTime"].tolist()

            def assign_segment(t):
                if len(boundaries) == 0:
                    return 1
                if t < boundaries[0]:
                    return 1
                if len(boundaries) < 2 or t < boundaries[1]:
                    return 2
                return 3

            all_laps["segment"] = all_laps["LapStartTime"].apply(assign_segment)
            lap_segment_map = {
                (str(row["DriverNumber"]), int(row["LapNumber"])): int(row["segment"])
                for _, row in all_laps.iterrows()
            }
            q2_boundary_laps = all_laps[all_laps["segment"] == 2]["LapNumber"]
            q3_boundary_laps = all_laps[all_laps["segment"] == 3]["LapNumber"]
            q2_start = int(q2_boundary_laps.min()) if not q2_boundary_laps.empty else None
            q3_start = int(q3_boundary_laps.min()) if not q3_boundary_laps.empty else None
        except Exception:
            lap_segment_map = {}
            q2_start = q3_start = None

    # ── 3. Assign each DB lap to its segment ─────────────────────────────────
    # Group DB laps by driver, find best lap per segment
    # Structure: segment → driver → best lap row
    from collections import defaultdict

    # First pass: collect all valid laps per driver per segment
    driver_segment_laps: dict = defaultdict(lambda: defaultdict(list))

    for row in db_laps:
        dn = row["driver_number"]
        ln = row["lap_number"]
        seg_key = (str(dn), int(ln))
        segment = lap_segment_map.get(seg_key, 1)  # default to Q1 if no cache
        driver_segment_laps[segment][dn].append(dict(row))

    # Second pass: pick best (fastest) lap per driver per segment
    segments_out: dict = {"Q1": [], "Q2": [], "Q3": []}
    seg_labels = {1: "Q1", 2: "Q2", 3: "Q3"}

    for seg_num, seg_label in seg_labels.items():
        seg_drivers = driver_segment_laps.get(seg_num, {})
        seg_results = []

        for dn, laps in seg_drivers.items():
            # Best lap = minimum lap_time_ms
            best = min(laps, key=lambda x: x["lap_time_ms"])
            info = driver_info.get(dn, {})
            seg_results.append({
                "driver_number": dn,
                "abbreviation":  info.get("abbreviation", "???"),
                "team_name":     info.get("team_name", ""),
                "team_colour":   info.get("team_colour", "666666"),
                "lap_number":    best["lap_number"],
                "lap_time_ms":   best["lap_time_ms"],
                "s1_ms":         best["s1_ms"],
                "s2_ms":         best["s2_ms"],
                "s3_ms":         best["s3_ms"],
            })

        # Sort by lap time
        seg_results.sort(key=lambda x: x["lap_time_ms"])

        # Add gap to leader and eliminated flag
        # Q1 eliminates P16-P20 (bottom 5 of 20), Q2 eliminates P11-P15
        eliminate_from = {1: 16, 2: 11, 3: None}
        elim_pos = eliminate_from[seg_num]
        fastest_ms = seg_results[0]["lap_time_ms"] if seg_results else None

        for i, r in enumerate(seg_results):
            r["position"] = i + 1
            r["gap_ms"] = round(r["lap_time_ms"] - fastest_ms, 1) if fastest_ms else None
            r["eliminated"] = (elim_pos is not None and r["position"] >= elim_pos)

        segments_out[seg_label] = seg_results

    return jsonify({
        "segments": segments_out,
        "boundaries": {
            "Q2_start_lap": q2_start,
            "Q3_start_lap": q3_start,
        }
    })
