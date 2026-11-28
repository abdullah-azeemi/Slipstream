import json

import pytest

from backend.analyst import workflow
from backend.analyst.client import Reply, ToolCall
from backend.analyst.facts import Facts, PreCall
from backend.analyst.tools import ToolOutput

PLAN = '{"category": "result", "year": 2026, "gp": "Dutch", "session_type": "R"}'
DIGEST = "Race of 72 laps.\nWinner: Lando Norris (NOR)."
AGENT = Reply(
    content="",
    tool_calls=(
        ToolCall("c1", "final_answer", json.dumps({"markdown": "From the agent."})),
    ),
    cost_usd=0.002,
)


class ScriptedLLM:
    def __init__(self, *replies):
        self.seen = []  # the messages of every call
        self.replies = [
            r if isinstance(r, Reply) else Reply(content=r, cost_usd=0.0001)
            for r in replies
        ]

    def chat(self, messages, tools):
        self.seen.append(list(messages))
        return self.replies.pop(0)


@pytest.fixture(autouse=True)
def facts(monkeypatch):
    found = Facts({"session_key": 1, "session_type": "R"})
    monkeypatch.setattr(workflow, "gather_facts", lambda plan, toolbox, **kw: found)
    monkeypatch.setattr(workflow, "race_digest", lambda *args: DIGEST)
    loaded = PreCall("race_summary", {"session_key": 1}, ToolOutput(DIGEST))
    monkeypatch.setattr(workflow, "preload_calls", lambda *args: [loaded])
    return found


def run(llm, **kw):
    return workflow.run_workflow("Who won?", llm=llm, toolbox=None, **kw)


def types(result):
    return [e["type"] for e in result.events]


def test_result_question_takes_two_calls():
    seen = []
    result = run(ScriptedLLM(PLAN, "Lando Norris won."), emit=seen.append)
    assert result.answer == "Lando Norris won."
    assert result.cost_usd == 0.0002
    assert types(result) == [
        "run_start",
        "llm_call",
        "plan",
        "llm_call",
        "final",
    ]
    assert seen == result.events


@pytest.mark.parametrize("weak", ["NEED_AGENT", "Norris did a 75.001s lap."])
def test_weak_answer_falls_back_to_the_agent(weak):
    result = run(ScriptedLLM(PLAN, weak, AGENT))
    assert result.answer == "From the agent."
    assert result.cost_usd == 0.0022
    assert [e["seq"] for e in result.events] == list(range(len(result.events)))
    assert types(result).count("run_start") == 1
    assert result.events[-1]["cost_usd"] == 0.0022


def test_unlabelled_question_tries_the_facts_first():
    plan = PLAN.replace('"result"', '"unknown"')
    result = run(ScriptedLLM(plan, "Lando Norris won."))
    assert result.answer == "Lando Norris won."


def test_agent_starts_with_the_loaded_data_and_a_method():
    llm = ScriptedLLM(PLAN.replace('"result"', '"tyres"'), AGENT)
    result = run(llm)
    assert types(result)[:5] == [
        "run_start",
        "llm_call",
        "plan",
        "tool_start",
        "tool_end",
    ]
    system, question, asked, loaded = llm.seen[-1][:4]
    assert "ALREADY DONE" in system["content"]
    assert "degradation_by_stint" in system["content"]
    assert question["role"] == "user"
    assert asked["tool_calls"][0]["id"] == loaded["tool_call_id"] == "pre-0"
    assert loaded["content"] == DIGEST
    agent_call = next(
        e for e in result.events if e["type"] == "llm_call" and e["round"]
    )
    assert agent_call["round"] == 1  # after the preloaded round 0


def test_failed_loader_is_not_reported_as_done():
    failed = PreCall("race_summary", {}, ToolOutput("no lap data", ok=False))
    assert workflow.agent_guidance("unknown", [failed]) == ""


def test_missing_data_refuses_without_the_agent(facts):
    facts.missing = "No lap data is stored."
    result = run(ScriptedLLM(PLAN))
    assert result.refused
    assert result.answer == "No lap data is stored."


def test_follow_up_goes_straight_to_the_agent():
    history = [
        {"role": "user", "content": "q"},
        {"role": "assistant", "content": "a"},
    ]
    result = run(ScriptedLLM(AGENT), history=history)
    assert result.answer == "From the agent."
    assert "plan" not in types(result)
