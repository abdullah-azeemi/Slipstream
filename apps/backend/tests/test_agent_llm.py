"""DB-free unit tests for the OpenRouter adapter (L9)."""

import pytest

from backend.agent import llm, types
from backend.config import settings


def _fake_payload(content, usage=None):
    return {
        "choices": [{"message": {"content": content}}],
        "usage": usage
        or {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    }


def _set_key(monkeypatch, value="test-key"):
    monkeypatch.setattr(settings, "openrouter_api_key", value)


def test_route_question_extracts_entities(monkeypatch):
    _set_key(monkeypatch)
    monkeypatch.setattr(
        llm,
        "_post",
        lambda messages, model, temperature: _fake_payload(
            '{"intent": "pit_stop_speed_delta", "driver": "Sainz", '
            '"year": 2026, "gp_name": "Monaco", "laps_window": 3}'
        ),
    )
    routed = llm.route_question("On which lap did Sainz pit in Monaco 2026?")
    assert routed.intent is types.Intent.PIT_STOP_SPEED_DELTA
    assert routed.driver_name == "Sainz"
    assert routed.year == 2026
    assert routed.gp_name == "Monaco"


def test_route_question_unsupported_has_null_entities(monkeypatch):
    _set_key(monkeypatch)
    monkeypatch.setattr(
        llm,
        "_post",
        lambda messages, model, temperature: _fake_payload(
            '{"intent": "unsupported", "driver": null, "year": null, '
            '"gp_name": null, "laps_window": null}'
        ),
    )
    routed = llm.route_question("What is the weather?")
    assert routed.intent is types.Intent.UNSUPPORTED
    assert routed.driver_name is None
    assert routed.year is None
    assert routed.gp_name is None
    assert routed.laps_window == 3


def test_route_question_unparseable_raises(monkeypatch):
    _set_key(monkeypatch)
    monkeypatch.setattr(
        llm,
        "_post",
        lambda messages, model, temperature: _fake_payload("hello world"),
    )
    with pytest.raises(types.LLMError):
        llm.route_question("when did he pit?")


def test_route_question_unknown_intent_raises(monkeypatch):
    _set_key(monkeypatch)
    monkeypatch.setattr(
        llm,
        "_post",
        lambda messages, model, temperature: _fake_payload('{"intent": "weather"}'),
    )
    with pytest.raises(types.LLMError):
        llm.route_question("when did he pit?")


def test_chat_raises_when_no_api_key(monkeypatch):
    _set_key(monkeypatch, value="")
    with pytest.raises(types.LLMError):
        llm._chat([{"role": "user", "content": "hi"}])


def test_estimate_cost_uses_known_prices():
    usage = {"prompt_tokens": 1_000_000, "completion_tokens": 1_000_000}
    assert llm._estimate_cost("openai/gpt-4o-mini", usage) == pytest.approx(0.75)


def test_estimate_cost_uses_openrouter_cost():
    usage = {"cost": 0.0042, "prompt_tokens": 10, "completion_tokens": 5}
    assert llm._estimate_cost("unknown/model", usage) == pytest.approx(0.0042)


def test_estimate_cost_unknown_model_is_zero():
    usage = {"prompt_tokens": 100, "completion_tokens": 100}
    assert llm._estimate_cost("unknown/model", usage) == 0.0


def test_compose_answer(monkeypatch):
    _set_key(monkeypatch)
    monkeypatch.setattr(
        llm,
        "_post",
        lambda messages, model, temperature: _fake_payload(
            "Verstappen pitted on lap 22."
        ),
    )
    out = llm.compose_answer("when did he pit?", {"pit_lap": 22})
    assert out == "Verstappen pitted on lap 22."


def test_compose_answer_uses_final_model(monkeypatch):
    _set_key(monkeypatch)
    seen = {}

    def fake_post(messages, model, temperature):
        seen["model"] = model
        return _fake_payload("ok")

    monkeypatch.setattr(llm, "_post", fake_post)
    llm.compose_answer("when?", {})
    assert seen["model"] == settings.openrouter_final_model


def test_route_question_coerces_string_year(monkeypatch):
    _set_key(monkeypatch)
    monkeypatch.setattr(
        llm,
        "_post",
        lambda messages, model, temperature: _fake_payload(
            '{"intent": "pit_stop_speed_delta", "driver": "HAM", "year": "2018"}'
        ),
    )
    assert llm.route_question("q?").year == 2018


def test_route_question_bad_year_raises(monkeypatch):
    _set_key(monkeypatch)
    monkeypatch.setattr(
        llm,
        "_post",
        lambda messages, model, temperature: _fake_payload(
            '{"intent": "pit_stop_speed_delta", "year": "fast"}'
        ),
    )
    with pytest.raises(types.LLMError):
        llm.route_question("q?")


def test_route_question_clamps_window(monkeypatch):
    _set_key(monkeypatch)
    monkeypatch.setattr(
        llm,
        "_post",
        lambda messages, model, temperature: _fake_payload(
            '{"intent": "pit_stop_speed_delta", "laps_window": 99}'
        ),
    )
    assert llm.route_question("q?").laps_window == 10
