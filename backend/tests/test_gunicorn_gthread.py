"""chore/gunicorn-gthread: a slow Gemini call must not block other requests.

Starts a real gunicorn with the flags parsed from backend/entrypoint.sh (only the bind address and the
app spec are swapped), serving tests/gthread_wsgi.py: the real app on TEST_DATABASE_URL with
`gemini._generate` replaced by a ~3 s sleep. The schema is built by the session `app` fixture before
gunicorn starts (the child never migrates), users and tokens come from the normal `signup` fixture, and
gunicorn is stopped by its own PID before the test returns.
"""
import os
import re
import shlex
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

pytestmark = pytest.mark.slow

pytest.importorskip("gunicorn")
requests = pytest.importorskip("requests")

BACKEND = Path(__file__).resolve().parents[1]
ENTRYPOINT = BACKEND / "entrypoint.sh"
SLOW_S = 3.0
APP_SPEC = "tests.gthread_wsgi:app"


# --------------------------------------------------------------------------------------------- flag parsing
def _expand(tok: str) -> str:
    """${VAR:-default} / ${VAR} / $VAR as sh expands them (unset or empty -> default or '')."""
    def sub(m):
        name = m.group(1) or m.group(3)
        val = os.environ.get(name, "")
        return val if val else (m.group(2) or "")
    return re.sub(r"\$\{(\w+)(?::-([^}]*))?\}|\$(\w+)", sub, tok)


def gunicorn_argv() -> list[str]:
    """The gunicorn command line from entrypoint.sh (`exec gunicorn ...`, continuations joined)."""
    text = ENTRYPOINT.read_text().replace("\\\n", " ")
    lines = [l.strip() for l in text.splitlines() if re.match(r"\s*(exec\s+)?gunicorn\b", l)]
    assert len(lines) == 1, f"expected exactly one gunicorn command in entrypoint.sh, got {lines}"
    argv = [_expand(t) for t in shlex.split(lines[0], comments=True)]
    if argv[0] == "exec":
        argv = argv[1:]
    assert argv[0] == "gunicorn"
    return argv[1:]


def _opt(argv, short, long):
    """Value of an option given as `-x v`, `--long v` or `--long=v` (last one wins), else None."""
    val = None
    for i, t in enumerate(argv):
        if t in (short, long) and i + 1 < len(argv):
            val = argv[i + 1]
        elif long and t.startswith(long + "="):
            val = t.split("=", 1)[1]
        elif short and t.startswith(short) and len(t) > len(short) and not t.startswith("--"):
            val = t[len(short):]
    return val


def test_entrypoint_runs_one_gthread_process(monkeypatch):
    monkeypatch.delenv("GUNICORN_THREADS", raising=False)
    argv = gunicorn_argv()
    assert _opt(argv, "-k", "--worker-class") == "gthread", argv
    # A single process: the in-process recipe and JWKS caches assume it (more workers = split caches).
    assert _opt(argv, "-w", "--workers") == "1", argv
    assert _opt(argv, None, "--threads") == "4", argv  # default of ${GUNICORN_THREADS:-4}
    assert _opt(argv, "-t", "--timeout") == "120", argv
    assert _opt(argv, None, "--graceful-timeout") == "30", argv
    assert _opt(argv, "-b", "--bind") == "0.0.0.0:5055", argv
    assert "--preload" not in argv
    assert argv[-1] == "wsgi:app", argv
    text = ENTRYPOINT.read_text()
    assert '"${GUNICORN_THREADS:-4}"' in text  # overridable, quoted
    monkeypatch.setenv("GUNICORN_THREADS", "8")
    assert _opt(gunicorn_argv(), None, "--threads") == "8"
    # Migrations still run first and gunicorn is exec'd (PID 1 gets SIGTERM from `docker stop`).
    assert "db upgrade" in text and text.index("db upgrade") < text.index("exec gunicorn")
    assert re.search(r"^\s*exec\s+gunicorn\b", text, re.M)


def _test_argv(port: int) -> list[str]:
    out, argv, i = [], gunicorn_argv(), 0
    while i < len(argv):
        t = argv[i]
        if t in ("-b", "--bind"):
            i += 2
            continue
        if t.startswith("--bind=") or (t.startswith("-b") and not t.startswith("--") and len(t) > 2):
            i += 1
            continue
        out.append(t)
        i += 1
    assert out and out[-1] == "wsgi:app", argv
    out[-1] = APP_SPEC
    return ["-b", f"127.0.0.1:{port}", *out]


