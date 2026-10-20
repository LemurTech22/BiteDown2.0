"""The `slow` marker must stay registered and applied to the gunicorn module."""
from pathlib import Path


def test_slow_marker_registered(pytestconfig):
    markers = pytestconfig.getini("markers")
    assert any(m.split(":")[0].strip() == "slow" for m in markers)


def test_gunicorn_module_is_marked_slow():
    # Read the source: importing it would run its gunicorn importorskip side effects.
    src = (Path(__file__).with_name("test_gunicorn_gthread.py")).read_text()
    assert "pytestmark = pytest.mark.slow" in src
