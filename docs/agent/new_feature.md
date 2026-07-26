# Pitwall — NEW_FEATURES.md
> Planning doc for the ML/Driver-Intelligence + Agent Framework epic.
> Hand this alongside CLAUDE.md to resume this work in a new chat.
> Last updated: 2026-07-25

---

## Decisions log

| Question | Decision |
|---|---|
| "Clipping analysis" | Track-limits / kerb usage from telemetry (steering + throttle spikes near corners) |
| "World model" | Reframed as **Driver Representation Model** — engineered features → embedding (PCA/autoencoder) → interpretability layer. NOT a full sequential simulator: 518-row training set doesn't support that yet |
| Agent framework scope | Reusable core — multiple future agents (debrief, strategy-advisor, driver-profile) |
| Orchestration | Static agents first. Dynamic "queen"/DAG (OpenHive-style) deferred until 2-3 agents exist to actually orchestrate |
| Charting library | Plotly.js (react-plotly.js) — native radar/violin/box/heatmap support. **New frontend dependency, needs explicit confirmation before Phase 2** |

---

## Open blockers

1. ~~**`lap_times` / `telemetry` schema**~~ — ✅ RESOLVED. Schema in CLAUDE.md, migration 0013 applied.
2. ~~**Plotly.js dependency approval**~~ — ✅ RESOLVED. Already in package.json (plotly.js@^3.4.0, react-plotly.js@^2.6.0).

---

## Track A — ML / Driver Intelligence

```
Phase 0    Feature store              packages/ml/src/ml/driver_features.py
                                       new table: driver_features
                                       ✅ DONE — 13 features, upsert, re-runnable

Phase 0.5  Statistical validation     ICC per candidate feature (grouped by driver) —
                                       filters out features that are race-noise, not driver-trait.
                                       Ridge regression baseline vs FLAML/SHAP sanity check.
                                       ✅ DONE — ICC skipped (1 season), Ridge R²=0.976. Features pass.

Phase 1    Driver embeddings          packages/ml/src/ml/driver_embeddings.py
                                       PCA or small autoencoder -> N-dim vector per driver/season
                                       new table: driver_embeddings

Phase 2    Driver profile page        app/drivers/[id]/page.tsx  (needs Plotly.js — see blockers)

Phase 3    Kerb-usage telemetry       Track-limits signal from steering/throttle spikes,
                                       feeds back into Phase 0 feature store

Phase 4    Interpretability layer     Ridge regression + correlation: label embedding axes
                                       (aggression, tyre mgmt, etc.) against known traits

Phase 5    Archetype clustering       KMeans/HDBSCAN on embeddings -> named driver types
                                       ("Late braker", "Tyre whisperer", etc.)

Phase 6    Circuit embeddings         Mirror of driver embeddings, learned from lap/telemetry
                                       shape instead of hand-coded is_street_circuit flags.
                                       Enriches race_predictor.pkl directly.

Phase 7    Overtake probability +     Row-level classifiers (gap_ms, tyre_delta, DRS -> overtake;
           pit-strategy archetype +   stint data -> strategy type; Isolation Forest -> anomalous
           anomaly detection          laps, generalizes existing is_outlier flag)

Phase 8    Embedding-as-feature       Concatenate driver embedding vector onto the existing 22
                                       features before FLAML training -> race_predictor.pkl v2
```

### New pages

```
/drivers                Driver gallery — grid of cards, radar thumbnail + archetype badge,
                         filter by year/team

/drivers/[id]            Driver profile (flagship page)
                          - Radar chart: aggression, consistency, tyre mgmt, qualifying pace, racecraft
                          - 2D embedding scatter (PCA/UMAP), field greyed out, driver + 5 nearest neighbours highlighted
                          - Season trend: embedding position per year, connected as a path ("style drift")
                          - Violin plot: lap-time distribution per compound, driver vs field median
                          - Kerb usage gauge + sparkline (Phase 3 output)
                          - SHAP-style contribution bars (reuses existing /predictions pattern)

/drivers/compare?a=X&b=Y  Head-to-head — overlaid radar (2 traces), delta bar chart,
                          box plot of sector times side by side

/agent                    Chat page (extends existing roadmap item) — agent-type selector
                          (Debrief / Strategy / Driver Profile), shared AgentChat.tsx component
```

### Chart type mapping

