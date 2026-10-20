"""Test harness. Schema is built by running the real Alembic migrations against TEST_DATABASE_URL."""
import os
import uuid
from datetime import date, timedelta
from pathlib import Path

import pytest
from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_ROOT.parent / ".env")
load_dotenv(BACKEND_ROOT / ".env")

TEST_DB = os.environ.get("TEST_DATABASE_URL")
if not TEST_DB:  # pragma: no cover
    raise RuntimeError("TEST_DATABASE_URL is not set")
# The xdist controller imports this file first and overwrites DATABASE_URL below; workers inherit its
# environment, so they check against the caller's original value, which the controller stashes here.
os.environ.setdefault("_FWR_CALLER_DATABASE_URL", os.environ.get("DATABASE_URL", ""))
if TEST_DB == os.environ["_FWR_CALLER_DATABASE_URL"]:  # pragma: no cover
    raise RuntimeError("TEST_DATABASE_URL must differ from DATABASE_URL")


def _worker_db(url, worker):
    """pytest-xdist: give each worker its own database (<name>_<worker_id>), created on first use.

    Workers then never share tables, the schema rebuild, or the advisory lock (advisory locks are per database).
    The gunicorn subprocess test inherits it via app.config["SQLALCHEMY_DATABASE_URI"]."""
    import time

    import psycopg
    from psycopg import sql as pgsql
    from sqlalchemy.engine import make_url

    u = make_url(url)
    name = f"{u.database}_{worker}"
    admin = u.set(drivername="postgresql").render_as_string(hide_password=False)
    for attempt in range(10):
        try:
            with psycopg.connect(admin, autocommit=True) as conn:
                if conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,)).fetchone() is None:
                    conn.execute(pgsql.SQL("CREATE DATABASE {}").format(pgsql.Identifier(name)))
            break
        except psycopg.errors.DuplicateDatabase:  # another process created it first
            break
        except psycopg.errors.ObjectInUse:  # template1 busy with a concurrent CREATE DATABASE: retry
            time.sleep(0.2 * (attempt + 1))
    else:  # pragma: no cover
        raise RuntimeError(f"could not create per-worker test database {name}")
    return u.set(database=name).render_as_string(hide_password=False)


_XDIST_WORKER = os.environ.get("PYTEST_XDIST_WORKER")
if _XDIST_WORKER:
    TEST_DB = _worker_db(TEST_DB, _XDIST_WORKER)

# Never let tests see real upstream config.
os.environ["DATABASE_URL"] = TEST_DB
os.environ.pop("GEMINI_API_KEY", None)
os.environ["ML_SERVICE_URL"] = ""
os.environ.pop("GOOGLE_IOS_CLIENT_IDS", None)  # tests opt in per test via app.config

from app import create_app  # noqa: E402
from app.extensions import db  # noqa: E402
from sqlalchemy import text  # noqa: E402

CONFIG = {
    "TESTING": True,
    "SQLALCHEMY_DATABASE_URI": TEST_DB,
    "JWT_SECRET": "test-secret-test-secret-test-secret-123",
    "GEMINI_API_KEY": "",
    "ML_SERVICE_URL": "",
}


@pytest.fixture(scope="session")
def _db_lock():
    """Serialise whole pytest sessions: concurrent runs share fwr_test and one's DROP SCHEMA breaks the other."""
    import psycopg

    conn = psycopg.connect(TEST_DB.replace("postgresql+psycopg://", "postgresql://"), autocommit=True)
    conn.execute("SELECT pg_advisory_lock(918273645)")
    yield
    conn.close()


@pytest.fixture(scope="session")
def app(_db_lock):
    app = create_app(dict(CONFIG))
    with app.app_context():
        with db.engine.begin() as c:
            c.execute(text("DROP SCHEMA public CASCADE"))
            c.execute(text("CREATE SCHEMA public"))
        db.engine.dispose()
        from flask_migrate import upgrade

        upgrade(directory=str(BACKEND_ROOT / "migrations"))
    return app


@pytest.fixture(autouse=True)
def _clean(app):
    """Truncate every table (except alembic_version) before each test."""
    with app.app_context():
        rows = db.session.execute(
            text("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> 'alembic_version'")
        ).all()
        if rows:
            names = ", ".join(f'"{r[0]}"' for r in rows)
            db.session.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))
        db.session.commit()
        try:  # the in-process recipe cache lives on the session-wide app: isolate tests
            from app.services import recipe_cache
            recipe_cache.clear()
        except ImportError:  # pragma: no cover
            pass
    _google_guard = None
    try:  # never let any test reach Google: JWKS fetches fail unless a test installs its own fetcher
        from app.services import google_auth

        def _no_google():
            import requests
            raise requests.ConnectionError("tests must not call Google")

        _google_guard = google_auth
        google_auth.set_fetcher(_no_google)
    except ImportError:  # pragma: no cover
        pass
    yield
    if _google_guard is not None:
        _google_guard.set_fetcher(_no_google)
    with app.app_context():
        db.session.remove()


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def sql(app):
    """Run raw SQL: sql('select ...', **params) -> list of row mappings; commits writes."""

    def run(stmt, **params):
        with app.app_context():
            try:
                res = db.session.execute(text(stmt), params)
                rows = [dict(r._mapping) for r in res.fetchall()] if res.returns_rows else []
                db.session.commit()
                return rows
            except Exception:
                db.session.rollback()
                raise

    return run


def _signup(client, email=None, password="pw-correct-horse-9", name="Tester"):
    email = email or f"u{uuid.uuid4().hex[:8]}@example.com"
    r = client.post("/auth/signup", json={"email": email, "password": password, "display_name": name})
    assert r.status_code == 201, r.get_data(as_text=True)
    body = r.get_json()
    return {"email": email, "password": password, "token": body["token"], "user": body["user"],
            "headers": {"Authorization": f"Bearer {body['token']}"}}


@pytest.fixture
def user(client):
    return _signup(client)


@pytest.fixture
def user2(client):
    return _signup(client)


@pytest.fixture
def signup(client):
    return lambda **kw: _signup(client, **kw)


def items_of(resp):
    body = resp.get_json()
    return body["items"] if isinstance(body, dict) else body


@pytest.fixture
def make_item(client):
    """Create one item via the API; returns the item dict."""

    def make(u, **over):
        payload = {"name": "Milk", "category": "dairy", "storage": "fridge", "quantity": 2,
                   "unit": "l", "est_price": 3.5, "source": "manual"}
        payload.update(over)
        payload = {k: v for k, v in payload.items() if v is not None}
        r = client.post("/items", json={"items": [payload]}, headers=u["headers"])
        assert r.status_code == 201, r.get_data(as_text=True)
        return items_of(r)[0]

    return make


@pytest.fixture
def events(sql):
    def get(item_id=None, event_type=None):
        q = "SELECT * FROM food_events WHERE true"
        p = {}
        if item_id:
            q += " AND item_id = :i"
            p["i"] = item_id
        if event_type:
            q += " AND event_type = :t"
            p["t"] = event_type
        return sql(q + " ORDER BY time", **p)

    return get


def iso_in(days):
    return (date.today() + timedelta(days=days)).isoformat()
