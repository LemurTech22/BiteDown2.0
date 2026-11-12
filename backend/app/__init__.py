import os

from dotenv import load_dotenv
from flask import Flask

from .extensions import db, migrate


def create_app(config: dict | None = None) -> Flask:
    load_dotenv()
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get("DATABASE_URL", "sqlite:///:memory:")
    app.config["JWT_SECRET"] = os.environ.get("JWT_SECRET", "")
    app.config["GEMINI_API_KEY"] = os.environ.get("GEMINI_API_KEY", "")
    app.config["GEMINI_MODEL"] = os.environ.get("GEMINI_MODEL", "")
    # Seconds per Gemini HTTP attempt for every call except enrichment (ENRICH_TIMEOUT_S); see services/gemini.py.
    try:
        app.config["GEMINI_TIMEOUT_S"] = float(os.environ.get("GEMINI_TIMEOUT_S") or 30)
        if not 0 < app.config["GEMINI_TIMEOUT_S"] < float("inf"):  # also rejects nan
            raise ValueError
    except ValueError:
        app.config["GEMINI_TIMEOUT_S"] = 30.0
    app.config["ML_SERVICE_URL"] = os.environ.get("ML_SERVICE_URL", "")
    # Comma-separated Google OAuth iOS client ids accepted as the ID-token `aud` (POST /auth/oauth/google).
    app.config["GOOGLE_IOS_CLIENT_IDS"] = os.environ.get("GOOGLE_IOS_CLIENT_IDS", "")
    app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024
    # Exact web origins allowed to call the API from a browser (app/cors.py). Empty = CORS off.
    app.config["CORS_ORIGINS"] = os.environ.get("CORS_ORIGINS", "")
    if config:
        app.config.update(config)

    db.init_app(app)
    migrate.init_app(app, db)

    from . import models  # noqa: F401  (register tables for Alembic)
    from .errors import register_error_handlers
    from .routes import auth, friends, groups, health, insights, items, people, requests, share

    from .cors import register_cors

    register_error_handlers(app)
    register_cors(app)
    for mod in (health, auth, items, share, insights, friends, groups, requests, people):
        app.register_blueprint(mod.bp)
    return app
