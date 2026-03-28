"""
Race prediction inference.

Given a qualifying session key, loads the trained model and returns
predicted finishing positions with win probabilities for each driver.

Win probability is computed by running 1000 bootstrap samples with
noise added to simulate race uncertainty (crashes, strategy, weather).
"""
from __future__ import annotations
import pickle
import threading
import numpy as np
import structlog

from ml.features import build_inference_features, FEATURE_COLS
from ml.model_store import GLOBAL_MODEL_PATH, gp_model_path

log       = structlog.get_logger()
_train_lock = threading.Lock()


def ensure_model_available(gp_name: str | None = None) -> None:
    model_path = gp_model_path(gp_name) if gp_name else GLOBAL_MODEL_PATH
    if gp_name and not model_path.exists() and GLOBAL_MODEL_PATH.exists():
        return
    if model_path.exists():
        return

    with _train_lock:
        model_path = gp_model_path(gp_name) if gp_name else GLOBAL_MODEL_PATH
        if gp_name and not model_path.exists() and GLOBAL_MODEL_PATH.exists():
            return
        if model_path.exists():
            return

        log.info("model.train_on_demand.start", gp_name=gp_name)
        from ml.train import main as train_main
        train_main()
        log.info("model.train_on_demand.done", gp_name=gp_name)


def load_model(gp_name: str | None = None):
    model_path = gp_model_path(gp_name) if gp_name else GLOBAL_MODEL_PATH

    if gp_name and not model_path.exists():
        log.warning("model.gp_missing", gp_name=gp_name, fallback=str(GLOBAL_MODEL_PATH))
        model_path = GLOBAL_MODEL_PATH

    if not model_path.exists():
        raise FileNotFoundError(
            f"No model found at {model_path}. Run: uv run python -m ml.train"
        )

    with open(model_path, 'rb') as f:
        return pickle.load(f)


def predict_race(quali_session_key: int, n_simulations: int = 1000) -> list[dict]:
    """
    Predict race finishing order from qualifying data.

    Returns list of dicts sorted by predicted position:
    [
        {
            "driver_number": 63,
            "abbreviation": "RUS",
            "team_name": "Mercedes",
            "predicted_position": 1,
            "win_probability": 0.34,
            "podium_probability": 0.67,
            "position_probabilities": {1: 0.34, 2: 0.21, 3: 0.12, ...}
        },
        ...
    ]
    """
    features = build_inference_features(quali_session_key)
    gp_name = str(features['gp_name'].iloc[0]) if 'gp_name' in features.columns and not features.empty else None
    ensure_model_available(gp_name)
    model = load_model(gp_name)

    X          = features[FEATURE_COLS]
    base_preds = model.predict(X)

    # Monte Carlo simulation: add gaussian noise to capture race variance
    # Noise scale ≈ 2 positions (typical race variability)
    # This converts point predictions into probability distributions
    n_drivers   = len(features)
    sim_results = np.zeros((n_simulations, n_drivers))

    for i in range(n_simulations):
        noise = np.random.normal(0, 2.0, n_drivers)
        noisy = base_preds + noise
        # Convert noisy predictions to positions (rank them)
        ranks = noisy.argsort().argsort() + 1
        sim_results[i] = ranks

    # Compute probability distributions from simulations
    results = []
    for idx, row in features.iterrows():
        driver_sims     = sim_results[:, list(features.index).index(idx)]
        pos_probs       = {}
        for pos in range(1, n_drivers + 1):
            pos_probs[pos] = round(float(np.mean(driver_sims == pos)), 3)

        win_prob    = pos_probs.get(1, 0)
        podium_prob = sum(pos_probs.get(p, 0) for p in [1, 2, 3])

        results.append({
            "driver_number":         int(row['driver_number']),
            "abbreviation":          row['abbreviation'],
            "team_name":             row['team_name'],
            "grid_position":         int(row['grid_position']),
            "predicted_position":    int(round(base_preds[list(features.index).index(idx)])),
            "win_probability":       round(win_prob, 3),
            "podium_probability":    round(podium_prob, 3),
            "position_probabilities":pos_probs,
        })

    # Sort by predicted position
    results.sort(key=lambda x: x['predicted_position'])
    return results


def explain_prediction(quali_session_key: int) -> list[dict]:
    """
    SHAP values for each driver's prediction.
    Returns top 3 most influential features per driver.
    """
    try:
        import shap
    except ImportError:
        log.warning("shap.not_installed")
        return []

    features = build_inference_features(quali_session_key)
    gp_name = str(features['gp_name'].iloc[0]) if 'gp_name' in features.columns and not features.empty else None
    ensure_model_available(gp_name)
    model = load_model(gp_name)
    X        = features[FEATURE_COLS]

    try:
        explainer  = shap.Explainer(model.model.estimator, X)
        shap_values = explainer(X)
    except Exception as e:
        log.warning("shap.failed", error=str(e))
        return []

    results = []
    for idx, row in features.iterrows():
        i          = list(features.index).index(idx)
        sv         = shap_values[i].values
        # Get top 3 features by absolute SHAP value
        top_indices = np.argsort(np.abs(sv))[-3:][::-1]
        factors = []
        for fi in top_indices:
            feat_name  = FEATURE_COLS[fi]
            shap_val   = float(sv[fi])
            # Positive SHAP = pushes position higher (worse)
            # Negative SHAP = pushes position lower (better)
            direction  = "+" if shap_val < 0 else "-"
            label      = _feature_label(feat_name, shap_val)
            factors.append({
                "feature":   feat_name,
                "shap_value":round(shap_val, 3),
                "label":     f"{direction} {label}",
                "positive":  shap_val < 0,  # negative shap = good for position
            })

        results.append({
            "driver_number": int(row['driver_number']),
            "abbreviation":  row['abbreviation'],
            "factors":       factors,
        })

    return results


def _feature_label(feature: str, shap_val: float) -> str:
    labels = {
        "grid_position":         "Grid position advantage" if shap_val < 0 else "Grid position disadvantage",
        "quali_gap_ms":          "Strong quali pace" if shap_val < 0 else "Quali pace gap",
        "s1_gap_ms":             "Sector 1 strength" if shap_val < 0 else "Sector 1 weakness",
        "s2_gap_ms":             "Sector 2 strength" if shap_val < 0 else "Sector 2 weakness",
        "s3_gap_ms":             "Sector 3 strength" if shap_val < 0 else "Sector 3 weakness",
        "s1_rank":               "Top sector 1 performer",
        "s2_rank":               "Top sector 2 performer",
        "s3_rank":               "Top sector 3 performer",
        "quali_compound_soft":   "Soft tyre qualifier",
        "quali_compound_inter":  "Intermediate tyre qualifier",
    }
    return labels.get(feature, feature)
