"""Interpretability layer — label PCA axes with human-readable names.

For each PCA component, computes Pearson correlation with original features.
The top correlated features reveal what each axis "means", which gets stored
as human-readable labels for the frontend radar charts.

Usage:
    uv run python -m ml.interpretability
"""

from __future__ import annotations

import json
import structlog
import numpy as np
import pandas as pd
from scipy import stats as sp_stats
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from ml.config import settings

logger = structlog.get_logger()

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

# Feature groupings for label inference
FEATURE_GROUPS = {
    "racecraft": {"podium_rate", "win_rate", "avg_finish_position"},
    "consistency": {"lap_time_consistency", "finish_position_stddev"},
    "aggression": {"braking_aggression", "drs_usage_pct", "throttle_instability"},
    "kerb_style": {"kerb_confidence", "track_limits_rate", "throttle_instability"},
    "pace": {"avg_speed_trap", "max_speed_capability"},
    "racecraft_gain": {"avg_positions_gained", "quali_to_race_delta"},
    "wet_weather": {"wet_pace_delta"},
    "reliability": {"dnf_rate"},
}

TOP_CORRELATIONS = 3


def load_data(engine: Engine) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Load features and embeddings."""
    features_sql = text("""
        SELECT driver_number, season,
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
        SELECT driver_number, season, embedding, pca_loadings
        FROM driver_embeddings
        ORDER BY driver_number, season
    """)
    with engine.connect() as conn:
        features = pd.read_sql(features_sql, conn)
        embeddings = pd.read_sql(embeddings_sql, conn)

    logger.info("loaded_data", features=len(features), embeddings=len(embeddings))
    return features, embeddings


def compute_correlations(features: pd.DataFrame, embeddings: pd.DataFrame) -> dict:
    """Compute correlation between each PCA component and each original feature.

    Returns: {component_index: {feature: correlation, ...}}
    """
    # Merge on driver_number + season
    merged = features.merge(
        embeddings[["driver_number", "season", "embedding"]],
        on=["driver_number", "season"],
        how="inner",
    )

    if len(merged) < 5:
        logger.warning("too_few_samples_for_correlation", n=len(merged))
        return {}

    # Extract embedding dimensions into separate columns
    emb_matrix = np.vstack(merged["embedding"].values)
    n_dims = emb_matrix.shape[1]

    # Extract feature matrix
    feat_matrix = merged[FEATURE_COLS].fillna(0).infer_objects(copy=False).values

    correlations = {}
    for dim in range(n_dims):
        dim_corrs = {}
        for j, feat_name in enumerate(FEATURE_COLS):
            col = feat_matrix[:, j]
            # Skip constant features (correlation undefined)
            if np.std(col) == 0:
                dim_corrs[feat_name] = 0.0
                continue
            r, _ = sp_stats.pearsonr(emb_matrix[:, dim], col)
            dim_corrs[feat_name] = round(float(r) if r == r else 0.0, 4)
        correlations[str(dim)] = dim_corrs

    return correlations


def infer_axis_label(top_features: list[dict]) -> str:
    """Map top correlated features to a human-readable label.

    Uses feature groupings to determine which concept the axis represents.
    """
    feature_names = {f["feature"] for f in top_features}

    # Score each group by how many of its features appear in top correlated
    best_group = "unknown"
    best_score = 0
    for group_name, group_features in FEATURE_GROUPS.items():
        overlap = len(feature_names & group_features)
        if overlap > best_score:
            best_score = overlap
            best_group = group_name

    # Clean up label name
    label_map = {
        "racecraft": "Racecraft",
        "consistency": "Consistency",
        "aggression": "Aggression",
        "kerb_style": "Kerb Style",
        "pace": "Raw Pace",
        "racecraft_gain": "Racecraft Gain",
        "wet_weather": "Wet Weather",
        "reliability": "Reliability",
    }
    return label_map.get(best_group, best_group)


def build_axis_labels(correlations: dict, loadings: dict) -> dict:
    """Build human-readable labels for each PCA axis.

    Returns: {component_index: {label: str, top_features: [...]}}
    """
    labels = {}
    for dim_str, dim_corrs in correlations.items():
        # Sort by absolute correlation
        sorted_features = sorted(
            dim_corrs.items(), key=lambda x: abs(x[1]), reverse=True
        )
        top_features = [
            {"feature": name, "correlation": corr}
            for name, corr in sorted_features[:TOP_CORRELATIONS]
        ]

        label = infer_axis_label(top_features)

        labels[dim_str] = {
            "label": label,
            "top_features": top_features,
        }

    logger.info("axis_labels_built", labels={k: v["label"] for k, v in labels.items()})
    return labels


UPSERT_SQL = text("""
    UPDATE driver_embeddings
    SET axis_labels = :axis_labels
    WHERE season = :season
""")


def upsert_labels(engine: Engine, season: int, axis_labels: dict) -> int:
    """Write axis labels for all drivers in a season. Returns row count."""
    with engine.begin() as conn:
        result = conn.execute(
            UPSERT_SQL,
            {
                "axis_labels": json.dumps(axis_labels),
                "season": season,
            },
        )
    count = result.rowcount
    logger.info("upsert_labels", season=season, rows=count)
    return count


def main() -> None:
    engine = create_engine(settings.db_url)
    features, embeddings = load_data(engine)

    if features.empty or embeddings.empty:
        logger.error("no_data")
        return

    # Get seasons present
    seasons = sorted(embeddings["season"].unique())

    for season in seasons:
        season_features = features[features["season"] == season]
        season_embeddings = embeddings[embeddings["season"] == season]

        correlations = compute_correlations(season_features, season_embeddings)
        if not correlations:
            continue

        # Use loadings from first driver (they're the same PCA for all)
        first_loadings = (
            json.loads(season_embeddings.iloc[0]["pca_loadings"])
            if isinstance(season_embeddings.iloc[0]["pca_loadings"], str)
            else season_embeddings.iloc[0]["pca_loadings"]
        )

        axis_labels = build_axis_labels(correlations, first_loadings)
        upsert_labels(engine, season, axis_labels)

        # Print summary
        print(f"\n{'=' * 60}")
        print(f"  PHASE 4 — INTERPRETABILITY (Season {season})")
        print(f"{'=' * 60}")
        for dim, info in axis_labels.items():
            print(f"\n  PC{int(dim) + 1}: {info['label']}")
            for f in info["top_features"]:
                r = f["correlation"]
                bar = "+" * int(abs(r) * 20) if r > 0 else "-" * int(abs(r) * 20)
                print(f"    {f['feature']:30s} r={r:+.3f} {bar}")
        print(f"\n{'=' * 60}\n")


if __name__ == "__main__":
    main()
