"""Optional model fallback chain; the SDK client is stubbed, with no network or database needed.

Run with --noconftest to bypass the shared database fixtures for these service-only tests.
"""
import logging
import re
from types import SimpleNamespace

import pytest
from flask import Flask

from app.services import gemini


class Err(Exception):
    def __init__(self, msg="boom", code=None):
        super().__init__(msg)
        self.code = code


@pytest.fixture
def gem(monkeypatch):
    app = Flask(__name__)
    app.config.update(GEMINI_API_KEY="fake-key-for-tests", GEMINI_MODEL="primary",
                      GEMINI_FALLBACK_MODELS=["fallback", "last"])
    state = SimpleNamespace(app=app, sleeps=[], elapsed=0.0, records=[])
    monkeypatch.setattr(gemini, "time", SimpleNamespace(
        monotonic=lambda: state.elapsed, sleep=lambda s: state.sleeps.append(s)))
    handler = logging.Handler()
    handler.emit = lambda record: state.records.append(record)
    gemini.usage_log.addHandler(handler)
    try:
        with app.app_context():
            yield state
    finally:
        gemini.usage_log.removeHandler(handler)


def install(monkeypatch, outcomes, gem, durations=None):
    """Consume one exception or response text per call, optionally advancing a fake clock."""
    import google.genai as genai

    calls = []

    class Models:
        def generate_content(self, **kw):
            index = len(calls)
            calls.append(kw)
            if durations:
                gem.elapsed += durations[index]
            outcome = outcomes[index]
            if isinstance(outcome, Exception):
                raise outcome
            return SimpleNamespace(text=outcome, usage_metadata=SimpleNamespace(
                prompt_token_count=1, candidates_token_count=2, total_token_count=3))

    class Client:
        def __init__(self, **kw):
            self.models = Models()

    monkeypatch.setattr(genai, "Client", Client)
    return calls


def usage(gem, model, status="ok", code="200"):
    assert len(gem.records) == 1
    record = gem.records[0]
    assert record.levelno == logging.INFO
    fields = dict(re.findall(r"(\w+)=(\S+)", record.getMessage()))
    assert fields["model"] == model
    assert fields["status"] == status
    assert fields["code"] == code
    assert fields["purpose"] == "generate"
    assert fields["input_tokens"] == ("1" if status == "ok" else "null")


@pytest.mark.parametrize("exc", [Err(code=429), Err("RESOURCE_EXHAUSTED quota")])
def test_quota_skips_primary_retry_and_sleep(gem, monkeypatch, exc):
    calls = install(monkeypatch, [exc, '[{"name":"Milk"}]'], gem)
    assert gemini._generate("milk", "hint") == [{"name": "Milk"}]
    assert [c["model"] for c in calls] == ["primary", "fallback"]
    assert gem.sleeps == []
    assert calls[0]["contents"] == calls[1]["contents"]
    assert calls[0]["config"] is calls[1]["config"]
    usage(gem, "fallback")


@pytest.mark.parametrize("exc", [Err(code=503), Err(code=504), Err("UNAVAILABLE"),
                                 Err("DEADLINE_EXCEEDED")])
@pytest.mark.parametrize("retry", [True, False])
def test_busy_primary_retries_before_fallback(gem, monkeypatch, exc, retry):
    failures = [exc, exc] if retry else [exc]
    calls = install(monkeypatch, [*failures, "[]"], gem)
    assert gemini._generate("x", "hint", retry=retry) == []
    assert [c["model"] for c in calls] == ["primary"] * len(failures) + ["fallback"]
    assert gem.sleeps == (list(gemini.RETRY_DELAYS_S) if retry else [])
    usage(gem, "fallback")


@pytest.mark.parametrize("exc", [Err(code=400), Err(code=500), Err("INVALID_ARGUMENT"),
                                 ValueError("bad")])
@pytest.mark.parametrize("on_fallback", [False, True])
def test_non_transient_stops_chain(gem, monkeypatch, exc, on_fallback):
    outcomes = [Err(code=429), exc] if on_fallback else [exc]
    calls = install(monkeypatch, outcomes, gem)
    with pytest.raises(gemini.UpstreamError) as caught:
        gemini._generate("x", "hint")
    assert caught.value.__cause__ is exc
    assert [c["model"] for c in calls] == (["primary", "fallback"] if on_fallback else ["primary"])
    assert gem.sleeps == []
    usage(gem, "fallback" if on_fallback else "primary", "error",
          str(exc.code) if isinstance(getattr(exc, "code", None), int) else "null")


