"""Phase 7 — Overtake probability, strategy archetype, anomaly detection.

Three classifiers that write to the ml_predictions table:

  1. Overtake probability — gap_ms, tyre_delta, DRS → overtake (1) or hold (0)
  2. Strategy archetype — stint sequence → strategy type label
  3. Anomaly detection — Isolation Forest flags unusual laps

Usage:
    uv run python -m ml.phase7_classifiers
"""

from __future__ import annotations

import json
import structlog
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from ml.config import settings

logger = structlog.get_logger()
MODEL_VERSION = "phase7-v1"


# ═══════════════════════════════════════════════════════════════════════════════
# 1. OVERTAKE PROBABILITY
# ═══════════════════════════════════════════════════════════════════════════════

OVERTAKE_SQL = text("""
    WITH lap_positions AS (
        SELECT
            lt.session_key,
            lt.driver_number,
            lt.lap_number,
            lt.position,
            lt.compound,
            lt.tyre_life_laps,
            lt.lap_time_ms,
            LAG(lt.position) OVER (
                PARTITION BY lt.session_key, lt.driver_number
                ORDER BY lt.lap_number
            ) AS prev_position,
            LAG(lt.compound) OVER (
                PARTITION BY lt.session_key, lt.driver_number
                ORDER BY lt.lap_number
            ) AS prev_compound,
            LAG(lt.tyre_life_laps) OVER (
                PARTITION BY lt.session_key, lt.driver_number
                ORDER BY lt.lap_number
            ) AS prev_tyre_life
        FROM lap_times lt
        JOIN sessions s ON s.session_key = lt.session_key
        WHERE s.session_type = 'R' AND lt.deleted = FALSE
    )
    SELECT
        lp.session_key,
        lp.driver_number,
        lp.lap_number,
        lp.position,
        lp.prev_position,
        CASE WHEN lp.position < lp.prev_position THEN 1 ELSE 0 END AS overtook,
        -- Gap proxy: difference in previous position (how far ahead target was)
        lp.prev_position - lp.position AS position_gain,
        -- Tyre freshness delta (proxy for grip delta)
        COALESCE(lp.tyre_life_laps, 0) - COALESCE(lp.prev_tyre_life, 0) AS tyre_delta,
        -- Compound softness proxy
        CASE lp.compound
            WHEN 'SOFT' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'HARD' THEN 1 ELSE 0
        END AS compound_softness,
        lp.lap_time_ms
    FROM lap_positions lp
    WHERE lp.prev_position IS NOT NULL
      AND lp.position != lp.prev_position
""")


def build_overtake_dataset(engine: Engine) -> pd.DataFrame:
    """Build overtaking event dataset from lap position changes."""
    with engine.connect() as conn:
        df = pd.read_sql(OVERTAKE_SQL, conn)

    if df.empty:
        logger.warning("overtake_dataset_empty")
        return df

    logger.info("overtake_dataset_built",
                events=len(df),
                overtake_rate=df["overtook"].mean())
    return df


