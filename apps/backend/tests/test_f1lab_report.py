import json

import pytest

from backend.f1lab.report import degradation_by_stint, degradation_chart, pit_summary

TOTAL = 57


def _stint_laps(stint, first, n, deg, fuel=0.05, compound="SOFT"):
    return [
        {
            "lap_number": lap,
            "lap_time_ms": round(
                (95.0 + deg * (lap - first) + fuel * (TOTAL - lap)) * 1000
            ),
            "stint": stint,
            "compound": compound,
        }
        for lap in range(first, first + n)
    ]


def test_degradation_by_stint_recovers_each_stints_true_slope():
    laps = _stint_laps(1, 2, 15, 0.04, compound="MEDIUM") + _stint_laps(2, 20, 25, 0.10)
    first, second = degradation_by_stint(laps, TOTAL)
    assert (first.stint, first.compound, second.compound) == (1, "MEDIUM", "SOFT")
    assert first.corrected_slope_s_per_lap == pytest.approx(0.04, abs=1e-3)
    assert second.corrected_slope_s_per_lap == pytest.approx(0.10, abs=1e-3)
    assert first.raw_slope_s_per_lap == pytest.approx(-0.01, abs=1e-3)  # fuel hides it
    assert second.r2 > 0.99 and second.issues == ()


def test_short_stints_are_skipped_and_implausible_ones_are_flagged():
    laps = _stint_laps(1, 2, 3, 0.04) + _stint_laps(2, 10, 20, -0.2)
    results = degradation_by_stint(laps, TOTAL)
    assert [r.stint for r in results] == [2]
    assert results[0].issues == ("deg_negative_corrected",)


def test_chart_is_json_serialisable_with_a_scatter_and_a_fit_per_stint():
    laps = _stint_laps(1, 2, 15, 0.04) + _stint_laps(2, 20, 25, 0.10)
    option = degradation_chart(laps, TOTAL)
    json.dumps(option)
    assert [s["type"] for s in option["series"]] == [
        "scatter",
        "line",
        "scatter",
        "line",
    ]


def test_chart_with_no_usable_stint_has_no_series():
    assert degradation_chart(_stint_laps(1, 2, 3, 0.04), TOTAL)["series"] == []


def _driver(stop_in, extra_s):
    laps = []
    for lap in range(2, 40):
        t = (
            95.0
            + 0.05 * (TOTAL - lap)
            + (extra_s if lap in (stop_in, stop_in + 1) else 0)
        )
        row = {
            "lap_number": lap,
            "lap_time_ms": round(t * 1000),
            "stint": 1 if lap <= stop_in else 2,
        }
        if lap == stop_in:
            row["pit_in_time_ms"] = 1
        if lap == stop_in + 1:
            row["pit_out_time_ms"] = 1
        laps.append(row)
    return laps


def test_pit_summary_lists_stops_and_summarises_green_ones():
    summary = pit_summary({"HAM": _driver(15, 11.0), "LEC": _driver(20, 12.0)}, TOTAL)
    assert [(s["driver"], s["lap_in"]) for s in summary["stops"]] == [
        ("HAM", 15),
        ("LEC", 20),
    ]
    assert summary["stops"][0]["loss_s"] == pytest.approx(22.0, abs=0.01)
    assert summary["green"]["n"] == 2 and summary["green"]["median_s"] == pytest.approx(
        23.0, abs=0.01
    )
    json.dumps(summary)
