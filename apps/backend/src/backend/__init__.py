import structlog
from flask import Flask
from flask_cors import CORS
from sqlalchemy import create_engine

from backend import extensions
from backend.config import settings

log = structlog.get_logger()


def create_app() -> Flask:
    app = Flask(__name__)

    app.config["SECRET_KEY"] = settings.secret_key
    app.config["DEBUG"]      = settings.debug
    app.config["TESTING"]    = settings.testing

    # Allow Next.js dev server to call the API
    CORS(app, origins=["http://localhost:3000", "http://127.0.0.1:3000"])

    extensions.engine = create_engine(
        settings.db_url,
        pool_size=10,
        max_overflow=20,
        pool_pre_ping=True,
    )

    from backend.api.v1.sessions    import sessions_bp
    from backend.api.v1.laps        import laps_bp
    from backend.api.v1.drivers     import drivers_bp
    from backend.api.v1.telemetry   import telemetry_bp
    from backend.api.v1.strategy    import strategy_bp
    from backend.api.v1.analysis    import analysis_bp
    from backend.api.v1.predictions import predictions_bp
    from backend.health             import health_bp

    app.register_blueprint(health_bp)
    app.register_blueprint(sessions_bp,    url_prefix="/api/v1")
    app.register_blueprint(laps_bp,        url_prefix="/api/v1")
    app.register_blueprint(drivers_bp,     url_prefix="/api/v1")
    app.register_blueprint(telemetry_bp,   url_prefix="/api/v1")
    app.register_blueprint(strategy_bp,    url_prefix="/api/v1")
    app.register_blueprint(analysis_bp,    url_prefix="/api/v1")
    app.register_blueprint(predictions_bp, url_prefix="/api/v1")

    @app.errorhandler(404)
    def not_found(e):
        return {"error": "Not found", "code": 404}, 404

    @app.errorhandler(500)
    def server_error(e):
        log.exception("unhandled_exception", error=str(e))
        return {"error": "Internal server error", "code": 500}, 500

    log.info("app.created", debug=settings.debug)
    return app
