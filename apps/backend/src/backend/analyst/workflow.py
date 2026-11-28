"""The outer steps of an analyst run, decided by code.

prepare (one small call) -> facts (code) -> either a one-call answer for a
result or unlabelled question, or the full analyst loop. The model decides things only
inside these steps.
"""

from __future__ import annotations

import time

from backend.analyst import checker
from backend.analyst.client import AnalystLLMError, ChatClient, Reply
from backend.analyst.digest import race_digest
from backend.analyst.facts import Facts, PreCall, gather_facts, preload_calls
from backend.analyst.loop import AnalystResult, Emit, run_analyst
from backend.analyst.prepare import Plan, prepare
from backend.analyst.tools import ToolBox, describe_call

NEED_AGENT = "NEED_AGENT"

ANSWER_PROMPT = f"""You are Pitwall, an F1 analyst. Answer the question using only the FACTS.
Be short: the answer first, then one line of evidence. Copy numbers exactly.
Reply with exactly {NEED_AGENT} and nothing else only when the FACTS do not contain
what is asked."""

# The method for each kind of question, so the agent does not have to work it out.
RECIPES = {
    "strategy": "Use pit_summary({'CODE': laps, ...}, total_laps) for pit losses. Take gaps and traffic from race_summary.",
    "tyres": "Use degradation_by_stint(laps, total_laps) on each driver's laps and report StintDeg.issues. Publish degradation_chart(laps, total_laps).",
    "telemetry": "Call load_telemetry for every driver and lap you need in ONE turn, then use lateral_peak or longitudinal_g in one script.",
    "compare": "Compare the same laps for both drivers in one script. Use clean_laps and fuel_correct for pace. Load telemetry only if corners or speed are asked.",
    "what_if": "Start from the actual race and measured pit loss. Label the result as a scenario and list its assumptions.",
}


def agent_guidance(category: str, calls: list[PreCall]) -> str:
    parts = []
    done = [call.tool for call in calls if call.output.ok]
    if done:
        parts.append(
            f"ALREADY DONE: the session is found and these tools ran: {', '.join(done)}. "
            "Their results follow the question and their files are in /data. Do not call "
            "find_sessions or repeat them."
        )
    if category in RECIPES:
        parts.append(f"METHOD: {RECIPES[category]}")
    if parts:
        parts.append("With each tool call, write one short sentence saying why.")
    return "\n".join(parts)


class _Recorder:
    """Numbers and times every event, and totals what the model calls cost."""

    def __init__(self, emit: Emit | None) -> None:
        self.emit = emit
        self.events: list[dict] = []
        self.started = time.perf_counter()

    def __call__(self, type_: str, **data) -> None:
        event = {
            **data,
            "type": type_,
            "seq": len(self.events),
            "t_ms": round((time.perf_counter() - self.started) * 1000),
        }
        self.events.append(event)
        if self.emit:
            try:
                self.emit(event)
            except Exception:  # a broken consumer must never kill the run
                pass


class _Traced:
    """A ChatClient that records an llm_call event, for calls made outside the loop."""

    def __init__(self, llm: ChatClient, record: _Recorder) -> None:
        self.llm, self.record = llm, record
        self.cost = 0.0

    def chat(self, messages: list[dict], tools: list[dict] | None) -> Reply:
        t0 = time.perf_counter()
        reply = self.llm.chat(messages, tools)
        self.cost += reply.cost_usd
        self.record(
            "llm_call",
            round=0,
            model=getattr(self.llm, "model", "unknown"),
            duration_ms=round((time.perf_counter() - t0) * 1000),
            cost_usd=reply.cost_usd,
            prompt_tokens=reply.prompt_tokens,
            completion_tokens=reply.completion_tokens,
            content=reply.content,
            tool_calls=[],
            forced=False,
        )
        return reply


