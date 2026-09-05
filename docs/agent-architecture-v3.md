# Pitwall Agent Architecture v3

Last updated: 2026-09-06

Status: **L1–L31 complete and shipped (deterministic pipeline). Tier 0 (T0.1–T0.5) complete and shipped. T1.1 (dynamic tool planning), T1.2 (bounded iterative loop) complete and shipped behind the `AGENT_PLANNER_MODE` feature flag. Tier 2 (T2.1 long-term memory + RAG, T2.2 retry with backoff, T2.3 adaptive complexity) complete and shipped. This doc supersedes `agent-architecture-v2.md`.**

**Key change from v2:** the shadow-mode ("run old + new planner in parallel on live traffic") idea from v2's rollout plan is **REMOVED**. Running two systems in parallel live is real infra complexity (2x DB load, 2x LLM spend, a diffing service to build and maintain) for a solo project with no production traffic yet. Replaced with an **offline eval gate + feature flag**: build the new planner behind a flag, validate it against a fixed question set *before* any live traffic sees it, flip the flag only once it passes. Same safety property (don't ship a regression), much less to build and operate.

---

## Goal Statement (unchanged)

Build a public Pitwall AI agent that answers race questions from stored F1 data while keeping cost, safety, and evidence quality under control.

The system's three invariants:

1. **LLM plans. Tools compute. Verifier checks. LLM explains.**
2. **Zero hallucinations** — the evidence gate refuses rather than inventing numbers.
3. **Parameterized SQL only** — the LLM can choose a tool, never write SQL.

---

## Current System (L1–L31) — unchanged, see v2 for full detail

Deterministic 5-stage pipeline: `Route → Plan (hardcoded DAG) → Execute → Verify → Compose`.

- **13 read-only tools**, typed frozen-dataclass contracts, `text()` + `:param` SQL only.
- **Evidence gate** as terminal node of every DAG.
- **Slot-filling clarification** for multi-turn (L29).
- This is solid and stays as the **fallback path** through every tier below — nothing in this roadmap removes it, everything wraps around it.

---

## Tier 0 — Production hardening (NEW — must land before T1.1)

**Why this exists:** T1.1 replaces deterministic tool selection with LLM judgment. That's the single highest-risk change in the whole roadmap, because a regression in judgment doesn't crash — it just quietly gives worse answers, and your 119 existing tests check code correctness, not agent quality. Tier 0 is the missing instrument panel for that risk, plus the baseline production-safety items every public, cost-bearing LLM endpoint needs regardless of which tier you're on.

**Implementation owner: Claude (this session/thread).** This tier is foundational and judgment-heavy — do not delegate to a cheaper model. See "Implementation ownership" section at the bottom for the full split.

### T0.1 — Golden evaluation set

**Goal:** A fixed set of 30–50 real questions, each with an expected tool sequence and expected evidence shape, that every planner change is checked against before shipping. This is what makes "did T1.1 actually improve things" answerable instead of a guess.

**Files to add:**
- `apps/backend/tests/agent/golden_set.json` — question → `{expected_intent, expected_tools: [...], min_evidence_fields: [...]}`. Cover all 10 existing intents (5+ each) plus 5-10 genuinely multi-intent questions (the ones T1.1 is meant to newly handle, e.g. "did weather affect tyre degradation").
- `apps/backend/tests/agent/test_golden_eval.py` — runs each question through the *current* planner (whichever is active behind the flag), asserts tool sequence overlap ≥ threshold and evidence gate passes. Reports a score, not just pass/fail, since planner behavior legitimately varies run to run.

**Acceptance criteria:**
- Running the eval against the existing hardcoded `build_dag()` gives a baseline score — this is your regression floor for every future planner change, hardcoded or LLM-driven.
- CI runs this on every PR touching `agent/`.

### T0.2 — Feature-flagged rollout (replaces v2's shadow mode)

**Goal:** Build the new LLM planner behind a flag. Validate offline against T0.1. Only flip the flag to send live traffic to it once it matches or beats the baseline score with no regression on any single existing intent.

**Files to add/change:**
- `config.py` — `AGENT_PLANNER_MODE: Literal["template", "llm"] = "template"` (env-controlled).
- `orchestrator.py:build_dag()` — branches on the flag; `"template"` keeps today's `if/elif`, `"llm"` calls the new `plan_dag()` from T1.1.
- CI step: run T0.1's golden eval against `AGENT_PLANNER_MODE=llm` on every PR, block merge if it drops below the template baseline on any intent.

**Why this instead of shadow mode:** same safety guarantee (never ship a quality regression), no live dual-execution, no diffing service, no 2x cost while you have zero/low production traffic. Revisit shadow mode later *only if* you have enough real traffic that offline eval stops being representative — not before.

**Acceptance criteria:**
- Flag defaults to `"template"` in production until T0.1 explicitly signs off on `"llm"`.
- Flipping the flag is a one-line config change, no code redeploy required ideally (env var).

### T0.3 — Per-DAG resource caps

**Goal:** Once the LLM can freely choose tools (T1.1), nothing currently stops a single question from generating an expensive DAG. Cap it before that's possible, not after.

**Files to change:**
- `orchestrator.py` — hard cap on total nodes per DAG (e.g. 8); reject/truncate plans exceeding it, falling back to the template DAG for that intent.
- `tools.py` — `telemetry_inspector` specifically gets a max-rows/max-laps ceiling; it's the heaviest tool (full telemetry load) and the most likely to be over-called by an enthusiastic planner.

**Acceptance criteria:** a deliberately multi-part test question can't produce a DAG that exceeds the cap; it either gets pruned or falls back to template, never runs unbounded.

### T0.4 — Per-user rate limiting + cost budget

**Goal:** You have Clerk auth already — use it. No public LLM-backed endpoint should ship without a cap on how much a single user can spend, or you're one enthusiastic user (or one bot) away from an unexpected bill.

**Files to add:**
- `apps/backend/src/backend/agent/rate_limit.py` — per-user request count (e.g. `flask-limiter` keyed on Clerk user ID) and a rough per-user daily token/cost estimate, rejecting with a clear message once exceeded.

**Acceptance criteria:** exceeding the limit returns a clean 429 with a retry-after, not a silent hang or an unbounded bill.

### T0.5 — Circuit breaker on LLM API failure

**Goal:** Distinguish "the plan failed" (already handled — fallback to template DAG) from "the LLM provider itself is down/timing out." The latter should degrade the *whole agent* to the deterministic path, not fail every single request individually while retrying a dead endpoint.

