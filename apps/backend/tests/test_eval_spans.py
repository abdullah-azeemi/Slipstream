"""Event log to spans (pure: no MLflow, no DB, no model)."""

from evals.spans import spans_of


def test_model_and_tool_calls_become_ordered_spans():
    events = [
        {"type": "run_start", "t_ms": 0, "question": "q"},
        {"type": "llm_call", "t_ms": 900, "duration_ms": 900, "round": 0, "model": "m",
         "content": "", "tool_calls": [], "prompt_tokens": 10, "completion_tokens": 2, "cost_usd": 0.1},
        {"type": "tool_start", "t_ms": 905, "round": 0, "call_id": "a", "tool": "load_laps", "args": {"session_key": 1}},
        {"type": "tool_end", "t_ms": 950, "round": 0, "call_id": "a", "ok": False, "summary": "boom"},
    ]  # fmt: skip
    llm, tool = spans_of(events)
    assert (llm["kind"], llm["start_ms"], llm["end_ms"]) == ("LLM", 0, 900)
    assert llm["attributes"]["prompt_tokens"] == 10
    assert (tool["name"], tool["start_ms"], tool["end_ms"], tool["ok"]) == (
        "load_laps",
        905,
        950,
        False,
    )
    assert tool["inputs"] == {"session_key": 1} and tool["outputs"] == {"text": "boom"}