| Insight | Chart | Why |
|---|---|---|
| Driver trait profile | Radar / spider (Plotly scatterpolar) | Bounded 0-10 axes, reads as a shape |
| Driver vs driver | Overlaid radar, 2 traces | Shape overlap = similarity |
| Lap-time spread per compound | Violin plot | Shows distribution shape (e.g. bimodal clean-vs-traffic laps), not just quartiles |
| Sector time across field (~20 drivers) | Box plot | Stays legible at high driver counts where violin gets noisy |
| Style embedding space | 2D scatter (PCA/UMAP projection) | What dimensionality reduction is for |
| Style drift across seasons | Scatter + connecting line | A driver's dot tracing a path year over year |
| Feature contribution to prediction | Horizontal bar / SHAP beeswarm | Reuse existing /predictions pattern |
| Embedding-dim <-> trait correlation | Heatmap | Core output of the interpretability layer |

---

## Track B — Agent Framework

```
packages/agent_framework/src/agent_framework/
├── core/
│   ├── client.py          Anthropic API wrapper (retries, cost logging)
│   ├── loop.py            decide -> act -> observe loop, max_iterations guard
│   ├── tool_registry.py   central @tool decorator + JSON schema registry
│   └── memory.py          conversation history, Redis-backed (already running, unused today)
├── tools/
│   ├── race_tools.py      wraps existing documented Flask endpoints
│   ├── ml_tools.py        get_driver_profile, get_driver_neighbors (JOIN POINT with Track A)
│   └── registry.py
├── agents/
│   ├── base.py             BaseAgent(name, system_prompt, allowed_tools)
│   ├── race_debrief.py     "Why did X finish P5" — Sky Sports pundit tone
│   ├── strategy_advisor.py "What if X pitted a lap earlier" — needs new what-if endpoints (TBD)
│   └── driver_profile.py   "Compare X and Y's style" — needs Track A Phase 2/4
└── config.py                model, max_tokens, max_iterations, timeout

Phase A0  Framework core        UNBLOCKED — start any time
Phase A1  race_debrief agent    UNBLOCKED — tools wrap already-documented endpoints
Phase A2  strategy_advisor      needs new backend what-if endpoints (separate design discussion)
Phase A3  driver_profile agent  JOIN POINT — needs Track A Phase 2/4 done first
Phase A4  Queen/DAG dynamic     deferred (OpenHive-inspired), until A1-A3 exist to orchestrate
          orchestration
```

Backend route: `POST /api/v1/agent/<agent_name>/chat` (single dispatcher, not one route per agent)
Frontend: `components/agent/AgentChat.tsx` (`agentType` prop, shared loop UI)

---

## Full pipeline (data + LLM orchestration)

```
FastF1 + Jolpica --> Ingestion --> TimescaleDB (lap_times, telemetry)
                                        |
                                        v
                          Feature store (driver_features)
                                        |
                                   ICC + ridge validation  <-- Phase 0.5 gate
                                        |
                                        v
                         Embedding model (driver_embeddings)
                                        |
                        ______________/  \______________
                       /                                \
                 Flask API                          Agent tools
              (same endpoints)                  (same endpoints, wrapped)
                       |                                |
              Next.js + Plotly charts              LLM agent loop
              (human reads a page)               (agent answers a question)
```

Both consumption paths read the same precomputed tables — nothing recomputes live except the LLM call itself.

---

## Branch naming

```
feature/ml-driver-feature-store
feature/ml-statistical-validation
feature/ml-driver-embeddings
feature/frontend-driver-profile-page
feature/ml-kerb-usage-signal
feature/ml-embedding-interpretability
feature/ml-archetype-clustering
feature/ml-circuit-embeddings
feature/ml-overtake-strategy-anomaly
feature/ml-embedding-as-feature
feature/agent-framework-core
feature/agent-race-debrief
feature/agent-strategy-advisor
feature/agent-driver-profile
```

Convention: `feature/<area>-<short-desc>`, kebab-case, one PR per branch — matches the existing CI setup (pytest + ruff + Next.js build on every PR).

---

## ML learning resources

- Papers With Code — https://paperswithcode.com
- scikit-learn algorithm cheat sheet — https://scikit-learn.org/stable/machine_learning_map.html
- StatQuest (YouTube) — https://www.youtube.com/@statquest
- Google's Rules of ML — https://developers.google.com/machine-learning/guides/rules-of-ml
- Kaggle — https://www.kaggle.com
- arXiv stat.ML recent listing — https://arxiv.org/list/stat.ML/recent
- ICML/ICLR 2026 papers with code index — https://www.paperdigest.org/2026/07/icml-2026-papers-with-code-data/