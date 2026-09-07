"""
Openrouter adapter
"""

from __future__ import annotations
import dataclasses
import json
import structlog
import urllib.error
import urllib.request

from backend.agent import types
from backend.config import settings
from backend.agent import circuit_breaker
from backend.agent import semantic_cache

log = structlog.get_logger()

_PRICES_PER_1M = {
    "openai/gpt-4o-mini": (0.15, 0.60),
}

_ROUTER_SYSTEM_PROMPT = """ You will classify an F1 question and extract its entities.
    Reply ONLY with a JSON Object and nothing else.

Allowed Intents:
    - "pit_stop_speed_delta" : the question asks about a pitstop before/after it.
    - "lap_event_investigation" : the question asks why a specific lap/anomaly happened for a driver.
    - "tyre_degradation_analysis" : the question asks about tyre wear / stint degradation.
    - "telemetry_comparison" : the question asks to compare two laps or two drivers' telemetry.
    - "position_gap_tracking" : the question asks about a driver's position, gap to leader, gap to cars ahead/behind, or whether an undercut/overcut worked.
    - "race_control_events" : the question asks about safety cars, VSC, yellow/red flags, or race control messages during a race.
    - "qualifying_lap_analysis" : the question asks about qualifying, a Q1/Q2/Q3 time, qualifying sector speed, or grid position. Sets session_type to "Q".
    - "team_radio" : the question asks what a driver's engineer/team said on the radio, or wants a radio clip / message inside the car.
    - "weather_correlation" : the question asks about rain, wet/dry conditions, track or air temperature, humidity, or wind during a session.
    - "unsupported" : everything else (other sports, live timing etc)

Field Rules:
    - "driver" : the surname, full name, number or abbreviation the user asks about; null if none
    - "compare_driver" : the second driver for a telemetry comparison; null otherwise
    - "year" and "gp_name" : only when the user names the race; null otherwise. Never guess a race
    - "laps_window" : how many laps before and after the stop to compare; 3 unless the user says otherwise
    - "target_lap" : the specific lap number the user asks about; null if none is specified
    - "session_type" : "Q" if the question is about qualifying, "R" for a race, null if unclear. Default "R" for race questions.
    - For "unsupported" questions every other field must be null.
"""

_COMPOSER_SYSTEM_PROMPT = """You are the Slipstream F1 analyst. You write a short,
readable answer for a fan using ONLY the evidence given.

Rules:
- Never invent numbers that are not in the evidence.
- If a number is missing, say it is missing. Do not guess.
- State the metric definition when a speed is reported.
"""
_MAX_COMPOSITION_CHARS = 4000

def validate_composition(text: str) -> str:
    """Post-LLM validation of the composer's answer 
    The system prompt forbids raw dumps and invented numbers, which we
    cannot check mechanically -- halllucination needs ground truth. What
    we CAN reject is structurally broken output, so the caller hits the
    typed-LLMError fallback instead of rendering a blank or an absurd
    wall of text.
    """
    cleaned = text.strip()
    if not cleaned:
        raise types.LLMError("composer returned an empty answer", code="composer_empty")
    if len(cleaned) > _MAX_COMPOSITION_CHARS:
        raise types.LLMError(f"composer answer exceeds {_MAX_COMPOSITION_CHARS} chars", code="composer_too_long")
    if "```" in cleaned:
        raise types.LLMError("composer returned a code block, not prose", code="composer_code_block")
    return cleaned

def _estimate_cost(model: str, usage: dict) -> float:
    """Rough USD cost for one call. Prefers OpenRouter's own cost if present."""
    if isinstance(usage.get("cost"), (int, float)):
        return float(usage["cost"])
    input_price, output_price = _PRICES_PER_1M.get(model, (0.0, 0.0))
    prompt_tokens = usage.get("prompt_tokens") or 0
    completion_tokens = usage.get("completion_tokens") or 0
    return (prompt_tokens / 1_000_000) * input_price + (
        completion_tokens / 1_000_000
    ) * output_price