**Files to add:**
- `apps/backend/src/backend/agent/circuit_breaker.py` — simple state machine (closed/open/half-open) around the LLM client calls; N consecutive failures within a window → open the breaker → force `AGENT_PLANNER_MODE=template` behavior for all requests until a half-open probe succeeds.

**Acceptance criteria:** simulated provider outage in tests causes the breaker to open and the system to keep serving (degraded but working) rather than every request individually timing out.

### T0.6 — Memory retention/deletion policy (prerequisite for T2.1, not urgent yet)

**Goal:** Once T2.1 (long-term memory) ships, it's durable per-user data behind auth — needs a retention policy and a delete path from day one, not bolted on later.

**Files to add (when T2.1 is actually built, not before):** a `DELETE /api/v1/agent/memory` endpoint, and a documented TTL or explicit-clear-only policy for stored preferences.

**Acceptance criteria:** user can clear their own memory; no memory record persists with no owner path to delete it.

---

## Tier 1 — True agentic behavior (T1.1–T1.3)

**T1.1 and T1.2 shipped (2026-09-03).** T1.3 unchanged from v2 in design — see v2 for full detail on the iterative reasoning loop and tool-output interpretation. The concrete implementation contracts live in the backend modules below. Restating only what changed:

- **T1.1 ships behind the `AGENT_PLANNER_MODE` flag from T0.2**, gated by the T0.1 golden eval — not a direct cutover.
- **T0.3's node cap and T0.5's circuit breaker must exist before T1.1 goes live**, since T1.1 is exactly the change that makes both risks real.
- **Implementation owner: Claude.** Foundational, high blast radius if wrong — a subtly bad planner corrupts every answer downstream. Not a good first delegation target to a cheaper model.

### T1.1 — Dynamic tool planning → `planner.py` ✅ DONE

**Safety invariants (do not change without going back to the architecture doc):**
- The LLM never invents a tool name or SQL. Every plan is validated against `TOOL_REGISTRY` before anything is bound or executed.
- A plan that fails validation ALWAYS raises `PlanValidationError`. The caller (`orchestrator.build_dag`) MUST catch it and fall back to the existing template DAG — never let it crash the request, never let it partially run.
- Max `MAX_DAG_NODES` per plan (T0.3).

`TOOL_REGISTRY` populated from the real 13 tools in `tools.py` via `ToolSpec.from_dataclass()`. `call_llm_json()` wired to the real LLM client in `llm.py`.

**Destination in the real repo:** `apps/backend/src/backend/agent/planner.py` (new file — **shipped**)

**Implementation contract (full code):**

