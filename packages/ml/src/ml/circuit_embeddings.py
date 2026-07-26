"""Circuit embeddings — learn circuit representations from telemetry/lap shape.

Instead of hand-coded is_street_circuit flags, computes per-circuit features
from actual lap data and projects them into a compact embedding via PCA.

Features per circuit:
  - avg_lap_time_ms, lap_time_stddev: pace characteristics
  - n_corners_avg, avg_corner_sharpness: layout complexity
  - avg_speed_kmh, max_speed_kmh: speed profile
  - avg_throttle_pct, avg_brake_pct: driving demands
  - overtakes_per_race: passing frequency
  - safety_car_rate: race disruption tendency

Usage:
    uv run python -m ml.circuit_embeddings
"""

from __future__ import annotations

import json
import structlog
import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from ml.config import settings

logger = structlog.get_logger()

N_COMPONENTS = 3
TOP_LOADINGS_PER_COMPONENT = 3


def compute_circuit_features(engine: Engine) -> pd.DataFrame:
    """Compute aggregate features per circuit from lap/telemetry data."""
    sql = text("""
        WITH lap_stats AS (
            SELECT
                s.circuit_key,
                s.gp_name,
                s.country,
                s.session_key,
                AVG(lt.lap_time_ms) AS avg_lap_time_ms,
                STDDEV_POP(lt.lap_time_ms) AS lap_time_stddev,
                AVG(lt.speed_st) AS avg_speed_trap
            FROM lap_times lt
            JOIN sessions s ON s.session_key = lt.session_key
            WHERE s.session_type = 'R'
              AND lt.deleted = FALSE
              AND lt.lap_time_ms IS NOT NULL
            GROUP BY s.circuit_key, s.gp_name, s.country, s.session_key
        ),
        telemetry_stats AS (
            SELECT
                s.circuit_key,
                AVG(lts.max_speed_kmh) AS avg_max_speed,
                AVG(lts.drs_open_pct) AS avg_drs_pct,
                AVG(lts.avg_brake_point_pct) AS avg_brake_pct
            FROM lap_telemetry_stats lts
            JOIN sessions s ON s.session_key = lts.session_key
            WHERE s.session_type = 'R'
            GROUP BY s.circuit_key
        ),
        overtakes AS (
            SELECT
                s.circuit_key,
                AVG(overtake_count) AS overtakes_per_race
            FROM (
                SELECT
                    session_key,
                    COUNT(*) AS overtake_count
                FROM (
                    SELECT
                        lt.session_key,
                        lt.driver_number,
                        lt.lap_number,
                        lt.position,
                        LAG(lt.position) OVER (
                            PARTITION BY lt.session_key, lt.driver_number
                            ORDER BY lt.lap_number
                        ) AS prev_position
                    FROM lap_times lt
                    JOIN sessions s ON s.session_key = lt.session_key
                    WHERE s.session_type = 'R' AND lt.deleted = FALSE
                ) pos_changes
                WHERE prev_position IS NOT NULL AND position < prev_position
                GROUP BY session_key
            ) race_overtakes
            JOIN sessions s ON s.session_key = race_overtakes.session_key
            GROUP BY s.circuit_key
        )
        SELECT
            ls.circuit_key,
            ls.gp_name,
            ls.country,
            COUNT(DISTINCT ls.session_key) AS n_races,
            AVG(ls.avg_lap_time_ms) AS avg_lap_time_ms,
            AVG(ls.lap_time_stddev) AS lap_time_stddev,
            AVG(ls.avg_speed_trap) AS avg_speed_trap,
            ts.avg_max_speed,
            ts.avg_drs_pct,
            ts.avg_brake_pct,
            COALESCE(ov.overtakes_per_race, 0) AS overtakes_per_race
        FROM lap_stats ls
        LEFT JOIN telemetry_stats ts ON ts.circuit_key = ls.circuit_key
        LEFT JOIN overtakes ov ON ov.circuit_key = ls.circuit_key
        GROUP BY ls.circuit_key, ls.gp_name, ls.country,
                 ts.avg_max_speed, ts.avg_drs_pct, ts.avg_brake_pct,
                 ov.overtakes_per_race
        HAVING COUNT(DISTINCT ls.session_key) >= 1
        ORDER BY ls.circuit_key
    """)
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)
    logger.info("circuit_features_computed", circuits=len(df))
    return df


CIRCUIT_FEATURE_COLS = [
    "avg_lap_time_ms",
    "lap_time_stddev",
    "avg_speed_trap",
    "avg_max_speed",
    "avg_drs_pct",
    "avg_brake_pct",
    "overtakes_per_race",
]


