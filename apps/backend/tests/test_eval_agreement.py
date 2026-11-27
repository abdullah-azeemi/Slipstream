"""Does the scorer agree with a hand check? Saved answers, no model calls, no cost.

The verdicts come from checking each answer against the database on 2026-11-07.
A change to the scorer or the questions that moves a verdict fails this test.
"""

import json
from pathlib import Path

from evals import score

FIXTURE = Path(__file__).parent / "fixtures" / "eval_labelled_runs.json"

# Wrong or partial answers the scorer still passes. Remove an entry once it is fixed.
KNOWN_FALSE_PASSES = {
    ("20261107-205334", "sup-01"),  # right numbers, wrong reading of them
    ("20261107-205334", "sup-03"),  # counts 4 messages as 4 safety car periods
}


def _disagreements():
    questions = {q["id"]: q for q in score.load_questions()}
    false_pass, false_fail = set(), set()
    for run in json.loads(FIXTURE.read_text()):
        passed = score.score_run(questions[run["id"]], run).passed
        if passed != run["correct"]:
            (false_pass if passed else false_fail).add((run["source"], run["id"]))
    return false_pass, false_fail


def test_no_correct_answer_is_failed():
    assert _disagreements()[1] == set()


def test_only_the_known_wrong_answers_are_passed():
    assert _disagreements()[0] == KNOWN_FALSE_PASSES
