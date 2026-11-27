"""Facts for a simple race question, selected and computed by code.

A small model misreads a 22-driver table, so it never gets one. Code picks the
drivers the question names, computes fastest laps and weather, and writes short
sentences. The model only words the answer.
"""

from __future__ import annotations

import re

from sqlalchemy import text

from backend.analyst.prepare import Plan
from backend.analyst.tools import ToolBox
from backend.f1lab import data, report

_STATUS = {"4": "Safety car", "6": "Virtual safety car", "5": "Red flag"}
_ASKED_LAP = re.compile(r"\blap (\d+)\b", re.I)


def _fastest(laps: list[dict]) -> dict | None:
    timed = [lap for lap in laps if lap.get("lap_time_ms") and not lap.get("deleted")]
    return min(timed, key=lambda lap: lap["lap_time_ms"], default=None)


def _lap_time(lap: dict) -> str:
    return f"{lap['lap_time_ms'] / 1000:.3f} s on lap {lap['lap_number']}"


def _driver_lines(row: dict, name: str, own: list[dict]) -> list[str]:
    stops = [
        f"lap {s['lap_in']} ({s['condition']}"
        + (f", {s['loss_s']} s lost" if s["loss_s"] is not None else "")
        + ")"
        for s in row["stops"]
    ]
    lines = [
        f"{name}: finished P{row['final_position']} and completed {row['laps']} laps.",
        f"{name} tyres in order: {' then '.join(row['compounds'])}.",
        f"{name} pit stops: {len(stops)}"
        + (f", on {'; '.join(stops)}." if stops else "."),
    ]
    best = _fastest(own)
    if best:
        lines.append(f"{name} fastest lap: {_lap_time(best)}.")
    return lines


def _elapsed(own: list[dict], number: int) -> float | None:
    """Race time at the end of a lap, or None when any lap up to it has no time."""
    times = {lap["lap_number"]: lap.get("lap_time_ms") for lap in own}
    wanted = [times.get(n) for n in range(1, number + 1)]
    return None if not wanted or None in wanted else sum(wanted) / 1000


def _gap_line(
    first: int, second: int, number: int, own: dict, names: dict
) -> str | None:
    a, b = _elapsed(own[first], number), _elapsed(own[second], number)
    if a is None or b is None:
        return None
    behind, ahead = (first, second) if a > b else (second, first)
    return (
        f"At the end of lap {number}, {names[behind]} was {abs(a - b):.3f} s "
        f"behind {names[ahead]}."
    )


def _track_status_line(leader_laps: list[dict]) -> str:
    found = []
    for code, label in _STATUS.items():
        on = [
            lap["lap_number"]
            for lap in leader_laps
            if code in str(lap.get("track_status") or "")
        ]
        if on:
            found.append(f"{label} on laps {', '.join(map(str, on))}")
    return "Interruptions: " + ("; ".join(found) if found else "none recorded") + "."


def race_digest(question: str, plan: Plan, session: dict, toolbox: ToolBox) -> str:
    key = session["session_key"]
    with toolbox.conn_factory() as conn:
        laps = data.load_laps(conn, key, include_deleted=True)
        roster = conn.execute(
            text(
                "SELECT driver_number, abbreviation, full_name FROM drivers "
                "WHERE session_key = :sk"
            ),
            {"sk": key},
        ).all()
        asked = [data.resolve_driver_number(conn, key, d) for d in plan.drivers]
        weather = conn.execute(
            text(
                "SELECT avg(air_temp_c), avg(track_temp_c), bool_or(rainfall) "
                "FROM weather_events WHERE session_key = :sk"
            ),
            {"sk": key},
        ).one()

    codes = {row[0]: row[1] for row in roster}
    names = {row[0]: f"{row[2]} ({row[1]})" for row in roster}
    summary = report.race_summary(laps, codes)
    rows = {row["driver"]: row for row in summary["drivers"]}
    number_of = {code: number for number, code in codes.items()}
    own: dict[int, list[dict]] = {}
    for lap in laps:
        own.setdefault(lap["driver_number"], []).append(lap)
    order = [number_of[row["driver"]] for row in summary["drivers"]]

    lines = [
        f"{session['year']} {session['gp_name']}, race of {summary['race_laps']} laps. "
        "Positions come from lap data, not official results.",
        f"Winner: {names[order[0]]}.",
        "Top three: "
        + ", ".join(f"P{i} {names[n]}" for i, n in enumerate(order[:3], 1))
        + ".",
    ]
    best = _fastest(laps)
    if best:
        lines.append(
            f"Fastest lap of the race: {names[best['driver_number']]}, "
            f"{_lap_time(best)}."
        )
    named = list(dict.fromkeys(n for n in asked if n in own))
    for number in named:
        lines += _driver_lines(rows[codes[number]], names[number], own[number])
    if len(named) == 2:
        asked_lap = _ASKED_LAP.search(question)
        both = min(max(lap["lap_number"] for lap in own[n]) for n in named)
        at_lap = int(asked_lap[1]) if asked_lap else both
        if gap := _gap_line(*named, at_lap, own, names):
            lines.append(gap)
    lines.append(_track_status_line(own[order[0]]))
    air, track, rain = weather
    if air is not None:
        lines.append(
            f"Weather: average air temperature {float(air):.2f} °C, average track "
            f"temperature {float(track):.2f} °C. "
            + ("Rain was recorded." if rain else "No rain was recorded.")
        )
    if match := _ASKED_LAP.search(question):
        number = int(match[1])
        at = sorted(
            (
                lap
                for lap in laps
                if lap["lap_number"] == number and lap.get("position")
            ),
            key=lambda lap: lap["position"],
        )
        if at and at[0]["position"] == 1:
            lines.append(f"Leader on lap {number}: {names[at[0]['driver_number']]}.")
        for lap in at:
            if lap["driver_number"] in asked:
                time = (
                    f", lap time {lap['lap_time_ms'] / 1000:.3f} s"
                    if lap.get("lap_time_ms")
                    else ""
                )
                lines.append(
                    f"Lap {number}: {names[lap['driver_number']]} was "
                    f"P{lap['position']}{time}."
                )
    return "\n".join(lines)
