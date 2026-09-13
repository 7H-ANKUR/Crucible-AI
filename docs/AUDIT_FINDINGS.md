# Crucible AI — Codebase Audit (pre-rebuild)

Ground truth established by reading source, not README claims.
Date: 2026-09-12

## Inventory

| Area | Count | Notes |
|---|---|---|
| API routers | 17 | `app/api/routers/` |
| Core modules | 18 + `routing/` pkg | `app/api/core/` |
| Backend LOC | ~10,600 | excluding `core/routing` (~1,800) |
| Desktop pages | 12 | `web/src/app/(app)/` |
| Mobile pages | 9 | `web/src/app/m/` — separate tree, duplicated logic |
| Shared components | 12 | `web/src/components/` |
| DB tables | 21 | 5 schemas: geo, ml, ops, gov, hub |
| ML artifacts | 16 | verified loading under numpy 2.2.6 / sklearn 1.9.0 |

## Confirmed defects

### A. Semantics

**A1 — `shortfall_prob` is not a probability.** `core/scenario_engine.py:229-230`
```python
shortfall_base = max(0.0, (plan - baseline_prod) / max(plan, 1))
```
This is a *production gap ratio*. It is emitted under the field name `shortfall_prob`
in both `baseline` and `scenario` blocks. A genuine calibrated probability exists
separately at `contracts.py:85` (`ShortfallRiskInfo.probability`) fed by the
`shortfall_champion` model. Two different quantities, one name.
→ Spec §11.

**A2 — Terminology drift.** `intelligence.py` speaks of "pulse"/"score"; the product
needs operational *state*. `optimizer.py` labels heuristic constants `expected_gain_t`.

### B. Fabricated evidence

**B1 — Invented confidence.** `core/scenario_engine.py:235-238`
```python
# Calculate a real model confidence based on evidence
model_conf = 85.0 if baseline_backed else 60.0
if any_model_backed: model_conf = min(95.0, model_conf + 5.0)
```
The comment claims evidence-derivation; the code is a two-branch constant.
Downstream `confidence_tier = "HIGH" if model_conf > 80 else "MEDIUM"` can never be LOW.

**B2 — Hardcoded SHAP.** `routers/intelligence.py:451-453` — three literal dicts tagged
`"type": "model_shap"`, `"confidence": "HIGH"`. No explainer is invoked.

**B3 — Constant gains as predictions.** `core/optimizer.py` `candidate_actions[].base_gain`
= 48.0 / 36.0 / 24.0 / 30.0 / 12.0 t, surfaced as `expected_gain_t`.

### C. Unsafe fallbacks

**C1 — Missing telemetry treated as safe.** `core/optimizer.py:52`
```python
reason = "No live data available; assuming typical availability."
```
Feasibility multiplier stays 1.0. A redeploy is approved on absent equipment data.
→ Spec §21 names this exact string class as must-eliminate.

**C2 — RBAC fails open.** `core/rbac.py:check_mine_access` final line is `return True`.
A user with neither `allowed_mines` nor `mine_id` gains access to every mine.

**C3 — Default mine id.** `routers/intelligence.py:25,33,240,318` default `mine_id="mine-01"`.
An unscoped request silently answers for an arbitrary mine.

### D. Duplication

**D1 — Scenario logic exists three times.**

| Symbol | scenario_engine.py | scenarios.py | optimizer.py |
|---|---|---|---|
| `_latest_features` | L37 | L43 | — |
| `_HEURISTIC` | L20 | L59 | — |
| `_ADJUSTABLE` | L28 | L67 | — |
| intervention scoring | L140-215 | L77-118 (`_model_delta`) | L104-197 |
| `check_operational_constraints` | calls | calls | defines |

`_HEURISTIC` and `_ADJUSTABLE` are byte-identical copies.

**D2 — Mobile tree duplicates desktop.** `app/m/*` reimplements 9 pages.

### E. Data access

**E1 — 20 `SELECT *`** across 12 files. Two are justified and commented
(`exploration.py:160-166` needs all ~37 engineered features); the rest are not.

**E2 — No pagination** on `mines`, `governance`, `training`, `lab`, `health`.
`alerts.py:39` and `ledger.py:20` build `WHERE 1=1` filters with a single trailing LIMIT.

**E3 — Best-effort audit writes.** `routers/ledger.py:70,88,106`, `decisions.py` audit
inserts, `data_hub.py:214,574` all swallow. ~20 bare `pass` handlers total.

### F. Model serving

**F1 — Prediction bypassing the serving check.** `routers/scenarios.py:82`
```python
model = get_model("prod_forecast")
```
inside `_model_delta`, which then calls `model.predict()`. `ensure_active_model()` —
which validates `ServingStatus` — is used at L129/L310 but not on this path.
`core/optimizer.py:108` also calls `get_model("prod_forecast")`; that binding is
never used (dead).

Sidecar `get_model()` calls for `*_feats`, `*_medians`, `*_catmap` are legitimate —
those are not models and have no serving status.

### G. Dead code

- `optimizer.py:107` `shortfall_gap` — computed, never read.
- `optimizer.py:108` `model` — loaded, never read.
- `scenarios.py` `_latest_features` — duplicate of the engine's.

## Existing assets worth keeping

- `gov.decisions` **already has** `lifecycle_state` with a CHECK constraint
  (RECOMMENDED → UNDER_REVIEW → APPROVED/REJECTED → EXECUTED → OUTCOME_RECORDED)
  plus `reviewed_by/at`, `executed_by/at`. Needs extending, not inventing.
- `gov.decision_outcomes` has predicted/actual/delta/effectiveness with a
  one-outcome-per-decision UNIQUE. This is the learning loop's spine already.