# --------------------------------------------------------------------------------------------- server
def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def server(app, tmp_path, monkeypatch):
    """gunicorn on a free localhost port; yields base URL. Stopped by PID (SIGTERM, then SIGKILL)."""
    monkeypatch.delenv("GUNICORN_THREADS", raising=False)  # the entrypoint default (4) is what ships
    port = _free_port()
    env = dict(os.environ)
    env.update(FWR_GTHREAD_QA="1", FWR_GTHREAD_SLOW_S=str(SLOW_S),
               FWR_GTHREAD_JWT_SECRET=app.config["JWT_SECRET"],
               TEST_DATABASE_URL=app.config["SQLALCHEMY_DATABASE_URI"],
               PYTHONPATH=str(BACKEND), PYTHONUNBUFFERED="1")
    env.pop("GEMINI_API_KEY", None)
    env.pop("GUNICORN_THREADS", None)
    log = open(tmp_path / "gunicorn.log", "w+")
    proc = subprocess.Popen([sys.executable, "-m", "gunicorn", *_test_argv(port)], cwd=BACKEND, env=env,
                            stdout=log, stderr=subprocess.STDOUT)
    print(f"gunicorn pid={proc.pid} port={port}")
    base = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + 20
        while True:
            if proc.poll() is not None:
                log.seek(0)
                pytest.fail(f"gunicorn exited {proc.returncode}:\n{log.read()[-3000:]}")
            try:
                if requests.get(base + "/health", timeout=1).status_code == 200:
                    break
            except requests.RequestException:
                pass
            if time.monotonic() > deadline:
                log.seek(0)
                pytest.fail(f"gunicorn not ready in 20 s:\n{log.read()[-3000:]}")
            time.sleep(0.1)
        yield base
    finally:
        if proc.poll() is None:
            os.kill(proc.pid, signal.SIGTERM)
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.kill(proc.pid, signal.SIGKILL)
                proc.wait(timeout=5)
        log.close()


def _slow(base, headers, out, i=0):
    t0 = time.monotonic()
    r = requests.post(base + "/items/parse-text", json={"text": "2 apples"}, headers=headers, timeout=30)
    out[i] = (r.status_code, time.monotonic() - t0, r.json())


def _timed_get(base, path, headers=None):
    t0 = time.monotonic()
    r = requests.get(base + path, headers=headers or {}, timeout=SLOW_S * 3)
    return r, time.monotonic() - t0


def test_fast_requests_not_blocked_by_slow_gemini_call(server, user, make_item):
    make_item(user, name="Eggs", category="eggs")
    out = [None]
    slow = threading.Thread(target=_slow, args=(server, user["headers"], out))
    t_start = time.monotonic()
    slow.start()
    time.sleep(0.4)  # the slow request is now inside the stubbed Gemini sleep
    fast = []
    for _ in range(3):
        fast.append(("/health", *_timed_get(server, "/health")))
        fast.append(("/items", *_timed_get(server, "/items", user["headers"])))
    fast_done = time.monotonic() - t_start
    slow_still_running = slow.is_alive()
    slow.join(timeout=SLOW_S * 4)
    assert not slow.is_alive()

    for path, r, dt in fast:
        assert r.status_code == 200, (path, r.status_code, r.text)
        assert dt < 1.0, f"{path} took {dt:.2f}s while a {SLOW_S}s Gemini call was in flight"
    assert slow_still_running, "slow call finished before the fast ones: the overlap was not exercised"
    assert [i["name"] for i in fast[1][1].json()["items"]] == ["Eggs"]  # authed and scoped through the DB
    assert fast_done < SLOW_S - 0.5

    status, dt, body = out[0]
    assert status == 200, body
    assert [c["name"] for c in body["candidates"]] == ["Apples"]
    assert SLOW_S - 0.1 <= dt < SLOW_S + 2.0


def test_four_concurrent_slow_calls_run_in_parallel(server, signup):
    users = [signup() for _ in range(4)]  # different users: no shared per-user state hides serialisation
    out = [None] * 4
    ts = [threading.Thread(target=_slow, args=(server, u["headers"], out, i)) for i, u in enumerate(users)]
    t0 = time.monotonic()
    for t in ts:
        t.start()
    for t in ts:
        t.join(timeout=SLOW_S * 6)
    wall = time.monotonic() - t0
    assert all(o is not None and o[0] == 200 for o in out), out
    # Serial would be >= 4 x SLOW_S = 12 s; parallel is ~one call. Allow generous slack for CI.
    assert wall < SLOW_S * 1.8, f"4 concurrent slow calls took {wall:.2f}s (one call = {SLOW_S}s)"
