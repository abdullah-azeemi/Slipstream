"""
FLAML AutoML training for race position prediction.

Run with:
    uv run python -m ml.train
"""
from __future__ import annotations
import json
import os
import pickle
from pathlib import Path

import mlflow
import numpy as np
import pandas as pd
from flaml import AutoML
from sklearn.metrics import mean_absolute_error
import structlog

from ml.config import settings
from ml.features import build_feature_matrix, FEATURE_COLS, TARGET_COL

log = structlog.get_logger()

MODEL_PATH = Path("./ml_models/race_predictor.pkl")
MODEL_PATH.parent.mkdir(exist_ok=True)

# Disable FLAML's built-in MLflow auto-logging — we do it ourselves
os.environ["FLAML_MAX_ITER"] = "0"  # no-op, just ensuring env is set


def cross_validate(df: pd.DataFrame) -> dict:
    """Leave-one-year-out cross validation."""
    years     = sorted(df['year'].unique())
    errors    = []
    top3_hits = []

    log.info("cv.start", years=list(years))

    for test_year in years:
        train_df = df[df['year'] != test_year]
        test_df  = df[df['year'] == test_year]

        if len(train_df) < 10:
            log.warning("cv.skip", year=test_year, reason="not enough training data")
            continue

        X_train = train_df[FEATURE_COLS]
        y_train = train_df[TARGET_COL]
        X_test  = test_df[FEATURE_COLS]
        y_test  = test_df[TARGET_COL]

        model = AutoML()
        model.fit(
            X_train, y_train,
            task="regression",
            time_budget=30,
            metric="mae",
            verbose=0,
            mlflow_logging=False,   # ← key: disable FLAML's own MLflow calls
        )

        preds = model.predict(X_test)
        mae   = mean_absolute_error(y_test, preds)
        errors.append(mae)

        actual_top3 = set(test_df.nsmallest(3, TARGET_COL)['driver_number'])
        pred_series = pd.Series(preds, index=test_df.index)
        pred_top3   = set(test_df.loc[pred_series.nsmallest(3).index, 'driver_number'])
        overlap     = len(actual_top3 & pred_top3)
        top3_hits.append(overlap / 3.0)

        log.info("cv.fold",
                 test_year=int(test_year),
                 mae=round(mae, 2),
                 top3_accuracy=round(overlap / 3.0, 2),
                 best_model=model.best_estimator)

    return {
        "mae_mean":           round(float(np.mean(errors)), 3),
        "mae_std":            round(float(np.std(errors)),  3),
        "top3_accuracy_mean": round(float(np.mean(top3_hits)), 3),
        "n_folds":            len(errors),
    }


def train_final_model(df: pd.DataFrame) -> AutoML:
    """Train on all available data for production inference."""
    X = df[FEATURE_COLS]
    y = df[TARGET_COL]

    model = AutoML()
    model.fit(
        X, y,
        task="regression",
        time_budget=60,
        metric="mae",
        verbose=1,
        mlflow_logging=False,   # ← disable here too
    )

    log.info("model.trained",
             best_estimator=model.best_estimator,
             best_config=str(model.best_config))
    return model


def main():
    mlflow.set_tracking_uri(settings.mlflow_tracking_uri)
    mlflow.set_experiment("pitwall-race-prediction")

    log.info("train.start")

    df = build_feature_matrix()
    log.info("train.data",
             rows=len(df),
             years=sorted(int(y) for y in df['year'].unique()),
             drivers=int(df['driver_number'].nunique()))

    if len(df) < 20:
        log.error("train.insufficient_data", rows=len(df))
        return

    print("\n=== Feature Matrix Sample ===")
    print(df[FEATURE_COLS + [TARGET_COL, 'abbreviation', 'year']].head(10).to_string())
    print(f"\nShape: {df.shape}")

    with mlflow.start_run(run_name="pitwall-race-predictor"):

        # Cross validation
        cv_metrics = cross_validate(df)
        print("\n=== Cross Validation Results ===")
        for year in sorted(df['year'].unique()):
            print(f"  {int(year)}: held out as test set")
        print(f"\n  MAE:            {cv_metrics['mae_mean']} ± {cv_metrics['mae_std']} positions")
        print(f"  Top-3 accuracy: {cv_metrics['top3_accuracy_mean'] * 100:.1f}%")
        print(f"  Folds:          {cv_metrics['n_folds']}")

        # Train final model on all data
        print("\n=== Training Final Model (all data) ===")
        model = train_final_model(df)

        # Log to MLflow manually (no FLAML auto-logging)
        mlflow.log_params({
            "best_estimator":  model.best_estimator,
            "time_budget":     60,
            "n_training_rows": len(df),
            "n_features":      len(FEATURE_COLS),
            "features":        json.dumps(FEATURE_COLS),
        })
        mlflow.log_metrics({
            "cv_mae_mean":           cv_metrics['mae_mean'],
            "cv_mae_std":            cv_metrics['mae_std'],
            "cv_top3_accuracy_mean": cv_metrics['top3_accuracy_mean'],
        })

        # Log feature importance — the most valuable thing to track.
        # WHY: knowing WHICH features the model relies on tells you:
        #   1. Whether your new features are actually being used
        #   2. Whether the model is learning sensible patterns
        #   3. What to focus on in the next feature engineering iteration
        try:
            # XGBoost and ExtraTree both expose feature_importances_
            estimator = model.model.estimator
            if hasattr(estimator, 'feature_importances_'):
                importances = dict(zip(
                    FEATURE_COLS,
                    [round(float(x), 4) for x in estimator.feature_importances_]
                ))
                # Sort by importance descending
                importances_sorted = dict(
                    sorted(importances.items(), key=lambda x: x[1], reverse=True)
                )
                # Log top features as metrics (MLflow shows these in charts)
                for feat, imp in list(importances_sorted.items())[:10]:
                    mlflow.log_metric(f"importance_{feat}", imp)

                # Log full importance as artifact
                import tempfile, os
                tmp = tempfile.mktemp(suffix=".json")
                with open(tmp, "w") as f:
                    json.dump(importances_sorted, f, indent=2)
                try:
                    mlflow.log_artifact(tmp)
                except Exception:
                    pass  # artifact logging optional
                os.unlink(tmp)

                print("\n=== Feature Importance (top 10) ===")
                for feat, imp in list(importances_sorted.items())[:10]:
                    bar = "█" * int(imp * 50)
                    print(f"  {feat:35s} {imp:.4f} {bar}")
        except Exception as e:
            log.warning("feature_importance.failed", error=str(e))

        # Save model pickle for fast inference
        with open(MODEL_PATH, 'wb') as f:
            pickle.dump(model, f)

        # Also log the pickle as an artifact
        #mlflow.log_artifact(str(MODEL_PATH), artifact_path="model")

        log.info("model.saved", path=str(MODEL_PATH))
        print(f"\n✅  Model saved  → {MODEL_PATH}")
        print(f"    Best algorithm: {model.best_estimator}")
        print(f"    MLflow run logged → {settings.mlflow_tracking_uri}")


if __name__ == '__main__':
    main()
