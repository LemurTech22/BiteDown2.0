"""CORS for the web build of the Expo client.

Only exact origins listed in ``CORS_ORIGINS`` (comma-separated, e.g.
``https://bitedown.expo.app,http://localhost:8081``) get CORS headers. Empty means off, so native
clients and the tests are unaffected. Auth is a bearer token, never a cookie, so
``Access-Control-Allow-Credentials`` is never sent.
"""

from flask import Flask, request

ALLOW_HEADERS = "Authorization, Content-Type"
ALLOW_METHODS = "GET, POST, PATCH, PUT, DELETE, OPTIONS"
MAX_AGE_S = "600"


def parse_origins(raw: str) -> frozenset[str]:
    return frozenset(o.strip().rstrip("/") for o in (raw or "").split(",") if o.strip())


def register_cors(app: Flask) -> None:
    def allowed_origin() -> str | None:
        origin = request.headers.get("Origin")
        if origin and origin in parse_origins(app.config.get("CORS_ORIGINS", "")):
            return origin
        return None

    @app.before_request
    def _preflight():
        if request.method == "OPTIONS" and request.headers.get("Access-Control-Request-Method"):
            if allowed_origin():
                return app.make_response(("", 204))
        return None

    @app.after_request
    def _cors_headers(response):
        origin = allowed_origin()
        if origin:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Headers"] = ALLOW_HEADERS
            response.headers["Access-Control-Allow-Methods"] = ALLOW_METHODS
            response.headers["Access-Control-Max-Age"] = MAX_AGE_S
        response.vary.add("Origin")
        return response