def train_overtake_model(engine: Engine, df: pd.DataFrame) -> None:
    """Train logistic regression overtake probability and store predictions."""
    if df.empty or len(df) < 20:
        logger.warning("overtake_insufficient_data", n=len(df))
        return

    features = ["position_gain", "tyre_delta", "compound_softness"]
    X = df[features].fillna(0).values
    y = df["overtook"].values

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    model = LogisticRegression(max_iter=1000, random_state=42)
    model.fit(X_scaled, y)

    # Predict on full dataset
    probs = model.predict_proba(X_scaled)[:, 1]

    # Store predictions in ml_predictions
    with engine.begin() as conn:
        for i, (_, row) in enumerate(df.iterrows()):
            conn.execute(text("""
                INSERT INTO ml_predictions (
                    session_key, prediction_type, driver_number,
                    predicted_value, confidence, model_version,
                    features_json
                ) VALUES (
                    :session_key, 'overtake_prob', :driver_number,
                    :predicted_value, :confidence, :model_version,
                    :features_json
                )
            """), {
                "session_key": int(row["session_key"]),
                "driver_number": int(row["driver_number"]),
                "predicted_value": str(round(float(probs[i]), 4)),
                "confidence": round(float(max(probs[i], 1 - probs[i])), 4),
                "model_version": MODEL_VERSION,
                "features_json": json.dumps({
                    "lap_number": int(row["lap_number"]),
                    "overtook": int(row["overtook"]),
                    "position_gain": int(row["position_gain"]),
                    "tyre_delta": int(row["tyre_delta"]),
                    "compound_softness": int(row["compound_softness"]),
                }),
            })

    acc = (model.predict(X_scaled) == y).mean()
    logger.info("overtake_model_trained",
                accuracy=round(acc, 4),
                events=len(df),
                intercept=round(float(model.intercept_[0]), 4),
                coef={f: round(float(c), 4)
                      for f, c in zip(features, model.coef_[0])})


# ═══════════════════════════════════════════════════════════════════════════════
# 2. PIT-STRATEGY ARCHETYPE
# ═══════════════════════════════════════════════════════════════════════════════

STRATEGY_SQL = text("""
    WITH stint_raw AS (
        SELECT
            lt.session_key,
            lt.driver_number,
            lt.compound,
            lt.tyre_life_laps,
            lt.lap_number,
            lt.lap_time_ms,
            -- Detect stint start: first lap of new compound stint
            CASE
                WHEN LAG(lt.compound) OVER (
                    PARTITION BY lt.session_key, lt.driver_number
                    ORDER BY lt.lap_number
                ) != lt.compound THEN 1
                WHEN LAG(lt.compound) OVER (
                    PARTITION BY lt.session_key, lt.driver_number
                    ORDER BY lt.lap_number
                ) IS NULL THEN 1
                ELSE 0
            END AS stint_start
        FROM lap_times lt
        JOIN sessions s ON s.session_key = lt.session_key
        WHERE s.session_type = 'R' AND lt.deleted = FALSE
    ),
    stints AS (
        SELECT
            session_key,
            driver_number,
            compound,
            MAX(tyre_life_laps) AS stint_length,
            MIN(lap_number) AS stint_start_lap,
            MIN(lap_time_ms) AS best_lap_in_stint
        FROM stint_raw
        WHERE stint_start = 1 OR tyre_life_laps = 1
        GROUP BY session_key, driver_number, compound,
                 lap_number - tyre_life_laps + 1
    ),
    strategy_summary AS (
        SELECT
            session_key,
            driver_number,
            COUNT(*) AS n_stints,
            ARRAY_AGG(compound ORDER BY stint_start_lap) AS stint_compounds,
            SUM(stint_length) AS total_race_laps,
            AVG(stint_length) AS avg_stint_length
        FROM stints
        GROUP BY session_key, driver_number
    )
    SELECT
        session_key,
        driver_number,
        n_stints,
        stint_compounds,
        total_race_laps,
        avg_stint_length
    FROM strategy_summary
    WHERE n_stints >= 2
""")


# Strategy archetypes based on stint patterns
def classify_strategy(stint_compounds: list, n_stints: int) -> str:
    """Classify strategy into archetype based on stint sequence."""
    if n_stints <= 1:
        return "unknown"

    # Filter out None
    compounds = [c for c in stint_compounds if c is not None]
    if not compounds:
        return "unknown"

    first = compounds[0]
    softs = sum(1 for c in compounds if c == "SOFT")
    hards = sum(1 for c in compounds if c == "HARD")
    mediums = sum(1 for c in compounds if c == "MEDIUM")

    if n_stints >= 4:
        return "aggressive"
    elif first == "SOFT" and hards >= 1 and n_stints == 2:
        return "soft-hard"
    elif first == "SOFT" and mediums >= 1 and n_stints == 2:
        return "soft-medium"
    elif first == "MEDIUM" and hards >= 1 and n_stints == 2:
        return "medium-hard"
    elif first == "HARD":
        return "conservative"
    elif softs >= 2:
        return "aggressive"
    else:
        return "standard"