def _post(messages: list[dict], model: str, temperature: float) -> dict:
    """Low-level POST to OpenRouter. Returns the parsed JSON body."""
    api_key = settings.openrouter_api_key
    if not api_key:
        raise types.LLMError("OPENROUTER_API_KEY is not set")

    body = json.dumps(
        {
            "model": model,
            "messages": messages,
            "temperature": temperature,
        }
    ).encode("utf-8")

    request = urllib.request.Request(
        f"{settings.openrouter_base_url}/chat/completions",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://slipstream.local",
            "X-Title": "Slipstream Agent",
        },
    )
    if not circuit_breaker.breaker.allow_request():
        raise types.LLMError("LLM provider temporarily unavailable (circuit open)")

    try:
        with urllib.request.urlopen(
            request, timeout=settings.openrouter_timeout_seconds
        ) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        circuit_breaker.breaker.record_failure()
        detail = exc.read().decode("utf-8", errors="replace")
        raise types.LLMError(f"OpenRouter HTTP {exc.code}: {detail[:300]}") from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        circuit_breaker.breaker.record_failure()
        raise types.LLMError(f"OpenRouter call failed: {exc}") from exc

    circuit_breaker.breaker.record_success()
    return payload


def _chat(
    messages: list[dict], model: str | None = None, temperature: float = 0.0
) -> tuple[str, dict]:
    """One chat completion. Returns (text, usage_summary) and logs tokens/cost."""
    model = model or settings.openrouter_routing_model
    payload = _post(messages, model, temperature)
    try:
        text = payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise types.LLMError(f"OpenRouter response missing content: {payload}") from exc

    usage = payload.get("usage") or {}
    cost = _estimate_cost(model, usage)
    log.info(
        "agent.llm",
        model=model,
        prompt_tokens=usage.get("prompt_tokens"),
        completion_tokens=usage.get("completion_tokens"),
        cost_estimate_usd=round(cost, 6),
    )
    return text, {"model": model, "cost_estimate_usd": cost}


def _clean_str(value) -> str | None:
    """Return a stripped non empty string, else None"""
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _coerce_year(value) -> int | None:
    """Accept an int year (or numeric string)"""
    if value is None:
        return None
    try:
        year = int(value)
    except (TypeError, ValueError) as exc:
        raise types.LLMError(f"router returned bad year: {value!r}", code="router_bad_year") from exc
    if year < 1950:
        raise types.LLMError(f"router returned impossible year: {year}", code="router_bad_year")
    return year


def _coerce_window(value) -> int:
    """Clamp the comparison window into a sane 1-10 range; default 3."""
    if value is None:
        return 3
    try:
        window = int(value)
    except (TypeError, ValueError) as exc:
        raise types.LLMError(f"router returned bad laps_window: {value!r}", code="router_bad_window") from exc
    return max(1, min(window, 10))


def _coerce_target_lap(value) -> int | None:
    """Accept a single lap number; None or zero becomes None"""
    if value is None:
        return None
    try:
        lap = int(value)
    except (TypeError, ValueError):
        raise types.LLMError(f"router returned bad target lap : {value!r}") from None
    return lap if lap > 0 else None


def _coerce_session_type(value) -> "types.SessionType | None":
    """Map an LLM session_type string ('Q', 'R', ...) to a SessionType, else None."""
    if not value:
        return None
    try:
        return types.SessionType(value)
    except ValueError:
        return None


def _coerce_compare_driver(value) -> str | None:
    """The second driver is just a name like the primary one"""
    return _clean_str(value)

_COMPLEXITY_VERBS = ("compare", "differs", "why", "how", "affect", "impact", "correlat", "worsen", "improve", "explain")

_COMPLEXITY_CONJUNCTIONS = (" and ", " vs ", " versus ", " over ", " then ")

def _score_complexity(question: str, routed: types.RoutedQuestion) -> int:
    score = 1
    entities = sum(
        1
        for v in (
            routed.compare_driver_name,
            routed.gp_name,
            routed.year,
            routed.target_lap,
            routed.session_type,
        )
        if v is not None
    )
    score += min(entities, 3)

    lowered = question.lower()
    score += sum(2 for verb in _COMPLEXITY_VERBS if verb in lowered)
    score += sum(1 for conj in _COMPLEXITY_CONJUNCTIONS if conj in lowered)

    return max(1, min(score, 5))

