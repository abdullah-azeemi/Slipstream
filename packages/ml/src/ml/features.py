"""
Feature engineering for race prediction.

Groups by (year, gp_name) so Monaco 2024 Q pairs with Monaco 2024 R,
not Spanish 2024 R. Each row = one driver at one race weekend.
"""
from __future__ import annotations
import pandas as pd
import numpy as np
from sqlalchemy import create_engine, text
from ml.config import settings
import structlog

log = structlog.get_logger()

FEATURE_COLS = [
    'grid_position',
    'quali_gap_ms',
    's1_gap_ms', 's2_gap_ms', 's3_gap_ms',
    's1_rank',   's2_rank',   's3_rank',
    'quali_compound_soft',
    'quali_compound_inter',
    # Circuit type encoding — model learns Monaco ≠ Monza
    'is_street_circuit',   # Monaco, Baku
    'is_power_circuit',    # Monza, Spa straight
    'is_high_df_circuit',  # Monaco, Hungary
]

TARGET_COL = 'finish_position'

STREET_CIRCUITS = {'Monaco Grand Prix', 'Azerbaijan Grand Prix', 'Singapore Grand Prix'}
POWER_CIRCUITS  = {'Italian Grand Prix', 'Belgian Grand Prix', 'Azerbaijan Grand Prix'}
HIGH_DF_CIRCUITS = {'Monaco Grand Prix', 'Hungarian Grand Prix'}


def get_engine():
    return create_engine(settings.database_url)


def build_feature_matrix() -> pd.DataFrame:
    engine = get_engine()
    with engine.connect() as conn:
        pairs = conn.execute(text("""
            SELECT
                year,
                gp_name,
                MAX(CASE WHEN session_type = 'Q' THEN session_key END) AS quali_key,
                MAX(CASE WHEN session_type = 'R' THEN session_key END) AS race_key
            FROM sessions
            GROUP BY year, gp_name
            HAVING
                MAX(CASE WHEN session_type = 'Q' THEN session_key END) IS NOT NULL
                AND MAX(CASE WHEN session_type = 'R' THEN session_key END) IS NOT NULL
            ORDER BY year, gp_name
        """)).mappings().all()

    log.info("feature.pairs", count=len(pairs))

    all_rows = []
    for pair in pairs:
        rows = _build_weekend_features(
            year=pair['year'],
            gp_name=pair['gp_name'],
            quali_key=pair['quali_key'],
            race_key=pair['race_key'],
        )
        all_rows.extend(rows)
        log.info("feature.weekend_done",
                 year=pair['year'],
                 gp=pair['gp_name'],
                 rows=len(rows))

    df = pd.DataFrame(all_rows)
    log.info("feature.matrix_built", shape=df.shape)
    return df


def _build_weekend_features(
    year: int,
    gp_name: str,
    quali_key: int,
    race_key: int,
) -> list[dict]:
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
              AND l.is_accurate   = TRUE
            ORDER BY l.driver_number, l.lap_time_ms ASC
        """), {"qk": quali_key}).mappings().all()

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
                    year=year, gp=gp_name,
                    quali=len(quali_laps or []),
                    race=len(race_results or []))
        return []

    finish_map = {r['driver_number']: r['finish_position'] for r in race_results}

    q = pd.DataFrame([dict(r) for r in quali_laps])
    q['grid_position']        = q['lap_time_ms'].rank(method='min').astype(int)
    q['quali_gap_to_pole_ms'] = q['lap_time_ms'] - q['lap_time_ms'].min()

    for sec in ['s1_ms', 's2_ms', 's3_ms']:
        q[f'{sec}_rank'] = q[sec].rank(method='min', na_option='bottom').astype(int)
        field_best       = q[sec].min()
        q[f'{sec}_gap']  = (q[sec] - field_best).fillna(9999)

    # Circuit type flags — teach the model track characteristics
    is_street  = int(gp_name in STREET_CIRCUITS)
    is_power   = int(gp_name in POWER_CIRCUITS)
    is_high_df = int(gp_name in HIGH_DF_CIRCUITS)

    rows = []
    for _, r in q.iterrows():
        finish = finish_map.get(int(r['driver_number']))
        if finish is None:
            continue
        rows.append({
            # Identifiers
            'year':          year,
            'gp_name':       gp_name,
            'driver_number': int(r['driver_number']),
            'abbreviation':  r['abbreviation'],
            'team_name':     r['team_name'] or 'Unknown',
            # Features
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
            'is_street_circuit':    is_street,
            'is_power_circuit':     is_power,
            'is_high_df_circuit':   is_high_df,
            # Target
            'finish_position': int(finish),
        })

    return rows


def build_inference_features(quali_session_key: int) -> pd.DataFrame:
    """Build features for a quali session — no target, used for inference."""
    engine = get_engine()

    with engine.connect() as conn:
        # Get circuit name for this session
        session_row = conn.execute(text("""
            SELECT gp_name FROM sessions WHERE session_key = :sk
        """), {"sk": quali_session_key}).first()

        gp_name = session_row[0] if session_row else ''

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
            WHERE l.session_key = :qk
              AND l.lap_time_ms IS NOT NULL
            ORDER BY l.driver_number, l.lap_time_ms ASC
        """), {"qk": quali_session_key}).mappings().all()

    if not quali_laps:
        raise ValueError(f"No qualifying data for session {quali_session_key}")

    q = pd.DataFrame([dict(r) for r in quali_laps])
    q['grid_position']        = q['lap_time_ms'].rank(method='min').astype(int)
    q['quali_gap_to_pole_ms'] = q['lap_time_ms'] - q['lap_time_ms'].min()

    for sec in ['s1_ms', 's2_ms', 's3_ms']:
        q[f'{sec}_rank'] = q[sec].rank(method='min', na_option='bottom').astype(int)
        field_best       = q[sec].min()
        q[f'{sec}_gap']  = (q[sec] - field_best).fillna(9999)

    is_street  = int(gp_name in STREET_CIRCUITS)
    is_power   = int(gp_name in POWER_CIRCUITS)
    is_high_df = int(gp_name in HIGH_DF_CIRCUITS)

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
            'is_street_circuit':    is_street,
            'is_power_circuit':     is_power,
            'is_high_df_circuit':   is_high_df,
        })

    return pd.DataFrame(rows)
