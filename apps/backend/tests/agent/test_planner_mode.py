import sys
from types import SimpleNamespace

from backend.agent import orchestrator, types
from backend.config import settings


def _routed(intent):
    return types.RoutedQuestion(
        intent=types.Intent(intent),
        driver_name="Hamilton",
        gp_name="Monaco",
        year=2026,
    )


def _tool_sequence(dag):
    order = orchestrator.topo_sort(dag)
    node_map = {n.id: n for n in dag.nodes}
    return [node_map[nid].tool_name.value for nid in order]


def test_flag_defaults_to_template():
    assert settings.agent_planner_mode == "template"


def test_template_mode_keeps_today_s_dag():
    routed = _routed("tyre_degradation_analysis")
    actual = _tool_sequence(orchestrator.build_dag(routed))
    expected = _tool_sequence(orchestrator._build_template_dag(routed))
    assert actual == expected


def test_llm_mode_without_planner_falls_back_to_template(monkeypatch):
    monkeypatch.setattr(settings, "agent_planner_mode", "llm")
    routed = _routed("tyre_degradation_analysis")
    actual = _tool_sequence(orchestrator.build_dag(routed))
    assert actual == _tool_sequence(orchestrator._build_template_dag(routed))


def test_llm_mode_dispatches_to_planner(monkeypatch):
    routed = _routed("tyre_degradation_analysis")
    template = orchestrator._build_template_dag(routed)
    calls = {"n": 0}

    def fake_plan_dag(routed):
        calls["n"] += 1
        return template

    monkeypatch.setitem(
        sys.modules,
        "backend.agent.planner",
        SimpleNamespace(plan_dag=fake_plan_dag),
    )
    monkeypatch.setattr(settings, "agent_planner_mode", "llm")

    dag = orchestrator.build_dag(routed)
    assert calls["n"] == 1
    assert dag is template