@pytest.mark.parametrize("retry", [True, False])
@pytest.mark.parametrize("code", [429, 503])
@pytest.mark.parametrize("succeeds", [True, False])
def test_empty_chain_preserves_retry_behavior(gem, monkeypatch, retry, code, succeeds):
    gem.app.config["GEMINI_FALLBACK_MODELS"] = []
    calls = install(monkeypatch, [Err(code=code), "[]" if succeeds else Err(code=code)], gem)
    if retry and succeeds:
        assert gemini._generate("x", "hint", retry=retry) == []
        usage(gem, "primary")
    else:
        with pytest.raises(gemini.UpstreamError):
            gemini._generate("x", "hint", retry=retry)
        usage(gem, "primary", "error", str(code))
    assert [c["model"] for c in calls] == ["primary"] * (2 if retry else 1)
    assert gem.sleeps == (list(gemini.RETRY_DELAYS_S) if retry else [])


@pytest.mark.parametrize("succeeds", [True, False])
def test_each_fallback_gets_only_one_attempt(gem, monkeypatch, succeeds):
    calls = install(monkeypatch, [Err(code=429), Err(code=503),
                                  "[]" if succeeds else Err(code=504)], gem)
    if succeeds:
        assert gemini._generate("x", "hint") == []
        usage(gem, "last")
    else:
        with pytest.raises(gemini.UpstreamError):
            gemini._generate("x", "hint")
        usage(gem, "last", "error", "504")
    assert [c["model"] for c in calls] == ["primary", "fallback", "last"]
    assert gem.sleeps == []


@pytest.mark.parametrize("budget,durations,want", [
    (None, [41], ["primary"]),
    (None, [20, 21], ["primary", "fallback"]),
    (12.5, [13], ["primary"]),
])
def test_budget_stops_before_next_model(gem, monkeypatch, budget, durations, want):
    if budget is not None:
        gem.app.config["GEMINI_FALLBACK_BUDGET_S"] = budget
    exc = Err(code=429)
    calls = install(monkeypatch, [exc] * len(durations), gem, durations)
    with pytest.raises(gemini.UpstreamError) as caught:
        gemini._generate("x", "hint")
    assert caught.value.__cause__ is exc
    assert [c["model"] for c in calls] == want
    assert gem.sleeps == []
    usage(gem, want[-1], "error", "429")


def test_budget_boundary_allows_attempt_and_keeps_its_answer(gem, monkeypatch):
    calls = install(monkeypatch, [Err(code=429), "[]"], gem, [40, 30])
    assert gemini._generate("x", "hint") == []
    assert [c["model"] for c in calls] == ["primary", "fallback"]
    usage(gem, "fallback")


def test_primary_success_does_not_try_fallback(gem, monkeypatch):
    calls = install(monkeypatch, ["[]"], gem)
    assert gemini._generate("x", "hint") == []
    assert [c["model"] for c in calls] == ["primary"]
    assert gem.sleeps == []
    usage(gem, "primary")


@pytest.mark.parametrize("reply", ["not json", "null", '{"items":42}'])
def test_unusable_response_does_not_try_fallback(gem, monkeypatch, reply):
    calls = install(monkeypatch, [reply], gem)
    with pytest.raises(gemini.UpstreamError):
        gemini._generate("x", "hint", list_key="items")
    assert [c["model"] for c in calls] == ["primary"]
    assert len(gem.records) == 1
    fields = dict(re.findall(r"(\w+)=(\S+)", gem.records[0].getMessage()))
    assert fields["model"] == "primary" and fields["status"] == "error"
    assert fields["input_tokens"] == "1" and fields["code"] == "null"


@pytest.mark.parametrize("env,models,budget", [
    ({}, [], 40),
    ({"GEMINI_FALLBACK_MODELS": " , first, , second , ", "GEMINI_FALLBACK_BUDGET_S": "12.5"},
     ["first", "second"], 12.5),
])
def test_app_reads_fallback_config_without_loading_secrets(monkeypatch, env, models, budget):
    import app as app_module

    monkeypatch.setattr(app_module, "load_dotenv", lambda: None)
    monkeypatch.setattr(app_module.os, "environ", env)
    app = app_module.create_app({"TESTING": True})
    assert app.config["GEMINI_FALLBACK_MODELS"] == models
    assert float(app.config["GEMINI_FALLBACK_BUDGET_S"]) == budget
