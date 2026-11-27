"""Log a saved eval results file to a local MLflow: one run per file, one trace per question.

Free and offline: it reads a file that already exists, calls no model, and re-scores
with the current scorer. MLflow is not a project dependency, so ask uv for it. Keep
the version pinned: an older MLflow refuses a database made by a newer one.

    cd apps/backend
    uv run --no-project --with mlflow==3.18.0 python evals/to_mlflow.py evals/results/<file>.json
    uv run --no-project --with mlflow==3.18.0 mlflow ui --backend-store-uri sqlite:///../../mlruns/mlflow.db
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# MLflow reports anonymous usage by default; this store is local and stays that way.
os.environ.setdefault("MLFLOW_DISABLE_TELEMETRY", "true")

import mlflow  # noqa: E402

from evals import score as scoring  # noqa: E402
from evals.spans import spans_of  # noqa: E402

STORE = Path(__file__).resolve().parents[3] / "mlruns"  # gitignored
EXPERIMENT = "pitwall-analyst-eval"


def _log_trace(record: dict, question: str, passed: bool) -> bool:
    spans = spans_of(record.get("events") or [])
    if not spans:
        return False
    # events carry times relative to the run start, so place the trace ending now
    zero = time.time_ns() - max(s["end_ms"] for s in spans) * 1_000_000
    root = mlflow.start_span_no_context(
        name=record["id"],
        span_type="AGENT",
        inputs={"question": question},
        tags={"question_id": record["id"], "passed": str(passed)},
        start_time_ns=zero,
    )
    for s in spans:
        child = mlflow.start_span_no_context(
            name=s["name"],
            span_type=s["kind"],
            parent_span=root,
            inputs=s["inputs"],
            attributes=s["attributes"],
            start_time_ns=zero + s["start_ms"] * 1_000_000,
        )
        child.end(
            outputs=s["outputs"],
            status="OK" if s["ok"] else "ERROR",
            end_time_ns=zero + s["end_ms"] * 1_000_000,
        )
    root.end(outputs={"answer": record.get("answer", "")})
    return True


def main(path: Path) -> None:
    data = json.loads(path.read_text())
    questions = {q["id"]: q for q in scoring.load_questions()}
    records = [r for r in data["runs"] if r["id"] in questions]
    scores = [scoring.score_run(questions[r["id"]], r) for r in records]

    STORE.mkdir(exist_ok=True)
    mlflow.set_tracking_uri(f"sqlite:///{STORE / 'mlflow.db'}")
    if mlflow.get_experiment_by_name(EXPERIMENT) is None:
        mlflow.create_experiment(
            EXPERIMENT, artifact_location=(STORE / "artifacts").as_uri()
        )
    mlflow.set_experiment(EXPERIMENT)

    with mlflow.start_run(run_name=path.stem):
        meta = data.get("meta", {})
        mlflow.log_params(
            {
                "engine": meta.get("engine", "unknown"),
                "model": meta.get("model", "unknown"),
                "questions": len(records),
            }
        )
        for tier, block in scoring.summarize(scores).items():
            for name, value in block.items():
                mlflow.log_metric(f"{tier}.{name}", value)
        mlflow.log_table(
            {
                "id": [s.id for s in scores],
                "passed": [s.passed for s in scores],
                "failures": ["; ".join(s.failures) for s in scores],
                "cost_usd": [s.cost_usd for s in scores],
                "latency_s": [s.latency_s for s in scores],
            },
            artifact_file="questions.json",
        )
        mlflow.log_artifact(str(path))
        traced = sum(
            _log_trace(r, questions[r["id"]]["question"], s.passed)
            for r, s in zip(records, scores)
        )
    mlflow.flush_trace_async_logging()
    print(
        f"logged {path.name}: {sum(s.passed for s in scores)}/{len(scores)} passed, {traced} traces"
    )


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(Path(sys.argv[1]))
