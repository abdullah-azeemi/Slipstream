"""Turn a run's event log into spans: named steps with a start, an end, inputs and outputs.

Pure, so it is tested without MLflow installed.
"""

from __future__ import annotations


def spans_of(events: list[dict]) -> list[dict]:
    """One span per model call and per tool call, ordered by start time."""
    starts = {e["call_id"]: e for e in events if e["type"] == "tool_start"}
    spans = []
    for e in events:
        if e["type"] == "llm_call":
            spans.append(
                {
                    "name": e["model"],
                    "kind": "LLM",
                    # the event is recorded when the reply arrives
                    "start_ms": max(e["t_ms"] - e["duration_ms"], 0),
                    "end_ms": e["t_ms"],
                    "inputs": {"turn": e["round"]},
                    "outputs": {"content": e["content"], "tool_calls": e["tool_calls"]},
                    "attributes": {
                        "prompt_tokens": e["prompt_tokens"],
                        "completion_tokens": e["completion_tokens"],
                        "cost_usd": e["cost_usd"],
                    },
                    "ok": True,
                }
            )
        elif e["type"] == "tool_end" and e["call_id"] in starts:
            start = starts[e["call_id"]]
            spans.append(
                {
                    "name": start["tool"],
                    "kind": "TOOL",
                    "start_ms": start["t_ms"],
                    "end_ms": e["t_ms"],
                    # runs saved before tracing have no args or full output
                    "inputs": start.get("args", {}),
                    "outputs": {"text": e.get("output", e.get("summary", ""))},
                    "attributes": {"turn": e["round"]},
                    "ok": e["ok"],
                }
            )
    return sorted(spans, key=lambda s: s["start_ms"])
