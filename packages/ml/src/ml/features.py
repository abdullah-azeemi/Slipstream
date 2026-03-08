"""
Feature engineering for race prediction.

Builds a feature matrix from qualifying + race data stored in TimescaleDB.
Each row = one driver in one race weekend.
Features come from qualifying; target comes from race result.
"""
from __future__ import annotations
import pandas as pd
import numpy as np
from sqlalchemy import create_engine, text
from ml.config import settings
import structlog

log = structlog.get_logger()


def get_engine():
    return create_engine(settings.database_url)


def build_feature_matrix() -> pd.DataFrame:
    """
    Build the full training dataset.

    Returns a DataFrame where each row is one driver at one race,
    with qualifying features and race finishing position as target.
    """
    engine = get_engine()

    with engine.connect() as conn:
        # Get all years that have BOTH qualifying and race data
        pairs = conn.execute(text("""
            SELECT
                year,
                MAX(CASE WHEN session_type = 'Q' THEN session_key END) AS quali_key,
                MAX(CASE WHEN session_type = 'R' THEN session_key END) AS race_key
            FROM sessions
            GROUP BY year
            HAVING
                MAX(CASE WHEN session_type = 'Q' THEN session_key END) IS NOT NULL
                AND MAX(CASE WHEN session_type = 'R' THEN session_key END) IS NOT NULL
            ORDER BY year
        """)).mappings().all()

    log.info("feature.pairs", count=len(pairs))

    all_rows = []
    for pair in pairs:
        rows = _build_weekend_features(
            year=pair['year'],
            quali_key=pair['quali_key'],
            race_key=pair['race_key'],
        )
        all_rows.extend(rows)
        log.info("feature.weekend_done",
                 year=pair['year'],
                 rows=len(rows))

    df = pd.DataFrame(all_rows)
    log.info("feature.matrix_built",
             shape=df.shape,
             columns=list(df.columns))
    return df


def _build_weekend_features(
    year: int,
    quali_key: int,
    race_key: int,
) -> list[dict]:
    """Build feature rows for one race weekend."""
    engine  = get_engine()
    rows    = []

    with engine.connect() as conn:

        # ── Qualifying data ───────────────────────────────────────────────
        quali_laps = conn.execute(text("""
            SELECT DISTINCT ON (l.driver_number)
                l.driver_number,
                d.abbreviation,
                d.team_name,
                l.lap_time_ms,
                l.s1_ms,
                l.s2_ms,
                l.s3_ms,
                l.compound AS quali_compound
            FROM lap_times l
            JOIN drivers d
                ON d.driver_number = l.driver_number
                AND d.session_key  = l.session_key
            WHERE l.session_key   = :qk
              AND l.lap_time_ms   IS NOT NULL
              AND l.is_accurate   = TRUE
            ORDER BY l.driver_number, l.lap_time_ms ASC
        """), {"qk": quali_key}).mappings().all()

        # ── Race result: final finishing position per driver ──────────────
        race_results = conn.execute(text("""
            SELECT DISTINCT ON (l.driver_number)
                l.driver_number,
                l.position AS finish_position
            FROM lap_times l
            WHERE l.session_key = :rk
              AND l.position    IS NOT NULL
            ORDER BY l.driver_number, l.lap_number DESC
        """), {"rk": race_key}).mappings().all()

    if not quali_laps or not race_results:
        log.warning("feature.missing_data",
                    year=year,
                    quali=len(quali_laps),
                    race=len(race_results))
        return []

    # Build lookup: driver_number → finish position
    finish_map = {r['driver_number']: r['finish_position']
                  for r in race_results}

    # Convert to DataFrame for vectorised ops
    q = pd.DataFrame([dict(r) for r in quali_laps])

    # Rank drivers by qualifying lap time (1 = pole)
    q['grid_position']        = q['lap_time_ms'].rank(method='min').astype(int)
    q['quali_gap_to_pole_ms'] = q['lap_time_ms'] - q['lap_time_ms'].min()

    # Sector ranks (1 = fastest in field for that sector)
    for sec in ['s1_ms', 's2_ms', 's3_ms']:
        q[f'{sec}_rank'] = q[sec].rank(method='min', na_option='bottom').astype(int)

    # Normalise sectors relative to field best
    for sec in ['s1_ms', 's2_ms', 's3_ms']:
        field_best = q[sec].min()
        q[f'{sec}_gap'] = (q[sec] - field_best).fillna(9999)

    # Build final rows
    for _, driver_row in q.iterrows():
        finish = finish_map.get(int(driver_row['driver_number']))
        if finish is None:
            continue  # driver didn't finish or not in race data

        rows.append({
            # Identifiers (not used as features — dropped before training)
            'year':           year,
            'driver_number':  int(driver_row['driver_number']),
            'abbreviation':   driver_row['abbreviation'],
            'team_name':      driver_row['team_name'] or 'Unknown',

            # ── Features ─────────────────────────────────────────────────
            'grid_position':        int(driver_row['grid_position']),
            'quali_gap_ms':         float(driver_row['quali_gap_to_pole_ms'] or 0),
            's1_gap_ms':            float(driver_row['s1_ms_gap']),
            's2_gap_ms':            float(driver_row['s2_ms_gap']),
            's3_gap_ms':            float(driver_row['s3_ms_gap']),
            's1_rank':              int(driver_row['s1_ms_rank']),
            's2_rank':              int(driver_row['s2_ms_rank']),
            's3_rank':              int(driver_row['s3_ms_rank']),
            'quali_compound_soft':  int(driver_row['quali_compound'] == 'SOFT'),
            'quali_compound_inter': int(driver_row['quali_compound'] == 'INTERMEDIATE'),

            # ── Target ───────────────────────────────────────────────────
            'finish_position': int(finish),
        })

    return rows