```python
"""
T1.1 -- Dynamic tool planning.

Destination in the real repo: apps/backend/src/backend/agent/planner.py (new file)

WHAT'S ALREADY DECIDED -- do not change this without going back to
agent-architecture-v3.md, these are the safety invariants:
  - The LLM never invents a tool name or SQL. Every plan is validated against
    TOOL_REGISTRY before anything is bound or executed.
  - A plan that fails validation ALWAYS raises PlanValidationError. The caller
    (orchestrator.build_dag) MUST catch it and fall back to the existing template
    DAG -- never let it crash the request, never let it partially run.
  - Max MAX_DAG_NODES per plan (T0.3 in the architecture doc).

WHAT YOU FILL IN -- every other function is complete and tested:
  1. TOOL_REGISTRY -- populate from the real 13 tools in tools.py (builder given below).
  2. call_llm_json() -- wire to whatever LLM client llm.py already uses.
Run test_planner.py after wiring these two. Don't change validate_plan(), topo_sort(),
or the prompt contract -- if a real tool doesn't fit ToolSpec.from_dataclass(), extend
the helper, don't hand-roll a one-off validation path for it.
"""

from __future__ import annotations
import dataclasses
import json
import typing as t

MAX_DAG_NODES = 8  # T0.3 cap -- see agent-architecture-v3.md


# ---------------------------------------------------------------------------
# Contracts. These belong in types.py in the real repo -- shown here so this
# file is self-contained and testable on its own.
# ---------------------------------------------------------------------------

@dataclasses.dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    input_fields: dict  # field_name -> python type name, e.g. {"year": "int"}
    required_fields: frozenset
    output_summary: str  # one-line, shown to the planner LLM, not the end user

    @staticmethod
    def from_dataclass(name: str, description: str, input_cls: type, output_summary: str) -> "ToolSpec":
        hints = t.get_type_hints(input_cls)
        fields = {}
        for f in dataclasses.fields(input_cls):
            hint = hints.get(f.name, f.type)
            fields[f.name] = getattr(hint, "__name__", str(hint))
        required = frozenset(
            f.name for f in dataclasses.fields(input_cls)
            if f.default is dataclasses.MISSING and f.default_factory is dataclasses.MISSING  # type: ignore[attr-defined]
        )
        return ToolSpec(name=name, description=description, input_fields=fields,
                         required_fields=required, output_summary=output_summary)


@dataclasses.dataclass
class DAGNode:
    node_id: str
    tool: str
    params: dict
    depends_on: list
    round: int = 0
    # T1.3: optional references into earlier node outputs, resolved at bind time.
    # Value format is "node_id.field.path" -- looked up via dict/attr access only,
    # never eval'd, so a malformed ref fails closed instead of executing anything.
    input_param_refs: dict = dataclasses.field(default_factory=dict)


@dataclasses.dataclass
class ExecutionDAG:
    nodes: list

    def edges(self):
        return [(dep, n.node_id) for n in self.nodes for dep in n.depends_on]


class PlanValidationError(Exception):
    """Raised whenever an LLM-emitted plan fails validation for any reason.
    Caller MUST catch this and fall back to the template DAG."""


# ---------------------------------------------------------------------------
# TOOL_REGISTRY -- populate from the real 13 tools in tools.py
# ---------------------------------------------------------------------------

# Example of the pattern -- replace with the real 13 tools. One line each,
# using the ToolSpec.from_dataclass() helper above against the existing frozen
# input dataclasses already in tools.py:
#
# from .tools import ResolveSessionInput, FindPitStopsInput, ...
#
# TOOL_REGISTRY: dict = {
#     "resolve_session": ToolSpec.from_dataclass(
#         "resolve_session",
#         "Find a session by year, GP name, and session type.",
#         ResolveSessionInput,
#         "Returns session_key, date, session_type.",
#     ),
#     ... (12 more)
# }
TOOL_REGISTRY: dict = {}


# ---------------------------------------------------------------------------
# Validation -- cycle guard, unknown-tool rejection, schema check, node cap.
# This is the part that must never be weakened -- it's the whole safety net.
# ---------------------------------------------------------------------------

def topo_sort(dag: ExecutionDAG):
    """Kahn's algorithm. Returns execution order, or None if a cycle exists.
    Kept identical in approach to the existing topo_sort in orchestrator.py so
    plan validation and execution never disagree about ordering."""
    indegree = {n.node_id: 0 for n in dag.nodes}
    adj: dict = {n.node_id: [] for n in dag.nodes}
    for n in dag.nodes:
        for dep in n.depends_on:
            if dep not in indegree:
                # Not a node in THIS plan -- either a prior-round node (already
                # executed, already validated via known_node_ids in validate_plan)
                # or a genuinely dangling ref, which validate_plan already rejects
                # BEFORE calling topo_sort. Either way, it's not part of this
                # graph's cycle-detection -- treat it as already satisfied.
                continue
            adj[dep].append(n.node_id)
            indegree[n.node_id] += 1
    queue = [nid for nid, d in indegree.items() if d == 0]
    order = []
    while queue:
        nid = queue.pop(0)
        order.append(nid)
        for nxt in adj[nid]:
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                queue.append(nxt)
    return order if len(order) == len(dag.nodes) else None


def validate_plan(raw: dict, registry: dict, known_node_ids=()) -> ExecutionDAG:
    """Validate a raw parsed-JSON plan from the LLM. Raises PlanValidationError on
    ANY problem: unknown tool, missing required param, dangling dependency, cycle,
    or exceeding MAX_DAG_NODES.

    known_node_ids lets T1.2 validate a *new* round's nodes, which may legally
    depend on node ids that already executed in a prior round (not present in
    THIS plan's own node list)."""
    if "nodes" not in raw or not isinstance(raw["nodes"], list):
        raise PlanValidationError("plan JSON missing 'nodes' list")

    if len(raw["nodes"]) > MAX_DAG_NODES:
        raise PlanValidationError(f"plan has {len(raw['nodes'])} nodes, cap is {MAX_DAG_NODES}")

    known_ids = set(known_node_ids)
    nodes = []

    for raw_node in raw["nodes"]:
        for required_key in ("id", "tool", "params", "depends_on"):
            if required_key not in raw_node:
                raise PlanValidationError(f"node missing required key '{required_key}': {raw_node}")

        tool_name = raw_node["tool"]
        if tool_name not in registry:
            raise PlanValidationError(f"unknown tool '{tool_name}' -- not in TOOL_REGISTRY")

        spec = registry[tool_name]
        params = raw_node["params"]
        if not isinstance(params, dict):
            raise PlanValidationError(f"node '{raw_node['id']}' params must be an object")

        refs = raw_node.get("input_param_refs", {})
        missing = spec.required_fields - set(params.keys())
        still_missing = missing - set(refs.keys())
        if still_missing:
            raise PlanValidationError(
                f"node '{raw_node['id']}' missing required params for '{tool_name}': {still_missing}")

        unknown_params = set(params.keys()) - set(spec.input_fields.keys())
        if unknown_params:
            raise PlanValidationError(
                f"node '{raw_node['id']}' has params not in '{tool_name}' schema: {unknown_params}")

        depends_on = raw_node["depends_on"]
        if not isinstance(depends_on, list):
            raise PlanValidationError(f"node '{raw_node['id']}' depends_on must be a list")

        nodes.append(DAGNode(
            node_id=raw_node["id"],
            tool=tool_name,
            params=params,
            depends_on=depends_on,
            round=raw_node.get("round", 0),
            input_param_refs=refs,
        ))

    node_ids = {n.node_id for n in nodes}
    for n in nodes:
        for dep in n.depends_on:
            if dep not in node_ids and dep not in known_ids:
                raise PlanValidationError(
                    f"node '{n.node_id}' depends on '{dep}' which doesn't exist in this "
                    f"plan or in prior-round evidence")

    dag = ExecutionDAG(nodes=nodes)
    if topo_sort(dag) is None:
        raise PlanValidationError("plan contains a dependency cycle")

    return dag


# ---------------------------------------------------------------------------
# The planner LLM call
# ---------------------------------------------------------------------------

def _build_planner_prompt(question: str, routed: dict, registry: dict) -> str:
    tool_lines = []
    for spec in registry.values():
        req = ", ".join(sorted(spec.required_fields)) or "none"
        opt = ", ".join(sorted(set(spec.input_fields) - spec.required_fields)) or "none"
        tool_lines.append(
            f"- {spec.name}: {spec.description}\n"
            f"    required params: {req} | optional params: {opt}\n"
            f"    returns: {spec.output_summary}"
        )
    tools_block = "\n".join(tool_lines)

    return f"""You are planning which read-only data tools to call to answer an F1 race question.

Question: {question}
Extracted entities so far: {json.dumps(routed)}

Available tools:
{tools_block}

Return ONLY a JSON object, no prose, matching exactly this shape:
{{
  "nodes": [
    {{"id": "n1", "tool": "<tool name from the list above>", "params": {{...}}, "depends_on": []}}
  ]
}}

Rules:
- Use ONLY tool names from the list above. Never invent a tool.
- Every param key must be one listed for that tool.
- "depends_on" lists node ids (from this same plan) that must run first.
- Do not exceed {MAX_DAG_NODES} nodes.
- If a required param's value depends on another node's output (not known yet), omit it
  from "params" and add it instead to a sibling key "input_param_refs":
  {{"param_name": "node_id.field"}}.
- If the question cannot be answered with these tools, return {{"nodes": []}}.
"""


def call_llm_json(prompt: str) -> dict:
    """Wire this to the real LLM client already used in llm.py.
    Must return parsed JSON (a dict), not a raw string -- use the client's structured
    output / JSON mode rather than parsing free text (see agent-architecture-v3.md's
    'structured output' section for why that matters)."""
    raise NotImplementedError("wire to the real LLM client")


def plan_dag(question: str, routed: dict, registry: dict) -> ExecutionDAG:
    """T1.1 entry point. Returns a validated ExecutionDAG, or raises
    PlanValidationError. Caller (orchestrator.build_dag) MUST catch
    PlanValidationError and fall back to the template DAG -- this sits behind the
    AGENT_PLANNER_MODE feature flag from T0.2, not a direct cutover."""
    prompt = _build_planner_prompt(question, routed, registry)
    raw = call_llm_json(prompt)
    return validate_plan(raw, registry)
```

