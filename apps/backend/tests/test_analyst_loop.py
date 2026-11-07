"""Analyst loop tests with a scripted model and a stub toolbox (no network, no Docker)."""

from backend.analyst.client import AnalystLLMError, Reply, ToolCall
from backend.analyst.loop import run_analyst
from backend.analyst.tools import ToolOutput


class ScriptedLLM:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []  # (messages snapshot, tools)

    def chat(self, messages, tools):
        self.calls.append((list(messages), tools))
        item = self.replies.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


class StubToolBox:
    def __init__(self, outputs=None):
        self.outputs = outputs or {}
        self.called = []

    def call(self, name, args):
        self.called.append((name, args))
        return self.outputs.get(name, ToolOutput(f"{name} ok", title=name))


def _call(id_, name, args="{}"):
    return ToolCall(id_, name, args)


def _types(result):
    return [e["type"] for e in result.events]


def test_tool_then_final_answer_emits_ordered_events_and_sums_cost():
    chart = {"title": "Deg", "option": {"series": []}}
    llm = ScriptedLLM(
        [
            Reply(
                "Load laps first.",
                (_call("c1", "load_laps", '{"session_key": 1}'),),
                cost_usd=0.001,
            ),
            Reply(
                "",
                (_call("c2", "run_python", '{"code": "# fit\\nprint(1)"}'),),
                cost_usd=0.002,
            ),
            Reply(
                "",
                (_call("c3", "final_answer", '{"markdown": "Deg is 0.08 s/lap."}'),),
                cost_usd=0.001,
            ),
        ]
    )
    box = StubToolBox({"run_python": ToolOutput("OK", title="fit", charts=[chart])})
    seen = []
    result = run_analyst("q", llm=llm, toolbox=box, emit=seen.append)

    assert result.answer == "Deg is 0.08 s/lap."
    assert result.cost_usd == 0.004
    assert _types(result) == [
        "run_start", "thought", "tool_start", "tool_end",
        "tool_start", "tool_end", "chart", "final",
    ]  # fmt: skip
    assert [e["seq"] for e in result.events] == list(range(len(result.events)))
    assert seen == result.events
    assert result.charts == [chart]
    assert box.called[0] == ("load_laps", {"session_key": 1})


def test_plain_text_reply_is_accepted_as_the_answer():
    llm = ScriptedLLM([Reply("Just an answer.")])
    result = run_analyst("hi", llm=llm, toolbox=StubToolBox())
    assert result.answer == "Just an answer."
    assert _types(result) == ["run_start", "final"]


def test_cost_budget_forces_a_final_answer_without_tools():
    llm = ScriptedLLM(
        [
            Reply("", (_call("c1", "load_laps"),), cost_usd=0.05),
            Reply("Best effort answer."),
        ]
    )
    result = run_analyst("q", llm=llm, toolbox=StubToolBox(), max_cost_usd=0.03)
    assert result.answer == "Best effort answer."
    assert llm.calls[-1][1] is None  # no tools offered on the forced turn
    assert "budget" in llm.calls[-1][0][-1]["content"].lower()


def test_step_limit_forces_a_final_answer():
    llm = ScriptedLLM(
        [
            Reply("", (_call("a", "load_laps"),)),
            Reply("", (_call("b", "load_laps"),)),
            Reply("Done."),
        ]
    )
    result = run_analyst("q", llm=llm, toolbox=StubToolBox(), max_steps=2)
    assert result.answer == "Done."
    assert result.steps == 2


def test_llm_failure_becomes_an_error_event_not_an_exception():
    llm = ScriptedLLM([AnalystLLMError("boom")])
    result = run_analyst("q", llm=llm, toolbox=StubToolBox())
    assert result.error == "boom"
    assert "unavailable" in result.answer
    assert _types(result)[-1] == "error"


def test_bad_json_arguments_become_empty_args():
    llm = ScriptedLLM(
        [
            Reply("", (_call("c1", "load_laps", "{not json"),)),
            Reply("", (_call("c2", "final_answer", '{"markdown":"x"}'),)),
        ]
    )
    box = StubToolBox()
    run_analyst("q", llm=llm, toolbox=box)
    assert box.called == [("load_laps", {})]


def test_failed_tool_is_reported_to_the_model():
    llm = ScriptedLLM(
        [
            Reply("", (_call("c1", "run_python", '{"code":"1/0"}'),)),
            Reply("", (_call("c2", "final_answer", '{"markdown":"x"}'),)),
        ]
    )
    box = StubToolBox({"run_python": ToolOutput("ERROR boom", ok=False, title="calc")})
    result = run_analyst("q", llm=llm, toolbox=box)
    end = next(e for e in result.events if e["type"] == "tool_end")
    assert end["ok"] is False
    tool_msgs = [m for m in llm.calls[1][0] if m["role"] == "tool"]
    assert tool_msgs[0]["content"] == "ERROR boom"


def test_reviewer_can_send_the_answer_back_once():
    llm = ScriptedLLM(
        [
            Reply("", (_call("c1", "final_answer", '{"markdown":"first"}'),)),
            Reply("", (_call("c2", "final_answer", '{"markdown":"second"}'),)),
        ]
    )
    verdicts = iter(["numbers are unsourced", None])
    result = run_analyst(
        "q", llm=llm, toolbox=StubToolBox(), reviewer=lambda a, m: next(verdicts)
    )
    assert result.answer == "second"
    second_turn = llm.calls[1][0]
    # every assistant tool call must be answered by a tool message before the next turn
    assert second_turn[-3]["role"] == "assistant"
    assert second_turn[-2] == {
        "role": "tool",
        "tool_call_id": "c1",
        "content": "answer recorded",
    }
    assert second_turn[-1]["role"] == "user"


def test_a_crashing_emit_callback_does_not_stop_the_run():
    def bad_emit(_event):
        raise RuntimeError("client gone")

    result = run_analyst(
        "q", llm=ScriptedLLM([Reply("ok")]), toolbox=StubToolBox(), emit=bad_emit
    )
    assert result.answer == "ok"
