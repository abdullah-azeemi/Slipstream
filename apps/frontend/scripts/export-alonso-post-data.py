"""Export the numbers behind the Alonso / Brazil 2026 blog post to static JSON.

Run once (read-only against DATABASE_URL), commit the JSON, and the post's
charts render from it with no database or API in production:

    DATABASE_URL=... uv run --with 'psycopg[binary]' python scripts/export-alonso-post-data.py
"""
import json
import os
import pathlib
import re

import psycopg

OUT = pathlib.Path(__file__).resolve().parent.parent / "content" / "blog" / "data" / "alonso-slowest-car.json"
BRAZIL_Q = 11408  # São Paulo GP 2026 qualifying

url = re.sub(r"\+\w+://", "://", os.environ["DATABASE_URL"])


def rows(cur, sql, *params):
    cur.execute(sql, params)
    cols = [d.name for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def num(v):
    return float(v) if v is not None else None


TEAM_PACE = """
with s as (select session_key from sessions where year=2026 and session_type='Q' and session_key<>%s),
b as (select l.session_key, d.team_name, min(l.lap_time_ms) t
      from lap_times l join s using(session_key)
      join drivers d on d.session_key=l.session_key and d.driver_number=l.driver_number
      where l.lap_time_ms is not null and l.is_accurate and not coalesce(l.deleted,false)
      group by 1,2),
p as (select session_key, min(t) pole from b group by 1)
select team_name as team, round(avg((t-pole)/pole*100)::numeric,2) pct_off_pole, count(*) sessions
from b join p using(session_key) group by 1 order by 2
"""

BRAZIL_LAPS = """
select d.abbreviation as driver, d.team_name as team, l.quali_segment as segment,
       l.compound, l.lap_number as lap, l.lap_time_ms
from lap_times l join drivers d on d.session_key=l.session_key and d.driver_number=l.driver_number
where l.session_key=%s and l.lap_time_ms is not null and l.lap_time_ms <= 115000
  and not coalesce(l.deleted,false) and l.quali_segment is not null
order by l.quali_segment, l.lap_number
"""

BRAZIL_RESULTS = """
select position, abbreviation as driver, team_name as team, q1_ms, q2_ms, q3_ms
from session_results where session_key=%s order by position
"""

# Margin over the car's other drivers, per season, for every driver with 8+ seasons.
CAREER = """
with r as (select year, round, constructor_id, constructor_name, driver_id, driver_name,
                  nullif(grid,0) grid, position
           from historical_results where kind='R' and position is not null),
pairs as (
  select a.driver_id, a.driver_name, a.year, a.constructor_id, a.constructor_name,
         (avg(b.position) - a.position) race_d, (avg(b.grid) - a.grid) grid_d
  from r a join r b on a.year=b.year and a.round=b.round
       and a.constructor_id=b.constructor_id and a.driver_id<>b.driver_id
  group by a.driver_id, a.driver_name, a.year, a.round, a.constructor_id, a.constructor_name, a.position, a.grid),
seas as (select driver_id, driver_name, year, constructor_name, count(*) n,
                avg(race_d) race_d, avg(grid_d) grid_d
         from pairs group by 1,2,3,4 having count(*) >= 8)
select * from seas order by driver_id, year
"""

with psycopg.connect(url, options="-c default_transaction_read_only=on") as c:
    cur = c.cursor()
    team_pace = rows(cur, TEAM_PACE, BRAZIL_Q)
    laps = rows(cur, BRAZIL_LAPS, BRAZIL_Q)
    results = rows(cur, BRAZIL_RESULTS, BRAZIL_Q)
    seasons = rows(cur, CAREER)

by_driver: dict[str, list[dict]] = {}
for s in seasons:
    by_driver.setdefault(s["driver_name"], []).append(s)

peers = []
for name, ss in by_driver.items():
    if len(ss) < 8:
        continue
    races = sum(s["n"] for s in ss)
    peers.append({
        "driver": name,
        "seasons": len(ss),
        "races": races,
        "race_delta": round(sum(num(s["race_d"]) * s["n"] for s in ss) / races, 2),
        "grid_delta": round(sum(num(s["grid_d"]) * s["n"] for s in ss) / races, 2),
        "share_ahead": round(sum(1 for s in ss if num(s["race_d"]) > 0) / len(ss), 2),
    })
peers.sort(key=lambda p: -p["race_delta"])

alonso = [
    {"year": s["year"], "team": s["constructor_name"], "races": s["n"],
     "race_delta": round(num(s["race_d"]), 2), "grid_delta": round(num(s["grid_d"]), 2)}
    for s in by_driver.get("Fernando Alonso", [])
]

data = {
    "team_pace": [{**t, "pct_off_pole": num(t["pct_off_pole"])} for t in team_pace],
    "brazil_laps": laps,
    "brazil_results": results,
    "alonso_seasons": alonso,
    "peers": peers,
    "note": "Teammate margin = places ahead of the car's other driver(s), averaged per race. Seasons with fewer than 8 shared races are excluded.",
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(data, separators=(",", ":"), default=num))
print(f"wrote {OUT} ({OUT.stat().st_size} bytes): {len(laps)} laps, {len(peers)} peers, {len(alonso)} Alonso seasons")