### T1.2 — Iterative reasoning loop → `agentic_loop.py` ✅ DONE

**Status (2026-09-03): shipped.** Iterative loop lives in `agentic_loop.py`, dispatched from `orchestrator.run()` under the `AGENT_PLANNER_MODE == "llm"` flag (`_run_agentic` → `run_agentic_dag` → `_compose_agentic`). On `PlanValidationError` or empty evidence it falls back to the template DAG. `build_dag()` now always returns the deterministic template baseline the golden eval measures; the agentic path executes only in `run()`.

**Already decided:**
- Bounded at `MAX_ROUNDS=3`. At the cap we STOP regardless of what `assess_evidence` wants — the existing `verify_evidence` tool decides whether what we have is enough to answer or should be refused. We never loop forever and we never silently answer on partial evidence without going through that gate.
- Every round's tool calls go through the exact same `validate_plan()` from `planner.py` — a second round is not a lower-trust code path than the first.

**Destination in the real repo:** `apps/backend/src/backend/agent/agentic_loop.py` (new file — **shipped**)

`execute_node()` must call the real tools via `bind_params()` from `binding.py`.

> **Real-ship note:** `binding.py` (T1.3) does not exist yet, so the shipped T1.2 binds through the existing `orchestrator._bind_*` functions instead of `bind_params()`. That keeps parameter binding on the exact same path as the template DAG today. When T1.3 lands, `agentic_loop.py` switches to `bind_params()` with no behaviour change expected. Also: the real `planner.py` types are `PlannerDAGNode`/`PlannerExecutionDAG` (not `DAGNode`/`ExecutionDAG`), and `_compose_agentic` is wired into `run()`, not `build_dag()`.

**Implementation contract (full code):**

```python
"""
T1.2 -- Iterative reasoning loop.

Destination in the real repo: apps/backend/src/backend/agent/agentic_loop.py (new file)

WHAT'S ALREADY DECIDED:
  - Bounded at MAX_ROUNDS=3 (agent-architecture-v3.md). At the cap we STOP regardless
    of what assess_evidence wants -- the existing verify_evidence tool decides whether
    what we have is enough to answer or should be refused. We never loop forever and
    we never silently answer on partial evidence without going through that gate.
  - Every round's tool calls go through the exact same validate_plan() from planner.py
    -- a second round is not a lower-trust code path than the first.

WHAT YOU FILL IN:
  1. execute_node() -- call the real tool functions via bind_params() (binding.py).
  2. call_llm_json() -- reused from planner.py, same client-wiring TODO, do it once.
"""

from __future__ import annotations
import typing as t

from planner import (
    ExecutionDAG, DAGNode, PlanValidationError,
    validate_plan, topo_sort, plan_dag, call_llm_json,
)

MAX_ROUNDS = 3


def _summarize(result: t.Any) -> str:
    """Keep the assess-evidence prompt small -- a full telemetry dump would blow the
    context budget every round. Replace with a real per-tool-type summarizer if this
    naive truncation isn't informative enough in practice."""
    s = str(result)
    return s[:500] + ("..." if len(s) > 500 else "")


def _build_assess_prompt(question: str, evidence: dict, registry: dict, round_num: int) -> str:
    evidence_summary = {node_id: _summarize(result) for node_id, result in evidence.items()}
    tool_names = ", ".join(sorted(registry.keys()))
    return f"""You already gathered this evidence for the question below (round {round_num} of {MAX_ROUNDS}):

Question: {question}
Evidence so far: {evidence_summary}

Available tools: {tool_names}

Is this evidence sufficient to answer the question completely and accurately?

Return ONLY JSON:
- If sufficient: {{"satisfied": true}}
- If not, and more tool calls are needed: {{"satisfied": false, "nodes": [ ... same shape as a plan ... ]}}
  New nodes may depend on node ids already listed in "Evidence so far" above -- those
  have already run.

Do not repeat a tool call that already produced evidence you already have.
"""


def assess_evidence(question: str, evidence: dict, registry: dict, round_num: int) -> ExecutionDAG | None:
    """Returns None when satisfied. Returns a validated ExecutionDAG of NEW nodes for
    the next round otherwise. Round-count enforcement lives in the caller (below), not
    here, so this function's own logic stays simple and independently testable."""
    prompt = _build_assess_prompt(question, evidence, registry, round_num)
    raw = call_llm_json(prompt)
    if raw.get("satisfied"):
        return None
    return validate_plan(raw, registry, known_node_ids=evidence.keys())


def execute_node(node: DAGNode, env: dict) -> t.Any:
    """Call the real tool. Must:
      1. resolve node.params + node.input_param_refs into final kwargs via
         binding.py's bind_params() -- do not duplicate that priority logic here.
      2. call the tool function from tools.py.
      3. return its output. Let NotFoundError/DataError propagate per the existing
         convention in types.py -- the loop below treats a raised exception the same
         as a failed dependency, it does not need special-casing here."""
    raise NotImplementedError("wire to real tool execution")


def run_agentic_dag(question: str, routed: dict, registry: dict) -> dict:
    """Top-level T1.1+T1.2 entry point: plan round 0, execute, assess, repeat up to
    MAX_ROUNDS. Returns the accumulated evidence env -- pass this to the existing
    verify_evidence tool exactly as today, unchanged."""
    env: dict = {}

    dag = plan_dag(question, routed, registry)  # raises PlanValidationError -- caller falls back

    round_num = 0
    while True:
        order = topo_sort(dag)
        assert order is not None, "validate_plan() must guarantee this"
        for node_id in order:
            if node_id in env:
                continue  # already executed in a prior round
            node = next(n for n in dag.nodes if n.node_id == node_id)
            env[node_id] = execute_node(node, env)

        round_num += 1
        if round_num >= MAX_ROUNDS:
            break

        try:
            next_dag = assess_evidence(question, env, registry, round_num)
        except PlanValidationError:
            break  # a bad "give me more evidence" plan just means we stop with what we have
        if next_dag is None or not next_dag.nodes:
            break
        dag = next_dag  # only the NEW nodes; already-executed ids are skipped above

    return env
```

### T1.3 — Tool-output interpretation / parameter binding → `binding.py`