- `gov.audit_log` exists with actor/entity/payload.
- `core/cache.py` — 1,266 lines, circuit breaker, L1/L2, policy table. Reusable.
- `core/ml_loader.py` `ensure_active_model` + `ServingStatus` — the canonical path
  is *built*, merely not universally used.
- `core/routing/` — risk surface, A*, exact risk decomposition, counterfactual
  root-cause. Already matches the product model the spec asks for.

---

## Findings from live database inspection

Discovered while testing the constraint engine against the Aiven instance.

### H1 — `ops.equipment_telemetry.timestamp` is not a timestamp

The column is `TEXT` holding values like `'2024-10-31-S3'` (date plus shift).
A canonical `datetime TIMESTAMPTZ` column exists alongside it and is fully
populated (9,900 / 9,900 rows). The schema comment says as much.

`routers/intelligence.py:428` orders by the TEXT column — a lexical sort that
matches chronology only by coincidence of format. All new code must use
`datetime`.

### H2 — The dataset is historical, and the two domains do not overlap

| Source | Earliest | Latest | Span |
|---|---|---|---|
| `ops.equipment_telemetry` | 2024-10-22 | 2024-10-31 | 10 days |
| `ops.production_records` | 2024-07-01 | 2025-06-30 | 12 months |

Wall clock at time of audit: 2026-09-12.

Two consequences:

1. **Wall-clock freshness is meaningless here.** Every record would read EXPIRED
   forever, pinning every evidence grade to LOW and making the Command Center
   permanently report "no recent telemetry". Addressed by `core/clock.py`, which
   measures freshness against the dataset epoch in BENCHMARK mode and states the
   reference point rather than leaving it implicit.

2. **Equipment telemetry genuinely trails production by ~8 months** *within* the
   benchmark, and covers only 10 days against production's 12 months. This is a
   real defect of the benchmark, not an artefact of the clock. The constraint
   engine reports it truthfully (`telemetry_freshness` FAILED).

   Because the penalty applies identically to every intervention it does not
   distort their relative ranking; it correctly lowers evidence quality across
   the board. It belongs in **platform / data health** (spec §31) rather than
   being read as an operational problem at any individual mine.

### H3 — `ops.mines` coordinates drive routing, with a silent fallback

`routers/routing.py:_mine_location` falls back to `21.95, 79.25` (Sausar Belt)
when the row is missing, logging a warning. Acceptable for routing geometry, but
it means a mine with no coordinates routes as if it were somewhere else. The
constraint engine does not inherit this: it requires an explicit location and
returns NOT_EVALUATED without one.

### H4 — `/material-flow` was entirely fabricated

`routers/intelligence.py:532` returned six stages with hardcoded `capacity_tph`,
`current_tph` and `utilization_pct`, one of them labelled `"BOTTLENECK"`. The
endpoint took no `mine_id`, so every mine was shown identical figures. Replaced
by `core/bottleneck.py`, which computes each stage per mine and reports
INSUFFICIENT_DATA for dispatch, which the schema does not cover.

### H5 — `ops.production_records` is per zone-shift, not per mine-shift

Granularity is (mine, date, zone_id, shift). MH-NAGPUR-01 has 3 zones and 3
shifts across 113 rows, with most dates carrying a single row rather than nine.

This is a scope trap for anything joining production to fleet data: a row's
`actual_production_t` describes one zone-shift, while `ops.equipment_telemetry`
is mine-wide. Comparing them directly made haulage read 4% utilised at every
mine — which would tell a manager haulage is never worth looking at. The
haulage capacity model scales the truck count to the production record's scope.

### H6 — Fleet size disagrees between sources

| Source | MH-NAGPUR-01 |
|---|---|
| `ops.equipment_telemetry` distinct `machine_id` | 85 machines, 6 trucks |
| `ops.production_records.equipment_count` | 18 |

Trucks are 7.1% of the telemetry fleet. `active_equipment_count` counts every
machine type, so treating it as a truck count overstates haulage capacity by
roughly 14×. Any future capacity model must apply the fleet-composition share.

### H7 — Only trucks record `payload_tons`

NULL for excavator, loader, crusher, drill, dozer, pump, conveyor. Correct, but
it means `AVG(payload_tons)` without a type filter silently yields the truck
mean while appearing to describe the whole fleet.

### H8 — Database latency dominates every response

Measured against the configured Aiven instance:

```
SELECT 1                 1236 ms
MAX(datetime)            1533 ms
MAX(date)                1228 ms
```

A bare `SELECT 1` costs ~1.2 s. Response time on this platform is therefore a
function of **how many round trips a request makes**, not of how much work the
database does. The Command Center summary needs ~20 distinct reads, which is
close to irreducible for the analysis it performs.

Work done, and what it bought:

| Change | Cold summary |
|---|---|
| baseline | 35.1 s |
| clock + aggregate memoisation (`core/memo.py`) | 29.1 s |
| single state evaluation per request | 21.2 s |
| model-registry TTL 10 s → 120 s | 18.3 s |
| concurrent signal and section evaluation | ~18 s |

**Warm (cached) summary: ~2.7 s.** The `/summary` cache holds 60 s, so a manager
refreshing during a shift hits the warm path; the cold cost is paid once per
mine per minute.

Beyond this point parallelism stops helping — the concurrent registry reads
started contending and their total wall time rose. The remaining cost is network
latency to a distant instance, not application code. If cold load matters, the
fixes are infrastructural: co-locate the database with the API, or warm the
cache for each user's mines at startup.

**Not done deliberately:** serving the Command Center summary stale. Every other
surface may show a slightly old number, but this one answers "is anything wrong
right now", and a stale answer to that question is worse than a slow one.
