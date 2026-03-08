"""
Predictions endpoint — runs ML inference and returns race predictions.

GET /api/v1/sessions/<quali_key>/predict
→ Runs the trained model against this qualifying session
→ Returns predicted finishing order + win probabilities + SHAP factors

GET /api/v1/sessions/<quali_key>/predict/simulate
→ Body: { grid_position_overrides: {63: 5}, weather: "wet", safety_car: "high" }
→ Modifies feature vector and reruns inference
→ Powers the "What If?" simulator on the frontend
"""
from flask import Blueprint, jsonify, request
import structlog

predictions_bp = Blueprint("predictions", __name__)
log = structlog.get_logger()


@predictions_bp.get("/sessions/<int:quali_key>/predict")
def predict(quali_key: int):
    try:
        from ml.predict  import predict_race, explain_prediction
        predictions = predict_race(quali_key)
        explanations = explain_prediction(quali_key)

        # Merge SHAP factors into predictions
        shap_map = {e['driver_number']: e['factors'] for e in explanations}
        for p in predictions:
            p['shap_factors'] = shap_map.get(p['driver_number'], [])

        return jsonify({
            "quali_session_key": quali_key,
            "predictions":       predictions,
            "model_info": {
                "name":    "FLAML AutoML",
                "version": "1.0",
            }
        })
    except FileNotFoundError:
        return {
            "error": "Model not trained yet. Run: uv run python -m ml.train"
        }, 503
    except Exception as e:
        log.exception("predict.error", error=str(e))
        return {"error": str(e)}, 500


@predictions_bp.post("/sessions/<int:quali_key>/predict/simulate")
def simulate(quali_key: int):
    """
    What-If simulator — modify features and rerun inference.

    Body (all optional):
    {
        "grid_overrides": {"63": 5, "44": 1},  // force specific grid positions
        "weather": "wet",                        // dry | wet | mixed
        "safety_car": "high"                     // standard | high | certain
    }
    """
    try:
        from ml.predict  import predict_race, load_model
        from ml.features import build_inference_features, FEATURE_COLS
        import numpy as np

        body     = request.get_json(silent=True) or {}
        model    = load_model()
        features = build_inference_features(quali_key)

        # Apply grid overrides
        grid_overrides = body.get("grid_overrides", {})
        for driver_num_str, new_pos in grid_overrides.items():
            mask = features['driver_number'] == int(driver_num_str)
            features.loc[mask, 'grid_position'] = int(new_pos)

        # Apply weather modifier — wet conditions compress the field
        # (backmarkers finish closer to leaders)
        weather = body.get("weather", "dry")
        if weather == "wet":
            # Reduce the impact of quali gap in wet conditions
            features['quali_gap_ms'] = features['quali_gap_ms'] * 0.6
            features['s1_gap_ms']    = features['s1_gap_ms'] * 0.6
            features['s2_gap_ms']    = features['s2_gap_ms'] * 0.6
            features['s3_gap_ms']    = features['s3_gap_ms'] * 0.6
            features['quali_compound_inter'] = 1

        # Safety car modifier — field bunches up
        safety_car = body.get("safety_car", "standard")
        sc_noise = {"standard": 2.0, "high": 3.5, "certain": 5.0}
        noise_scale = sc_noise.get(safety_car, 2.0)

        X          = features[FEATURE_COLS]
        base_preds = model.predict(X)

        # Run simulations with modified noise
        n_drivers   = len(features)
        sim_results = np.zeros((1000, n_drivers))
        for i in range(1000):
            noisy = base_preds + np.random.normal(0, noise_scale, n_drivers)
            sim_results[i] = noisy.argsort().argsort() + 1

        results = []
        for idx_pos, (idx, row) in enumerate(features.iterrows()):
            driver_sims = sim_results[:, idx_pos]
            win_prob    = float(np.mean(driver_sims == 1))
            podium_prob = float(np.mean(driver_sims <= 3))
            results.append({
                "driver_number":      int(row['driver_number']),
                "abbreviation":       row['abbreviation'],
                "team_name":          row['team_name'],
                "grid_position":      int(row['grid_position']),
                "predicted_position": int(round(base_preds[idx_pos])),
                "win_probability":    round(win_prob, 3),
                "podium_probability": round(podium_prob, 3),
            })

        results.sort(key=lambda x: x['predicted_position'])
        return jsonify({
            "scenario": {
                "grid_overrides": grid_overrides,
                "weather":        weather,
                "safety_car":     safety_car,
            },
            "predictions": results,
        })

    except FileNotFoundError:
        return {"error": "Model not trained yet. Run: uv run python -m ml.train"}, 503
    except Exception as e:
        log.exception("simulate.error", error=str(e))
        return {"error": str(e)}, 500