**Already decided — the "choose-over-default, never blind-overwrite" rule.** Final value for a given param comes from, in this priority order:
1. An `input_param_ref` resolved from a prior node's output (T1.3's whole point).
2. An explicit value the planner put directly in `node.params`.
3. The existing generic `_bind_<tool>()` default from routed entities (unchanged code).

A param is NEVER silently overwritten with a wrong-typed or missing value — if step 1 fails, fall back to step 2, then step 3, rather than crashing the whole node. `BindError` is only raised when NO source can supply a required value. Ref resolution uses dict/attribute lookup only, never `eval()`.

**Destination in the real repo:** `apps/backend/src/backend/agent/binding.py` (new file)

`existing_default_binder()` must dispatch to the real `_bind_<tool>()` functions already in `orchestrator.py` (~lines 50-226).

**Implementation contract (full code):**

```python
"""
T1.3 -- Tool-output interpretation / parameter binding.

Destination in the real repo: apps/backend/src/backend/agent/binding.py (new file)

WHAT'S ALREADY DECIDED -- the "choose-over-default, never blind-overwrite" rule.
Final value for a given param comes from, in this priority order:
  1. An input_param_ref resolved from a prior node's output (T1.3's whole point)
  2. An explicit value the planner put directly in node.params
  3. The existing generic _bind_<tool>() default from routed entities (unchanged code)
A param is NEVER silently overwritten with a wrong-typed or missing value -- if step 1
fails (referenced node not in env yet, or the field path doesn't resolve), we fall back
to step 2, then step 3, rather than crashing the whole node. BindError is only raised
when NO source can supply a required value.

WHAT YOU FILL IN:
  1. existing_default_binder() -- dispatch to the real _bind_<tool>(routed) functions
     already in orchestrator.py. They already exist; this just needs a lookup table.
"""

from __future__ import annotations
import typing as t

from planner import DAGNode


class BindError(Exception):
    """Raised only when no source (ref, explicit param, or default) can supply a
    required value. Treat this the same as any other single-node failure -- it fails
    this node and its downstream dependents, it does not crash the whole request."""


def _resolve_ref(ref: str, env: dict) -> t.Any:
    """ref format: 'node_id.field' or 'node_id.field.nested'. Resolved via plain
    dict/attribute lookups only -- never eval()'d -- so a malformed ref fails closed
    instead of executing anything."""
    node_id, *path = ref.split(".")
    if node_id not in env:
        raise BindError(f"referenced node '{node_id}' has not executed yet")
    value = env[node_id]
    for part in path:
        if isinstance(value, dict):
            if part not in value:
                raise BindError(f"field '{part}' not found in output of '{node_id}'")
            value = value[part]
        else:
            if not hasattr(value, part):
                raise BindError(f"field '{part}' not found in output of '{node_id}'")
            value = getattr(value, part)
    return value


def existing_default_binder(tool_name: str, routed: dict) -> dict:
    """Dispatch to the real _bind_<tool_name>(routed) functions already in
    orchestrator.py (per agent-architecture-v3.md, lines ~50-226). Example:

        from .orchestrator import (
            _bind_resolve_session, _bind_resolve_driver, ...  # the existing 13
        )
        _BINDERS = {
            "resolve_session": _bind_resolve_session,
            "resolve_driver": _bind_resolve_driver,
            ...
        }
        return _BINDERS[tool_name](routed) if tool_name in _BINDERS else {}

    Returns {} (no defaults) for any tool not in the table -- that's fine, it just
    means priority 3 contributes nothing and priority 1/2 must fully supply the params."""
    return {}


def bind_params(node: DAGNode, env: dict, routed: dict) -> dict:
    """Resolves the final kwargs for a tool call, applying the priority order above.
    Raises BindError only if a required field truly cannot be resolved from any source."""
    defaults = existing_default_binder(node.tool, routed)   # priority 3
    final: dict = dict(defaults)
    final.update(node.params)                                # priority 2, overwrites defaults

    for param_name, ref in node.input_param_refs.items():
        try:
            final[param_name] = _resolve_ref(ref, env)        # priority 1, highest
        except BindError:
            if param_name not in final:
                raise  # nothing else could supply it either -- genuinely missing
            # else: silently keep whatever priority 2/3 already provided
    return final
```

### The test contract → `tests/agent/test_planner.py`

`apps/backend/tests/agent/test_planner.py` exercises the validation/cycle-detection/binding logic against a small FAKE registry and FAKE tool outputs — it doesn't need the real LLM client or real `tools.py`. It IS the contract: once `call_llm_json()` and `execute_node()` are wired to the real implementations, these should still all pass unmodified. If a change to `planner.py`/`agentic_loop.py`/`binding.py` breaks one of these, that's a signal to stop and reconsider, not to edit the test to match.

**Destination in the real repo:** `apps/backend/tests/agent/test_planner.py` (new file; `apps/backend/tests/agent/` is a new directory).

**Full test contract:**

