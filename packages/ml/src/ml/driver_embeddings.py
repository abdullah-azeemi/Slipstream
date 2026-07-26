"""Driver embeddings — PCA projection of driver features into low-dimensional space.

Takes the 13 features from driver_features and projects them into a 5-dimensional
embedding using PCA. Each driver/season gets a compact "driving style fingerprint."

Usage:
    uv run python -m ml.driver_embeddings
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

N_COMPONENTS = 5
TOP_LOADINGS_PER_COMPONENT = 3

FEATURE_COLS = [
    "avg_finish_position",
    "finish_position_stddev",
    "podium_rate",
    "win_rate",
    "avg_positions_gained",
    "quali_to_race_delta",
    "dnf_rate",
    "lap_time_consistency",
    "avg_speed_trap",
    "max_speed_capability",
    "braking_aggression",
    "drs_usage_pct",
    "wet_pace_delta",
]


def load_features(engine: Engine) -> pd.DataFrame:
    """Load driver features with metadata for embedding."""
    sql = text("""
        SELECT
            driver_number, season, abbreviation, team_name,
            avg_finish_position, finish_position_stddev, podium_rate, win_rate,
            avg_positions_gained, quali_to_race_delta, dnf_rate,
            lap_time_consistency, avg_speed_trap,
            max_speed_capability, braking_aggression, drs_usage_pct,
            wet_pace_delta
        FROM driver_features
        ORDER BY driver_number, season
    """)
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)
    logger.info("loaded_features", rows=len(df), drivers=df["driver_number"].nunique())
    return df


def compute_embeddings(df: pd.DataFrame) -> dict:
    """Run PCA on features, return embeddings + metadata."""
    meta = df[["driver_number", "season", "abbreviation", "team_name"]].copy()
    X_raw = df[FEATURE_COLS].fillna(0).values

    # Standardize — PCA is scale-sensitive
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X_raw)

    # Fit PCA — project 13-dim onto N_components
    pca = PCA(n_components=N_COMPONENTS)
    X_embedded = pca.fit_transform(X_scaled)

    # Build loadings dict — which features contribute most to each component
    loadings = {}
    feature_names = np.array(FEATURE_COLS)
    for i in range(N_COMPONENTS):
        sorted_idx = np.argsort(np.abs(pca.components_[i]))[::-1]
        top_features = [
            {
                "feature": feature_names[idx],
                "weight": round(float(pca.components_[i][idx]), 4),
            }
            for idx in sorted_idx[:TOP_LOADINGS_PER_COMPONENT]
        ]
        loadings[str(i)] = top_features

    # Attach embeddings to metadata
    meta["embedding"] = [row.tolist() for row in X_embedded]

    explained = [round(float(v), 4) for v in pca.explained_variance_ratio_]
    logger.info(
        "pca_done",
        n_components=N_COMPONENTS,
        total_variance_explained=round(sum(explained), 4),
        explained_per_dim=explained,
    )

    return {
        "embeddings": meta,
        "pca_model": pca,
        "scaler": scaler,
        "explained_variance": explained,
        "loadings": loadings,
    }


UPSERT_SQL = text("""
    INSERT INTO driver_embeddings (
        driver_number, season, abbreviation, team_name,
        embedding, pca_explained_variance, pca_loadings
    ) VALUES (
        :driver_number, :season, :abbreviation, :team_name,
        :embedding, :pca_explained_variance, :pca_loadings
    )
    ON CONFLICT (driver_number, season)
    DO UPDATE SET
        abbreviation = EXCLUDED.abbreviation,
        team_name = EXCLUDED.team_name,
        embedding = EXCLUDED.embedding,
        pca_explained_variance = EXCLUDED.pca_explained_variance,
        pca_loadings = EXCLUDED.pca_loadings,
        computed_at = NOW()
""")


def upsert_embeddings(
    engine: Engine,
    embeddings_df: pd.DataFrame,
    explained_variance: list,
    loadings: dict,
) -> int:
    """Write embeddings to database. Returns count of rows written."""
    with engine.begin() as conn:
        for _, row in embeddings_df.iterrows():
            conn.execute(
                UPSERT_SQL,
                {
                    "driver_number": int(row["driver_number"]),
                    "season": int(row["season"]),
                    "abbreviation": row["abbreviation"],
                    "team_name": row["team_name"],
                    "embedding": row["embedding"],
                    "pca_explained_variance": explained_variance,
                    "pca_loadings": json.dumps(loadings),
                },
            )
    count = len(embeddings_df)
    logger.info("upsert_embeddings", rows=count)
    return count


def main() -> None:
    engine = create_engine(settings.db_url)
    df = load_features(engine)

    if len(df) < N_COMPONENTS:
        logger.error("not_enough_data", rows=len(df), required=N_COMPONENTS)
        return

    result = compute_embeddings(df)
    count = upsert_embeddings(
        engine,
        result["embeddings"],
        result["explained_variance"],
        result["loadings"],
    )

    # Print summary
    print("\n" + "=" * 60)
    print("  PHASE 1 — DRIVER EMBEDDINGS")
    print("=" * 60)
    print(f"\n  Drivers embedded: {count}")
    print(f"  Embedding dimensions: {N_COMPONENTS}")
    print("\n  Explained variance per component:")
    cumulative = 0
    for i, v in enumerate(result["explained_variance"]):
        cumulative += v
        print(f"    PC{i + 1}: {v:.4f}  (cumulative: {cumulative:.4f})")
    print(f"\n  Total variance captured: {sum(result['explained_variance']):.4f}")
    print("\n  Top features per component:")
    for comp, features in result["loadings"].items():
        feats = ", ".join(f"{f['feature']}({f['weight']:+.3f})" for f in features)
        print(f"    PC{int(comp) + 1}: {feats}")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    main()
