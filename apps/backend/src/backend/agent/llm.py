"""
Openrouter adapter
"""

from __future__ import annotations
import json
import structlog
import urllib.error
import urllib.request

from backend.agent import types
from backend.config import settings

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
    - "unsupported" : everything else (weather, other sports, live timing etc)

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

    try:
        with urllib.request.urlopen(
            request, timeout=settings.openrouter_timeout_seconds
        ) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise types.LLMError(f"OpenRouter HTTP {exc.code}: {detail[:300]}") from exc
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise types.LLMError(f"OpenRouter call failed: {exc}") from exc


def _chat(messages: list[dict], model: str | None = None, temperature: float = 0.0) -> tuple[str, dict]:
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
        raise types.LLMError(f"router returned bad year: {value!r}") from exc
    if year < 1950:
        raise types.LLMError(f"router returned impossible year: {year}")
    return year


def _coerce_window(value) -> int:
    """Clamp the comparison window into a sane 1-10 range; default 3."""
    if value is None:
        return 3
    try:
        window = int(value)
    except (TypeError, ValueError):
        return 3
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


def route_question(question: str) -> tuple[types.RoutedQuestion, float]:
    """Classify a question and extract its entities with the cheap routing model"""
    messages = [
        {"role": "system", "content": _ROUTER_SYSTEM_PROMPT},
        {"role": "user", "content": question},
    ]
    text, usage = _chat(messages, model=settings.openrouter_routing_model, temperature=0.0)
    try:
        payload = json.loads(text)
        intent_value = payload["intent"]
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        raise types.LLMError(f"router returned unparseable response: {text[:200]}") from exc

    if intent_value not in {member.value for member in types.Intent}:
        raise types.LLMError(f"router returned unknown intent: {intent_value}")

    cost = usage.get("cost_estimate_usd", 0.0)
    intent = types.Intent(intent_value)
    return types.RoutedQuestion(
        intent=intent,
        driver_name=_clean_str(payload.get("driver")),
        compare_driver_name=_coerce_compare_driver(
            payload.get("compare_driver") or payload.get("compare_driver_name")
        ),
        gp_name=_clean_str(payload.get("gp_name")),
        year=_coerce_year(payload.get("year")),
        laps_window=_coerce_window(payload.get("laps_window")),
        target_lap=_coerce_target_lap(payload.get("target_lap")),
        session_type=_coerce_session_type(payload.get("session_type")),
    ), cost


def compose_answer(question: str, evidence: dict) -> tuple[str, float]:
    """Write the final human-readable answer from structured evidence."""
    messages = [
        {"role": "system", "content": _COMPOSER_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Question: {question}\n\nEvidence (JSON):\n"
                f"{json.dumps(evidence, indent=2, default=str)}"
            ),
        },
    ]
    text, usage = _chat(
        messages, model=settings.openrouter_final_model, temperature=0.2
    )
    cost = usage.get("cost_estimate_usd", 0.0)
    return text.strip(), cost
