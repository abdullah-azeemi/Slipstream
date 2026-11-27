"""Read a question once, cheaply, before the analyst starts.

One small model call turns the question into a Plan: what kind of question it
is and which race, session and drivers it is about. Code uses the Plan to look
up data and choose a path. The call gets a short prompt and no tool schemas,
so it costs a fraction of an analyst turn.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date
from typing import Literal, get_args

import structlog

from backend.analyst.client import AnalystLLMError, ChatClient

log = structlog.get_logger()

Category = Literal[
    "result",
    "strategy",
    "tyres",
    "telemetry",
    "what_if",
    "compare",
    "out_of_scope",
    "unknown",
]
SESSION_TYPES = ("R", "Q", "S", "SQ", "FP1", "FP2", "FP3")

PREPARE_PROMPT = """You read questions for an F1 analysis agent. Do not answer the question.
Today is {today}. Every season up to today has happened. Do not judge whether data
exists: code checks that afterwards.
Return JSON only, with these keys:
- category, one of (examples in brackets):
  result: one fact from results or timing ["Who won?", "When did X pit?", "X's fastest
    lap?", "Gap between X and Y at the end?", "Did the safety car come out?", "How many
    laps did X complete?", "Was it raining?", "Which sessions do you have?"]
  strategy: reasoning about pit strategy ["Was there an undercut window?", "Would a
    different stop count have won?"]
  tyres: tyre degradation or stint pace ["How bad was X's degradation?", "Was the long
    stint limited by tyre wear?"]
  telemetry: corners, braking, speed traces, g-forces ["Why was X slow in the corners?",
    "Peak lateral g?"]. Use it whenever the question says telemetry, even to compare
    drivers
  what_if: a hypothetical scenario ["What if a safety car came out on lap 15?"]
  compare: drivers compared on pace or style ["Compare X and Y on lap 20"]
  out_of_scope: not about F1, or asks to predict the future ["Who will win 2027?"]
  unknown: none of these fit
  Choose a category even when you doubt the data exists.
- year: integer or null
- gp: the event's place name as one or two words, e.g. "Singapore", or null
- session_type: one of R, Q, S, SQ, FP1, FP2, FP3, or null. A "Grand Prix" question
  with no session named is R
- drivers: surnames exactly as written in the question, [] if none
- reason: under 12 words
Example: {{"category": "result", "year": 2026, "gp": "Dutch", "session_type": "R",
"drivers": [], "reason": "asks for the winner"}}"""


@dataclass(frozen=True)
class Plan:
    category: Category
    year: int | None = None
    gp: str | None = None
    session_type: str | None = None
    drivers: tuple[str, ...] = ()
    reason: str = ""
    cost_usd: float = 0.0


def _parse(text: str) -> dict:
    # Models sometimes wrap JSON in a code fence or add words around it.
    data = json.loads(text[text.find("{") : text.rfind("}") + 1])
    if not isinstance(data, dict):
        raise ValueError("reply is not a JSON object")
    if data.get("category") not in get_args(Category):
        raise ValueError(f"unknown category: {data.get('category')!r}")
    return data


def _clean(data: dict) -> dict:
    """Keep only well-formed fields. A bad field becomes empty, not an error."""
    year = data.get("year")
    gp = data.get("gp")
    session_type = data.get("session_type")
    drivers = data.get("drivers") if isinstance(data.get("drivers"), list) else []
    return {
        "category": data["category"],
        "year": year if isinstance(year, int) and 1950 <= year <= 2100 else None,
        "gp": gp.strip() if isinstance(gp, str) and gp.strip() else None,
        "session_type": session_type if session_type in SESSION_TYPES else None,
        "drivers": tuple(
            d.strip() for d in drivers if isinstance(d, str) and d.strip()
        )[:4],
        "reason": str(data.get("reason", ""))[:200],
    }


def prepare(question: str, llm: ChatClient) -> Plan:
    """Never raises for a bad model reply: the category is then "unknown"."""
    messages = [
        {"role": "system", "content": PREPARE_PROMPT.format(today=date.today())},
        {"role": "user", "content": question},
    ]
    cost = 0.0
    try:
        reply = llm.chat(messages, None)
        cost = reply.cost_usd
        fields = _clean(_parse(reply.content))
    except (AnalystLLMError, ValueError) as exc:
        log.warning("analyst.prepare_failed", error=str(exc))
        return Plan("unknown", reason=f"prepare failed: {exc}", cost_usd=cost)
    return Plan(**fields, cost_usd=cost)
