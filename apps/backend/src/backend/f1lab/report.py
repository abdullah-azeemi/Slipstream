"""Ready-made analyses built on pace, pit and sanity. Pure functions.

These are the standard, tested versions of what an analyst script usually
needs, so a model (or a person) does not have to re-derive them each time.
"""

from __future__ import annotations

from dataclasses import dataclass

from backend.f1lab import sanity
from backend.f1lab.pace import (
    FUEL_EFFECT_S_PER_LAP,
    clean_laps,
    fit_degradation,
    fuel_correct,
)
from backend.f1lab.pit import PitLoss, pit_losses, summarize_green

_COLORS = ("#3d7f8a", "#d9822b", "#7a5aa6", "#4c9a6a", "#c4574c")


@dataclass(frozen=True)
class StintDeg:
    stint: int
    compound: str | None
    laps: int  # clean laps used in the fit
    first_lap: int
    last_lap: int
    raw_slope_s_per_lap: float  # no fuel correction (what a naive fit gives)
    corrected_slope_s_per_lap: float  # after fuel correction: the tyre degradation
    r2: float  # of the corrected fit; low means treat the slope as indicative
    issues: tuple[str, ...]  # codes from sanity.check_degradation


def _stints(laps: list[dict]) -> list[int]:
    return sorted({lap["stint"] for lap in laps if lap.get("stint") is not None})


def degradation_by_stint(
    laps: list[dict],
    total_laps: int,
    *,
    effect_s_per_lap: float = FUEL_EFFECT_S_PER_LAP,
    min_laps: int = 5,
) -> list[StintDeg]:
    """Cleaned, fuel-corrected degradation for each stint of ONE driver."""
    results: list[StintDeg] = []
    for stint in _stints(laps):
        stint_laps = [lap for lap in laps if lap.get("stint") == stint]
        clean = clean_laps(stint_laps)
        corrected = fuel_correct(clean, total_laps, effect_s_per_lap=effect_s_per_lap)
        raw_fit = fit_degradation(clean, min_laps=min_laps)
        fit = fit_degradation(corrected, min_laps=min_laps)
        if raw_fit is None or fit is None:
            continue
        issues = tuple(
            i.code
            for i in sanity.check_degradation(fit.slope_s_per_lap, fuel_corrected=True)
        )
        results.append(
            StintDeg(
                stint=stint,
                compound=stint_laps[0].get("compound"),
                laps=fit.laps,
                first_lap=corrected[0]["lap_number"],
                last_lap=corrected[-1]["lap_number"],
                raw_slope_s_per_lap=raw_fit.slope_s_per_lap,
                corrected_slope_s_per_lap=fit.slope_s_per_lap,
                r2=fit.r2,
                issues=issues,
            )
        )
    return results


def degradation_chart(
    laps: list[dict],
    total_laps: int,
    *,
    effect_s_per_lap: float = FUEL_EFFECT_S_PER_LAP,
    min_laps: int = 5,
) -> dict:
    """ECharts option: fuel-corrected lap times per stint with the fitted lines."""
    series: list[dict] = []
    for i, stint in enumerate(_stints(laps)):
        stint_laps = [lap for lap in laps if lap.get("stint") == stint]
        corrected = fuel_correct(
            clean_laps(stint_laps), total_laps, effect_s_per_lap=effect_s_per_lap
        )
        fit = fit_degradation(corrected, min_laps=min_laps)
        if fit is None:
            continue
        color = _COLORS[i % len(_COLORS)]
        name = (
            f"Stint {stint} {str(stint_laps[0].get('compound') or '').title()}".strip()
        )
        first, last = corrected[0]["lap_number"], corrected[-1]["lap_number"]
        series.append(
            {
                "name": name,
                "type": "scatter",
                "symbolSize": 6,
                "itemStyle": {"color": color},
                "data": [
                    [lap["lap_number"], round(lap["lap_time_ms"] / 1000, 3)]
                    for lap in corrected
                ],
            }
        )
        series.append(
            {
                "name": f"{name} fit",
                "type": "line",
                "showSymbol": False,
                "lineStyle": {"color": color, "width": 2},
                "data": [
                    [first, round(fit.intercept_s, 3)],
                    [
                        last,
                        round(
                            fit.intercept_s + fit.slope_s_per_lap * (last - first), 3
                        ),
                    ],
                ],
            }
        )
    return {
        "tooltip": {"trigger": "item"},
        "legend": {"top": 0},
        "xAxis": {"type": "value", "name": "Lap", "min": "dataMin"},
        "yAxis": {
            "type": "value",
            "name": "Fuel-corrected lap time (s)",
            "scale": True,
        },
        "series": series,
    }


def pit_summary(laps_by_driver: dict[str, list[dict]], total_laps: int) -> dict:
    """Pit stops for several drivers: every stop plus the green-flag summary.

    laps_by_driver maps a label (e.g. 'HAM') to that driver's laps.
    """
    stops: list[tuple[str, PitLoss]] = [
        (label, stop)
        for label, laps in laps_by_driver.items()
        for stop in pit_losses(laps, total_laps)
    ]
    return {
        "stops": [
            {
                "driver": label,
                "lap_in": stop.lap_in,
                "lap_out": stop.lap_out,
                "condition": stop.condition,
                "loss_s": None if stop.loss_s is None else round(stop.loss_s, 2),
                "issues": [
                    i.code for i in sanity.check_pit_loss(stop.loss_s, stop.condition)
                ],
            }
            for label, stop in stops
        ],
        "green": summarize_green([stop for _, stop in stops]),
    }
