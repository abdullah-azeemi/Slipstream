"""
ML race predictions API.
Requires the model to be trained first: uv run python -m ml.train
"""
from flask import Blueprint, jsonify, redirect, url_for
from sqlalchemy import text
from backend.extensions import engine

predictions_bp = Blueprint("predictions", __name__)


@predictions_bp.get("/sessions/<int:session_key>/predictions")
def race_predictions(session_key: int):
    """
    Run ML predictions for a qualifying session.
    Returns predicted finishing order with win/podium probabilities + SHAP factors.
    """
    # Verify session exists and is qualifying
    with engine.connect() as conn:
        row = conn.execute(text("""
            SELECT session_type, gp_name, year
            FROM sessions WHERE session_key = :sk
        """), {"sk": session_key}).first()

    if not row:
        return jsonify({"error": "Session not found"}), 404
    if row[0] not in ('Q', 'SQ'):
        return jsonify({"error": "Predictions only available for qualifying sessions"}), 400

    try:
        from ml.predict import predict_race, explain_prediction
    except ImportError:
        return jsonify({"error": "ML package not available — check uv workspace"}), 503

    try:
        predictions  = predict_race(session_key)
        explanations = explain_prediction(session_key)
    except FileNotFoundError:
        return jsonify({"error": "Model not trained. Run: uv run python -m ml.train"}), 503
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    # Merge SHAP factors
    shap_map = {e["driver_number"]: e["factors"] for e in explanations}
    for p in predictions:
        p["factors"] = shap_map.get(p["driver_number"], [])

    # Add team colours from DB
    with engine.connect() as conn:
        drivers = conn.execute(text("""
            SELECT driver_number, team_colour, team_name
            FROM drivers WHERE session_key = :sk
        """), {"sk": session_key}).mappings().all()
    from backend.api.v1.strategy import _resolve
    colour_map = {r["driver_number"]: _resolve(r["team_colour"], r["team_name"]) for r in drivers}
    for p in predictions:
        p["team_colour"] = colour_map.get(p["driver_number"], "666666")

    return jsonify({
        "session_key": session_key,
        "gp_name":     row[1],
        "year":        row[2],
        "predictions": predictions,
    })


@predictions_bp.get("/predictions/latest")
def latest_predictions():
    """Predictions for the most recent qualifying session."""
    with engine.connect() as conn:
        row = conn.execute(text("""
            SELECT session_key FROM sessions
            WHERE session_type = 'Q'
            ORDER BY date_start DESC NULLS LAST
            LIMIT 1
        """)).first()

    if not row:
        return jsonify({"error": "No qualifying sessions found"}), 404

    return redirect(url_for("predictions.race_predictions", session_key=row[0]))