def _record_preload(record: _Recorder, calls: list[PreCall]) -> None:
    for number, call in enumerate(calls):
        call_id = f"pre-{number}"
        title, preview = describe_call(call.tool, call.args)
        record(
            "tool_start",
            round=0,
            call_id=call_id,
            tool=call.tool,
            args=call.args,
            title=title,
            preview=preview,
        )
        out = call.output
        record(
            "tool_end",
            round=0,
            call_id=call_id,
            ok=out.ok,
            duration_ms=0,  # the loaders ran together, so one time each is not kept
            summary=out.text[:300],
            output=out.text,
            title=out.title or title,
            preview=out.preview or preview,
        )


def _answer_from_facts(
    question: str, plan: Plan, facts: Facts, toolbox: ToolBox, llm: ChatClient
) -> str | None:
    """One call over facts that code selected. None means the agent should take over."""
    if facts.session is None or facts.session["session_type"] != "R":
        return None
    digest = race_digest(question, plan, facts.session, toolbox)
    messages = [
        {"role": "system", "content": ANSWER_PROMPT},
        {"role": "user", "content": f"FACTS\n{digest}\n\nQUESTION\n{question}"},
    ]
    try:
        answer = llm.chat(messages, None).content.strip()
    except AnalystLLMError:
        return None
    if not answer or NEED_AGENT in answer:
        return None
    evidence = [
        {"role": "tool", "content": digest},
        {"role": "user", "content": question},
    ]
    return None if checker.find_unverified(answer, evidence) else answer


def run_workflow(
    question: str,
    *,
    llm: ChatClient,
    toolbox: ToolBox,
    emit: Emit | None = None,
    history: list[dict] | None = None,
    **agent_options,
) -> AnalystResult:
    # A follow-up ("and Russell?") cannot be read on its own: the agent has the chat.
    if history:
        return run_analyst(
            question,
            llm=llm,
            toolbox=toolbox,
            emit=emit,
            history=history,
            **agent_options,
        )

    record = _Recorder(emit)
    traced = _Traced(llm, record)
    record("run_start", question=question, history_turns=0)

    def finish(answer: str, *, refused: bool = False) -> AnalystResult:
        cost = round(traced.cost, 6)
        record(
            "final",
            markdown=answer,
            cost_usd=cost,
            steps=0,
            refused=refused,
            incomplete=False,
            unverified=[],
        )
        return AnalystResult(answer, cost, 0, record.events, refused=refused)

    plan = prepare(question, traced)
    record(
        "plan",
        category=plan.category,
        year=plan.year,
        gp=plan.gp,
        session_type=plan.session_type,
        drivers=list(plan.drivers),
        reason=plan.reason,
    )
    # Checks only: a one-call answer needs no tool output, so load it later.
    facts = gather_facts(plan, toolbox, preload=False)
    if facts.missing:
        return finish(facts.missing, refused=True)
    # "unknown" is often an easy question the plan could not label, so try it too.
    if plan.category in ("result", "unknown"):
        answer = _answer_from_facts(question, plan, facts, toolbox, traced)
        if answer is not None:
            return finish(answer)
        record("thought", round=0, text="The facts are not enough: running the agent.")

    calls = preload_calls(plan, facts.session, toolbox) if facts.session else []
    _record_preload(record, calls)

    spent = traced.cost
    # The agent's rounds come after the preloaded round 0 on the canvas.
    offset = 1 if calls else 0

    def forward(event: dict) -> None:
        data = {k: v for k, v in event.items() if k not in ("type", "seq", "t_ms")}
        if event["type"] == "run_start":
            return
        if "round" in data:
            data["round"] += offset
        if event["type"] == "final":
            data["cost_usd"] = round(data["cost_usd"] + spent, 6)
        record(event["type"], **data)

    result = run_analyst(
        question,
        llm=llm,
        toolbox=toolbox,
        emit=forward,
        preloaded=calls,
        guidance=agent_guidance(plan.category, calls),
        **agent_options,
    )
    result.cost_usd = round(result.cost_usd + spent, 6)
    result.events = record.events
    return result
