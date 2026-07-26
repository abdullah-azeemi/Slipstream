"""
    Statistical Validation Features for driver_features.

    Computes:
        1. ICC(1,1) per feature - filters the features that are race noise, not just a driver-trait
        2. Ridge regression baseline - sanity check that features predict something

    Usage:
        uv run python -m ml.validate_features

"""

from __future__ import annotations
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
    "wet_pace_delta"
]

ICC_MIN_THRESHOLD = 0.5
MIN_SEASONS_PER_DRIVER = 2

def load_features(engine: Engine) -> pd.DataFrame:
    """ Load driver features table in the dataframe"""
    sql = text(""" 
            SELECT
                driver_number, season, abbreviation, team_name, 
                avg_finish_position, finish_position_stddev, podium_rate, win_rate,
                avg_positions_gained, quali_to_race_delta, dnf_rate,
                lap_time_consistency, braking_aggression, drs_usage_pct, wet_pace_delta
            FROM driver_features
            ORDER BY driver_number, season
    """)
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn)
    logger.info("loaded_features", rows=len(df), drivers=df["driver_number"].nunique())
    return df

def compute_icc_per_feature(df: pd.DataFrame) -> dict[str, float]:
    """ Compute ICC(1,1) for each feature, groupped by driver.
        
        Uses a one way ANOVA: F = MS_BETWEEN / MS_WITHIN
        Then: ICC = (F-1) / (F + k_avg - 1)
        
        Returns : {feature_name: icc_value}
    """

    # First filter out the seasons with MIN_SEASONS_PER_DRIVER threshold
    driver_counts = df.groupby("driver_number")[FEATURE_COLS[0]].count()
    valid_drivers = driver_counts[driver_counts >= MIN_SEASONS_PER_DRIVER].index
    df_valid = df[df["driver_number"].isin(valid_drivers)]

    n_drivers = df_valid["driver_number"].nunique()
    n_total = len(df_valid)
    k_avg = n_total / n_drivers

    logger.info (
        "icc_input",
        drivers=n_drivers,
        observations=n_total,
        k_avg=round(k_avg, 1)
    )

    results = {}
    for col in FEATURE_COLS:

        # First drop the rows where the feature is Nan.
        groups = [
            grp[col].dropna().values
            for _, grp in df_valid.groupby("driver_number")
            if len(grp[col].dropna()) >= 2
        ]

        if len(groups) < 3:
            logger.warning("icc_skip", feature=col, reason="too_few_groups")
            results[col] = None
            continue

        # One-way ANOVA: tests if group is different significantly
        f_stat, _ = sp_stats.f_oneway(*groups)

        # Convert the F-statsitc to ICC
        # F = MS_BETWEEN / MS_WITHIN
        # ICC = (F-1) / (F+ k_avg -1)
        icc = (f_stat - 1) / (f_stat+ k_avg - 1)
        icc = max(icc, 0.0)

        results[col] = round(icc, 3)

    return results

def ridge_baseline(df: pd.DataFrame) -> dict:
    """5-fold CV Ridge regression: predict avg_finish_position from features.

    If R² >> 0, features have signal. If R² ≈ 0, features are garbage.
    """
    from sklearn.linear_model import Ridge
    from sklearn.model_selection import cross_val_score
    from sklearn.preprocessing import StandardScaler
    from sklearn.pipeline import make_pipeline

    df_clean = df.dropna(subset=FEATURE_COLS + ["avg_finish_position"])

    X = df.clean[FEATURE_COLS].values
    y = df_clean["avg_finish_position"].values

    model = make_pipeline(
        StandardScaler(),
        Ridge(alpha=1.0)
    )
    scores = cross_val_score(model, X, y, cv=5, scoring="r2")
    model.fit(X,y)
    ridge = model.named_steps["ridge"]
    coefs = dict(zip(FEATURE_COLS, ridge.coef_))

    return {
        "r2_mean": round(float(scores.mean()), 4),
        "r2_std": round(float(scores.std()), 4),
        "n_samples": len(df_clean),
        "coefficients": {k: round(float(v), 4) for k, v in coefs.items()},
    }

def validate(engine: Engine) -> dict:
    """ Run the full validation pipeline and return a report"""

    df = load_features(engine)
    icc_results = compute_icc_per_feature(df)

    passed = {k: v for k, v in icc_results.items() if v is not None and v >= ICC_MIN_THRESHOLD}
    borderline = {k: v for k, v in icc_results.items() if v is not None and 0.5 <= v <= 0.75}
    failed = {k: v for k, v in icc_results.items() if v is not None and v < ICC_MIN_THRESHOLD}
    skipped = {k: v for k, v in icc_results.items() if v is None}

    ridge = ridge_baseline(df)
    report = {
        "icc": {
            "passed": passed,
            "borderline": borderline,
            "failed": failed,
            "skipped": skipped,
            "threshold": ICC_MIN_THRESHOLD
        },
        "ridge_baseline": ridge,
        "recommendation": _recommend(passed, failed, ridge),
    }

    _print_report(report)
    return report

def _recommend(passed, failed, ridge) -> str:
    if not failed and ridge["r2_mean"] > 0.1:
        return "ALL_CLEAR — proceed to Phase 1 (embeddings)"
    if failed and ridge["r2_mean"] > 0.1:
        return "DROP_FAILED_FEATURES — remove low-ICC features, then proceed"
    if ridge["r2_mean"] <= 0.1:
        return "STOP — features have no predictive signal, investigate feature store"
    return "REVIEW — mixed results, manual inspection needed"

def _print_report(report) -> None:
    icc = report["icc"]
    ridge = report["ridge_baseline"]
    print("=" * 60 + "\n")
    print("\n\n STATISTICAL VALIDATION REPORT \n\n")
    print(f"\n  Drivers in dataset: {ridge['n_samples']}")
    print(f"  Features evaluated: {len(FEATURE_COLS)}")
    print(f"\n  ICC Results (threshold = {icc['threshold']}):")
    print(f"    Passed (≥0.75):  {len([v for v in icc['passed'].values() if v >= 0.75])}")
    print(f"    Moderate (0.5-0.75): {len(icc['borderline'])}")
    print(f"    Failed (<0.5):   {len(icc['failed'])}")
    print(f"    Skipped:         {len(icc['skipped'])}")

    print(f"\n  Per-feature ICC:")
    for col in FEATURE_COLS:
        val = icc["passed"].get(col) or icc["borderline"].get(col) or icc["failed"].get(col)
        if val is None:
            icon, val_str = "⏭️", "N/A"
        elif val >= 0.75:
            icon, val_str = "✅", f"{val:.3f}"
        elif val >= 0.5:
            icon, val_str = "⚠️", f"{val:.3f}"
        else:
            icon, val_str = "❌", f"{val:.3f}"
        print(f"    {icon} {col:30s} {val_str}")

    print(f"\n  Ridge Regression Baseline (5-fold CV):")
    print(f"    R² = {ridge['r2_mean']:.4f} ± {ridge['r2_std']:.4f}")
    print(f"    Coefficients (sorted by magnitude):")
    for name, coef in sorted(ridge["coefficients"].items(), key=lambda x: abs(x[1]), reverse=True):
        print(f"      {name:30s} {coef:+.4f}")

    print(f"\n  Recommendation: {report['recommendation']}")
    print("=" * 60 + "\n")


def main() -> None:
    engine = create_engine(settings.db_url)
    validate(engine)

if __name__ == "__main__":
    main()