```python
"""
Run with: python -m pytest test_planner.py -v

These tests exercise the validation/cycle-detection/binding logic against a small
FAKE registry and FAKE tool outputs -- they don't need the real LLM client or real
tools.py wired up. They ARE the contract: once you wire call_llm_json() and
execute_node() to the real implementations, these should still all pass unmodified.
If a change to planner.py/agentic_loop.py/binding.py breaks one of these, that's a
signal to stop and reconsider, not to edit the test to match.
"""
import dataclasses
import pytest

from planner import (
    ToolSpec, DAGNode, ExecutionDAG, PlanValidationError,
    validate_plan, topo_sort, MAX_DAG_NODES,
)
from binding import bind_params, BindError, existing_default_binder


# ---------------------------------------------------------------------------
# Fake registry for testing
# ---------------------------------------------------------------------------

@dataclasses.dataclass(frozen=True)
class _ResolveSessionInput:
    year: int
    gp_name: str


@dataclasses.dataclass(frozen=True)
class _GetLapsInput:
    session_key: str
    driver: str = "VER"  # optional, has a default


REGISTRY = {
    "resolve_session": ToolSpec.from_dataclass(
        "resolve_session", "Find a session.", _ResolveSessionInput, "Returns session_key."),
    "get_laps": ToolSpec.from_dataclass(
        "get_laps", "Get lap times.", _GetLapsInput, "Returns lap times list."),
}


# ---------------------------------------------------------------------------
# validate_plan -- happy path
# ---------------------------------------------------------------------------

def test_valid_plan_passes():
    raw = {"nodes": [
        {"id": "n1", "tool": "resolve_session", "params": {"year": 2024, "gp_name": "Spa"}, "depends_on": []},
        {"id": "n2", "tool": "get_laps", "params": {"session_key": "spa2024"}, "depends_on": ["n1"]},
    ]}
    dag = validate_plan(raw, REGISTRY)
    assert len(dag.nodes) == 2
    assert topo_sort(dag) == ["n1", "n2"]


def test_optional_param_can_be_omitted():
    raw = {"nodes": [
        {"id": "n1", "tool": "get_laps", "params": {"session_key": "spa2024"}, "depends_on": []},
    ]}
    dag = validate_plan(raw, REGISTRY)
    assert dag.nodes[0].params == {"session_key": "spa2024"}


# ---------------------------------------------------------------------------
# validate_plan -- rejections
# ---------------------------------------------------------------------------

def test_unknown_tool_rejected():
    raw = {"nodes": [{"id": "n1", "tool": "delete_database", "params": {}, "depends_on": []}]}
    with pytest.raises(PlanValidationError, match="unknown tool"):
        validate_plan(raw, REGISTRY)


def test_missing_required_param_rejected():
    raw = {"nodes": [{"id": "n1", "tool": "resolve_session", "params": {"year": 2024}, "depends_on": []}]}
    with pytest.raises(PlanValidationError, match="missing required params"):
        validate_plan(raw, REGISTRY)


def test_missing_required_param_covered_by_ref_is_allowed():
    raw = {"nodes": [{
        "id": "n1", "tool": "resolve_session", "params": {"year": 2024}, "depends_on": [],
        "input_param_refs": {"gp_name": "n0.gp_name"},
    }]}
    dag = validate_plan(raw, REGISTRY, known_node_ids={"n0"})
    assert dag.nodes[0].input_param_refs == {"gp_name": "n0.gp_name"}


def test_unknown_param_rejected():
    raw = {"nodes": [{
        "id": "n1", "tool": "resolve_session",
        "params": {"year": 2024, "gp_name": "Spa", "sabotage": True}, "depends_on": [],
    }]}
    with pytest.raises(PlanValidationError, match="not in .* schema"):
        validate_plan(raw, REGISTRY)


def test_dangling_dependency_rejected():
    raw = {"nodes": [{
        "id": "n1", "tool": "resolve_session", "params": {"year": 2024, "gp_name": "Spa"},
        "depends_on": ["ghost_node"],
    }]}
    with pytest.raises(PlanValidationError, match="doesn't exist"):
        validate_plan(raw, REGISTRY)


def test_cycle_rejected():
    raw = {"nodes": [
        {"id": "n1", "tool": "get_laps", "params": {"session_key": "x"}, "depends_on": ["n2"]},
        {"id": "n2", "tool": "get_laps", "params": {"session_key": "y"}, "depends_on": ["n1"]},
    ]}
    with pytest.raises(PlanValidationError, match="cycle"):
        validate_plan(raw, REGISTRY)


def test_node_cap_enforced():
    raw = {"nodes": [
        {"id": f"n{i}", "tool": "get_laps", "params": {"session_key": "x"}, "depends_on": []}
        for i in range(MAX_DAG_NODES + 1)
    ]}
    with pytest.raises(PlanValidationError, match="cap is"):
        validate_plan(raw, REGISTRY)


def test_cross_round_dependency_allowed_via_known_node_ids():
    # simulates T1.2: a second-round plan referencing a node that already ran
    raw = {"nodes": [
        {"id": "n2", "tool": "get_laps", "params": {"session_key": "x"}, "depends_on": ["n1"]},
    ]}
    dag = validate_plan(raw, REGISTRY, known_node_ids={"n1"})
    assert dag.nodes[0].depends_on == ["n1"]


def test_cross_round_dependency_rejected_if_truly_unknown():
    raw = {"nodes": [
        {"id": "n2", "tool": "get_laps", "params": {"session_key": "x"}, "depends_on": ["never_existed"]},
    ]}
    with pytest.raises(PlanValidationError, match="doesn't exist"):
        validate_plan(raw, REGISTRY, known_node_ids={"n1"})  # n1 exists, never_existed doesn't


# ---------------------------------------------------------------------------
# bind_params -- priority order (ref > explicit param > default)
# ---------------------------------------------------------------------------

def test_bind_priority_ref_wins_over_explicit_and_default(monkeypatch):
    import binding
    monkeypatch.setattr(binding, "existing_default_binder",
                         lambda tool, routed: {"session_key": "default_val"})

    node = DAGNode(node_id="n2", tool="get_laps",
                    params={"session_key": "explicit_val"}, depends_on=["n1"],
                    input_param_refs={"session_key": "n1.session_key"})
    env = {"n1": {"session_key": "ref_val"}}

    result = bind_params(node, env, routed={})
    assert result["session_key"] == "ref_val"


def test_bind_falls_back_to_explicit_when_ref_unresolvable(monkeypatch):
    import binding
    monkeypatch.setattr(binding, "existing_default_binder", lambda tool, routed: {})

    node = DAGNode(node_id="n2", tool="get_laps",
                    params={"session_key": "explicit_val"}, depends_on=["n1"],
                    input_param_refs={"session_key": "n1.session_key"})
    env = {}  # n1 hasn't executed yet

    result = bind_params(node, env, routed={})
    assert result["session_key"] == "explicit_val"


def test_bind_falls_back_to_default_when_nothing_else_present(monkeypatch):
    import binding
    monkeypatch.setattr(binding, "existing_default_binder",
                         lambda tool, routed: {"session_key": "default_val"})

    node = DAGNode(node_id="n1", tool="get_laps", params={}, depends_on=[])
    result = bind_params(node, env={}, routed={})
    assert result["session_key"] == "default_val"


def test_bind_raises_when_truly_nothing_can_supply_required_value(monkeypatch):
    import binding
    monkeypatch.setattr(binding, "existing_default_binder", lambda tool, routed: {})

    node = DAGNode(node_id="n2", tool="get_laps", params={}, depends_on=["n1"],
                    input_param_refs={"session_key": "n1.session_key"})
    with pytest.raises(BindError):
        bind_params(node, env={}, routed={})  # ref fails, no explicit, no default


def test_bind_ref_never_uses_eval():
    # a malicious/garbled ref should fail closed with BindError, never execute anything
    import binding
    node = DAGNode(node_id="n2", tool="get_laps", params={"session_key": "fallback"},
                    depends_on=["n1"], input_param_refs={"session_key": "n1.__class__.__bases__"})
    env = {"n1": {"session_key": "x"}}
    # "__class__" isn't a real dict key on a dict env value -> BindError -> falls back
    result = bind_params(node, env, routed={})
    assert result["session_key"] == "fallback"


# ---------------------------------------------------------------------------
# run_agentic_dag -- round bounding (T1.2), using fakes for the LLM + tool calls
# ---------------------------------------------------------------------------

def test_round_bounding_stops_at_max_rounds(monkeypatch):
    import planner
    import agentic_loop

    call_count = {"n": 0}

    def fake_call_llm_json(prompt: str) -> dict:
        call_count["n"] += 1
        if "Evidence so far" not in prompt:
            # round-0 plan call
            return {"nodes": [{"id": "n1", "tool": "get_laps",
                                "params": {"session_key": "x"}, "depends_on": []}]}
        # assess_evidence call -- always asks for more, to prove we still stop at the cap
        return {"satisfied": False, "nodes": [
            {"id": f"n_extra_{call_count['n']}", "tool": "get_laps",
             "params": {"session_key": "y"}, "depends_on": []}
        ]}

    monkeypatch.setattr(planner, "call_llm_json", fake_call_llm_json)
    monkeypatch.setattr(agentic_loop, "call_llm_json", fake_call_llm_json)
    monkeypatch.setattr(agentic_loop, "execute_node", lambda node, env: {"laps": [1, 2, 3]})

    env = agentic_loop.run_agentic_dag("why did VER pit early", routed={}, registry=REGISTRY)

    # must have stopped -- never an infinite loop -- and must not exceed MAX_ROUNDS
    # worth of assess_evidence calls even though fake_call_llm_json always says "not satisfied"
    assert len(env) <= MAX_DAG_NODES  # sane upper bound, real assertion is it terminated at all
    assert call_count["n"] <= 1 + agentic_loop.MAX_ROUNDS  # 1 plan call + <=MAX_ROUNDS assess calls
```

