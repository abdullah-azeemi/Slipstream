"""Archetype clustering — group drivers into named archetypes via KMeans.

Takes the 5-dim PCA embeddings and clusters them into k driver types.
Each cluster gets a human-readable name based on which features dominate.

Usage:
    uv run python -m ml.archetypes
"""

from __future__ import annotations

import structlog
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from ml.config import settings

logger = structlog.get_logger()

N_CLUSTERS = 4
RANDOM_STATE = 42

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
    "throttle_instability",
    "kerb_confidence",
    "track_limits_rate",
]

# Archetype naming rules: if a feature is significantly above/below global mean,
# it contributes to the archetype name. Weights determine naming priority.
ARCHETYPE_SIGNALS = {
    "Late Braker": {
        "braking_aggression": +1.5,
        "drs_usage_pct": +0.5,
    },
    "Tyre Whisperer": {
        "lap_time_consistency": -1.5,
        "finish_position_stddev": -1.0,
    },
    "Race Winner": {
        "podium_rate": +1.5,
        "win_rate": +1.0,
    },
    "Kerb Rider": {
        "kerb_confidence": +1.5,
        "throttle_instability": +1.0,
        "track_limits_rate": +0.5,
    },
    "Wet Specialist": {
        "wet_pace_delta": -1.5,
    },
    "Quali Ace": {
        "quali_to_race_delta": -1.0,
        "avg_speed_trap": +0.5,
        "max_speed_capability": +0.5,
    },
    "Steady Eddie": {
        "dnf_rate": -1.0,
        "lap_time_consistency": -0.5,
        "avg_finish_position": +0.5,
    },
}


def load_data(engine: Engine) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Load features and embeddings."""
    features_sql = text("""
        SELECT driver_number, season, abbreviation,
               avg_finish_position, finish_position_stddev, podium_rate, win_rate,
               avg_positions_gained, quali_to_race_delta, dnf_rate,
               lap_time_consistency, avg_speed_trap,
               max_speed_capability, braking_aggression, drs_usage_pct,
               wet_pace_delta,
               throttle_instability, kerb_confidence, track_limits_rate
        FROM driver_features
        ORDER BY driver_number, season
    """)
    embeddings_sql = text("""
        SELECT driver_number, season, embedding
        FROM driver_embeddings
        ORDER BY driver_number, season
    """)
    with engine.connect() as conn:
        features = pd.read_sql(features_sql, conn)
        embeddings = pd.read_sql(embeddings_sql, conn)
    return features, embeddings


def cluster_embeddings(embeddings_df: pd.DataFrame) -> np.ndarray:
    """Run KMeans on embeddings, return cluster labels."""
    emb_matrix = np.vstack(embeddings_df["embedding"].values)

    kmeans = KMeans(n_clusters=N_CLUSTERS, random_state=RANDOM_STATE, n_init=10)
    labels = kmeans.fit_predict(emb_matrix)

    logger.info("kmeans_done", n_clusters=N_CLUSTERS, labels=labels.tolist())
    return labels


def name_archetypes(
    features: pd.DataFrame, embeddings: pd.DataFrame, labels: np.ndarray
) -> dict[int, str]:
    """Name each cluster based on feature analysis.

    For each cluster, compute the mean feature values, z-score against
    global mean, then score each archetype name by how well the cluster
    matches its signals.
    """
    merged = features.merge(
        embeddings[["driver_number", "season"]].assign(cluster=labels),
        on=["driver_number", "season"],
        how="inner",
    )

    # Global feature stats
    global_means = merged[FEATURE_COLS].mean()
    global_stds = merged[FEATURE_COLS].std().replace(0, 1).infer_objects(copy=False)

    cluster_names = {}
    for cluster_id in range(N_CLUSTERS):
        cluster_data = merged[merged["cluster"] == cluster_id]
        if cluster_data.empty:
            cluster_names[cluster_id] = f"Cluster {cluster_id}"
            continue

        cluster_means = cluster_data[FEATURE_COLS].mean()
        # Z-score: how many std devs above/below global mean
        z_scores = (cluster_means - global_means) / global_stds

        # Score each archetype name
        best_name = f"Cluster {cluster_id}"
        best_score = 0
        for archetype_name, signals in ARCHETYPE_SIGNALS.items():
            score = sum(
                z_scores.get(feat, 0) * weight for feat, weight in signals.items()
            )
            if score > best_score:
                best_score = score
                best_name = archetype_name

        cluster_names[cluster_id] = best_name
        logger.info(
            "archetype_named",
            cluster=cluster_id,
            name=best_name,
            score=round(best_score, 2),
            n_drivers=len(cluster_data),
        )

    return cluster_names


UPSERT_SQL = text("""
    UPDATE driver_embeddings
    SET archetype = :archetype
    WHERE driver_number = :driver_number
      AND season = :season
""")


def upsert_archetypes(
    engine: Engine, embeddings_df: pd.DataFrame, labels: np.ndarray, names: dict
) -> int:
    """Write archetype labels to database."""
    count = 0
    with engine.begin() as conn:
        for _, row in embeddings_df.iterrows():
            cluster_id = int(labels[count])
            archetype = names[cluster_id]
            conn.execute(
                UPSERT_SQL,
                {
                    "driver_number": int(row["driver_number"]),
                    "season": int(row["season"]),
                    "archetype": archetype,
                },
            )
            count += 1
    logger.info("upsert_archetypes", rows=count)
    return count


def main() -> None:
    engine = create_engine(settings.db_url)
    features, embeddings = load_data(engine)

    if features.empty or embeddings.empty:
        logger.error("no_data")
        return

    # Merge to get matching rows
    merged = features.merge(
        embeddings[["driver_number", "season", "embedding"]],
        on=["driver_number", "season"],
        how="inner",
    )
    if len(merged) < N_CLUSTERS:
        logger.error("not_enough_data", n=len(merged), required=N_CLUSTERS)
        return

    labels = cluster_embeddings(merged[["driver_number", "season", "embedding"]])
    names = name_archetypes(features, embeddings, labels)

    upsert_archetypes(
        engine, merged[["driver_number", "season", "embedding"]], labels, names
    )

    # Print summary
    print(f"\n{'=' * 60}")
    print("  PHASE 5 — ARCHETYPE CLUSTERING")
    print(f"{'=' * 60}")
    print(f"\n  Drivers clustered: {len(merged)}")
    print(f"  Number of archetypes: {N_CLUSTERS}")
    print("\n  Archetypes:")
    for cluster_id, name in names.items():
        count = sum(1 for lbl in labels if lbl == cluster_id)
        drivers = merged.iloc[labels == cluster_id]
        abbrs = ", ".join(drivers["abbreviation"].tolist())
        print(f"    {name:20s} ({count} drivers): {abbrs}")
    print(f"{'=' * 60}\n")


if __name__ == "__main__":
    main()
