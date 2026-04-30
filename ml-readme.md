# Pitwall ML Podium Prediction v1.5

## Goal

Pitwall ML is now framed around podium probability rather than pretending exact finishing order is the main research target. The production model can still learn race order, but the public-facing question is sharper:

> Given everything available before the race, which drivers are most likely to finish P1/P2/P3, and why?

For Miami, the v1.5 goal is credible shipping: clear assumptions, no leakage, visible uncertainty, and a race-engineering explanation that shows the model is thinking in performance streams.

## Current Production Shape

- Baseline engine: FLAML AutoML regression over race finishing position.
- Public output: podium-first probability table, P1/P2/P3 probabilities, Monte Carlo uncertainty, SHAP/XAI factors.
- Training default: 2022-present race weekends, because that matches the current F1 regulation era.
- Validation focus: top-3 hit rate, podium precision/recall, Brier score, and grid-order baseline comparison.

This is not yet a full ranking ensemble or survival model. That is Phase 2 after Miami. v1.5 is intentionally conservative so the live app stays healthy.

## Feature Streams

Real performance work is easier to reason about when features are grouped by source of performance, not dumped into one flat list.

### Car pace

- Grid position
- Qualifying gap to pole
- S1/S2/S3 gaps and ranks
- Sector weakness score
- Pole gap percentage
- Speed trap rank and top-speed delta

Question this stream answers: is the car genuinely fast this weekend, and where is that pace coming from?

### Tyre / strategy

- Qualifying tyre indicators
- FP2 hard/medium usage where available
- FP1 long-run degradation rate
- FP1 long-run pace

Question this stream answers: does the car look raceable over a stint, not only over one lap?

### Driver / team form

- Team rolling three-race form
- Team trend
- Driver circuit average and best finish
- Sprint finish and sprint position delta where available

Question this stream answers: is this performance consistent with recent car and driver form?

### Circuit context

- Street/power/high-downforce flags
- Safety-car probability prior
- Overtake difficulty prior
- Circuit DNF/reliability prior

Question this stream answers: how much should track position, chaos, and reliability reshape a pure pace read?

## Miami Weekend Flow

Miami is treated as a sprint-format prediction workflow:

1. FP1 gives the first tyre/race-sim signal.
2. SQ gives a first low-fuel ordering signal.
3. Sprint gives short-race form and tyre/reliability hints.
4. Q gives the final race grid and strongest race-start prior.
5. The race prediction is generated after Q.

If FP1 has no meaningful long runs, the tyre stream remains neutral and the UI reports that the stream is weak or unavailable. Missing data should never be hidden.

## Statistical Validation

v1.5 records the diagnostics that make the prediction discussion more honest:

- Cohen's d: whether a feature meaningfully separates podium finishers from the rest.
- p-value: screening only, never proof by itself.
- Spearman correlation: whether feature direction is monotonic with finishing position.
- VIF: whether features are too collinear to interpret cleanly.
- Permutation importance: whether shuffling a feature hurts model performance.
- Grid baseline: the model must be compared against simply picking the top three starters.

The most important principle is leakage control. Features for any race must only use information available before that race.

## Grill Questions

- Are we optimizing for a truthful model or an impressive demo? For Miami, v1.5 should be truthful first.
- What happens if FP1 has no meaningful long runs? The model must show "missing/weak tyre stream" instead of pretending.
- Are SQ/Sprint signals allowed to influence race prediction before Q? Yes, but label them separately from final qualifying pace.
- Is exact P1/P2/P3 order the target? No. Primary target is podium probability; ordered podium is a displayed derived ranking.
- What baseline are we beating? Grid-order podium and simple recent-team-form podium.
- How will we know improvement is real? Use leave-one-year-out validation plus grid baseline comparison, not only MAE.
- What should an F1 performance engineer respect? Clear assumptions, no leakage, uncertainty, feature-stream attribution, and visible failure modes.

## Phase 2 Research

- Train an explicit podium classifier alongside the rank regressor.
- Add probability calibration with reliability plots and Brier decomposition.
- Evaluate a pairwise ranking model for finishing order.
- Model DNF and safety-car effects as separate stochastic processes.
- Add circuit-similarity clusters instead of only static circuit flags.
- Store prediction snapshots in `ml_predictions` and compare after the race.
