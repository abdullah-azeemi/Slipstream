"""Run the answer-quality eval against the live agent.

Calls the real orchestrator, so it hits the configured database and the LLM
provider (costs money). Start small:

    uv run --project apps/backend python apps/backend/evals/run_eval.py --limit 3
    uv run --project apps/backend python apps/backend/evals/run_eval.py --dry-run
    uv run --project apps/backend python apps/backend/evals/run_eval.py --rescore <results.json>
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from evals import score as scoring  # noqa: E402

RESULTS_DIR = Path(__file__).parent / "results"


def _select(questions: list[dict], args: argparse.Namespace) -> list[dict]:
    if args.ids:
        wanted = set(args.ids)
        questions = [q for q in questions if q["id"] in wanted]
    if args.tier:
        questions = [q for q in questions if q["tier"] == args.tier]
    return questions[: args.limit] if args.limit else questions


def _run_one(question: str) -> dict:
    from backend.agent import orchestrator

    started = time.perf_counter()
    try:
        answer = orchestrator.run(question)
        record = asdict(answer)
    except Exception as exc:  # a crash is a failed run, not a crashed eval
        record = {"answer": "", "refusals": [], "trace": [], "crash": repr(exc)}
    record["latency_s"] = round(time.perf_counter() - started, 2)
    return record


def _print_report(scores: list[scoring.QuestionScore]) -> None:
    for s in scores:
        mark = "PASS" if s.passed else "FAIL"
        print(f"[{mark}] {s.id:<8} {s.tier:<10} {s.latency_s:>6.1f}s ${s.cost_usd:.4f}")
        for failure in s.failures:
            print(f"        - {failure}")
    print(json.dumps(scoring.summarize(scores), indent=2))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, help="run only the first N questions")
    parser.add_argument("--ids", nargs="+", help="run only these question ids")
    parser.add_argument("--tier", choices=scoring.TIERS)
    parser.add_argument("--dry-run", action="store_true", help="validate and list, no calls")
    parser.add_argument("--rescore", type=Path, help="re-score a saved results file")
    args = parser.parse_args()

    questions = scoring.load_questions()
    by_id = {q["id"]: q for q in questions}

    if args.rescore:
        runs = json.loads(args.rescore.read_text())["runs"]
        scores = [scoring.score_run(by_id[r["id"]], r) for r in runs if r["id"] in by_id]
        _print_report(scores)
        return 0

    selected = _select(questions, args)
    if args.dry_run:
        for q in selected:
            print(f"{q['id']:<8} {q['tier']:<10} {q['question']}")
        print(f"{len(selected)} of {len(questions)} questions valid")
        return 0

    from backend import create_app

    create_app()  # sets extensions.engine, which every tool reads

    runs: list[dict] = []
    scores: list[scoring.QuestionScore] = []
    for q in selected:
        print(f"running {q['id']} ...", flush=True)
        run = _run_one(q["question"])
        run["id"] = q["id"]
        runs.append(run)
        scores.append(scoring.score_run(q, run))

    RESULTS_DIR.mkdir(exist_ok=True)
    out = RESULTS_DIR / f"{datetime.now():%Y%m%d-%H%M%S}.json"
    out.write_text(
        json.dumps(
            {"summary": scoring.summarize(scores), "runs": runs},
            indent=2,
            default=str,
        )
    )
    _print_report(scores)
    print(f"saved {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
