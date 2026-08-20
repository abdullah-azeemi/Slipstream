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

_ROUTER_SYSTEM_PROMPT = """ You will classify an F1 question into exactly one intent.
Reply with ONLY a JSON object and nothing else:
{"intent": "pit_stop_speed_delta"}

Allowed intents:
- "pit_stop_speed_delta": the question asks about a pit stop and speed before/after it.
- "unsupported": everything else (weather, other sports, live timing, money).

Rules:
- Never explain. Never add prose. JSON only.
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


def route_question(question: str) -> str:
    """Classify a question into an Intent value with the cheap routing model."""
    messages = [
        {"role": "system", "content": _ROUTER_SYSTEM_PROMPT},
        {"role": "user", "content": question},
    ]
    text, _ = _chat(messages, model=settings.openrouter_routing_model, temperature=0.0)
    try:
        intent = json.loads(text)["intent"]
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        raise types.LLMError(
            f"router returned unparseable response: {text[:200]}"
        ) from exc
    if intent not in {member.value for member in types.Intent}:
        raise types.LLMError(f"router returned unknown intent: {intent}")
    return intent


def compose_answer(question: str, evidence: dict) -> str:
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
    text, _ = _chat(messages, model=settings.openrouter_final_model, temperature=0.2)
    return text.strip()