def parse_routed_question(payload: dict, question: str) -> types.RoutedQuestion:
    """Validate a router JSON payload into a RoutedQuestion (T3.3).

    Formal per-call validator: every field the router emits is coerced
    through the typed helpers above, and anything non-recoverable raises
    a typed LLMError with a ``code`` -- never a raw crash, never garbage.
    """

    intent_value = payload.get("intent")
    if intent_value not in {member.value for member in types.Intent}:
        raise types.LLMError(f"router returned unknown intent: {intent_value}", code="router_unknown_intent")

    routed = types.RoutedQuestion(
        intent=types.Intent(intent_value),
        question=question,
        driver_name=_clean_str(payload.get("driver")),
        compare_driver_name=_coerce_compare_driver(payload.get("compare_driver") or payload.get("compare_driver_name")),
        gp_name=_clean_str(payload.get("gp_name")),
        year=_coerce_year(payload.get("year")),
        laps_window=_coerce_window(payload.get("laps_window")),
        target_lap=_coerce_target_lap(payload.get("target_lap")),
        session_type=_coerce_session_type(payload.get("session_type")),
    )
    return dataclasses.replace(routed, complexity=_score_complexity(question, routed))

def route_question(question: str) -> tuple[types.RoutedQuestion, float]:
    """Classify a question and extract its entities with the cheap routing model"""

    cached = semantic_cache.get(question)

    if cached is not None:
        return parse_routed_question(cached, question), 0.0

    messages = [
        {"role": "system", "content": _ROUTER_SYSTEM_PROMPT},
        {"role": "user", "content": question},
    ]
    text, usage = _chat(
        messages, model=settings.openrouter_routing_model, temperature=0.0
    )
    try:
        payload = json.loads(text)
    except (json.JSONDecodeError, TypeError) as exc:
        raise types.LLMError(f"router returned unparseable response: {text[:200]}", code="router_unparseable") from exc
    if not isinstance(payload, dict):
        raise types.LLMError(f"router returned non-object JSON: {text[:200]}", code="router_unparseable")

    semantic_cache.set(question, payload)
    cost = usage.get("cost_estimate_usd", 0.0)
    return parse_routed_question(payload, question), cost


_CAPABLE_INTENTS = frozenset({
    types.Intent.TELEMETRY_COMPARISON,
    types.Intent.WEATHER_CORRELATION,
    types.Intent.TYRE_DEGRADATION_ANALYSIS,
})

_ANALYTICAL_COMPLEXITY_FLOOR = 3


def select_model(intent: types.Intent | None, complexity: int) -> str:
    """T3.2 -- pick the composer/planner model for an intent+complexity pair.

    Rule (kept explicit so it is cheap to review): analytical intents are
    sent to the capable model only when the question is actually compound
    (complexity >= 3). Everything else stays on the cheap everyday model.
    Start narrow -- over-routing to the expensive model defeats the point.
    """
    if (
        intent is not None
        and intent in _CAPABLE_INTENTS
        and complexity >= _ANALYTICAL_COMPLEXITY_FLOOR
    ):
        return settings.openrouter_capable_model
    return settings.openrouter_final_model


def compose_answer(
    question: str,
    evidence: dict,
    memory_context: str = "",
    intent: types.Intent | None = None,
    complexity: int = 1,
) -> tuple[str, float]:
    """Write the final human-readable answer from structured evidence."""
    context_block = ""
    if memory_context:
        context_block = (
            f"\n\nBackground context from this user's memory (usable for narrative "
            f"flavour only, NOT evidence -- every number you write must come from "
            f"the evidence JSON):\n{memory_context}"
        )
    messages = [
        {"role": "system", "content": _COMPOSER_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Question: {question}\n\nEvidence (JSON):\n"
                f"{json.dumps(evidence, indent=2, default=str)}"
                f"{context_block}"
            ),
        },
    ]
    text, usage = _chat(messages, model=select_model(intent, complexity), temperature=0.2)
    cost = usage.get("cost_estimate_usd", 0.0)
    return validate_composition(text), cost
