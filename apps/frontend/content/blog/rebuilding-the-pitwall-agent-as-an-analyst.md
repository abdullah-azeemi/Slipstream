---
title: Rebuilding the Pitwall agent as an analyst, with the numbers
summary: The first agent answered simple questions with fixed recipes. We measured it, found where it breaks, and built one that writes and runs its own analysis. Here is what the eval says, including what still fails.
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
4. **A live canvas.** Every tool call becomes a card, the model's thoughts float over the cards they led to, and the graph grows as the agent decides what to do next. [Watch a recorded run](/analyst/demo).

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

We ran the new engine on 8 of the 22 questions (the budget for model calls was capped at $0.20 in total).

| | Old agent | Analyst |
|---|---|---|
| Passed by the scorer, same 8 questions | 0 | **2** |
| Correct when we checked by hand | 0 | **1** |
| Median latency | about 10 s | about 30 s |
| Mean model cost per question | about $0.0003 | about $0.003 |

The old agent's cost counts only its router and answer calls, so the gap is smaller than it looks.

We checked every analyst answer against the database, because the scorer only checks text and ranges:

- **Hamilton's degradation in Singapore** is right, and matches our own calculation above.
- **British Grand Prix weather** passed the scorer and is half right: "no rain" is correct, but it reported an average track temperature of 37.9 °C where the stored data averages **40.0 °C**.
- **"Was there a safety car in Azerbaijan?"** it answered "cannot confirm". The race-control data holds **four safety-car events**; it never found them. The scorer failed it for the wrong reason, because the answer was honest but wrong.
- It explained away negative fuel-corrected slopes as "fuel burn", the one explanation we had already removed. We added a rule against it, and the next run called the data noisy instead.
- On strategy questions a small model reasons shallowly (one run defined "traffic" as "position 4 or lower"). One run made 51 tool calls and still ended with "unable to".

So the honest summary is **one verified correct answer out of eight**, against none before. That is progress, and it is also the reason the next step is a reviewer, not a bigger model.

## What the eval caught while we built it

Running real questions found problems no unit test did:

- Laps loaded through pandas carry NaN where the database has NULL, and our cleaner dropped every lap as a pit lap.
- Each Python call was a fresh process, but the model assumed variables persisted. We now replay earlier successful scripts.
- One reply spent **245 seconds** producing an empty final answer. Replies are now capped at 2,500 tokens and a run has a 150-second limit.

## Limits

- Eight questions, one small model, and a scorer that checks text and number ranges rather than correctness (it passed a wrong temperature). These are directional numbers, not a benchmark.
- The "trap" tier has not been run against the analyst.
- The sandbox runs in Docker. Production on Fly will need a hosted runner behind the same interface.
- Fuel effect, smoothing and reference windows are assumptions we will calibrate per circuit.

## Next

A reviewer that checks every number in an answer against the tool results and the physics ranges before it is shown, a model-graded rubric on the eval, and a stronger model for the analytical tier. The same 22 questions will tell us whether each change helps.