def build_strategy_dataset(engine: Engine) -> pd.DataFrame:
    """Build strategy archetype dataset."""
    with engine.connect() as conn:
        df = pd.read_sql(STRATEGY_SQL, conn)

    if df.empty:
        logger.warning("strategy_dataset_empty")
        return df

    # Classify each strategy
    df["archetype"] = df.apply(
        lambda r: classify_strategy(
            r["stint_compounds"], int(r["n_stints"])
        ), axis=1
    )
    logger.info("strategy_dataset_built",
                drivers=len(df),
                distribution=df["archetype"].value_counts().to_dict())
    return df


def train_strategy_model(engine: Engine, df: pd.DataFrame) -> None:
    """Train strategy archetype classifier and store predictions."""
    if df.empty or len(df) < 10:
        logger.warning("strategy_insufficient_data", n=len(df))
        return

    # Encode compounds per stint position
    max_stints = int(df["n_stints"].max())
    feature_cols = []
    for i in range(max_stints):
        col = f"stint_{i}_compound"
        feature_cols.append(col)
        df[col] = df["stint_compounds"].apply(
            lambda x, idx=i: (
                {"SOFT": 3, "MEDIUM": 2, "HARD": 1, "INTER": 0, "WET": 0}
                .get(x[idx] if idx < len(x) else None, 0)
            )
        )

    feature_cols.append("n_stints")
    feature_cols.append("avg_stint_length")

    X = df[feature_cols].fillna(0).values
    le = LabelEncoder()
    y = le.fit_transform(df["archetype"].values)

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    model = LogisticRegression(max_iter=1000, random_state=42)
    model.fit(X_scaled, y)

    probs = model.predict_proba(X_scaled)

    with engine.begin() as conn:
        for i, (_, row) in enumerate(df.iterrows()):
            pred_label = le.inverse_transform([np.argmax(probs[i])])[0]
            confidence = round(float(np.max(probs[i])), 4)

            conn.execute(text("""
                INSERT INTO ml_predictions (
                    session_key, prediction_type, driver_number,
                    predicted_value, confidence, model_version,
                    features_json
                ) VALUES (
                    :session_key, 'strategy_archetype', :driver_number,
                    :predicted_value, :confidence, :model_version,
                    :features_json
                )
            """), {
                "session_key": int(row["session_key"]),
                "driver_number": int(row["driver_number"]),
                "predicted_value": pred_label,
                "confidence": confidence,
                "model_version": MODEL_VERSION,
                "features_json": json.dumps({
                    "n_stints": int(row["n_stints"]),
                    "stint_compounds": row["stint_compounds"],
                    "actual_archetype": row["archetype"],
                }),
            })

    acc = (model.predict(X_scaled) == y).mean()
    logger.info("strategy_model_trained",
                accuracy=round(acc, 4),
                drivers=len(df),
                archetypes=le.classes_.tolist())


# ═══════════════════════════════════════════════════════════════════════════════
# 3. ANOMALY DETECTION
# ═══════════════════════════════════════════════════════════════════════════════

ANOMALY_SQL = text("""
    SELECT
        lt.session_key,
        lt.driver_number,
        lt.lap_number,
        lt.lap_time_ms,
        lt.s1_ms,
        lt.s2_ms,
        lt.s3_ms,
        lt.tyre_life_laps,
        lts.max_speed_kmh,
        lts.drs_open_pct,
        lts.avg_brake_point_pct
    FROM lap_times lt
    JOIN sessions s ON s.session_key = lt.session_key
    LEFT JOIN lap_telemetry_stats lts
        ON  lts.session_key   = lt.session_key
        AND lts.driver_number = lt.driver_number
        AND lts.lap_number    = lt.lap_number
    WHERE s.session_type = 'R'
      AND lt.deleted = FALSE
      AND lt.lap_time_ms IS NOT NULL
""")


