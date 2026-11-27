import pytest
from backend.analyst.client import AnalystLLMError, Reply
from backend.analyst.prepare import prepare


class FakeLLM:
    def __init__(self, content="", error=None):
        self.content, self.error = content, error
        self.calls = []

    def chat(self, messages, tools):
        self.calls.append((messages, tools))
        if self.error:
            raise self.error
        return Reply(content=self.content, cost_usd=0.0001)


def test_prepare_reads_the_question():
    llm = FakeLLM(
        '{"category": "result", "year": 2026, "gp": "Dutch", "session_type": "R",'
        ' "drivers": [], "reason": "asks for the winner"}'
    )
    plan = prepare("Who won the 2026 Dutch Grand Prix?", llm)
    assert plan.category == "result"
    assert plan.year == 2026
    assert plan.gp == "Dutch"
    assert plan.session_type == "R"
    assert plan.cost_usd == 0.0001
    assert llm.calls[0][1] is None


def test_prepare_drops_bad_fields_but_keeps_the_category():
    llm = FakeLLM(
        '```json\n{"category": "tyres", "year": "2026", "session_type": "race",'
        ' "drivers": ["Hamilton", 7]}\n```'
    )
    plan = prepare("How bad was Hamilton's degradation?", llm)
    assert plan.category == "tyres"
    assert plan.year is None
    assert plan.session_type is None
    assert plan.drivers == ("Hamilton",)


@pytest.mark.parametrize(
    "llm",
    [
        FakeLLM('{"category": "banana"}'),
        FakeLLM("It is a result question"),
        FakeLLM("[1, 2]"),
        FakeLLM(error=AnalystLLMError("down")),
    ],
)
def test_prepare_falls_back_to_unknown(llm):
    plan = prepare("Who won?", llm)
    assert plan.category == "unknown"
    assert plan.reason.startswith("prepare failed")