---

## Tier 2 — Memory & robustness (T2.1–T2.3)

**T2.1, T2.2, and T2.3 shipped (2026-09-06).** Full feedback landed in the retry + complexity work: `RetryableError` (distinct from `NotFoundError`/`DataError`) with a capped 3-attempt / 200·400·800ms backoff that never retries permanent data errors and stays SSE-transparent (one trace record per node); and a router-computed `complexity` score (1–5) carried on `RoutedQuestion` that steers the planner's node budget and prunes un-consumed heavy-telemetry leaves on simple questions while `verify_evidence` always survives. Backend test suite at **285 passing**.

- **T2.1 — Long-term memory + RAG:** wiring the unused `race_vector_index_dir`/`race_vector_table` config; durable per-user memory; memory is grounding, not authority; recalled facts must still pass `verify_evidence`. Ships the `DELETE /api/v1/agent/memory` endpoint required by T0.6.
- **T2.2 — Retry with backoff:** `RetryableError` distinct from `NotFoundError`/`DataError`; retries transients (max 3, 200/400/800ms), never `NotFoundError`/`DataError`; transparent to SSE.
- **T2.3 — Adaptive complexity:** DAG depth matched to question difficulty via router-scored complexity; complexity is a steered *cap*, not a hard rule; `verify_evidence` always remains.

