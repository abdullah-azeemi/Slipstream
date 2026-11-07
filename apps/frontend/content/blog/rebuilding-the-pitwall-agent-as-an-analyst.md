---
title: Rebuilding the Pitwall agent as an analyst, with the numbers
summary: The first agent answered simple questions with fixed recipes. We measured it, built one that writes and runs its own analysis, and checked every answer by hand. Here is what got better and what still fails.
date: 2026-11-07
tag: Build notes
draft: true
---

The first Pitwall agent was a router with recipes. A question was matched to one of fourteen intents, and each intent ran a fixed graph of tools. That is reliable for "when did Leclerc pit?" and useless for the questions a strategist actually asks: *whose tyres really degraded more once you remove the fuel effect?*

So we rebuilt it. Before writing any of it, we measured the old one.

## The baseline

We wrote 22 questions in three tiers and a scorer that checks terms, number ranges, tool errors and refusals. Nothing is graded by a model yet, so treat the scorer as a floor, not a judge.

| Tier | Passed | What it tests |
|---|---|---|
| Supported | 2 of 8 | Things the agent should do today |
| Analytical | 0 of 10 | Strategy, what-ifs, multi-step analysis |
| Trap | 4 of 4 | Data we do not have; it must refuse |

That is **6 of 22 (27%)** on `gpt-4o-mini`. The failures were instructive:

- Six questions were refused before any analysis ran, because the router demanded a driver or a race the question did not need.
- Degradation came out **negative** (−126 ms per lap). A car burns fuel every lap and gets faster by about as much as the tyres get slower, so a raw lap-time slope hides degradation.
- One answer reported "throttle 0%" at 313 km/h. The real cause: the stored telemetry has **no throttle channel at all**, and the old code filled the gap with zero.

## What we built

The new engine is a loop. The model sees the question, picks a tool, reads the result and decides what to do next.

1. **Loaders** stage lap, telemetry, weather and race-control data into a per-run workspace. The model never sees the database.
2. **A sandbox** runs the Python the model writes: no network, read-only root file system, non-root user, 512 MB and one CPU.
3. **`f1lab`**, a small library of tested F1 methods: lap cleaning, fuel correction, degradation fits, pit loss, lateral and longitudinal g, and physics sanity checks. The model is told to use it instead of re-deriving methods.
4. **Checks on the answer.** Every number with a decimal or a unit must appear in computed output, or the answer goes back once and is then labelled unverified. A `race_summary` tool hands the model the final order, stops and gaps before it starts.
5. **A live canvas.** Every tool call becomes a card, the model's thoughts float over the cards they led to, and the graph grows as the agent decides what to do next. [Watch a recorded run](/analyst/demo).

## The methods, measured

These come from stored 2026 data.

**Tyre degradation, Hamilton, Singapore.** Cleaning the laps (no lap 1, no in/out laps, no safety-car laps) and then removing the fuel effect:

| Stint | Raw slope | Fuel-corrected | R² |
|---|---|---|---|
| 1 Medium | −0.005 s/lap | **+0.045 s/lap** | 0.23 |
| 2 Soft | +0.062 s/lap | **+0.112 s/lap** | 0.72 |

The Medium fit is weak, so we call it indicative. The fuel effect of 0.05 s per lap of fuel is an **assumption**, not a measurement, and every answer that uses it must say so.

**Pit loss.** Measured from a driver's own fuel-corrected laps around each stop, green-flag stops only:

| Race | Green stops | Median pit loss | Old estimator |
|---|---|---|---|
| Singapore | 20 | **23.9 s** (21.9–30.5) | 28.6 s |
| Spain | 13 | **26.6 s** (23.9–30.1) | 41.5 s |

Spain's old figure of 41.5 s is not a plausible green pit loss. We suspect it counted virtual-safety-car stops as green; we have not traced that.

**Lateral g.** From the X/Y position trace, which turned out to be in tenths of a metre. Unsmoothed it reads about 13 g, which is noise. Smoothed, a Hamilton lap in Singapore peaks around **4–5 g** (range 3.8–5.7 across smoothing settings), so we report ranges and call them estimates.

## Does the analyst do better?

We ran the new engine on 8 of the 22 questions and checked every answer against the database by hand, because our scorer only checks text and number ranges. It has passed wrong answers and failed right ones.

| | Old agent | Analyst, `gpt-4o-mini` | Analyst, `qwen3.7-plus` |
|---|---|---|---|
| Correct | 0 | 1 | **4** |
| Partly right | | 5 | 2 |
| No answer | | 0 | 2 |
| Wrong | | 2 | **0** |
| Model cost per question | about $0.0003 | about $0.003 | about $0.014 |
| Median time per question | about 10 s | about 28 s | about 118 s |

The old agent's eight all failed the scorer, mostly through refusals; we did not grade them further. Its cost counts only router and answer calls.

The larger model is about five times the price and four times as slow, and it got more right. Each column is one run, and scores moved between runs on the same model.

The clearest case: *could Verstappen have undercut the car ahead in Singapore?* The small model compared the wrong laps and said he spent 60 laps in traffic. The larger one read the race summary and answered that he led every lap, so there was no car ahead to undercut. That is right, though one gap it quoted was about 4 seconds off.

Its other misses were smaller or plainly admitted. It gave a wrong 135.4 s gap between Norris and Piastri while getting the rest right. Two runs hit their limit and returned no conclusion.

## What the eval caught while we built it

Running real questions found problems no unit test did:

- Laps loaded through pandas carry NaN where the database has NULL, and our cleaner dropped every lap as a pit lap.
- Each Python call was a fresh process, but the model assumed variables persisted. We now replay earlier successful scripts.
- One reply spent **245 seconds** producing an empty final answer. Replies are now capped at 2,500 tokens and a run has a 150-second limit.
- We showed the model a sample row, and it reported that row as the race average: 37.9 °C against a true **40.0 °C**. A sample is no longer accepted as evidence.
- It missed two safety-car deployments by reading the wrong column, so loaders now list the values each column holds.
- Our own check was wrong too: we first counted a red-flag pit entry at the Dutch Grand Prix as a stop.

## Limits

- Eight questions and one run per model, graded by hand by the people who built it. We wrote the expected facts after seeing early answers. These are directional numbers, not a benchmark.
- The "trap" tier has not been run against the analyst.
- The sandbox runs in Docker. Production on Fly will need a hosted runner behind the same interface.
- Fuel effect, smoothing and the 1.35 s traffic threshold are assumptions. The threshold comes from a simulation at one circuit ([Fieni et al.](https://arxiv.org/abs/2602.23056)).
- Two minutes per question is slow for a live product.

## Next

Send simple questions to the fast, cheap path and hard ones to the larger model, using measured results rather than guesses: work on model routing finds that a router short of information is the main limit ([Agent-as-a-Router](https://arxiv.org/abs/2606.22902), on coding tasks). Add a separate judge for reasoning, as [DS-STAR](https://arxiv.org/abs/2509.21825) does, and build a lap-time model that measures the fuel effect instead of assuming it.

This is also a thin corner of the field: one [recent scoping review](https://pdfs.semanticscholar.org/3fd2/71ffc72994e47c885397b9b3abb6edd3cfd4.pdf) of AI in motorsport counted 4 of 50 sources on telemetry and race data analysis.