def build_inference_features(quali_session_key: int) -> pd.DataFrame:
    """
    Build features for a qualifying session to run inference on.
    Same shape as training features — no target column.
    Used by predict.py after a qualifying session.
    """
    engine = get_engine()

    with engine.connect() as conn:
        quali_laps = conn.execute(text("""
            SELECT DISTINCT ON (l.driver_number)
                l.driver_number,
                d.abbreviation,
                d.team_name,
                l.lap_time_ms,
                l.s1_ms,
                l.s2_ms,
                l.s3_ms,
                l.compound AS quali_compound
            FROM lap_times l
            JOIN drivers d
                ON d.driver_number = l.driver_number
                AND d.session_key  = l.session_key
            WHERE l.session_key   = :qk
              AND l.lap_time_ms   IS NOT NULL
            ORDER BY l.driver_number, l.lap_time_ms ASC
        """), {"qk": quali_session_key}).mappings().all()

    if not quali_laps:
        raise ValueError(f"No qualifying data for session {quali_session_key}")

    q = pd.DataFrame([dict(r) for r in quali_laps])

    q['grid_position']        = q['lap_time_ms'].rank(method='min').astype(int)
    q['quali_gap_to_pole_ms'] = q['lap_time_ms'] - q['lap_time_ms'].min()

    for sec in ['s1_ms', 's2_ms', 's3_ms']:
        q[f'{sec}_rank'] = q[sec].rank(method='min', na_option='bottom').astype(int)

    for sec in ['s1_ms', 's2_ms', 's3_ms']:
        field_best = q[sec].min()
        q[f'{sec}_gap'] = (q[sec] - field_best).fillna(9999)

    rows = []
    for _, r in q.iterrows():
        rows.append({
            'driver_number':        int(r['driver_number']),
            'abbreviation':         r['abbreviation'],
            'team_name':            r['team_name'] or 'Unknown',
            'grid_position':        int(r['grid_position']),
            'quali_gap_ms':         float(r['quali_gap_to_pole_ms'] or 0),
            's1_gap_ms':            float(r['s1_ms_gap']),
            's2_gap_ms':            float(r['s2_ms_gap']),
            's3_gap_ms':            float(r['s3_ms_gap']),
            's1_rank':              int(r['s1_ms_rank']),
            's2_rank':              int(r['s2_ms_rank']),
            's3_rank':              int(r['s3_ms_rank']),
            'quali_compound_soft':  int(r['quali_compound'] == 'SOFT'),
            'quali_compound_inter': int(r['quali_compound'] == 'INTERMEDIATE'),
        })

    return pd.DataFrame(rows)


# Feature columns used for training/inference — must be identical in both
FEATURE_COLS = [
    'grid_position',
    'quali_gap_ms',
    's1_gap_ms', 's2_gap_ms', 's3_gap_ms',
    's1_rank',   's2_rank',   's3_rank',
    'quali_compound_soft',
    'quali_compound_inter',
]

TARGET_COL = 'finish_position'