**Note on the implementation ownership split from v2:** T2.1 was intentionally built as a *teaching exercise* — the human wrote each function with Claude providing the exact file/line/code, and both T2.2 and T2.3 were implemented by the human from line-precise lessons and cold-fixed when tests surfaced off-by-one / missing-import bugs (retry's 4-attempt vs 3-attempt threshold; `dataclasses.replace` not imported in the router). This satisfies v2's ownership guidance in practice: T2.1/T2.3 (grounding + pruning judgment) were Claude-verified, and T2.2's mechanical retry logic was effectively delegated.

---

## Tier 3 — Quality & cost (T3.1–T3.3)

Unchanged from v2. **T3.1 (feedback UI+persistence) and T3.3 (structured-output validation) are safe delegation candidates.** T3.2 (cost routing) is a judgment call about model tiers per intent — cheap to get wrong quietly (over-routing to the expensive model defeats the point) — recommend Claude reviews the routing table even if a cheaper model writes the mechanical code.

- **T3.1 — User feedback loop:** rate answers, persist per-run ratings, optionally feed back into composer/planner.
- **T3.2 — Cost routing:** simple intents → cheap/fast model, complex analytical → capable model, via per-model-tier config.
- **T3.3 — Structured-output validation:** validate every LLM-produced structure against a schema before use; malformed output → typed `LLMError` → clean fallback, never a 500.

Full specs are in **v2** — T3.1, T3.2, T3.3 sections are unchanged from that doc.

---

## Implementation ownership — the actual answer to "can a cheaper model write this as well"

| Item | Owner | Why |
|---|---|---|
| T0.1–T0.5 | Claude | Foundational safety infra; a subtle bug here undermines every tier above it |
| T1.1, T1.2, T1.3 | Claude | Judgment-heavy, high blast radius, hard to unit-test correctness of "is this a good plan" |
| T2.1 (memory/RAG) | Claude (shipped 2026-09-06) | Privacy + grounding correctness; recalled facts must still pass the evidence gate |
| T2.2 (retry/backoff) | Delegatable (shipped 2026-09-06) | Narrow, mechanical, clear acceptance criteria (3 attempts, capped backoff) |
| T2.3 (adaptive complexity) | Claude reviews, cheaper model can draft (shipped 2026-09-06) | Pruning logic risks silently dropping needed evidence |
| T3.1 (feedback loop) | Delegatable | Standard CRUD + a UI control, low blast radius |
| T3.2 (cost routing) | Claude reviews routing table | Easy to get subtly wrong (wrong model on wrong intent) without it being an obvious bug |
| T3.3 (structured-output validation) | Delegatable | Mechanical schema-validation wrapper, testable in isolation |

**The thing that makes delegation safe at all, regardless of tier:** the T0.1 golden eval set. Once it exists, *any* change — yours, mine, or a cheaper model's — has an objective pass/fail gate instead of depending on trusting whoever wrote the code. Build T0.1 first for exactly this reason.

---

## Industry patterns — what this architecture is actually built on, and who uses it

Knowing the name and origin of a pattern is also directly useful in interviews: it signals you understand the design space, not just your own implementation of it.

### Tool/function calling
**What it is:** the LLM emits a structured request ("call `get_lap_evolution` with these params") instead of free text, which your code then executes. **Origin:** OpenAI's function calling API (2023) and Anthropic's tool use API formalized this as a first-class capability; before that, people hand-rolled it by asking the model to emit JSON and parsing it themselves (fragile). **Who uses it:** essentially every production LLM agent today — this is the primitive everything else in your doc is built on.

### ReAct (Reason + Act)
**What it is:** interleave reasoning ("I think I need X") with tool calls ("call tool X"), observe the result, reason again. Your T1.2 iterative reasoning loop is a bounded, safety-constrained version of this. **Origin:** a 2022 research paper (Yao et al., Princeton/Google) that's become the default mental model for agent loops. **Who uses it:** LangChain's agent executors, most "agentic" products you've seen demoed are ReAct or a close variant, gated to prevent infinite loops the way your `max_rounds=3` does.

### Plan-and-execute (vs. ReAct)
**What it is:** generate the *whole* plan upfront (your T1.1), then execute it, rather than deciding one step at a time. Generally cheaper and more predictable than pure ReAct, at the cost of being less adaptive mid-execution — which is exactly why T1.3 (mid-execution parameter adjustment) exists as a middle ground between the two. **Who uses it:** LangGraph's plan-and-execute template, most production agents that care about cost/latency predictability lean this direction rather than pure step-by-step ReAct.

### Structured output / schema-constrained generation
**What it is:** forcing the LLM's output into a validated schema (JSON Schema/Pydantic) instead of hoping it formats correctly. Your `plan_dag` needing "schema-constrained" output and your `_coerce_*`/`_clean_*` helpers are this. **Origin/current state:** OpenAI's "Structured Outputs" mode and Anthropic's tool-use schemas do this natively now; the `instructor` Python library (wraps Pydantic around LLM calls) is the most widely used third-party version. **Who uses it:** anyone shipping LLM output into a system that can't tolerate malformed JSON — which is any production agent, including yours.

### Evidence grounding / RAG-as-verification (not just RAG-as-retrieval)
**What it is:** your evidence gate is doing something slightly different from classic RAG — it's not retrieving context to answer with, it's *verifying* the answer is backed by real tool output before allowing it out. **Who uses it:** Perplexity's citation-required answers, most enterprise RAG products that got burned by hallucination early on now have some form of "refuse if ungrounded" gate, same principle as your `verify_evidence` terminal node.

### LLM evals as first-class engineering practice
**What it is:** treating prompt/agent behavior like code that needs tests — your T0.1 golden set. **Who uses it / tooling:** this is now a whole product category — OpenAI Evals, Braintrust, LangSmith, Humanloop, W&B Weave. The pattern all of them formalize: fixed question set, expected behavior, regression score, gate merges on it. Your T0.1 is a lightweight version of exactly this — you don't need the paid tooling to get the core benefit at your scale.

### Circuit breaker
**What it is:** stop calling a failing dependency after N consecutive failures, degrade gracefully, periodically retry. **Origin:** distributed systems pattern, popularized by Netflix's Hystrix library for microservices. **Why it applies here:** an LLM API is just another external dependency that can go down; treating it with the same discipline you'd treat a flaky database is the right instinct, and it's increasingly standard in production agent systems that can't afford to fully die when one provider blips.

### Model cascades / cost-based routing
**What it is:** your T3.2 — route cheap/fast models to simple queries, escalate to a stronger model only when needed. **Who uses it:** OpenRouter and similar routing services productize this; most serious AI product teams do some internal version of it because a flat "always use the biggest model" bill doesn't scale. Research term to know: "LLM cascades."

### Human feedback loops
**What it is:** your T3.1 thumbs up/down. Simple version of the same idea behind RLHF (reinforcement learning from human feedback), just used here as a product signal rather than a training signal. **Who uses it:** virtually every consumer AI product (ChatGPT, Claude, etc.) collects this; you don't need to retrain a model to get value from it — even just surfacing "which tool chains get thumbs-down" is useful product signal at your scale.

### Observability/tracing for agents
**Not yet in your roadmap — worth adding as a T3 item.** Production agent systems increasingly emit OpenTelemetry-style traces per tool call (span per node, same idea as microservice tracing) so you can debug *why* a specific answer came out wrong after the fact. Tools in this space: Langfuse, Arize Phoenix, LangSmith's tracing view. Your SSE protocol already streams `node_start`/`node_complete` events — piping those into a persistent trace store (even just structured logs to start) gets you most of this value cheaply, and it directly helps you debug T1.1 once it's live.

---

## Suggested build order

1. ~~**T0.1** (golden eval set)~~ — done.
2. ~~**T0.3 + T0.4 + T0.5** (resource caps, rate limit, circuit breaker)~~ — done.
3. ~~**T0.2** (feature flag)~~ — done.
4. ~~**T1.1** behind the flag~~ — done, validated against T0.1, flag defaults to "template".
5. ~~**T1.2** (capped iterative loop, dispatched in `run()`)~~ — done; golden-eval / template baseline still green (256 tests pass). Next: eval the llm path against the golden set before relying on it.
6. **T1.3** (parameter binding → `binding.py`) — same pattern, same gate; `agentic_loop.py` currently binds via `orchestrator._bind_*`, this extracts it to `bind_params()`.
7. ~~**T2.1** / **T2.2** / **T2.3**~~ — done (2026-09-06), with T0.6's retention/delete path (`DELETE /api/v1/agent/memory`). Full backend suite at 285 passing.
8. **T3.1/T3.2/T3.3** — lowest risk, best delegation candidates, do these whenever, in any order.

---

## Conventions — do not break these

- Tools live in `tools.py`; contracts in `types.py`; SQL is always `text()` + `:param` binds, never f-strings.
- Every tool: one frozen input dataclass → one frozen output dataclass.
- Typed errors: `NotFoundError` = data not found, `DataError` = unusable/unsupported. New code adds `PlanValidationError` and `BindError` for the T1.1–T1.3 planning/binding layer.
- SQL gathers, pure Python derives. Pure helpers take `list[dict]` and no DB.
- `ORDER BY` everywhere, `round(x, 2)` for computed numbers.
- `extensions.engine` only accessible inside `create_app()`. Standalone scripts use `create_engine(settings.db_url)` directly.
- House quality: `uv run ruff check`, `uv run ruff format --check`, `uv run pytest apps/backend/tests/`, `pnpm lint`, `pnpm tsc --noEmit`, `pnpm build`.