def compute_circuit_embeddings(df: pd.DataFrame) -> dict:
    """PCA on circuit features."""
    meta = df[["circuit_key", "gp_name", "country", "n_races",
               "avg_lap_time_ms"]].copy()

    X_raw = df[CIRCUIT_FEATURE_COLS].fillna(0).values
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X_raw)

    n_comp = min(N_COMPONENTS, len(df), len(CIRCUIT_FEATURE_COLS))
    pca = PCA(n_components=n_comp)
    X_embedded = pca.fit_transform(X_scaled)

    # Loadings
    loadings = {}
    feature_names = np.array(CIRCUIT_FEATURE_COLS)
    for i in range(n_comp):
        sorted_idx = np.argsort(np.abs(pca.components_[i]))[::-1]
        top_features = [
            {"feature": feature_names[idx],
             "weight": round(float(pca.components_[i][idx]), 4)}
            for idx in sorted_idx[:TOP_LOADINGS_PER_COMPONENT]
        ]
        loadings[str(i)] = top_features

    meta["embedding"] = [row.tolist() for row in X_embedded]
    explained = [round(float(v), 4) for v in pca.explained_variance_ratio_]

    # Simple axis labels based on top loadings
    axis_labels = {}
    for dim_str, dim_loadings in loadings.items():
        top_feat = dim_loadings[0]["feature"] if dim_loadings else "unknown"
        label_map = {
            "avg_lap_time_ms": "Pace",
            "lap_time_stddev": "Consistency",
            "avg_speed_trap": "Speed",
            "avg_max_speed": "Speed",
            "avg_drs_pct": "Overtaking",
            "avg_brake_pct": "Braking",
            "overtakes_per_race": "Action",
        }
        axis_labels[dim_str] = {
            "label": label_map.get(top_feat, top_feat),
            "top_features": dim_loadings,
        }

    return {
        "embeddings": meta,
        "explained_variance": explained,
        "loadings": loadings,
        "axis_labels": axis_labels,
    }


UPSERT_SQL = text("""
    INSERT INTO circuit_embeddings (
        circuit_key, gp_name, country, embedding,
        pca_explained_variance, pca_loadings, axis_labels,
        n_races, avg_lap_time_ms
    ) VALUES (
        :circuit_key, :gp_name, :country, :embedding,
        :pca_explained_variance, :pca_loadings, :axis_labels,
        :n_races, :avg_lap_time_ms
    )
    ON CONFLICT (circuit_key)
    DO UPDATE SET
        gp_name = EXCLUDED.gp_name,
        country = EXCLUDED.country,
        embedding = EXCLUDED.embedding,
        pca_explained_variance = EXCLUDED.pca_explained_variance,
        pca_loadings = EXCLUDED.pca_loadings,
        axis_labels = EXCLUDED.axis_labels,
        n_races = EXCLUDED.n_races,
        avg_lap_time_ms = EXCLUDED.avg_lap_time_ms,
        computed_at = NOW()
""")


def upsert_circuit_embeddings(engine: Engine, result: dict) -> int:
    """Write circuit embeddings to database."""
    meta = result["embeddings"]
    with engine.begin() as conn:
        for _, row in meta.iterrows():
            conn.execute(UPSERT_SQL, {
                "circuit_key": int(row["circuit_key"]),
                "gp_name": row["gp_name"],
                "country": row["country"],
                "embedding": row["embedding"],
                "pca_explained_variance": result["explained_variance"],
                "pca_loadings": json.dumps(result["loadings"]),
                "axis_labels": json.dumps(result["axis_labels"]),
                "n_races": int(row["n_races"]),
                "avg_lap_time_ms": float(row["avg_lap_time_ms"])
                    if pd.notna(row["avg_lap_time_ms"]) else None,
            })
    count = len(meta)
    logger.info("upsert_circuit_embeddings", rows=count)
    return count


def main() -> None:
    engine = create_engine(settings.db_url)
    df = compute_circuit_features(engine)

    if len(df) < 3:
        logger.error("not_enough_circuits", n=len(df))
        return

    result = compute_circuit_embeddings(df)
    count = upsert_circuit_embeddings(engine, result)

    print(f"\n{'=' * 60}")
    print("  PHASE 6 — CIRCUIT EMBEDDINGS")
    print(f"{'=' * 60}")
    print(f"\n  Circuits embedded: {count}")
    print(f"  Embedding dimensions: {len(result['explained_variance'])}")
    print("\n  Explained variance:")
    cumulative = 0
    for i, v in enumerate(result["explained_variance"]):
        cumulative += v
        print(f"    PC{i + 1}: {v:.4f}  (cumulative: {cumulative:.4f})")
    print("\n  Axis labels:")
    for dim, info in result["axis_labels"].items():
        print(f"    PC{int(dim) + 1}: {info['label']}")
    print("\n  Circuits:")
    for _, row in result["embeddings"].iterrows():
        print(f"    {row['gp_name']:30s} ({row['n_races']} races)")
    print(f"{'=' * 60}\n")


if __name__ == "__main__":
    main()