def build_anomaly_dataset(engine: Engine) -> pd.DataFrame:
    """Build anomaly detection dataset from lap + telemetry stats."""
    with engine.connect() as conn:
        df = pd.read_sql(ANOMALY_SQL, conn)

    if df.empty:
        logger.warning("anomaly_dataset_empty")
        return df

    logger.info("anomaly_dataset_built", laps=len(df))
    return df


def train_anomaly_model(engine: Engine, df: pd.DataFrame) -> None:
    """Train Isolation Forest and flag anomalous laps."""
    if df.empty or len(df) < 50:
        logger.warning("anomaly_insufficient_data", n=len(df))
        return

    feature_cols = [
        "lap_time_ms", "s1_ms", "s2_ms", "s3_ms",
        "tyre_life_laps", "max_speed_kmh", "drs_open_pct",
        "avg_brake_point_pct",
    ]
    X = df[feature_cols].fillna(0).values

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    model = IsolationForest(
        n_estimators=100,
        contamination=0.05,
        random_state=42,
    )
    preds = model.fit_predict(X_scaled)  # 1 = normal, -1 = anomaly
    scores = model.decision_function(X_scaled)

    anomalies = (preds == -1).sum()
    logger.info("anomaly_model_trained",
                total_laps=len(df),
                anomalies=int(anomalies),
                anomaly_rate=round(anomalies / len(df), 4))

    with engine.begin() as conn:
        for i, (_, row) in enumerate(df.iterrows()):
            is_anomaly = preds[i] == -1
            if not is_anomaly:
                continue

            # Convert decision function score to 0-1 confidence
            # Lower score = more anomalous
            confidence = round(float(1 / (1 + np.exp(scores[i]))), 4)

            conn.execute(text("""
                INSERT INTO ml_predictions (
                    session_key, prediction_type, driver_number,
                    predicted_value, confidence, model_version,
                    features_json
                ) VALUES (
                    :session_key, 'anomaly_lap', :driver_number,
                    :predicted_value, :confidence, :model_version,
                    :features_json
                )
            """), {
                "session_key": int(row["session_key"]),
                "driver_number": int(row["driver_number"]),
                "predicted_value": "anomaly",
                "confidence": confidence,
                "model_version": MODEL_VERSION,
                "features_json": json.dumps({
                    "lap_number": int(row["lap_number"]),
                    "lap_time_ms": round(float(row["lap_time_ms"]), 1),
                    "decision_score": round(float(scores[i]), 4),
                    "feature_values": {
                        col: round(float(row[col]), 4)
                        if pd.notna(row[col]) else None
                        for col in feature_cols
                    },
                }),
            })


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════

def main() -> None:
    engine = create_engine(settings.db_url)

    # 1. Overtake probability
    ot_df = build_overtake_dataset(engine)
    train_overtake_model(engine, ot_df)

    # 2. Strategy archetype
    st_df = build_strategy_dataset(engine)
    train_strategy_model(engine, st_df)

    # 3. Anomaly detection
    an_df = build_anomaly_dataset(engine)
    train_anomaly_model(engine, an_df)

    print(f"\n{'=' * 60}")
    print("  PHASE 7 — CLASSIFIERS")
    print(f"{'=' * 60}")
    print(f"  Overtake events:   {len(ot_df)}")
    print(f"  Strategy drivers:  {len(st_df)}")
    print(f"  Laps analyzed:     {len(an_df)}")

    # Summary from ml_predictions
    with engine.connect() as conn:
        result = conn.execute(text("""
            SELECT prediction_type, COUNT(*)
            FROM ml_predictions
            WHERE model_version = :v
            GROUP BY prediction_type
        """), {"v": MODEL_VERSION})
        print("\n  Predictions stored:")
        for row in result:
            print(f"    {row[0]:25s} {row[1]}")
    print(f"{'=' * 60}\n")


if __name__ == "__main__":
    main()
