"""
Pitwall Backend — Application Factory

Usage:
    from backend import create_app
    app = create_app()
"""
import structlog
from flask import Flask
from sqlalchemy import create_engine

from backend import extensions
from backend.config import settings

log = structlog.get_logger()


def create_app() -> Flask:
    """
    Create and configure the Flask application.

    This function is the single entry point for creating the app.
    Called by the dev server, by Gunicorn in production, and by
    pytest fixtures in tests — each can pass different config.
    """
    app = Flask(__name__)

    # ── Core config ───────────────────────────────────────────────────────────
    app.config["SECRET_KEY"] = settings.secret_key
    app.config["DEBUG"]      = settings.debug
    app.config["TESTING"]    = settings.testing

    # ── Database engine ───────────────────────────────────────────────────────
    # Create engine once, share across all requests via extensions module.
    # SQLAlchemy's connection pool handles concurrent requests safely.
    extensions.engine = create_engine(
        settings.database_url,
        pool_size=10,
        max_overflow=20,
        pool_pre_ping=True,   # verify connections before using
    )

    # ── Register blueprints ───────────────────────────────────────────────────
    # A blueprint is a collection of routes. We register them here under
    # the /api/v1 prefix. All routes inside the blueprint are relative to it.
    from backend.api.v1.sessions import sessions_bp
    from backend.api.v1.laps     import laps_bp
    from backend.api.v1.drivers  import drivers_bp
    from backend.health          import health_bp

    app.register_blueprint(health_bp)
    app.register_blueprint(sessions_bp, url_prefix="/api/v1")
    app.register_blueprint(laps_bp,     url_prefix="/api/v1")
    app.register_blueprint(drivers_bp,  url_prefix="/api/v1")

    # ── Global error handlers ─────────────────────────────────────────────────
    @app.errorhandler(404)
    def not_found(e):
        return {"error": "Not found", "code": 404}, 404

    @app.errorhandler(500)
    def server_error(e):
        log.exception("unhandled_exception", error=str(e))
        return {"error": "Internal server error", "code": 500}, 500

    log.info("app.created", debug=settings.debug)
    return app
