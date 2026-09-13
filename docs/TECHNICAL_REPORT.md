# Crucible AI — Technical Report
## AI-Driven Mining Intelligence and Decision Support Platform

| Field | Value |
|---|---|
| **Project** | Crucible AI — Mining Intelligence Operating Platform |
| **Problem statement** | SIH26009 (referenced in repository `README.md`) |
| **Team** | Not recorded in repository |
| **Version** | v3 |
| **Date** | 12 September 2026 |
| **Prototype status** | Working end-to-end prototype on a synthetic operational benchmark |
| **Repository** | Local: `v8/v3` (git repository, no commits; predecessors `v1` 89 commits, `v2` 8 commits, retained in `v8/unused`) |
| **Live deployment** | None. Runs locally: web `:3000`, API `:8000`, geospatial engine `:8100` |

> **Method note.** This report was written by auditing the source code, the
> deployed PostgreSQL schema, and the committed model artifacts directly. Where
> documentation and code disagreed, the code was taken as authoritative and the
> disagreement is recorded. Every metric quoted is read from a file in the
> repository; nothing is estimated or carried over from previous documentation.

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Problem statement](#2-problem-statement)
3. [System objectives and status](#3-system-objectives-and-status)
4. [System overview](#4-system-overview)
5. [High-level architecture](#5-high-level-architecture)
6. [Technology stack](#6-technology-stack)
7. [Data architecture](#7-data-architecture)
8. [Datasets](#8-datasets)
9. [Synthetic data disclosure](#9-synthetic-data-disclosure)
10. [Machine learning architecture](#10-machine-learning-architecture)
11. [Model-by-model analysis](#11-model-by-model-analysis)
12. [Model metrics](#12-model-metrics)
13. [Validation methodology](#13-validation-methodology)
14. [Model explainability](#14-model-explainability)
15. [Production intelligence](#15-production-intelligence)
16. [Equipment intelligence](#16-equipment-intelligence)
17. [Exploration and GIS](#17-exploration-and-gis)
18. [Scenario engine](#18-scenario-engine)
19. [Decision intelligence](#19-decision-intelligence)
20. [Manager Command Center](#20-manager-command-center)
21. [What if we do nothing](#21-what-if-we-do-nothing)
22. [Decision memory](#22-decision-memory)
23. [Outcome learning](#23-outcome-learning)
24. [Alerts and incidents](#24-alerts-and-incidents)
25. [Role-based access control](#25-role-based-access-control)
26. [Security](#26-security)
27. [Database architecture](#27-database-architecture)
28. [Caching and performance](#28-caching-and-performance)
29. [API architecture](#29-api-architecture)
30. [Frontend architecture](#30-frontend-architecture)
31. [Testing](#31-testing)
32. [Experimental results](#32-experimental-results)
33. [Error handling and failure modes](#33-error-handling-and-failure-modes)
34. [Data and model governance](#34-data-and-model-governance)
35. [Defects found and corrected](#35-defects-found-and-corrected)
36. [Limitations](#36-limitations)
37. [Requirements for real-world deployment](#37-requirements-for-real-world-deployment)
38. [Conclusion](#38-conclusion)

---

## 1. Executive summary

Indian manganese mining operations generate production records, equipment
telemetry and geoscientific survey data in separate systems, on different
cadences, with no shared vocabulary. A shift supervisor facing a production
shortfall must reconcile them manually, under time pressure, and then justify a
decision that nobody will later be able to reconstruct.

Crucible AI is a decision support platform that connects those sources into one loop:

```
DETECT → UNDERSTAND → DECIDE → SIMULATE → APPROVE → ACT → MEASURE → LEARN
```

**What is built.** Four supervised ML pipelines (production forecasting,
shortfall classification, equipment failure, mineral prospectivity) served
through a governed registry; a constraint-aware scenario engine; an operational
state engine; a material-flow bottleneck analyser; a response-plan lifecycle with
role-gated approval and transactional audit; decision memory; and a Command
Center that presents these in decision order rather than as charts. A separate
geospatial engine (Crucible AI) provides dataset profiling, automated validation
strategy selection with genuine spatial block cross-validation, and raster
prospectivity stacking.

**Scale.** 130 API routes across 19 routers, ~15,200 lines of backend domain
logic, 13 frontend pages, 27 database tables across 5 schemas, 144 backend tests.

**Key technical result.** The platform distinguishes, at the type level and in
every response payload, between a model prediction, a declared heuristic, and an
absence of data (`MODEL_BACKED` / `HEURISTIC` / `INSUFFICIENT_DATA`). A manager
can see which of the four recommendations on screen came from a model and which
did not, and why. This was not cosmetic: implementing it exposed that three of
five intervention effect estimates were falling back to declared values because
the gradient-boosted model's output is flat to those feature moves — a fact that
was previously invisible.

**Major limitation.** All data is synthetic, and `leakage_status: PASS` in the
model validation output is a hardcoded string literal in the training scripts,
not a computed result. No accuracy figure in this report establishes real-world
mining performance. The system is a working prototype, not production-ready;
§36 and §37 state exactly what remains.

---

## 2. Problem statement

### 2.1 The operational situation

A mine manager at shift start needs to know whether anything requires their
attention, and if so what to do about it within the shift. The information
required is distributed:

| Question | Where the answer lives |
|---|---|
| Are we behind plan? | Production records, per zone-shift |
| Why? | Material flow — which stage is binding |
| Will equipment hold? | Machine telemetry, per unit |
| What can we do? | Operational experience, held by people |
| May we do it? | Safety rules, maintenance state, statutory limits |
| Did it work last time? | Nobody's system |

### 2.2 Why conventional dashboards are insufficient

A dashboard answers *what is happening*. It does not answer *what to do*, and the
gap between those two is where the decision actually is.

Concretely, a dashboard reporting "shortfall probability 73%" leaves the manager
to determine which stage is binding, which interventions are permitted given
current equipment condition, what each would recover, what each costs, who must
approve it, and whether a similar action worked before. Each of those is a
separate manual reconciliation, performed under time pressure, and none of it is
recorded.

Three consequences follow:

1. **Predictions do not become decisions.** A number without an available action
   attached is a report, not support.
2. **Decisions are not traceable.** Six weeks later, nobody can reconstruct what
   was known when a call was made.
3. **Nothing learns.** Because outcomes are not recorded against predictions, the
   platform accumulates forecasts nobody ever checked.

### 2.3 The central technical problem

> **Prediction alone is not enough.**

A useful mining intelligence system must connect detection to explanation to
simulation to decision to approval to outcome to learning, and must be honest at
every step about which of its numbers are measured, which are modelled, and which
are not available at all.

That last requirement drove most of the engineering in this version. A platform
that presents a heuristic estimate and a model prediction identically is not
merely imprecise — it trains its users to distrust everything it says once they
discover one instance.

---

## 3. System objectives and status

Every row below was verified against source code. Status definitions:
**IMPLEMENTED** — working and exercised by tests or live verification;
**PARTIAL** — working for a subset of cases, gap stated;
**PLANNED** — schema or scaffolding exists, behaviour does not.

| # | Objective | Technical implementation | Status |
|---|---|---|---|
| 1 | Production forecasting | LightGBM regressor + P10/P50/P90 quantile models, `app/ml/models/train_production_forecast.py` | IMPLEMENTED |
| 2 | Shortfall probability | Calibrated logistic classifier, `train_shortfall.py` | IMPLEMENTED |
| 3 | Equipment failure prediction | Logistic baseline + calibrator, `train_equipment_failure.py` | IMPLEMENTED (weak — §11.3) |
| 4 | Mineral prospectivity | Logistic pipeline over 37 geo features, `train_prospectivity.py` | IMPLEMENTED |
| 5 | Explainability | SHAP explainer artifact with native-importance fallback, `routers/production.py:65` | IMPLEMENTED |
| 6 | Operational state detection | 5-signal state engine, `core/state_engine.py` | IMPLEMENTED |
| 7 | Bottleneck analysis | 6-stage material flow, `core/bottleneck.py` | PARTIAL — dispatch stage has no data source |
| 8 | Scenario simulation | Canonical engine with model counterfactuals, `core/scenario/` | IMPLEMENTED |
| 9 | Constraint enforcement | Hard/soft split, fail-closed, `core/constraints.py` | IMPLEMENTED |
| 10 | Optimisation / ranking | Objective-driven ranking, `core/scenario/ranking.py` | IMPLEMENTED |
| 11 | Counterfactual baseline | Do-nothing projection, `core/projection.py` | IMPLEMENTED (heuristic by design — §21) |
| 12 | Response plans | 9-state lifecycle, `core/decision_store.py` | IMPLEMENTED |
| 13 | Human approval gate | Role-gated, strictest-action-governs, `routers/response_plans.py` | IMPLEMENTED |
| 14 | Outcome tracking | `gov.decision_outcomes`, predicted vs actual | IMPLEMENTED |
| 15 | Decision memory | Similarity retrieval with duplicate collapsing, `core/decision_memory.py` | IMPLEMENTED |
| 16 | Decision package | Approvable document, JSON + Markdown, `core/decision_package.py` | IMPLEMENTED |
| 17 | Response playbooks | Trigger evaluation with stage narrowing, `core/playbooks.py` | IMPLEMENTED |
| 18 | Shift handover | Structured facts + deterministic narrative, `core/handover.py` | IMPLEMENTED (no UI page) |
| 19 | Data ingestion + validation | 25 quality checks, `core/data_validator.py` | IMPLEMENTED (check 18 is a stub — §35) |
| 20 | Dataset versioning | `hub.dataset_versions`, SHA-256, lifecycle states | IMPLEMENTED |
| 21 | Model registry + approval | `gov.model_registry`, approve/promote/reject/rollback | IMPLEMENTED |
| 22 | Serving integrity | `ServingStatus` from registry, never inferred from class name | IMPLEMENTED |
| 23 | Caching | L1 LRU + L2 Redis, zlib, circuit breaker, `core/cache.py` | IMPLEMENTED |
| 24 | RBAC + mine scoping | 6 roles, backend-resolved mine context | IMPLEMENTED |
| 25 | Audit trail | Transactional, shares the write, `gov.audit_log` | IMPLEMENTED |
| 26 | Risk-aware haul routing | A* over a derived risk surface, `core/routing/` | IMPLEMENTED |
| 27 | Spatial validation machinery | 5×5 quantile block CV, `crucible/core/models/splitters.py` | IMPLEMENTED — **not used by the committed models** (§13) |
| 28 | Automated ML pipeline | 20-endpoint lab integration with Crucible AI | IMPLEMENTED |
| 29 | Alert generation | `gov.alerts` table + list/acknowledge API | PARTIAL — **nothing generates alerts** (§24) |
| 30 | Incident lifecycle | `ops.incidents` + `ops.incident_events` schema | PLANNED — no writer (§24) |
| 31 | Incident replay | — | PLANNED — not implemented |
| 32 | Command palette | — | PLANNED — not implemented |
| 33 | Automatic retraining | Modal training trigger exists; no outcome-driven trigger | PARTIAL |

---

## 4. System overview

Crucible AI is organised into eleven domains. The first four produce intelligence; the
next four convert it into decisions; the last three govern it.

| Domain | Responsibility | Primary modules |
|---|---|---|
| **Production** | Forecast, gap, shortfall probability, drivers | `routers/production.py`, `core/features.py` |
| **Equipment** | Fleet health, failure exposure, maintenance state | `routers/equipment.py` |
| **Exploration** | Prospectivity grid, target ranking, GIS | `routers/exploration.py`, `crucible/core/geospatial/` |
| **Material flow** | Stage capacity, binding constraint | `core/bottleneck.py` |
| **Scenario planning** | Interventions, constraints, counterfactuals, ranking | `core/scenario/` |
| **Decision intelligence** | Response plans, approval, outcomes, memory | `core/decision_store.py`, `core/decision_memory.py` |
| **Command Center** | State, attention, recommendations, do-nothing | `routers/command_center.py` |
| **Haul routing** | Risk-aware A*, heatmaps, haulage-constrained production | `core/routing/` |
| **Data management** | Upload, validate, canonicalise, version | `core/data_validator.py`, `core/canonicalizer.py` |
| **Model governance** | Registry, approval, promotion, rollback, serving | `core/ml_loader.py`, `routers/model_approval.py` |
| **Security** | Auth, RBAC, mine scoping, audit | `core/security.py`, `core/rbac.py` |

### How they connect

Production and equipment intelligence feed the **state engine**, which produces
five signals. The **attention queue** ranks the non-nominal signals. The
**recommendations engine** maps each attention item to the catalogue
interventions that could address it, and evaluates each through the **scenario
engine**, which consults the **constraint engine** before computing any effect.
The result becomes a **response plan** with a lifecycle, an approver and an
outcome record, which feeds **decision memory** for the next occurrence.

Nothing in that chain is computed twice. Before this version, scenario evaluation
existed in three places with copies that had begun to disagree; a guard test now
fails if they reappear.

---

## 5. High-level architecture

### 5.1 Runtime topology

```
                          ┌──────────────────────────┐
   Mine manager  ────────►│  Next.js 14 (App Router) │  :3000
   Shift supervisor       │  React 18 · Tailwind v4  │
   Maintenance manager    │  MapLibre GL · Clerk SDK │
   Exploration geologist  └────────────┬─────────────┘
                                       │ HTTPS + Bearer (Clerk RS256)
                          ┌────────────▼─────────────┐
                          │   FastAPI gateway        │  :8000
                          │   JWKS verify → RBAC →   │
                          │   mine scoping → router  │
                          └────────────┬─────────────┘
                                       │
        ┌──────────────────────────────┼───────────────────────────────┐
        │                              │                               │
┌───────▼────────┐          ┌──────────▼──────────┐         ┌──────────▼─────────┐
│ Domain services│          │  ML serving layer   │         │  Crucible AI engine     │ :8100
│                │          │                     │         │  (loopback only)   │
│ state_engine   │          │ ensure_active_model │         │                    │
│ bottleneck     │◄────────►│  → ServingStatus    │         │ dataset profiling  │
│ attention      │          │  → joblib artifacts │         │ feature roles      │
│ recommendations│          │  → SHAP explainer   │         │ leakage screen     │
│ scenario/      │          └──────────┬──────────┘         │ validation strategy│
│ constraints    │                     │                    │ spatial block CV   │
│ projection     │                     │                    │ raster prospectivity│
│ response_plan  │                     │                    │ fault localisation │
│ decision_store │                     │                    └──────────┬─────────┘
│ decision_memory│                     │                               │
│ playbooks      │                     │                      HMAC-SHA256 signed
│ handover       │                     │                      timestamp + nonce
│ routing/       │                     │
└───────┬────────┘                     │
        │                              │
┌───────▼──────────────────────────────▼───────────────────────────────────────┐
│  core/cache.py      L1 in-process LRU  →  L2 Redis (TLS, circuit breaker)     │
├──────────────────────────────────────────────────────────────────────────────┤
│  PostgreSQL 16 (Aiven, TLS)     schemas: ops · geo · ml · gov · hub           │
│  Google Drive (artifact storage, optional)    Modal (serverless training)     │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Why the engine is loopback-only.** Crucible AI has no authentication of its own. It
is bound to `127.0.0.1` and reachable only through the gateway, which holds
Clerk verification, RBAC and mine scoping. Requests carry an HMAC-SHA256
signature over method, path, body and timestamp, with a nonce for replay
protection.

### 5.2 Data and model lifecycle

```
  CSV / XLSX upload
        │
        ▼
  Schema mapping ─────────► hub.dataset_column_mappings
  (auto-map + confidence,   (human review below 0.7 confidence)
   core/schema_mapper.py)
        │
        ▼
  25 quality checks ──────► hub.dataset_validation_reports
  (core/data_validator.py)  structural · statistical · domain · temporal
        │
        ▼
  Canonicalisation ───────► schema hash, unit normalisation
  (core/canonicalizer.py)
        │
        ▼
  Versioning ─────────────► hub.dataset_versions  (SHA-256, UPLOADED →
                                                   MAPPED → VALIDATED →
                                                   APPROVED_FOR_TRAINING)
        │
        ▼
  Feature engineering ────► core/features.py  (ordered vector, median fill,
                                               derived temporal features)
        │
        ▼
  Training (Modal) ───────► gov.training_runs   candidate models
        │
        ▼
  Evaluation ─────────────► validation split → champion selection by PR-AUC/MAE
        │                    test split → reported metrics
        ▼
  Registry ───────────────► gov.model_registry  (challenger)
        │
        ▼
  Human approval ─────────► gov.model_approvals  → champion
        │
        ▼
  Serving ────────────────► ensure_active_model() verifies version, checksum,
        │                    smoke test → ServingStatus
        ▼
  Prediction ─────────────► ml.predictions  (entity, value, model_version)
        │
        ▼
  Decision ───────────────► gov.decisions · gov.response_plans
        │
        ▼
  Outcome ────────────────► gov.decision_outcomes  (predicted vs actual)
        │
        ▼
  Learning ───────────────► core/decision_memory.py  (similarity retrieval)
```

### 5.3 Layer responsibilities

| Layer | Responsibility | Rule enforced |
|---|---|---|
| **Routers** | HTTP shape, auth dependency, serialisation | No business logic. Routers are adapters. |
| **Domain services** | All computation and judgement | Each decision computed exactly once, in one place |
| **ML serving** | Artifact resolution, version integrity | Version from registry, never from `type(model).__name__` |
| **Cache** | L1/L2 with circuit breaking | Never serves stale safety-relevant state |
| **Data layer** | Pooled connections, transactions | Audit shares the transaction with the change |

---

## 6. Technology stack

Only technologies present in `requirements.txt`, `package.json` or imported in
source are listed.

| Layer | Technology | Version | Purpose | Reason for use | Status |
|---|---|---|---|---|---|
| Frontend framework | Next.js | 14 (App Router) | SSR + routing | File-based routing, server components, mature Clerk integration | Active |
| UI library | React | 18 | Component model | Required by Next 14 | Active |
| Styling | Tailwind CSS | v4 | Design system | Token-based theming, dark/light without duplication | Active |
| Mapping | MapLibre GL | — | GIS rendering | Open-source vector tiles, no licence constraint | Active |
| Auth (client) | Clerk | — | Sign-in, session | Managed RS256 JWT, publicMetadata for role and mine scope | Active |
| API framework | FastAPI | 0.115.0 | HTTP API | Pydantic contracts, dependency injection for auth, OpenAPI | Active |
| ASGI server | Uvicorn | 0.30.6 | Serving | Standard FastAPI pairing | Active |
| Validation | Pydantic | 2.9.2 | Request/response contracts | Type-level enforcement of the output contract (§10) | Active |
| Database | PostgreSQL | 16 (Aiven) | Persistence | Schemas, CHECK constraints, `DISTINCT ON`, `PERCENTILE_CONT` | Active |
| DB driver | psycopg2-binary | 2.9.9 | Connection pool | `ThreadedConnectionPool` for concurrent signal evaluation | Active |
| Cache | Redis | 5.2.1 client | L2 cache | TLS to Upstash; circuit-broken | Active |
| ML — boosting | LightGBM | 4.5.0 | Production forecast champion | Handles mixed tabular features | Active |
| ML — boosting | XGBoost | 2.1.1 | Candidate model | Evaluated, not promoted (§12.5) | Candidate only |
| ML — classical | scikit-learn | 1.9.0 | Logistic, RF, calibration, pipelines | Champion for 3 of 4 tasks | Active |
| ML — explainability | SHAP | 0.46.0 | Feature attribution | Additive attribution for the forecast | Active |
| ML — serialisation | joblib | 1.4.2 | Artifact format | scikit-learn native | Active |
| Numerics | numpy / pandas / scipy | 2.2.6 / 2.2.3 / 1.14.1 | Arrays, frames | Baseline | Active |
| Geospatial | rasterio / geopandas / shapely / pyproj | 1.5.1 / 1.1.4 / 2.1.2 / 3.8.0 | Raster, vector, CRS | Crucible AI prospectivity stacking | Active |
| Training compute | Modal | 1.5.5 | Serverless training | Offloads training from the API host | Active |
| Artifact storage | Google Drive API | via `gdown` 6.1.1 | Artifact distribution | Optional; artifacts also local | Partial — IDs unset |
| LLM | Groq | 0.11.0 | Target brief generation | Exploration narrative only | Active, narrow |
| Container | Docker | — | Deployment | `infra/api.Dockerfile`, `web.Dockerfile` | Present, not exercised |
| CI | GitHub Actions | — | Test automation | `.github/workflows/ci.yml` | Present |

**Python 3.12.10** is the single interpreter for both the gateway and the
geospatial engine. This is enforced by `test_environment_contract.py`, which
fails the build if the two dependency sets can resolve differently — a real
failure mode, since a numpy or scikit-learn mismatch changes how committed model
artifacts deserialise.

---

## 7. Data architecture

### 7.1 Ingestion and validation

`POST /api/v1/data/upload` accepts CSV or XLSX. The pipeline is:

**1. Schema mapping** (`core/schema_mapper.py`). Source columns are matched
against a canonical schema per domain. Each mapping carries a confidence score;
below 0.7 the column is flagged `requires_review=True` and a human must confirm
it. Unrecognised columns map to `None` with confidence 0.

The canonical schema declares, per column: name, type, required flag,
description, unit, and valid range. Example from the production domain:

```python
CanonicalColumn("planned_production_t", "float", True, "Planned output in tonnes", "tonnes", 0, 10000)
CanonicalColumn("ore_grade_mn_pct",     "float", False, "Manganese ore grade",      "%",      0, 100)
CanonicalColumn("working_hours",        "float", False, "Working hours in the shift","hr",     0, 24)
```

**2. Twenty-five quality checks** (`core/data_validator.py`), grouped:

| Group | Checks |
|---|---|
| Structural | row count, required columns, unknown columns, exact duplicates |
| Completeness | null rate, null concentration |
| Type and range | numeric parsing, numeric ranges, categorical vocabulary |
| Temporal | date format, future dates, temporal ordering, continuity, freshness |
| Identity | business key uniqueness |
| Geographic | India coordinate bounds |
| Domain logic | impossible combinations |
| Statistical | **target leakage**, temporal contamination, zero variance, near-constant, high cardinality, outlier rate, unit consistency |

**Check 17 — target leakage** is genuinely computed: it correlates every numeric
column against the domain target and flags any with `|r| > 0.99`, reporting the
offending column and its correlation.

**Check 18 — temporal contamination is a stub.** It appends a passing result with
the message "Strict chronological walk-forward split enforced for model
evaluation" and computes nothing. This is recorded as a defect in §35.

**3. Canonicalisation** (`core/canonicalizer.py`) produces a deterministic schema
hash over the canonical column set, so two uploads with the same structure are
recognisable as such.

**4. Versioning.** `hub.dataset_versions` records a SHA-256 of the content and a
lifecycle state: `UPLOADED → MAPPED → VALIDATED → APPROVED_FOR_TRAINING`, or
`REJECTED`. Only `APPROVED_FOR_TRAINING` versions may be used for training.

### 7.2 Provenance

Every row in the operational tables carries a `data_origin` column with a
constrained vocabulary: `REAL_PUBLIC`, `REAL_USER_UPLOADED`, `SYNTHETIC`,
`SYSTEM_GENERATED`, `DERIVED`, `MIXED`. Every row currently present is
`SYNTHETIC`.

Model artifacts carry SHA-256 checksums and smoke-test results in
`app/ml/ARTIFACT_MANIFEST.json`:

```json
"prod_forecast": {
  "filename": "production_forecast_champion.joblib",
  "sha256": "5d8c30ed9385ad6d78a3584f29aef989f2323894a7bc3d2268c7a529ba87e7bf",
  "bytes": 540199, "type": "LGBMRegressor", "module": "lightgbm.sklearn",
  "smoke_passed": true, "smoke_message": "output=186.2954", "status": "OK"
}
```

### 7.3 Feature engineering

`core/features.py` builds a model-ready vector with three guarantees:

1. **Exact column ordering** matching the artifact's saved feature list.
2. **Deterministic missing-value handling** — persisted training medians, not
   run-time means, so the same row always produces the same vector.
3. **Derived temporal features** (`year`, `month`, `day_of_week`) computed from
   the record date.

A design consequence worth stating: because the builder silently substitutes
medians, a caller cannot tell a complete vector from a mostly-imputed one. The
scenario engine therefore counts genuinely-present features separately and feeds
that count into evidence quality (§10.4). Without that, a record with 2 of 49
real values would score identically to a complete one.

---

## 8. Datasets

All row counts read from the deployed PostgreSQL instance on 12 September 2026.

### 8.1 `ops.production_records`

| Property | Value |
|---|---|
| Purpose | Production forecasting and shortfall classification training and serving |
| Rows | 5,000 |
| Columns | 57 |
| Grain | (mine_id, date, zone_id, shift) — **one row is a zone-shift** |
| Key features | `planned_production_t`, `actual_production_t`, `ore_available_t`, `processing_capacity_t`, `equipment_availability_pct`, `average_cycle_time_min`, `truck_queue_time_min`, `haul_distance_km`, `road_condition_score`, `rainfall_24h_mm`, `ore_grade_mn_pct`, `working_hours`, `shift_efficiency`, `blast_delay_hours`, `stockpile_t` |
| Cost columns | `equipment_operating_cost_inr`, `maintenance_cost_inr`, `blast_cost_inr`, `haul_cost_inr`, `processing_cost_inr`, `ore_value_inr` |
| Targets | `actual_production_t` (regression), `shortfall_flag` (binary) |
| Units | tonnes, hours, minutes, km, %, ₹ |
| Temporal coverage | 2024-07-01 to 2025-06-30 (12 months) |
| Spatial coverage | 5 mines, 3 zones each at MH-NAGPUR-01 |
| Missing values | Not systematically profiled; medians persisted for imputation |
| Source | Synthetic benchmark |
| Training usage | Production forecast (49 features), shortfall (49 features) |
| Serving usage | Scenario baseline, state engine, bottleneck, projection, economics |

### 8.2 `ops.equipment_telemetry`

| Property | Value |
|---|---|
| Purpose | Equipment failure prediction |
| Rows | 9,900 |
| Columns | 38 |
| Distinct machines | 85 at MH-NAGPUR-01 (6 trucks); 45–85 per mine |
| Equipment types | truck, excavator, loader, crusher, conveyor, drill, dozer, pump |
| Key features | `vibration_rms`, `engine_temperature_c`, `hydraulic_pressure_bar`, `oil_pressure_bar`, `coolant_temperature_c`, `maintenance_overdue_days`, `failure_count_7d/30d/90d`, `downtime_hours_7d`, `utilization_pct`, `payload_tons`, `odometer_km`, `operator_experience_years` |
| Target | `failure_next_24h` — **INTEGER 0/1 label**, not a probability |
| Temporal coverage | 2024-10-22 to 2024-10-31 (**10 days**) |
| Timestamp columns | `datetime` (TIMESTAMPTZ, canonical, 9,900/9,900 populated) and `timestamp` (TEXT, legacy, holds `'2024-10-31-S3'`) |
| Missing values | `payload_tons` NULL for all non-truck types (correct, but a trap — §35) |
| Source | Synthetic benchmark |
| Training usage | Equipment failure (31 features) |
| Serving usage | Fleet health, equipment risk signal, constraint evaluation |

### 8.3 `geo.prospectivity_grid`

| Property | Value |
|---|---|
| Purpose | Mineral prospectivity mapping and exploration target ranking |
| Rows | 15,173 grid cells |
| Columns | 44 |
| Spatial coverage | Latitude 14.90 – 22.20 °N, longitude 76.30 – 85.59 °E (central Indian manganese belt, extending into Odisha and Karnataka) |
| Spectral features | NDVI, NDMI, NDWI, NDSI, red-edge index, SWIR ratios 1 & 2, NIR/SWIR ratio, red-edge ratio, spectral variance, texture entropy, texture contrast |
| Terrain features | elevation, slope, aspect, hillshade, roughness, terrain ruggedness index, curvature (profile, plan), topographic position index, drainage density |
| Geological features | gondite / BIF / laterite lithology probabilities, formation proximity, fault distance, lineament distance, drainage distance |
| Climate features | annual rainfall, rainy days, soil moisture, mean temperature, cloud cover |
| Geochemistry | `mn_geochemistry` |
| Target | `prospectivity_label` — binary |
| Class balance | 9,508 negative (62.7%) / 5,665 positive (37.3%) |
| Temporal coverage | Not applicable (static survey grid) |
| Source | Synthetic benchmark |
| Training usage | Prospectivity model (37 features) |
| Serving usage | Exploration map, target detail, target ranking |

### 8.4 `ops.mines`

5 rows: MH-NAGPUR-01 (Nagpur Central), MP-BALAGHAT-01 (Balaghat North),
OD-KEONJHAR-01 (Keonjhar East), KA-TUMKUR-01 (Tumkur South), MH-BHANDARA-01.
Columns: `mine_id`, `mine_name`, `state`, `district`, `latitude`, `longitude`,
`active`, `data_origin`. `district` is NULL for all rows.

### 8.5 Operational and governance tables

| Table | Rows | Contents |
|---|---|---|
| `ml.predictions` | 746 | Prediction ledger: task, entity, value, model version |
| `gov.audit_log` | 377 | Append-only event log |
| `gov.decisions` | 117 | Decision records with 9-state lifecycle |
| `gov.decision_outcomes` | 67 | Predicted vs actual, effectiveness |
| `gov.model_registry` | 14 | Champion/challenger registry |
| `gov.alerts` | 5 | Seeded only — no generator (§24) |
| `gov.playbooks` | 4 | Seeded built-in response playbooks |
| `gov.response_plans` | 0 | Created at runtime |
| `ops.incidents` | 0 | Schema present, no writer |

---

## 9. Synthetic data disclosure

**This section is mandatory and its content is not qualified elsewhere in the
report.**

### 9.1 What is synthetic

**All operational and geoscientific data in this prototype is synthetic.** Every
row in `ops.production_records`, `ops.equipment_telemetry` and
`geo.prospectivity_grid` carries `data_origin = 'SYNTHETIC'`. Every row in the
model validation output carries `data_origin: SYNTHETIC`.

This includes:
- All production and cost figures
- All equipment telemetry and failure labels
- All spectral, terrain, geochemical and lithological features
- All prospectivity labels
- The seeded alerts and the majority of seeded decision history

### 9.2 Why synthetic data was used

1. **Real mining operational data is commercially sensitive** and not obtainable
   for a hackathon prototype.
2. **The pipeline is the deliverable.** Synthetic data with realistic structure,
   units and ranges exercises ingestion, validation, feature engineering,
   training, evaluation, governance and serving end to end.
3. **Reproducibility.** Anyone can run the system and obtain the same results.
4. **Demonstration** of workflow without disclosing site information.

### 9.3 What cannot be concluded

> **Synthetic benchmark performance does not establish real-world mining
> accuracy.** The numbers in §12 describe how four algorithms performed on data
> generated by a process we wrote. They say nothing about how they would perform
> on a real mine.

Specifically, the following claims are **not** supported by this work:

- That production can be forecast to within 30.9 t MAE at a real mine
- That equipment failures can be predicted at a real mine at any skill level
- That prospectivity at ROC-AUC 0.90 would transfer to real survey data
- That any target identified by the model contains manganese
- That any figure here constitutes a resource or reserve estimate

The data generator's relationships are, by construction, learnable. §12.5
observes that a linear baseline matches LightGBM on production forecasting,
which is itself evidence that the synthetic relationship is close to linear —
real production is not.

### 9.4 How this is surfaced in the product

Synthetic status is not buried in documentation. The platform:

- Runs on a **BENCHMARK clock** (`core/clock.py`) because the dataset ends
  2025-06-30, and labels every freshness value with its reference date rather
  than implying a live feed
- Displays a **"Benchmark data"** badge in the Command Center context bar
- Reports `data_origin` on every prediction response
- States, in the exploration target description, *"Probability score — not a
  reserve claim. All data SYNTHETIC."*

---

## 10. Machine learning architecture

### 10.1 Pipeline

```
  APPROVED_FOR_TRAINING dataset version
        │
        ▼
  Split materialisation (modal_train.py)
     positional 70 / 15 / 15  ──────► train / validation / test
        │
        ▼
  Preprocessing (per task trainer)
     numeric coercion · median imputation · categorical mapping · scaling
        │
        ▼
  Candidate training
     logistic/linear baseline · random forest · XGBoost · LightGBM
        │
        ▼
  Validation evaluation  ────────────► champion = argmax PR-AUC (or min MAE)
        │
        ▼
  Test evaluation (champion only) ───► *_validation.csv
        │
        ▼
  Artifact + sidecars
     champion · features · medians · catmap · calibrator · explainer
        │
        ▼
  gov.model_registry  (challenger)
        │
        ▼
  Human approval  ───────────────────► champion
        │
        ▼
  ensure_active_model() → ServingStatus → prediction
```

### 10.2 Candidate versus serving models

This distinction is enforced in code and matters for any claim about "how many
models Crucible AI has".

| Term | Meaning | Count |
|---|---|---|
| **Candidate** | Trained and evaluated on validation; may lose | 3–4 per task, 15 total evaluated |
| **Champion** | Selected on validation, evaluated on test, promoted | **4** |
| **Serving** | Champion whose artifact loaded and passed smoke test | **4** |
| **Sidecar artifacts** | Feature lists, medians, category maps, calibrator, explainer, quantile models | 12 |

**Total artifacts on disk: 16.** These are not 16 models. There are **four
serving ML pipelines**, plus P10/P90 quantile regressors for the forecast, plus
supporting metadata.

Candidates that were evaluated and **not** promoted: XGBoost (all four tasks),
LightGBM (three of four), random forest (prospectivity). Their metrics are
recorded in the validation CSVs.

### 10.3 Serving integrity

`ml_loader.ensure_active_model(task)` returns `(model, metadata)` where metadata
carries a `ServingStatus`:

| Status | Meaning | Effect on evidence quality |
|---|---|---|
| `SYNCED` | Serving version equals the registry's authoritative champion | No cap |
| `SYNC_PENDING` | Artifact missing; the previous model is still serving | Caps at MEDIUM |
| `SYNC_FAILED` | Artifact present, integrity checks failed; previous still serving | Caps at MEDIUM |
| `UNAVAILABLE` | Nothing loaded | Caps at LOW; mode becomes HEURISTIC |

Version is read from `gov.model_registry`, **never inferred from
`type(model).__name__`**. Metadata is cached for 120 seconds; promotion and
rollback call `invalidate_model_metadata()` explicitly, so the TTL is a backstop
against out-of-band registry writes rather than the mechanism by which
promotions take effect.

All four tasks currently report `SYNCED`; startup logs `ML artifacts: 16 loaded,
0 skipped`.

### 10.4 The output contract

Every value the platform produces carries three declarations
(`core/provenance.py`):

| Field | Values | Meaning |
|---|---|---|
| `calculation_mode` | `MODEL_BACKED` / `HEURISTIC` / `INSUFFICIENT_DATA` | How it was produced |
| `scope` | `MINE` / `ASSET` / `SHIFT` / `TARGET` / `REGIONAL` / `PLATFORM` | What it describes |
| `evidence_quality` | `HIGH` / `MEDIUM` / `LOW` / `UNAVAILABLE` | How well-supported |

`INSUFFICIENT_DATA` is a first-class outcome, not an error: it means the platform
could have produced a plausible number and declined. The `Measure.unavailable()`
constructor exists so callers never have to invent a zero to satisfy a type.

**Evidence quality replaced a confidence percentage.** The previous
implementation computed `model_conf = 85.0 if baseline_backed else 60.0` and
graded `HIGH if model_conf > 80 else MEDIUM` — a two-branch constant presented as
a calibrated probability, in which `LOW` was unreachable. It is now derived from
five measured factors:

| Factor | Measured from | Weight |
|---|---|---|
| Data freshness | age of newest observation (against the operational clock) | 1.4 |
| Feature completeness | fraction of the 49/37/31 features genuinely present | 1.2 |
| Model availability | champion serving and in sync | 1.5 |
| Historical support | count of comparable past observations | 0.8 |
| Constraint coverage | fraction of applicable constraints actually evaluated | 1.3 |

The grade is **capped, not averaged**, by factors that can independently ruin an
answer: no serving model caps at LOW regardless of data freshness; day-old data
caps at LOW regardless of feature completeness. Averaging would let four good
factors hide one fatal one.

Support is a claim about *inputs*, which is checkable. It is deliberately not a
claim about accuracy, which would not be.

**Calibrated model probabilities retain their numeric form** — see
`ShortfallRiskInfo.probability`. The rule is: a percentage is shown only when a
model produced it.

---

## 11. Model-by-model analysis

### 11.1 Production forecast

| Aspect | Detail |
|---|---|
| **Problem solved** | Predict `actual_production_t` for a zone-shift given operational conditions, so a gap against plan can be detected before the shift ends |
| **Input features** | 49, from `production_forecast_features.joblib`: ore availability, processing capacity, equipment counts and availabilities, cycle and queue times, haul distance, road condition, blast state, weather, stockpile, working hours, shift efficiency, derived `year`/`month`/`day_of_week` |
| **Target** | `actual_production_t` (continuous, tonnes) |
| **Preprocessing** | Numeric coercion; missing values filled from persisted training medians (`production_forecast_medians.joblib`); strict column ordering |
| **Algorithm** | LightGBM regressor (`LGBMRegressor`), 540 KB artifact |
| **Candidates evaluated** | linear baseline, XGBoost, LightGBM |
| **Training procedure** | Fit on train split; all candidates scored on validation; lowest MAE promoted; champion evaluated once on test |
| **Validation methodology** | Temporal split (declared), positional 70/15/15 materialisation |
| **Evaluation metrics** | MAE (primary — same units as the decision), R², MAPE |
| **Current performance** | **Test: MAE 30.90 t, R² 0.774, MAPE 19.26%** |
| **Model version** | `v1.0-champion` |
| **Serving location** | `ensure_active_model("production_forecast")`; used by `routers/production.py`, `core/scenario/engine.py` |
| **Explainability** | SHAP explainer artifact (1.6 MB `TreeExplainer`), fallback to `feature_importances_` |
| **Auxiliary models** | P10 (2.25 MB), P50 (2.23 MB), P90 (2.23 MB) quantile regressors, giving a prediction interval rather than a point estimate |
| **Usage in application** | Production page forecast, scenario baseline, intervention counterfactuals |
| **Limitations** | A linear baseline matches it (§12.5). Output is flat to ±10% moves in availability and cycle-time features, which forces three of five interventions to heuristic estimates (§18.4) |

### 11.2 Shortfall classifier

| Aspect | Detail |
|---|---|
| **Problem solved** | Estimate the probability that a shift misses its production plan — a distinct question from "how far below plan is the forecast" |
| **Input features** | 49 (same vector as the forecast) |
| **Target** | `shortfall_flag` (binary; derived as `actual < planned` where absent) |
| **Preprocessing** | As the forecast, plus probability calibration |
| **Algorithm** | Logistic regression with `CalibratedClassifierCV` |
| **Candidates evaluated** | logistic baseline, XGBoost, LightGBM |
| **Validation methodology** | Temporal split |
| **Evaluation metrics** | ROC-AUC, PR-AUC (primary — the positive class is what matters), Brier score (calibration quality) |
| **Current performance** | **Test: ROC-AUC 0.724, PR-AUC 0.653, Brier 0.217** |
| **Model version** | `v1.0-logistic_baseline_calibrated` |
| **Serving location** | `routers/production.py` — surfaced as `ShortfallRiskInfo.probability` with a 0.30 decision threshold |
| **Why calibration matters** | The platform treats this output as a probability and displays it as a percentage. An uncalibrated classifier's score is a ranking, not a probability, and displaying it as one would be exactly the fabrication this architecture forbids. Brier score is reported because it measures calibration, not just discrimination |
| **Limitations** | **Test PR-AUC (0.653) is nearly double validation (0.348).** A jump that large in that direction most likely reflects different positive-class balance between folds rather than genuine skill. The test figure should not be quoted as expected performance |

### 11.3 Equipment failure

| Aspect | Detail |
|---|---|
| **Problem solved** | Identify machines likely to fail within 24 hours, so inspection can be prioritised |
| **Input features** | 31: `vibration_rms`, `engine_temperature_c`, `hydraulic_pressure_bar`, `oil_pressure_bar`, `coolant_temperature_c`, `battery_voltage_v`, `fuel_consumption_lph`, `payload_tons`, `operating_hours`, `idle_hours`, `load_cycle_count`, `speed_kmh`, `odometer_km`, `maintenance_overdue_days`, `maintenance_days_since`, `failure_count_7d/30d/90d`, `downtime_hours_7d`, `downtime_hours_past_24h`, `total_operating_hours`, `utilization_pct`, `machine_age_years`, `equipment_type` (categorical), ambient conditions, `operator_experience_years`, `ground_condition_score`, `production_tons`, `shift_number` |
| **Target** | `failure_next_24h` (binary, 0/1) |
| **Preprocessing** | Categorical mapping via `equipment_failure_catmap.joblib`; median imputation; calibration |
| **Algorithm** | Logistic regression baseline with calibrator |
| **Candidates evaluated** | logistic baseline, XGBoost, LightGBM |
| **Validation methodology** | Temporal split |
| **Evaluation metrics** | ROC-AUC, PR-AUC, **baseline PR-AUC and lift** (essential for a rare positive class), Brier |
| **Current performance** | **Test: ROC-AUC 0.602, PR-AUC 0.132 against a 0.087 base rate → lift 1.51×, Brier 0.245** |
| **Model version** | `v1.0-logistic_baseline` |
| **Serving location** | `routers/equipment.py` fleet health |
| **Honest assessment** | **This model is weak.** ROC-AUC 0.602 is close to the 0.5 of a coin flip. Its one defensible claim is the lift: it concentrates failures 1.51× better than the base rate, which has value for ordering an inspection queue and none for asserting that a specific machine will fail |
| **How the platform reflects this** | The state engine does **not** present this as a probability. Because `failure_next_24h` is a 0/1 label in this schema, it reports *"11 of 85 machines are flagged for failure within 24 hours"* — a share of the fleet — and annotates the evidence block: *"failure_next_24h is a 0/1 label in this schema, so this is the share of the fleet flagged rather than a calibrated probability."* |

### 11.4 Prospectivity

| Aspect | Detail |
|---|---|
| **Problem solved** | Rank grid cells in the central Indian manganese belt by the likelihood that they warrant ground investigation |
| **Input features** | 37, in four evidence families: **spectral** (NDVI, NDMI, NDWI, NDSI, red-edge index, SWIR ratios, NIR/SWIR ratio, spectral variance, texture entropy, texture contrast), **terrain** (elevation, slope, aspect, hillshade, roughness, TRI, curvature ×3, TPI, drainage density), **geological** (gondite/BIF/laterite lithology probabilities, formation proximity, fault distance, lineament distance, drainage distance), **climate** (rainfall, rainy days, soil moisture, temperature, cloud cover), plus latitude and longitude |
| **Target** | `prospectivity_label` (binary), 37.3% positive |
| **Preprocessing** | scikit-learn `Pipeline` with scaling |
| **Algorithm** | Logistic regression inside a Pipeline |
| **Candidates evaluated** | logistic baseline, random forest, XGBoost, LightGBM |
| **Validation methodology** | Declared spatial; **materialised positionally** — see §13.3 |
| **Evaluation metrics** | ROC-AUC, PR-AUC, Brier |
| **Current performance** | **Test: ROC-AUC 0.901, PR-AUC 0.849, Brier 0.125** |
| **Model version** | `v1.0-logistic_baseline` |
| **Serving location** | `routers/exploration.py` — grid scoring, target detail, ranking |
| **Explainability** | Evidence families surfaced per target; Groq LLM generates a narrative brief from the scored evidence |
| **Limitations** | Test (0.901) exceeds validation (0.837). On a spatial problem that usually indicates an easier test region rather than a better model — **treat 0.837 as the defensible figure.** Latitude and longitude are model inputs, which on a positionally-split dataset allows the model to learn location directly; this is exactly what spatial blocking exists to prevent, and it was not applied |

---

## 12. Model metrics

### 12.1 Champion summary (test split)

| Task | Champion | Metric | Score | Validation type |
|---|---|---|---|---|
| Production forecast | LightGBM | MAE | **30.90 t** | Temporal |
| Production forecast | LightGBM | R² | **0.774** | Temporal |
| Production forecast | LightGBM | MAPE | **19.26 %** | Temporal |
| Shortfall | Logistic (calibrated) | ROC-AUC | **0.724** | Temporal |
| Shortfall | Logistic (calibrated) | PR-AUC | **0.653** | Temporal |
| Shortfall | Logistic (calibrated) | Brier | **0.217** | Temporal |
| Equipment failure | Logistic baseline | ROC-AUC | **0.602** | Temporal |
| Equipment failure | Logistic baseline | PR-AUC | **0.132** (base 0.087, lift 1.51×) | Temporal |
| Equipment failure | Logistic baseline | Brier | **0.245** | Temporal |
| Prospectivity | Logistic baseline | ROC-AUC | **0.901** | Spatial (declared) |
| Prospectivity | Logistic baseline | PR-AUC | **0.849** | Spatial (declared) |
| Prospectivity | Logistic baseline | Brier | **0.125** | Spatial (declared) |

Precision, recall, F1 and RMSE are **not reported** — they are not computed by the
training scripts.

### 12.2 Full candidate comparison (validation split)

| Task | Model | ROC-AUC | PR-AUC | Brier | MAE | R² | MAPE |
|---|---|---|---|---|---|---|---|
| production_forecast | **lightgbm** | — | — | — | **27.46** | **0.8224** | **16.37** |
| production_forecast | xgboost | — | — | — | 27.55 | 0.8207 | 16.43 |
| production_forecast | linear_baseline | — | — | — | 27.55 | 0.8216 | 17.36 |
| shortfall | **logistic** | **0.6235** | **0.3479** | 0.1827 | — | — | — |
| shortfall | lightgbm | 0.6187 | 0.3427 | 0.1863 | — | — | — |
| shortfall | xgboost | 0.6155 | 0.3383 | 0.1873 | — | — | — |
| equipment_failure | **logistic** | **0.5927** | **0.1234** | 0.2416 | — | — | — |
| equipment_failure | xgboost | 0.5807 | 0.1166 | 0.2139 | — | — | — |
| equipment_failure | lightgbm | 0.5753 | 0.1150 | 0.2017 | — | — | — |
| prospectivity | **logistic** | **0.8365** | **0.7095** | 0.1593 | — | — | — |
| prospectivity | random_forest | 0.8323 | 0.6612 | 0.1629 | — | — | — |
| prospectivity | xgboost | 0.8160 | 0.6444 | 0.1729 | — | — | — |
| prospectivity | lightgbm | 0.8098 | 0.6223 | 0.1688 | — | — | — |

Source: `app/ml/FINAL_MODEL_VALIDATION.csv` and the per-task
`artifacts/*_validation.csv`. Bold rows are promoted champions.

### 12.3 Why each metric was chosen

| Metric | Used for | Why |
|---|---|---|
| **MAE** | Production forecast | Same units as the decision (tonnes). A manager can read "±31 t" directly. Less sensitive to outlier shifts than RMSE |
| **R²** | Production forecast | Proportion of variance explained; comparable across mines of different size |
| **MAPE** | Production forecast | Scale-free, allowing comparison between a 100 t mine and a 300 t mine |
| **PR-AUC** | All classifiers | The positive class (shortfall, failure, prospective) is the class of interest and is often rare. ROC-AUC is optimistic under class imbalance because true negatives dominate |
| **Baseline PR-AUC + lift** | Equipment failure | With an 8.7% base rate, PR-AUC 0.132 is meaningless without the baseline. Lift (1.51×) is the interpretable quantity |
| **Brier score** | All classifiers | Measures calibration, not just ranking. Essential because the platform displays these as probabilities |
| **ROC-AUC** | All classifiers | Reported for comparability with published work, but subordinate to PR-AUC here |

### 12.4 Not reported

| Metric | Status |
|---|---|
| Precision, Recall, F1 | Not computed by the training scripts |
| RMSE | Not computed |
| Confusion matrices | Not computed |
| Per-mine breakdowns | Not computed |
| Confidence intervals on metrics | Not computed |
| Feature importance rankings (persisted) | Computed at serving time only |

### 12.5 The pattern across all four tasks

**The simplest model won three of four tasks and effectively tied the fourth.**

| Task | Champion | Beat |
|---|---|---|
| Production forecast | LightGBM | linear by 0.09 t MAE (0.3%) |
| Shortfall | Logistic | XGBoost, LightGBM |
| Equipment failure | Logistic | XGBoost, LightGBM |
| Prospectivity | Logistic | random forest, XGBoost, LightGBM |

On a synthetic benchmark of this size this is the expected outcome, not a
failure. Two implications should be stated plainly:

1. **The gradient-boosting machinery is currently carrying no weight.** A
   reviewer should not read "XGBoost and LightGBM" as evidence of sophistication
   in this system.
2. **The near-tie on production forecasting is evidence about the data**, not
   about LightGBM. A relationship that a linear model captures as well as a
   boosted ensemble is close to linear — which real mine production is not.

---

## 13. Validation methodology

### 13.1 What is claimed

The validation outputs declare:

| Task | `split_type` | `leakage_status` |
|---|---|---|
| production_forecast | temporal | PASS |
| shortfall | temporal | PASS |
| equipment_failure | temporal | PASS |
| prospectivity | **spatial** | PASS |

### 13.2 What is actually implemented

`modal_train._materialize_splits_from_canonical` performs a **positional** split:

```python
n_train = max(1, int(n * 0.70))
n_val   = max(n_train + 1, int(n * 0.85)) if n > 2 else n
train_df = df.iloc[:n_train]
val_df   = df.iloc[n_train:n_val]
test_df  = df.iloc[n_val:]
```

This is a genuine **temporal** split if and only if the canonical CSV is
date-ordered. It is **not a spatial split under any ordering**.

### 13.3 The spatial validation gap

For prospectivity this matters materially. The standard failure in mineral
prospectivity modelling is **spatial autocorrelation**: neighbouring grid cells
share geology, terrain and spectral response. If cell *(i, j)* is in training and
cell *(i, j+1)* is in test, the model has effectively seen the test answer. The
resulting metric measures interpolation between known points, not the ability to
identify prospective ground in an unsurveyed area — which is the only thing an
exploration manager cares about.

This risk is heightened here because **latitude and longitude are model inputs**.
A positionally-split model with coordinates available can learn location
directly.

**The correct machinery exists in this repository and was not used.**
`crucible/core/models/splitters.py` implements genuine spatial block
cross-validation:

```python
lat_bins = pd.qcut(coordinates[latitude_column],  q=min(5, nunique), labels=False, duplicates="drop")
lon_bins = pd.qcut(coordinates[longitude_column], q=min(5, nunique), labels=False, duplicates="drop")
blocks   = lat_bins.astype(str) + "_" + lon_bins.astype(str)
# whole blocks assigned to test, never individual cells
test_blocks = set(shuffled_blocks[:test_block_count])
test_mask   = blocks.isin(test_blocks)
```

A 5×5 quantile grid over the coordinate space, with entire cells assigned to
train or test. `crucible/core/validation/strategy.py` selects this automatically
when latitude and longitude columns are detected, with a stated reason:
*"geographic holdout reduces spatial leakage and tests geographic
generalization."*

**The four committed champion models were not trained through this path.** They
were trained by the standalone scripts in `app/ml/models/`, which read
pre-materialised positional splits.

### 13.4 The leakage claim

`leakage_status: PASS` is a **hardcoded string literal** in all four training
scripts:

```python
"split_type": "temporal", "leakage_status": "PASS", "data_origin": DATA_ORIGIN
```

No leakage test computes it. **It should be read as "not checked", not as
"verified".**

This is the most significant methodological caveat in the report.

### 13.5 What leakage detection does exist

Two implementations exist elsewhere in the platform and are genuinely functional:

| Implementation | Method | Where |
|---|---|---|
| **Statistical** | Correlates every numeric column against the target; flags `\|r\| > 0.99` with the column name and coefficient | `app/api/core/data_validator.py` check 17 |
| **Heuristic screen** | Flags column names containing `future`, `next`, `actual`, `outcome`, `post`, `after`, `result`, `predicted`, `target` | `crucible/core/leakage/detector.py` |

Both run at **ingestion**, on uploaded datasets. Neither runs at **training**,
and neither produced the `PASS` in the validation output.

### 13.6 Holdout discipline (what is correct)

Champion selection is methodologically sound:

```python
champion_name = max(val_results, key=lambda k: val_results[k]["pr_auc"])
champion      = val_results[champion_name]["model"]
test_prob     = champion.predict_proba(X_test)[:, 1]     # test touched once
```

Candidates are compared on **validation**; only the winner is evaluated on
**test**. Selection and reporting use different data, which is correct and is
what makes the test figures meaningful as an estimate of generalisation — within
the limits of the split itself.

### 13.7 Summary

| Property | Status |
|---|---|
| Train/validation/test separation | ✅ Correct |
| Model selection on validation only | ✅ Correct |
| Test touched once | ✅ Correct |
| Temporal ordering for operational data | ⚠️ Correct only if the CSV is date-ordered — not asserted in code |
| Spatial blocking for prospectivity | ❌ Declared, not performed |
| Leakage testing at training time | ❌ Hardcoded PASS |
| Leakage testing at ingestion | ✅ Statistical (Crucible AI) + heuristic (Crucible AI) |
| Cross-validation | ❌ Single holdout, no k-fold |

---

## 14. Model explainability

### 14.1 SHAP attribution

`routers/production.py` loads a persisted SHAP explainer and computes per-feature
contributions for each forecast:

```python
explainer = get_model("prod_explainer")
sv = explainer.shap_values(X)
vals  = np.abs(np.asarray(sv)[0]).ravel()
order = np.argsort(vals)[::-1][:k]
drivers.append({"feature": name, "impact": ..., "direction": "positive" if raw >= 0 else "negative"})
```

Output is a ranked driver list with magnitude and direction, surfaced on the
production page as "top drivers" per prediction.

**Fallback.** If the explainer cannot run for the model type, the code falls back
to `feature_importances_` or `coef_`. This is legitimate, but the fallback is
currently silent (`except Exception: pass`) — the caller cannot tell a SHAP
attribution from a global importance ranking. Recorded in §35.

### 14.2 Risk decomposition (routing)

`core/routing/explain.py` decomposes a haul route's risk score into its six
factors — slope, flood, road condition, mining activity, weather, traffic —
using **the same weighted terms the A\* search minimised**:

```
contribution_i = weight_i × mean_factor_i_along_route
points_i       = 100 × contribution_i / max_risk_weight_sum
```

Because the denominator matches the one used to compute the score, the
contributions **sum exactly to the risk score** (verified: 21.72 = 21.72). This
is an exact decomposition, not a post-hoc attribution, so the explanation and the
decision cannot disagree.

### 14.3 Counterfactual attribution (production)

`core/routing/production.py` attributes a production shortfall to causes by
relaxing one constraint at a time and measuring recovered tonnes — equipment
downtime, route delays, fleet capacity, ore grade, processing bottleneck,
queueing. Contributions are normalised to percentages of the attributable total,
with a note when they do not sum to the shortfall.

Live example:
```
root cause: Low-grade ore 57.3% (14,926 t) | Equipment downtime 42.7% (11,107 t)
```

### 14.4 Constraint explanation

Every constraint check returns a human-readable verdict naming the evidence:

```
"Unit EQ-059 is already 32.33 days overdue for service, past the 14-day lockout.
 Further deferral is refused."
```

### 14.5 What the user sees

For "what is causing this prediction?", the platform provides four layers:

| Layer | Question answered | Mechanism |
|---|---|---|
| SHAP drivers | Which inputs moved this forecast? | Additive attribution |
| State signals | Why is the mine in this state? | Five signals, each with value, threshold, source |
| Bottleneck reason | Which stage is limiting production? | Stage utilisation with runner-up comparison |
| Why-not | Why wasn't the alternative chosen? | Per-objective comparison naming the losing dimension |

Live example of the fourth:

```
Recommended: Raise primary crusher throughput
Why not "Defer non-critical maintenance": Unit EQ-059 is already 32.33 days
overdue for service, past the 14-day lockout. Further deferral is refused.
```

---

## 15. Production intelligence

### 15.1 Terminology — the critical distinction

Two quantities are routinely conflated in mining analytics. Crucible AI separates them
at the field level.

| Quantity | Definition | Source | Field name |
|---|---|---|---|
| **Production gap** | `(planned − forecast)` in tonnes, and `/ planned` as a percentage | Arithmetic on records | `production_gap_t`, `production_gap_pct` |
| **Probability of missing target** | Calibrated likelihood that the shift misses plan | Shortfall classifier | `probability_of_shortfall` |

**They are never merged, and neither is displayed using the other's label.**

This mattered. The field previously named `shortfall_prob` held:

```python
shortfall_base = max(0.0, (plan - baseline_prod) / max(plan, 1))
```

— a production gap ratio — and the frontend rendered it as **"Shortfall Risk
6.8%"**. A manager reading that would reasonably conclude there was a 6.8% chance
of missing plan. The actual meaning was that the forecast was 6.8% below plan,
which is a near-certainty of missing plan, not a 6.8% risk. The two readings are
almost opposite.

### 15.2 Forecast

- **Point estimate**: LightGBM regressor
- **Interval**: P10 / P50 / P90 quantile regressors give a range, not a single number
- **Horizon**: one zone-shift ahead, from the most recent record
- **Drivers**: SHAP top-k per prediction

### 15.3 Production gap signal

The state engine computes the gap over **the last five shifts**, not one:

```
Production is 15.1% below plan over the last 5 shifts — 101 t short of 668 t planned.
```

A single bad shift is noise; a run is a trend. Thresholds: 5% WATCH, 12%
DISRUPTION, 25% CRITICAL, each named as a module constant so it can be tuned
against a site's tolerances rather than being buried in a comparison.

### 15.4 Material flow and bottleneck

Six stages, each with an independently-derived capacity and its own calculation
mode:

| Stage | Capacity basis | Mode |
|---|---|---|
| Face preparation | recorded `ore_available_t` | MODEL_BACKED |
| Loading | 95th-percentile demonstrated rate × current availability ratio | HEURISTIC |
| Haulage | trucks-in-scope × trips/shift × payload, all measured | MODEL_BACKED |
| Processing | recorded `processing_capacity_t` | MODEL_BACKED |
| Stockpile | current stock against highest ever recorded | HEURISTIC |
| Dispatch | — | INSUFFICIENT_DATA |

**Dispatch reports INSUFFICIENT_DATA** because the schema contains no dispatch
throughput. It is not assigned a plausible utilisation.

The bottleneck is the **least-headroom measured stage**. The stockpile is
excluded from candidacy: a full buffer is a symptom of a downstream constraint,
not a constraint itself.

Live output:

```
Face preparation   thru=112.9  cap=123    util= 92.0%  CONSTRAINED  MODEL_BACKED
Loading            thru=112.9  cap=179    util= 63.0%  NOMINAL      HEURISTIC
Haulage            thru=112.9  cap=238    util= 47.4%  NOMINAL      MODEL_BACKED
Processing         thru=112.9  cap=490    util= 23.0%  NOMINAL      MODEL_BACKED
Stockpile          thru=  0.0  cap=5,516  util=  0.0%  NOMINAL      HEURISTIC
Dispatch                n/a       n/a        n/a       UNKNOWN      INSUFFICIENT_DATA
```

**Scope correctness.** Haulage capacity is derived at the production record's own
grain. `production_records` is per zone-shift while `equipment_telemetry` is
mine-wide, so trucks-in-scope is `active_equipment_count × truck_share_of_fleet`,
where the share (7.1% at MH-NAGPUR-01: 6 trucks of 85 machines) comes from the
telemetry composition. Comparing the two directly made haulage read **4% utilised
at every mine**, which would have told a manager that haulage is never worth
examining.

---

## 16. Equipment intelligence

### 16.1 Signals produced

| Signal | Computation | Thresholds |
|---|---|---|
| **Failure exposure** | Share of machines with `failure_next_24h > 0.5`, latest observation per machine via `DISTINCT ON` | 35% WATCH, 55% DISRUPTION |
| **Maintenance backlog** | Count and worst case of `maintenance_overdue_days` | 7 days WATCH, 21 days DISRUPTION |
| **Utilisation** | `utilization_pct` per machine and type | Reported, not thresholded |
| **Availability** | Per type: truck, loader, excavator, drill | Feeds loading capacity |

### 16.2 Production exposure

Equipment risk is converted into production terms using `production_tons` recorded
against the flagged machines — a **measured contribution**, not an allocation of
mine output:

```
Mean recorded output of the 11 flagged machine(s) (X t each per observation)
```

Where the flagged machines have no recorded production, the platform reports
`INSUFFICIENT_DATA` rather than apportioning.

### 16.3 Connection to production decisions

This is the link that makes equipment intelligence operational rather than
informational:

```
equipment_risk signal
      ↓
attention item (with production exposure, or an explicit "not estimated")
      ↓
recommendations engine → RESPONSE_MAP["equipment_risk"]
      ↓
candidate actions: equipment_redeploy, maintenance_defer
      ↓
constraint engine evaluates each
      ↓  maintenance_defer REFUSED: "EQ-059 is 32.33 days overdue, past the
      ↓  14-day lockout"
      ↓
response plan with the permitted actions only
```

A machine's condition therefore changes which production interventions are
offered — a deferral is withdrawn from the menu when a unit is past its lockout,
rather than being offered and rejected later.

### 16.4 Handover watchlist

`core/handover.py` produces a named watchlist for the incoming supervisor:

```
Units to watch: EQ-008, EQ-013, EQ-034, EQ-042
  EQ-008  Flagged for failure within 24 hours
  EQ-059  32 days overdue for service
```

---

## 17. Exploration and GIS

### 17.1 What Crucible AI does and does not claim

> **Crucible AI does not detect manganese from space.**

Spectral indices derived from satellite imagery can carry evidence associated
with surface mineralogy and alteration. That evidence is weak on its own, is
confounded by vegetation, moisture and cloud, and describes the surface only.

Crucible AI combines **four independent evidence families** — spectral, terrain,
geological, climatic — and produces a **ranking of areas for ground
investigation**. The output is a prospectivity score for prioritising survey
effort.

It is **not**:
- direct mineral detection
- a resource estimate
- a reserve estimate or certification
- a statement that any target contains manganese

The application states this in the target description text itself: *"Probability
score — not a reserve claim. All data SYNTHETIC."*

### 17.2 GIS architecture

| Component | Implementation |
|---|---|
| Rendering | MapLibre GL, imperative API (`react-map-gl` is not a dependency) |
| Coordinate handling | WGS84 lat/lon; Crucible AI `core/geospatial/crs.py` normalises and validates CRS, and enforces equivalence across layers before any stacking |
| Raster alignment | `core/geospatial/prospectivity.py` — `align_raster`, `stack_layers`, `valid_pixel_mask` |
| Grid serving | `geo.prospectivity_grid`, 15,173 cells, scored by the champion model |
| Target detail | Per-cell evidence breakdown across the four families |
| Narrative | Groq LLM generates a brief **from the scored evidence** |

**CRS discipline** matters and is enforced: `require_same_crs(*crs_values)` raises
rather than silently reprojecting. Stacking layers in mismatched projections
produces a plausible-looking raster in which features are spatially offset from
one another — a failure that is invisible in the output.

### 17.3 Target ranking

Targets are ranked by prospectivity probability with evidence coverage reported
alongside. The exploration page shows per-target: probability, maturity stage,
lithology host, geochemistry index, and the evidence families contributing.

### 17.4 Uncertainty

- Probability is from a **calibrated** pipeline, so the score is interpretable
- Brier score 0.125 (test) measures that calibration
- Evidence coverage is reported per target
- **Spatial uncertainty is not quantified** — no prediction intervals or spatial
  confidence surfaces are produced. Combined with the spatial validation gap
  (§13.3), exploration outputs from this prototype should be treated as
  demonstrative

---

## 18. Scenario engine

### 18.1 Workflow

```
  Current state (ScenarioContext)
     baseline production · planned production · feature vector ·
     serving model · provenance · operational clock
        │
        ▼
  Candidate interventions (catalogue, 6 entries)
        │
        ▼
  Constraint evaluation ◄── HARD constraints checked BEFORE any effect computed
        │                    A blocked action receives no number at all
        ▼
  Effect estimation
     1. Model counterfactual (move all controlled features, re-score)
     2. Flat-response detection → declared estimate, with the reason stated
     3. No baseline → INSUFFICIENT_DATA
        │
        ▼
  Cost (derived from the mine's own recorded cost lines)
  Risk (declared per intervention)
  Evidence quality (five measured factors)
        │
        ▼
  Objective-driven ranking  ── MAXIMIZE_PRODUCTION | BALANCED |
        │                      MINIMIZE_COST | MINIMIZE_RISK
        ▼
  Selection + why-this / why-not explanation
```

### 18.2 Inputs

Manager-facing controls, deliberately expressed as operational latitude rather
than model parameters:

| Control | Values | Meaning |
|---|---|---|
| `objective` | 4 options | What the manager is optimising for |
| `max_additional_fuel_pct` | 0–30% | Ceiling on extra fuel traded for production |
| `fleet_reallocation` | NONE/LOW/MEDIUM/HIGH | How much fleet movement is permitted |
| `route_flexibility` | NONE/LOW/MEDIUM/HIGH | How much rerouting is permitted |
| `maintenance_flexibility` | NONE/LOW/MEDIUM/HIGH | Whether deferral is on the table |
| `operating_time_flexibility` | NONE/LOW/MEDIUM/HIGH | Whether extended running is permitted |
| `risk_tolerance` | CONSERVATIVE/BALANCED/AGGRESSIVE | Filters high-exposure actions |
| `max_actions` | 1–6 | More than a handful is not a plan a shift can execute |

The control previously labelled **"Fleet Fuel Surge Tolerance"** — not a phrase a
mine manager uses — is now **"Maximum Additional Fuel"** with the helper text
*"Maximum additional fuel consumption the scenario may consider in exchange for
higher production."*

### 18.3 The intervention catalogue

One definition per action (`core/scenario/catalogue.py`), declaring together: the
features it controls, its declared effect, its cost driver, its risk effect, its
trade-offs, its horizon, its owner, and its approval roles.

| Key | Title | Horizon | Owner | Approval |
|---|---|---|---|---|
| `equipment_redeploy` | Reallocate haulage to the constrained route | NEXT | Fleet Coordinator | production_admin |
| `fleet_reroute` | Reroute haulage away from the congested corridor | NEXT | Dispatch | production_admin |
| `crusher_speed_trim` | Raise primary crusher throughput | NEXT | Processing Supervisor | production_admin |
| `blast_reschedule` | Advance the next blast | NEXT_SHIFT | Drill & Blast Engineer | production_admin, super_admin |
| `maintenance_defer` | Defer non-critical maintenance | NEXT_SHIFT | Maintenance Manager | equipment_admin, super_admin |
| `extend_operating_hours` | Extend productive operating time | NOW | Shift Supervisor | production_admin |

A guard test enforces that every entry declares trade-offs, an approver and a
valid horizon. **A recommendation with no stated downside is a sales pitch.**

### 18.4 MODEL_BACKED versus HEURISTIC — never conflated

The counterfactual moves **every feature the action controls, together**. A
haulage reallocation raises availability, utilisation and operating hours
simultaneously; moving one while holding the others fixed is not the intervention
being offered.

**Flat-response detection.** A tree ensemble returns exactly `0.0` when a feature
move crosses no split boundary. That is a fact about the model, not about the
mine. Reporting "this action achieves nothing" would be an overclaim, so the
estimate falls back to the catalogue's declared value and states why:

```
equipment_redeploy      +8.87 t  HEURISTIC     the model's output is flat to a +10%
                                               move in equipment_availability_pct,
                                               available_equipment_count, ...
fleet_reroute           +7.98 t  HEURISTIC     flat to a −10% move in
                                               average_cycle_time_min, ...
crusher_speed_trim      +0.85 t  MODEL_BACKED  re-scored with processing_capacity_t +10%
blast_reschedule        +0.34 t  MODEL_BACKED  re-scored with ore_available_t +10%
extend_operating_hours  +5.32 t  HEURISTIC     flat to a +10% move in working_hours
maintenance_defer         n/a    REFUSED       EQ-059 is 32.33 days overdue
```

**A heuristic result is never called an ML prediction.** This is enforced by the
type system: `InterventionOutcome.calculation_mode` is required, and the
serialiser emits it on every action.

**Clamping.** A model delta beyond ±25% of baseline is extrapolation rather than
prediction, and is clamped with the clamp declared in the method string.

### 18.5 Constraints

| Kind | Behaviour |
|---|---|
| **HARD** | Never violated. Blocks when `FAILED` **or `NOT_EVALUATED`** |
| **SOFT** | Shapes ranking only. Penalty applies only when unsatisfied |

**A hard constraint that could not be evaluated blocks.** The code this replaced
found no equipment rows, set *"No live data available; assuming typical
availability"*, left the feasibility multiplier at 1.0, and approved a redeploy on
data that did not exist.

> Absence of evidence is not evidence of safety.

An action with no registered evaluator is **refused**, not assumed safe. Adding an
action type therefore requires deciding what governs it.

Implemented evaluators:

| Action | Hard constraints | Named threshold |
|---|---|---|
| `equipment_redeploy` | A healthy unit is available | `MAX_REDEPLOY_FAILURE_RISK = 0.60` |
| `blast_reschedule` | Blast falls in a permitted shift window | S3 (night) prohibited, DGMS-informed |
| `maintenance_defer` | No unit past maintenance lockout | `MAINTENANCE_LOCKOUT_DAYS = 14` |
| `crusher_speed_trim` | Within motor vibration tolerance | `MAX_CRUSHER_TRIM = 0.20` |
| `fleet_reroute` | A compliant haul route exists | Evaluated by running A* on the terrain surface |
| `extend_operating_hours` | Within working-time limits | `MAX_SHIFT_OPERATING_HOURS = 12.0` |

Every threshold is a named module constant so it can be reviewed against a site's
own rules. Where a rule encodes regulation, the citation is named in the reason
text — **Crucible AI asserts no regulatory authority of its own.**

The `fleet_reroute` check is not a stub: it builds the terrain cost surface and
runs A* to confirm a compliant route exists for the vehicle profile.

### 18.6 Ranking — nothing is best in the abstract

Each objective has its own scorer, and `winners()` reports the leader under
**every** objective so disagreement is visible:

```
objectives_agree = False
winners = { MAXIMIZE_PRODUCTION: crusher_speed_trim,
            BALANCED:            crusher_speed_trim,
            MINIMIZE_COST:       fleet_reroute,
            MINIMIZE_RISK:       crusher_speed_trim }
```

That disagreement is the useful output — it is precisely the moment the choice
belongs to the manager rather than the platform.

**An unpriced action does not win on cost.** Treating a missing cost estimate as
zero would make every unpriced option win; it sorts below anything priced.

### 18.7 Cost model

Derived from each mine's own recorded cost lines, not a flat rate:

```
MH-NAGPUR-01, 113 shifts observed
  equipment operating   ₹ 84,410 / shift
  maintenance           ₹ 63,689
  blast                 ₹ 68,754
  processing            ₹ 36,113
  haul                  ₹  1,583
  ───────────────────────────────
  total                 ₹254,549 / shift  →  ₹1,987 / t
  ore value             ₹898,811 / shift  →  ₹7,015 / t
```

The previous model was `abs(delta) × ₹1,200/t`, which made cost strictly
proportional to benefit — every intervention had identical return on investment
and the cost term could not influence ranking at all. A manager selecting
"minimise cost" was being ranked by production in disguise.

**These remain modelled estimates**, clearly labelled: unit rates observed from
the mine's records applied to a proportional change. They are not quoted prices,
and no financial ROI is claimed anywhere in the platform.

---

## 19. Decision intelligence

### 19.1 Lifecycle

```
DRAFT → SIMULATED → READY_FOR_REVIEW → APPROVED → EXECUTING → COMPLETED → MEASURED → LEARNED
                          ↓                ↓
                       REJECTED ←──────────┘
                          ↓
                        DRAFT
```

Enforced by `core/decision_store.TRANSITIONS`. Three deliberate choices:

- **REJECTED can return to DRAFT.** A rejection usually means "not like that";
  forcing a new record would sever the history of what was asked.
- **APPROVED can reach REJECTED.** Authorisation can be withdrawn before work starts.
- **Nothing leaves LEARNED.** A superseding decision is a new decision, so the
  record of what was believed at the time stays intact.

Illegal transitions are refused with the permitted set named:

```
409  Response plan RP-000003 cannot move from SIMULATED to COMPLETED.
     allowed: ['DRAFT', 'READY_FOR_REVIEW', 'REJECTED']
```

### 19.2 Response plans

`GET /command-center/response-plan` generates, and `POST /response-plans`
persists, a plan containing:

| Section | Content |
|---|---|
| Situation | Assembled from the attention item and the projection |
| Evidence | Drivers, impact, impact basis, bottleneck, clock reference |
| Root cause | Binding stage **only when genuinely constrained** (§35) |
| Actions | Grouped NOW / NEXT / NEXT_SHIFT, each with owner and effect |
| Not available | Actions considered and refused, with the constraint reason |
| Expected | Delta, residual gap, calculation mode |
| Do nothing | Full projection |
| Comparison | Every option against the baseline at one horizon |
| Constraints checked | Per action, with feasibility |
| Risks | Union of the selected actions' trade-offs |
| Approval | Required roles and owners |

### 19.3 Approval

**The strictest action governs.** A plan is approved as a whole, so a plan
containing a maintenance deferral requires the equipment approver even if its
other actions do not — otherwise the role model could be bypassed by bundling.

Verified:
```
409  Role 'equipment_admin' cannot approve this plan. It contains actions
     requiring one of: production_admin, super_admin.
```

**A rejection requires a rationale.** A refusal with no reason cannot inform the
next one:
```
422  A rejection needs a reason.
```

### 19.4 Audit shares the transaction

The audit write is **not** wrapped in `try/except`. If it cannot be recorded, the
state change does not happen:

```python
def _write_audit(tx, entry: AuditEntry) -> None:
    tx.execute("INSERT INTO gov.audit_log (...) VALUES (...)", (...))
    # Deliberately not wrapped. An unrecorded state change is worse than no
    # state change.
```

The routers this replaced used `except Exception: pass`, so a broken audit log
was indistinguishable from a working one — and the ledger is the only thing that
makes a decision reconstructable afterwards.

Verified trail for one plan:
```
response_plan.created           test_manager (production_admin)
response_plan.ready_for_review  test_manager (production_admin)
response_plan.approved          test_manager (production_admin)
response_plan.executing         test_manager (production_admin)
response_plan.completed         test_manager (production_admin)
response_plan.measured          test_manager (production_admin)
```

### 19.5 Decision package

`core/decision_package.py` renders one situation as an approvable document —
JSON or Markdown — in eleven sections: situation, root cause, evidence, if no
action, options considered, recommendation, why not the alternatives, constraints
checked, risks, what happened last time, approval.

It is a **rendering, not a new computation**: every field is drawn from the
response plan, projection, comparison and decision memory. It introduces no
numbers of its own, which is what makes it auditable against the systems that
produced it.

It carries its own lineage — model version, dataset version, calculation mode,
evidence quality, clock reference — so a package read in three months can be
reconstructed rather than interpreted against whatever the registry says then.

### 19.6 Playbooks

A playbook encodes a site's standing answer to a recurring situation: trigger
conditions, ordered steps, owners, and a pointer to the site's own approved
procedure (`site_procedure_ref`) where one governs.

Four built-ins are seeded as a **starting point to be edited**, not as authority.

Three properties:

- **Triggers evaluate against measured signals only.** An `INSUFFICIENT_DATA`
  signal never satisfies a clause — a playbook firing on absence would be an
  alarm with no evidence behind it.
- **Triggers narrow by stage.** A haulage playbook must not fire when the face is
  the constraint, because haulage actions cannot relieve it.
- **Dormant playbooks are returned with their reason.** Without them there is no
  way to distinguish "nothing is wrong" from "the check never ran".

Live evaluation:
```
FIRED  Face preparation is the binding constraint   material flow constraint concerns face; 92.0 gte 85.0
FIRED  Production falling behind plan               production against plan is disruption
quiet  Haulage is the binding constraint            the constrained stage is face, not haulage
quiet  Fleet failure exposure is elevated           equipment failure exposure is none, below required watch
```

### 19.7 Shift handover — IMPLEMENTED (backend only)

`core/handover.py` produces structured findings with sources, plus a
deterministic narrative.

**The narrative is assembled from the findings, not generated by an LLM.** Every
sentence restates a `Finding` that is also present in the structured payload. A
handover is read by someone who was not there and cannot check it, which makes it
the worst possible place for an invented number.

If a language model is introduced later, the contract is that it receives these
facts and may not add to them.

**Gap: no frontend page.** The endpoint exists at
`GET /command-center/handover`; nothing in the UI calls it.

### 19.8 Incident replay — PLANNED

`ops.incidents` and `ops.incident_events` exist with a full event vocabulary
(`DETECTED`, `THRESHOLD_CROSSED`, `IMPACT_ESTIMATED`, `PLAN_GENERATED`,
`PLAN_APPROVED`, `ACTION_STARTED`, `ACTION_COMPLETED`, `OUTCOME_RECORDED`,
`RESOLVED`). `decision_store` writes incident events when a plan is linked to an
incident. **No incident is ever created**, so the replay has nothing to replay.

---

## 20. Manager Command Center

### 20.1 Why not a collection of charts

A mine manager opening the platform at 08:00 during a difficult shift does not
need seven graphs and a score out of 100. They need to know whether anything
requires them, and what to do about it within the shift.

The previous landing experience was the production page: a forecast chart, KPI
tiles, and a "Mine Pulse" score. **The score blended production, equipment,
exploration, data quality and governance into one number** — scopes that cannot
meaningfully be averaged. A mine cannot be 82% operational, and 82 does not tell
anyone whether to act.

### 20.2 Information hierarchy

The page order is the payload order, so the two cannot drift:

```
1. OPERATIONAL STATE      Does the mine need me right now?
   ↓
2. ATTENTION REQUIRED     What first?
   ↓
3. RECOMMENDED ACTIONS    What do I do about it?
   ↓
4. IF NOTHING IS DONE     What does waiting cost?
   ↓
5. MATERIAL FLOW          What is limiting production?
```

Charts do not appear above decisions.

### 20.3 State engine

Five independent signals, evaluated **concurrently**, each carrying value, unit,
source, timestamp, threshold, calculation mode and a plain-language reason:

```
DISRUPTION — Production is 15.1% below plan over the last 5 shifts,
             101 t short of 668 t planned. Also contributing: maintenance backlog.

  DISRUPTION  Production against plan       15.06 %      MODEL_BACKED
  NONE        Equipment failure exposure     0.13 share  MODEL_BACKED
  DISRUPTION  Maintenance backlog           32.33 days   MODEL_BACKED
  WATCH       Material flow constraint      92.00 %      MODEL_BACKED
  NONE        Open incidents                 0    count  MODEL_BACKED
```

**State is the worst severity present, not an average.** Averaging lets four
healthy signals bury one critical one.

**A signal that fails to evaluate is reported as a failed signal, never dropped.**
Dropping it would quietly *raise* the state, since state is the worst of what
remains — a broken equipment check would make a mine look healthier than it is.

**UNKNOWN is distinct from NORMAL.** A mine nobody is measuring is not a healthy
mine.

### 20.4 Scope separation

`platform_state()` is returned separately and covers data freshness and model
serving integrity:

```
MINE      DISRUPTION   production 15.1% below plan
PLATFORM  WATCH        benchmark dataset, last observation 27 Jun 2025
```

Stale data is a platform problem, not a mining one. Merging them would make a
mine with a broken feed look like a mine in trouble, and would let good data
hygiene mask a real production problem.

### 20.5 Attention queue

Ranked by `severity × urgency × evidence`, with impact as a tiebreaker that
cannot promote a low-severity item above a critical one. Capped at six — a queue
of thirty items is a list, not a priority.

**Items whose evidence is UNAVAILABLE are separated into "knowledge gaps"**, not
ranked among operational problems. Sorting "we cannot see this" next to
"production is 15% down" invites a manager to treat them as comparable, and they
are not.

### 20.6 How modules feed it

| Section | Source module |
|---|---|
| Operational state | `state_engine.mine_state()` |
| Platform health | `state_engine.platform_state()` |
| Attention queue | `attention.build()` ← state signals |
| Recommendations | `recommendations.build()` ← attention + `scenario/` |
| Do nothing | `projection.do_nothing()` |
| Material flow | `bottleneck.analyse()` |
| Response plan | `response_plan.generate()` ← all of the above |

One `mine_state()` evaluation is shared across the summary; computing it twice
was a measured 8-second cost against this database.

### 20.7 Implementation status

| Element | Status |
|---|---|
| Operational state banner with expandable signals | IMPLEMENTED |
| Attention queue with impact and evidence | IMPLEMENTED |
| Knowledge gaps section | IMPLEMENTED |
| Recommended actions with why/cost/trade-offs | IMPLEMENTED |
| Blocked actions, expandable | IMPLEMENTED |
| Do-nothing projection | IMPLEMENTED |
| Material flow with per-stage basis | IMPLEMENTED |
| Response plan drawer with full lifecycle | IMPLEMENTED |
| Mine selector, authorisation-filtered | IMPLEMENTED |
| Benchmark data badge | IMPLEMENTED |
| Skeleton loading states | IMPLEMENTED |
| Shift handover page | **NOT IMPLEMENTED** (API exists) |
| Incident timeline | **NOT IMPLEMENTED** |
| Command palette (Ctrl+K) | **NOT IMPLEMENTED** |
| Mobile Command Center | **NOT IMPLEMENTED** (`/m` serves the old page set) |

---

## 21. What if we do nothing

### 21.1 Why it matters

A manager shown "we are 6.8% below plan" has a fact. A manager shown "and by end
of shift that becomes 118 t, after which the shift cannot be recovered" has a
decision. This is the counterfactual baseline against which every option is
compared.

### 21.2 How it is calculated — and what it is not

**`calculation_mode` is `HEURISTIC` throughout, deliberately.**

The projection extrapolates the mine's own **observed shortfall rate** under the
stated assumption that conditions persist unchanged:

```
rate = (planned − actual) / working_hours    over the last 5 shifts
shortfall(t) = rate × t
```

Live example:
```
rate = 2.52 t/h

In 30 minutes     1.3 t   recoverable=True   A response started now can still recover this shift
In 2 hours        5.0 t   recoverable=True
By end of shift  20.1 t   recoverable=False  Past the point where redirecting the fleet pays back
By end of day    60.4 t   recoverable=False  Beyond this shift — the gap carries forward
```

**Why not a model.** The production model forecasts a shift given its features;
it does not forecast how a shift decays hour by hour, and no hourly data exists
to fit that on. Presenting a model-backed hourly curve would be extrapolation
dressed as prediction. A linear persistence of a measured rate is a weaker claim,
and a true one.

The assumptions are returned in the payload and rendered in a "What this assumes"
disclosure:

> *Conditions persist unchanged. The rate is the mine's own measured shortfall of
> 101 t over 40 recorded working hours across 5 shifts.*
> *This is a linear persistence of an observed rate, not a forecast model.*
> *The recovery window assumes a response is worth starting within the first 65%
> of an 8-hour shift.*

### 21.3 Option comparison

Every option is compared **at the same horizon**, which is explicit in the payload
rather than implied:

| Option | Shortfall at shift end | Recovered | Cost |
|---|---|---|---|
| **Do nothing** (baseline) | 52.0 t | — | ₹0 |
| Reroute haulage | 40.4 t | +11.6 t | ₹158 |
| Extend operating time | 44.3 t | +7.7 t | ₹8,441 |
| Advance the next blast | 50.6 t | +1.4 t | ₹6,875 |
| Raise crusher throughput | 51.0 t | +1.0 t | ₹3,611 |

A note accompanies the table: *"Recovered tonnes are each option's own estimate;
they are not additive across options unless the options are independent."*

---

## 22. Decision memory

### 22.1 What it answers

Most platforms answer *"what does the model predict?"*. Decision memory answers a
question managers trust more, because it is about their own mine:

> **"We have been here before — what did we do, and did it work?"**

### 22.2 Stored information

`gov.decisions` joined to `gov.decision_outcomes`:

| Field | Purpose |
|---|---|
| `problem`, `recommendation` | What the situation was and what was done |
| `mine_id`, `shift_id` | Scope (added by migration 003) |
| `lifecycle_state` | Only MEASURED / LEARNED / COMPLETED are retrievable as history |
| `objective` | What was being optimised |
| `calculation_mode`, `evidence_quality` | How well-supported the original estimate was |
| `model_version`, `dataset_version` | Lineage |
| `predicted_value`, `actual_value`, `delta` | The outcome |
| `effectiveness`, `variance_pct`, `variance_reason` | How the prediction fared and why |

### 22.3 Similarity logic

| Stage | Method |
|---|---|
| **Structural (preferred)** | Exact match on `intervention_key` → similarity 1.0, `match_basis: "exact"` |
| **Textual (fallback)** | Jaccard overlap of stopword-filtered tokens over problem + recommendation, threshold 0.12, `match_basis: "textual"` |
| **Scope** | This mine first; widens to other mines only if fewer than 3 cases, and says so |
| **Test data** | Rows matching `test|guard|rollback|dummy|sample|fixture` are excluded |

### 22.4 Three properties that keep it honest

**1. Duplicates are collapsed** on `(problem, recommendation, predicted, actual)`.
The seeded history contains one decision written **37 times**. Counted separately
it presented as independent corroboration and produced *"5 measured cases, median
48 t"* from a single observation. After collapsing:

```
cases: 1
note : Only 1 distinct comparable case(s) found with a recorded outcome — fewer
       than the 3 needed before Crucible AI will summarise them. They are listed
       individually instead. 36 duplicate record(s) of the same event were collapsed.
summary: None
```

**2. No aggregate below 3 distinct cases.** *"Median recovery 3.7%"* reads as a
statistic regardless of whether it came from thirty cases or two.

**3. Unscoped records are labelled.** Rows predating migration 003 have no mine
recorded; they are included for a mine-scoped search but tagged `mine_unscoped`
rather than attributed to the mine being asked about.

### 22.5 Limitations

- The usable history is **one distinct case**. The feature is correct and
  exercised, but there is not yet enough recorded operational history for it to
  be informative.
- Textual similarity is lexical. Two descriptions of the same situation in
  different words will not match.
- No embedding or semantic similarity.

---

## 23. Outcome learning

### 23.1 The loop

```
PREDICT  →  DECIDE  →  APPROVE  →  ACT  →  OBSERVE  →  LEARN
```

### 23.2 Predict

A response plan records `expected_delta_t`, its `calculation_mode`, its
`evidence_quality`, and the `model_version` and `dataset_version` that produced
it. **Lineage travels with the plan**, so a decision read months later can be
reconstructed without depending on whatever the registry says by then.

### 23.3 Observe

`POST /response-plans/{id}/outcome` records what actually happened:

```json
{
  "plan_ref": "RP-000003",
  "predicted_t": 23.4,
  "actual_t": 18.4,
  "delta_t": -5.0,
  "variance_pct": -21.4,
  "effectiveness": 0.786,
  "variance_reason": "Hauler H-03 unavailable for 2 hours.",
  "lifecycle_state": "MEASURED"
}
```

`effectiveness = actual / predicted`, **bounded at 1**. A result that beat the
prediction is not "160% effective" — it is a prediction that was low, and
`variance_pct` already says so.

**Effectiveness measures how well Crucible AI forecast the result, not whether the
decision was good.** That wording is preserved in every surface showing the
number, because the two readings lead to opposite conclusions when a good
decision produces a disappointing outcome for reasons nobody could have modelled.

### 23.4 Learn

Outcomes feed `core/decision_memory.similar()`, surfaced when a comparable
situation recurs.

### 23.5 What is NOT implemented

> **There is no automatic retraining.** Nothing triggers a training run from
> accumulated outcomes.

`gov.decision_outcomes` accumulates paired prediction/actual observations under
real operating conditions. These are **not** used as training labels — the volume
is far too low (67 rows, mostly seeded) and the outcomes are human-reported.

What they support today is **evaluation**: systematic variance in one direction
for one intervention type is evidence that the effect estimate for that action is
wrong, which is actionable without any retraining.

**Boundary.** The decision loop learns about *the platform's estimates*. The
training loop learns about *the mine*. Conflating them would let an operator's
judgement call become a training label, which is how a model quietly learns to
predict what people already believe.

---

## 24. Alerts and incidents

### 24.1 Alerts — PARTIAL

| Capability | Status |
|---|---|
| `gov.alerts` schema with severity CHECK (`critical`/`warning`/`info`) | IMPLEMENTED |
| `GET /api/v1/alerts` with role-filtered alert types | IMPLEMENTED |
| `POST /api/v1/alerts/{id}/acknowledge` | IMPLEMENTED |
| Role-based alert type filtering (`production_admin` sees production, shortfall_risk, data_freshness, production_forecast) | IMPLEMENTED |
| **Alert generation** | **NOT IMPLEMENTED** |

> **Nothing in the application generates alerts.** A repository-wide search for
> `INSERT INTO gov.alerts` finds only `seed_db.py`. The 5 rows present
> (equipment_failure, shortfall_risk, data_freshness, prospectivity_update) were
> seeded.

The alert surface is read-only from the application's perspective. The state
engine computes exactly the conditions that should produce alerts — it simply
does not write them.

### 24.2 Incidents — PLANNED

`ops.incidents` and `ops.incident_events` were created by migration 002 with:

- 8 incident types, 4 severities, 5 statuses
- A deduplication index: one open incident per `(mine_id, signature)`
- 11 event types for the timeline
- Impact estimate with `calculation_mode` and `evidence_quality`

`core/attention.py` already computes the `signature` and `incident_type` needed
to create them:

```python
INCIDENT_TYPE = {"production_gap": "PRODUCTION_SHORTFALL",
                 "equipment_risk": "EQUIPMENT_RISK",
                 "bottleneck":     "HAULAGE_BOTTLENECK", ...}
signature = f"{mine_id}:{signal.key}:{stage_or_machine}"
```

`decision_store` writes incident events when a plan carries an `incident_id`.

**The missing piece is a single writer** that promotes a sustained attention item
into an incident. Everything downstream of that is built.

### 24.3 How incidents would connect

```
attention item (signature, incident_type, severity, impact)
      ↓ [NOT IMPLEMENTED: promotion]
ops.incidents  ← deduplicated on signature
      ↓
ops.incident_events  DETECTED → THRESHOLD_CROSSED → IMPACT_ESTIMATED
      ↓
gov.response_plans (incident_id FK)  → PLAN_GENERATED
      ↓
gov.decision_approvals               → PLAN_APPROVED
      ↓
gov.decision_outcomes                → OUTCOME_RECORDED
      ↓
incident RESOLVED  →  replay timeline available
```

---

## 25. Role-based access control

### 25.1 Roles

Six roles, from `core/rbac.VALID_ROLES`:

| Role | Department | Intent |
|---|---|---|
| `super_admin` | all | Full platform control; bypasses every role check |
| `management` | all | Cross-domain read and decision authority |
| `production_admin` | production | Shift operations |
| `equipment_admin` | equipment | Fleet maintenance |
| `exploration_admin` | exploration | Geology and assays |
| `mine_planner` | planning | Scenario simulation and planning |

Clerk users with no role default to `unassigned` (no privilege).

### 25.2 Permission matrix

Read access is broadly available to authenticated users; write and approval
authority is gated. ✅ full · 👁 read · ❌ none.

| Role | Production | Equipment | Exploration | Scenarios | Data Hub | Models | Decisions | Approve plan | Admin |
|---|---|---|---|---|---|---|---|---|---|
| `super_admin` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ any | ✅ |
| `management` | 👁 | 👁 | 👁 | ✅ | 👁 | 👁 | ✅ | ❌ | ❌ |
| `production_admin` | ✅ | 👁 | 👁 | ✅ | ✅ | 👁 | ✅ | ✅ production actions | ❌ |
| `equipment_admin` | 👁 | ✅ | 👁 | ✅ | ✅ | 👁 | ✅ | ✅ maintenance actions | ❌ |
| `exploration_admin` | 👁 | 👁 | ✅ | ✅ | ✅ | 👁 | ✅ | ❌ | ❌ |
| `mine_planner` | 👁 | 👁 | 👁 | ✅ | 👁 | 👁 | ✅ | ❌ | ❌ |

**Approval authority is per action, not per plan.** A plan is approved as a whole
and the strictest action governs, so a plan containing `maintenance_defer`
requires `equipment_admin` or `super_admin` even if every other action needs only
`production_admin`.

### 25.3 Mine-level scoping

Role checks answer *what*; mine scoping answers *where*. Both must hold.

Resolution order in `check_mine_access`:

1. `super_admin` → all mines
2. `allowed_mines` in Clerk `publicMetadata` → enforced (`"*"` / `"all"` grants all)
3. `mine_id` in metadata → that mine only
4. **Unscoped** → refused when `ENVIRONMENT=production`; permitted elsewhere with
   a WARNING logged once per user

```python
if settings.ENVIRONMENT.lower() == "production":
    logger.warning("Mine access refused: user=%s has no mine scope", identity)
    return False
```

An unscoped account in production is a misconfiguration, and the safe reading of
a misconfiguration is "no access", not "all access".

### 25.4 Mine context is backend-resolved

`resolve_mine_context(mine_id, user)` treats a frontend-supplied `mine_id` as a
*request*, authorises it, and raises `MineContextRequired` rather than
substituting one.

**An unauthorised mine returns the same shape as an unknown mine.** Telling a
caller that a mine exists is itself a disclosure.

---

## 26. Security

| Control | Implementation | Status |
|---|---|---|
| Authentication | Clerk RS256 via JWKS; issuer validated when `CLERK_ISSUER` is set | IMPLEMENTED |
| Session handling | Bearer token from Clerk `getToken()`; **never written to `localStorage`** | IMPLEMENTED |
| Demo auth | Local JWT accounts, gated behind `DEMO_BOOTSTRAP_ENABLED`; refused in production by `validate_production_config()` | IMPLEMENTED |
| Authorisation | 6 roles, department mapping, domain permissions | IMPLEMENTED |
| Mine isolation | Backend-resolved, fails closed in production | IMPLEMENTED |
| Approval authority | Per-action roles, strictest governs | IMPLEMENTED |
| Secret handling | `.env` files, gitignored (verified via `git check-ignore`) | IMPLEMENTED |
| SQL injection | Parameterised queries throughout (`%s` placeholders, psycopg2) | IMPLEMENTED |
| Input validation | Pydantic models with `ge`/`le` bounds on every numeric input | IMPLEMENTED |
| Engine isolation | Crucible AI bound to `127.0.0.1`, no public route | IMPLEMENTED |
| Engine request signing | HMAC-SHA256 over method/path/body/timestamp + nonce, `hmac.compare_digest` | IMPLEMENTED — **inert** (§36) |
| Audit logging | Transactional, append-only by convention | IMPLEMENTED |
| Rate limiting | — | NOT IMPLEMENTED |
| CSRF protection | — | Not applicable (Bearer tokens, no cookie auth) |

### 26.1 The hole this version closed

`check_mine_access` previously ended in a bare `return True`, and **no Clerk user
carries mine scoping in `publicMetadata`** — so the fallthrough was the only path
anyone took. **Every authenticated user reached every mine in the platform.**
Mine-level isolation was failing open in its entirety.

### 26.2 Session storage

```
Security invariant: Bearer tokens are NEVER stored in localStorage.
localStorage is an XSS-accessible surface; session-scoped memory is safer.
```

Enforced in `web/src/lib/api.ts`. Demo-mode tokens are held in an in-memory
variable only.

### 26.3 Circuit-breaker design decision

`core/crucible_client.py` trips the breaker on **5xx and transport failures only**.
A 4xx does not trip it — otherwise malformed user input could take the entire
integration offline for every user.

---

## 27. Database architecture

### 27.1 Schemas

| Schema | Tables | Purpose |
|---|---|---|
| `ops` | 5 | Operational: production, telemetry, mines, incidents, incident events |
| `geo` | 1 | Geoscientific: prospectivity grid |
| `ml` | 1 | Prediction ledger |
| `gov` | 15 | Governance: registry, approvals, decisions, plans, outcomes, playbooks, audit |
| `hub` | 5 | Data Hub: datasets, versions, mappings, validation reports, canonical schemas |

**27 tables total.**

### 27.2 Entity relationships

```
ops.mines ──1:N──► ops.production_records        (mine_id, date, zone_id, shift)
    │                    │
    │                    └──► ml.predictions      (entity_id, task, model_version)
    │
    ├──1:N──► ops.equipment_telemetry            (machine_id, datetime)
    │
    └──1:N──► ops.incidents ──1:N──► ops.incident_events
                    │
                    ├──1:N──► gov.response_plans ──1:N──► gov.response_plan_actions
                    │               │
                    │               ├──1:N──► gov.decision_approvals
                    │               ├──1:N──► gov.decision_scenarios
                    │               └──1:1──► gov.decision_outcomes
                    │
                    └──1:N──► gov.decisions ──1:1──► gov.decision_outcomes

geo.prospectivity_grid  (grid_id, latitude, longitude, 37 features, label)

hub.datasets ──1:N──► hub.dataset_versions ──1:N──► hub.dataset_column_mappings
                              │                └──1:N──► hub.dataset_validation_reports
                              │
                              └──► gov.training_runs ──► gov.model_registry
                                                              │
                                                              ├──1:N──► gov.model_approvals
                                                              └──1:N──► gov.model_artifacts

gov.audit_log  (event_type, actor_id, actor_role, entity_type, entity_id, payload)
gov.playbooks  (playbook_ref, mine_id NULL = platform-wide, trigger_spec, steps)
gov.alerts     (alert_type, severity, mine_id, entity_id, acknowledged)
```

### 27.3 Integrity constraints

| Constraint | Purpose |
|---|---|
| `CHECK (status = lower(lifecycle_state))` on `gov.decisions` | The two columns were independently writable and had drifted — 8 rows existed marked `RECOMMENDED` + `executed` simultaneously |
| 9-state `CHECK` on `lifecycle_state` | Confines the state machine at the storage layer |
| `UNIQUE (decision_id)` on `gov.decision_outcomes` | One outcome per decision |
| `UNIQUE (plan_id, position)` on plan actions | Ordered, gap-free action lists |
| Partial `UNIQUE INDEX` on `(mine_id, signature) WHERE status IN ('OPEN','ACKNOWLEDGED','RESPONDING')` | One open incident per condition |
| `CHECK` on `calculation_mode` and `evidence_quality` columns | The output contract enforced in storage, not only in code |
| Range `CHECK`s on telemetry (e.g. `humidity_pct BETWEEN 0 AND 100`) | Physical plausibility |
| Deferred FK on `prediction_id` | Decisions may exist before a prediction is linked |

### 27.4 Migrations applied

| Migration | Effect |
|---|---|
| `002_decision_os` | 9-state lifecycle; 8 new tables; `status` derived constraint; `gov.decisions_pre_002` backup |
| `003_decision_mine_scope` | `gov.decisions.mine_id` + index — declared in `init.sql`, absent from the deployed schema |

Migration 002 reconciled the drift **before** applying the constraint: rows whose
`status` was more advanced than their `lifecycle_state` were promoted, not
demoted. The 8 rows marked `RECOMMENDED` + `executed` became `COMPLETED` rather
than `READY_FOR_REVIEW`, so no record of an executed decision was lost.

---

## 28. Caching and performance

### 28.1 Architecture

```
Request
   │
   ▼
L1  in-process, OrderedDict LRU, monotonic-clock TTL, thread-safe
   │  miss
   ▼
L2  Redis over TLS (Upstash), circuit breaker, strict timeout
   │  miss
   ▼
Producer (database + ML)
   │
   ├──► L2 populate (envelope + zlib above 25 KB)
   └──► L1 populate
```

| Feature | Implementation |
|---|---|
| Serialisation | JSON with a custom default for datetime/Decimal/Pydantic |
| Compression | zlib level 6 above a 25 KB threshold, base64-encoded, with a decompressed-size ceiling |
| Key versioning | `crucible:cache:v{schema}:{domain}:{resource}:{entity}:{params_hash}:{model_version}:{dataset_version}:{auth_scope}` |
| Circuit breaker | CLOSED / OPEN / HALF_OPEN / DISABLED |
| Stale-while-revalidate | Per-policy `allow_stale` with a hard stale ceiling |
| Invalidation | On model promotion, dataset approval, new operational data |

**Auth scope is part of the key.** Two users with different mine access cannot
share a cached response.

### 28.2 Short-lived memoisation

`core/memo.py` is a separate, smaller mechanism: in-process TTL memoisation
(20 s default) for individual reads that repeat within one request. Building one
Command Center page evaluates six candidate actions, each independently checking
equipment availability, the maintenance lockout and telemetry freshness for the
same mine — six identical answers, six round trips.

It is explicitly documented as unsuitable for writes or for anything whose
staleness could make a safety decision wrong.

### 28.3 Measured latency

Database round-trip cost, measured against the configured Aiven instance:

```
SELECT 1               1,236 ms
MAX(datetime)          1,533 ms
MAX(date)              1,228 ms
```

**A bare `SELECT 1` costs 1.2 seconds.** Response time on this deployment is
therefore a function of *how many round trips a request makes*, not of how much
work the database does.

### 28.4 Optimisation performed

Command Center summary, ~20 distinct reads:

| Change | Cold | Method |
|---|---|---|
| Baseline | 35.1 s | — |
| Memoise clock + stable aggregates | 29.1 s | `core/memo.py`, `lru_cache` |
| Evaluate state once, not twice | 21.2 s | Pass state into `attention.build()` |
| Model-registry TTL 10 s → 120 s | 18.3 s | Promotion invalidates explicitly |
| Concurrent signal + section evaluation | ~18 s | `ThreadPoolExecutor` |
| **Warm (cached)** | **2.7 s** | 60 s TTL |

**Methodology.** Wall-clock timing of `_summary()` with a query-counting wrapper
around `db.query`, on the configured Aiven instance over a residential
connection, single run per configuration. Not a controlled benchmark — the
absolute numbers are specific to this network path.

### 28.5 Where optimisation stopped

Beyond this point parallelism stopped helping: concurrent registry reads began
contending and their aggregate wall time *rose* (4 reads: 4.23 s sequential →
10.84 s concurrent). The remaining cost is network latency to a distant instance,
not application code.

### 28.6 A regression introduced and reverted

Widening the connection pool to 16 exhausted the server. Aiven reports
`max_connections = 20` **for the whole instance**, shared across all clients, and
the server began closing connections mid-query. Reverted to 2–10, which leaves
headroom for the 8 concurrent paths the code actually opens. The limit is
documented in `db.py` so it is not raised again.

### 28.7 A deliberate non-optimisation

The Command Center summary is **never served stale** (`allow_stale=False`). Every
other surface may show a slightly old number; this one answers "is anything wrong
right now", and a stale answer to that question is worse than a slow one.

---

## 29. API architecture

**130 routes across 19 routers.** All list endpoints paginate with
`items`/`total`/`limit`/`offset`/`has_more`.

### 29.1 Command Center

| Method | Endpoint | Purpose | Auth | Role |
|---|---|---|---|---|
| GET | `/command-center/mines` | Mines this account may open | Bearer | any authenticated |
| GET | `/command-center/state` | Operational state + 5 signals | Bearer | mine-scoped |
| GET | `/command-center/platform-state` | Data and model health | Bearer | mine-scoped |
| GET | `/command-center/attention` | Ranked attention queue | Bearer | mine-scoped |
| GET | `/command-center/recommendations` | Actions with cost, owner, approver | Bearer | mine-scoped |
| GET | `/command-center/do-nothing` | Counterfactual projection | Bearer | mine-scoped |
| GET | `/command-center/bottlenecks` | 6-stage material flow | Bearer | mine-scoped |
| GET | `/command-center/response-plan` | Generate a plan (not persisted) | Bearer | mine-scoped |
| GET | `/command-center/handover` | Shift handover brief | Bearer | mine-scoped |
| GET | `/command-center/summary` | Everything, in page order | Bearer | mine-scoped |

### 29.2 Decision lifecycle

| Method | Endpoint | Purpose | Role |
|---|---|---|---|
| GET | `/response-plans` | List, paginated | mine-scoped |
| POST | `/response-plans` | Generate and persist | authenticated |
| GET | `/response-plans/{id}` | Plan + actions + approvals + allowed transitions | mine-scoped |
| GET | `/response-plans/{id}/precedent` | Decision memory per action | mine-scoped |
| POST | `/response-plans/{id}/submit` | → READY_FOR_REVIEW | authenticated |
| POST | `/response-plans/{id}/approve` | → APPROVED | **per-action roles** |
| POST | `/response-plans/{id}/reject` | → REJECTED (rationale required) | authenticated |
| POST | `/response-plans/{id}/start` | → EXECUTING (records, does not dispatch) | authenticated |
| POST | `/response-plans/{id}/complete` | → COMPLETED | authenticated |
| POST | `/response-plans/{id}/outcome` | → MEASURED, records actual | authenticated |

### 29.3 Scenarios, playbooks, packages

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/scenarios/run` | Evaluate specified interventions |
| POST | `/scenarios/evaluate` | Evaluate from manager controls |
| GET | `/scenarios/optimise/{mine_id}` | Rank every available action |
| GET | `/scenarios/catalogue` | Every intervention Crucible AI can evaluate |
| GET | `/playbooks` | Playbooks applying to a mine |
| GET | `/playbooks/evaluate` | Triggered and dormant, with reasons |
| PUT | `/playbooks/{ref}` | Create/replace (role-gated, audited) |
| GET | `/decision-package` | Approvable document, JSON |
| GET | `/decision-package/markdown` | Printable |

### 29.4 Domain and governance

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/production/{mine_id}/forecast` | P10/P50/P90, gap, shortfall probability, SHAP drivers |
| GET | `/equipment/{mine_id}/fleet-health` | Per-machine failure risk and maintenance state |
| GET | `/exploration/targets` | Prospectivity grid, ranked |
| GET | `/exploration/targets/{grid_id}` | Per-target evidence breakdown |
| GET | `/routing/config`, `/routing/heatmap`, `/routing/points/{mine}` | Haul routing surfaces |
| POST | `/routing/optimize`, `/routing/compare-conditions` | Risk-aware route planning |
| POST | `/data/upload` | Dataset ingestion |
| GET | `/data/versions/{id}/validation` | 25-check report |
| POST | `/training/trigger` | Governed training run |
| GET | `/models/pending`, `/models/all` | Registry |
| POST | `/models/{id}/approve`, `/promote`, `/reject`, `/rollback` | Governance gate |
| GET | `/lab/pipelines/...` | 20 Crucible AI engine endpoints |
| GET | `/health`, `/health/live`, `/health/ready` | Liveness and readiness |

### 29.5 Error contract

Structured refusals with a machine-readable code (`core/errors.py`):

| Code | HTTP | Meaning |
|---|---|---|
| `INSUFFICIENT_DATA` | 422 | Valid request, inputs absent. Carries `missing`, `required_for`, `remedy` |
| `MINE_CONTEXT_REQUIRED` | 400 | No mine given or inferable. Carries `available_mines` |
| `CONSTRAINT_VIOLATION` | 409 | A hard constraint forbids it. Carries `constraint`, `evidence` |
| `ILLEGAL_STATE_TRANSITION` | 409 | Carries `from_state`, `to_state`, `allowed` |
| `MODEL_UNAVAILABLE` | 503 | No serving model for a task requiring one |

---

## 30. Frontend architecture

### 30.1 Stack and structure

Next.js 14 App Router with route groups:

```
app/
  (app)/            authenticated shell — 13 pages
    command-center/ landing page after sign-in
    production/ equipment/ exploration/ scenario/ routing/
    intelligence/ alerts/ data-hub/ lab/ governance/ admin/ profile/
  m/                mobile route tree — 9 pages (does NOT include command-center)
  login/ sign-in/ sign-up/
```

| Page | Lines | Notes |
|---|---|---|
| governance | 960 | Model registry, approvals |
| exploration | 786 | MapLibre GIS |
| routing | 746 | Haul routing, heatmaps, what-if |
| production | 732 | Forecast, drivers, ledger |
| intelligence | 588 | NL query, root cause |
| scenario | 508 | Scenario controls |
| data-hub | 459 | Upload, mapping, validation |
| lab | 441 | Crucible AI pipeline integration |
| admin | 301 | User management |
| command-center | 172 | Composed from `components/command/` |

### 30.2 State management

No global state library. Deliberate: server state is fetched per page through
typed hooks (`useCommandSummary`, `useMines`, `usePlanActions`), and the only
client state is UI-local (`useState`). A Redux-style store for data that is
authoritative on the server introduces a second source of truth.

`localStorage` is used only for per-viewer conveniences (remembered mine
selection), wrapped in `try/catch` because it throws in private browsing.

### 30.3 API communication

`lib/api.ts` centralises `apiFetch`/`apiPost`, injecting the Clerk bearer token
at call time. `NEXT_PUBLIC_API_URL` is the single source of truth and **throws at
build time** if unset in production — a bundle that silently defaults to
localhost ships a frontend that only works on the machine that built it.

### 30.4 Component system

`components/command/` makes provenance structurally unavoidable:

| Component | Guarantee |
|---|---|
| `<Metric>` | Requires `calculation_mode`; renders `null` as "Not available", never zero |
| `<EvidenceBadge>` | Expands into the measured factors and limiters |
| `<ProvenanceBadge>` | Model / Estimate / Not estimated |
| `<Caveat>` | Stated limitations render as deliberate, not as failed loads |
| `<UtilisationBar>` | Colour only past the thresholds that matter |
| `<Skeleton>` | Loading placeholders, never spinners over stale numbers |

A page cannot accidentally present a heuristic estimate with the authority of a
model prediction, because the component that draws it must be told which it is.

### 30.5 Role-based UI

`lib/roles.ts` defines navigation groups with a `dept` per page; `pagesForRole()`
and `groupsForRole()` filter the visible set. This is **presentation only** —
every endpoint enforces its own authorisation server-side.

### 30.6 Responsive behaviour

A middleware redirects phone user-agents to `/m/*`. The desktop pages use
responsive Tailwind breakpoints. **The mobile tree does not include the Command
Center** and still serves the previous page set.

---

## 31. Testing

### 31.1 Suite composition

**18 test files, 144 tests, all passing** (`pytest app/api/tests -q`, ~295 s).

> Count changed from 146 after the v3 restructure: the environment-contract
> test parametrised over two requirements pointer files, and the reorganised
> tree has one.

| File | Tests | Area |
|---|---|---|
| `test_hardening_guarantees.py` | 28 | Cross-cutting invariants, isolation, lifecycle |
| `test_decision_operating_model.py` | 23 | Scoping, provenance, lifecycle, playbooks, intent |
| `test_cache.py` | 21 | L1/L2, SWR, compression, circuit breaker |
| `test_scenario_engine.py` | 16 | Constraints, evidence, ranking, catalogue |
| `test_hardening_v2.py` | 10 | Second hardening pass |
| `test_intelligence.py` | 6 | Mine scoping on intelligence endpoints |
| `test_environment_contract.py` | 6 | Dependency pinning, interpreter window |
| `test_auth_and_rbac.py` / `test_rbac.py` | 8 | Authentication, authorisation |
| `test_storage.py` | 4 | Artifact storage |
| `test_architectural_hardening.py` | 4 | Architectural invariants |
| `test_data_hub.py` / `test_data_hub_lifecycle.py` | 5 | Upload, mapping, validation |
| `test_canonicalizer.py` | 2 | Schema hashing |
| `test_training_and_approval.py` | 2 | Training and promotion |
| `test_decisions.py` | 1 | Decision lifecycle |
| `test_governance_lifecycle.py` | 1 | Governance |
| `test_production_semantics.py` | 1 | Gap vs probability |

### 31.2 Coverage by area

| Test area | Tests | Status |
|---|---|---|
| Unit — domain logic | ~60 | ✅ Passing |
| Integration — API with live DB | ~50 | ✅ Passing |
| Security / RBAC | 12 | ✅ Passing |
| ML — serving integrity, environment contract | 8 | ✅ Passing |
| Data validation | 5 | ✅ Passing |
| Caching | 21 | ✅ Passing |
| **Frontend unit** | **0** | ❌ None |
| **End-to-end (browser)** | **0** | ❌ None |
| **ML — model quality regression** | **0** | ❌ None |
| **Load / stress** | **0** | ❌ None |

### 31.3 Guard tests

Several tests assert *properties* rather than behaviour, so a later change that
reintroduces a removed defect fails here rather than in front of a manager:

| Guard | Property |
|---|---|
| `test_unevaluated_hard_constraint_blocks` | Absence of evidence is not evidence of safety |
| `test_evidence_can_return_low` | The grade LOW is reachable (it was not before) |
| `test_missing_model_caps_grade` | No model means heuristic, however fresh the data |
| `test_catalogue_is_the_only_definition` | The triplicated intervention tables cannot return |
| `test_mine_access_fails_closed_in_production` | RBAC does not fail open |
| `test_unscoped_request_is_refused_not_defaulted` | No arbitrary mine substitution |
| `test_unmeasured_stage_is_never_the_bottleneck` | An unmeasured stage cannot be blamed |
| `test_unpriced_action_does_not_win_on_cost` | A missing cost estimate is not free |
| `test_playbook_does_not_fire_on_unmeasured_signal` | No alarm without evidence |
| `test_every_intervention_declares_tradeoffs` | No recommendation without a stated downside |
| `test_ambiguous_word_does_not_decide_intent` | "exploration target" is not a production query |
| `test_learned_is_terminal` | Decision history is immutable once learned |

### 31.4 Tests that failed during the rebuild

Nine tests failed while this version was being built. **All nine were asserting
defective behaviour:**

| Test | Was asserting |
|---|---|
| `test_mine_pulse_endpoint` | That an unscoped request returns data (the `mine-01` default) |
| `test_top_issues_endpoint` | Same |
| `test_nl_query_production_intent` | Same |
| `test_scenarios_cross_mine_isolation` | `baseline.production_t == 0.0` for a nonexistent mine |
| 5 lifecycle tests | The pre-migration 6-state vocabulary |

Each was corrected to assert the intended contract. None was weakened.

### 31.5 Frontend verification

| Check | Result |
|---|---|
| `tsc --noEmit` | ✅ Clean |
| `next lint` | ✅ No warnings or errors |
| `next build` | ✅ Compiled successfully |
| All 13 pages HTTP 200 | ✅ Verified live |

---

## 32. Experimental results

### 32.1 ML results

See §12. Summary: production forecast MAE 30.9 t / R² 0.774; shortfall ROC-AUC
0.724; equipment failure ROC-AUC 0.602 (lift 1.51×); prospectivity ROC-AUC 0.901.
All on synthetic data, all with the leakage caveat of §13.4.

### 32.2 System results

| Measurement | Value | Method |
|---|---|---|
| Backend tests passing | 144 / 144 | `pytest` |
| API routes | 130 | Route table introspection |
| ML artifacts loading | 16 / 16, 0 skipped | Startup log |
| Frontend pages serving | 13 / 13 HTTP 200 | Live curl with browser UA |
| Decision-loop endpoints | 25 / 25 HTTP 200 | Live curl with bearer token |
| Database tables | 27 across 5 schemas | `information_schema` |
| Migration reconciliation | 8 drifted rows correctly promoted | Post-migration query |

### 32.3 Functional results — workflows verified end to end

**1. Detection → decision → outcome** (verified live via API):

```
create   → RP-000003, SIMULATED, expected +23.4 t, evidence LOW
authority→ 409  equipment_admin cannot approve a production plan
guard    → 422  a rejection needs a reason
guard    → 409  SIMULATED cannot move to COMPLETED
submit   → SIMULATED → READY_FOR_REVIEW
approve  → READY_FOR_REVIEW → APPROVED
start    → APPROVED → EXECUTING
complete → EXECUTING → COMPLETED
outcome  → predicted 23.4 t, actual 18.4 t, variance −21.4%, effectiveness 0.786
audit    → 6 entries, all actor-attributed
```

**2. Constraint enforcement** (verified against live data):

```
maintenance_defer  REFUSED  "Unit EQ-059 is already 32.33 days overdue for
                             service, past the 14-day lockout."
blast_reschedule   REFUSED  "Blasting is prohibited during the night shift (S3)."
teleport_the_ore   REFUSED  "no constraint rules are defined for this action"
```

**3. Playbook stage narrowing:**

```
FIRED  Face preparation is the binding constraint
quiet  Haulage is the binding constraint — the constrained stage is face, not haulage
```

**4. Decision memory duplicate collapsing:** 37 records → 1 distinct case,
aggregate withheld.

**5. Risk-aware routing:** 82 endpoint pairs re-route under rainfall, up to 93%
path divergence; risk decomposition sums exactly to the score (21.72 = 21.72).

### 32.4 Performance results

See §28.3–28.5. Command Center: ~18 s cold, **2.7 s warm**. Bounded by 1.2 s
database round-trip latency.

### 32.5 Not benchmarked

| Item | Status |
|---|---|
| Concurrent user load | Not benchmarked |
| ML inference latency in isolation | Not benchmarked |
| Cache hit ratio under realistic traffic | Not benchmarked |
| Frontend Core Web Vitals | Not benchmarked |
| Database query plans / index effectiveness | Not analysed |
| Memory footprint under sustained load | Not benchmarked |

---

## 33. Error handling and failure modes

| Failure | Behaviour | Classification |
|---|---|---|
| **Database unavailable** | `/health/ready` returns 503; `/health` reports `database: error`, overall `degraded`. Pooled connections roll back on exception before release — an aborted transaction otherwise poisons a pooled connection | **Fail closed** |
| **Redis unavailable** | Circuit breaker opens; L1 and the producer continue serving. `/health` reports `cache: degraded`. Correctness is unaffected; latency rises | **Graceful degradation** |
| **ML model unavailable** | `ServingStatus.UNAVAILABLE`; predictions become `HEURISTIC`; evidence quality capped at LOW with the reason *"No model is serving this task"* | **Degraded, declared** |
| **Serving version mismatch** | `SYNC_PENDING` / `SYNC_FAILED`; previous model continues serving; evidence capped at MEDIUM with the reason stated | **Degraded, declared** |
| **Required feature missing** | Median-imputed for scoring, but counted separately; feature completeness lowers evidence quality proportionally | **Degraded, declared** |
| **No production baseline** | `INSUFFICIENT_DATA` with `missing`, `required_for`, `remedy`. **No zero is returned** | **Fail closed** |
| **Safety telemetry missing** | Hard constraint `NOT_EVALUATED` → action blocked | **Fail closed** |
| **Unknown intervention** | Refused; not assumed safe | **Fail closed** |
| **No mine context** | 400 `MINE_CONTEXT_REQUIRED` with the reachable mine list | **Fail closed** |
| **Unauthorised mine** | Same shape as unknown mine | **Fail closed** |
| **Stale data** | Clock switches to BENCHMARK; every freshness value carries its reference date | **Declared, not hidden** |
| **Crucible AI engine down** | Circuit breaker; `/lab` degrades; gateway unaffected. 4xx does **not** trip the breaker | **Graceful degradation** |
| **Recommendations fail** | Command Center still renders state and attention; the failure is reported in the payload as `failed: true` with the exception type | **Partial, declared** |
| **Audit write fails** | **The state change is rolled back** | **Fail closed** |
| **Plan persist fails** | Plan returned with `persisted: false` and `persist_error`; `POST /response-plans` raises rather than returning a plan the caller believes was saved | **Declared** |
| **Invalid dataset** | 25 checks produce a report with per-check severity; version cannot reach `APPROVED_FOR_TRAINING` | **Fail closed** |

### 33.1 Silent fallbacks that remain

Honesty requires naming these:

| Location | Behaviour | Risk |
|---|---|---|
| `routers/production.py:83` | SHAP failure silently falls back to `feature_importances_` | The caller cannot tell an attribution from a global importance ranking |
| `core/constraints.py` `_safe_query` | DB failure returns `None` | **Mitigated** — `None` means "could not check" and blocks hard constraints |
| ~20 `except: pass` handlers | Remain in `data_hub.py`, `ledger.py`, `equipment.py`, `intelligence.py` | Non-critical paths, but not audited individually |

The first is a genuine gap. The second is the correct pattern. The third is
pre-existing and not yet reviewed case by case.

---

## 34. Data and model governance

### 34.1 Dataset lifecycle

```
UPLOADED → MAPPED → VALIDATED → APPROVED_FOR_TRAINING
                         ↓
                     REJECTED
```

| Stage | Gate |
|---|---|
| UPLOADED | SHA-256 computed; row and column counts recorded |
| MAPPED | Auto-mapping with confidence; columns below 0.7 require human confirmation |
| VALIDATED | 25 checks; report persisted to `hub.dataset_validation_reports` with a quality score |
| APPROVED_FOR_TRAINING | **Human approval required.** Only approved versions may train |

### 34.2 Model lifecycle

```
challenger → approved → champion → retired
                ↓            ↓
             rejected    rolled_back / archived
```

| Transition | Endpoint | Authority |
|---|---|---|
| Register challenger | Training run completion | System |
| Approve | `POST /models/{id}/approve` | `super_admin` |
| Promote to champion | `POST /models/{id}/promote` | `super_admin` |
| Reject | `POST /models/{id}/reject` | `super_admin` |
| Emergency rollback | `POST /models/{id}/rollback` | `super_admin` |

Every transition writes to `gov.model_approvals` and `gov.audit_log`.

### 34.3 Serving integrity invariant

> **Reported model version must equal the actually-loaded serving model version.**

A model is not marked synced merely because the registry has a version.
`ensure_active_model` verifies artifact identity (SHA-256), version, and a smoke
test, and reports `ServingStatus` accordingly. Startup does not bypass this.

### 34.4 Prediction ledger

`ml.predictions` records every served prediction: task, entity, value,
probability, confidence tier, top driver, model version, `data_origin`. This is
what makes "why did Crucible AI say this in June?" answerable.

### 34.5 Audit

`gov.audit_log` — 377 rows — records `event_type`, `actor_id`, `actor_role`,
`entity_type`, `entity_id`, JSON payload, timestamp. Append-only by application
convention (no UPDATE or DELETE in application code). Indexed on
`(entity_type, entity_id, created_at DESC)` and `(event_type, created_at DESC)`.

For a decision, the reconstructable set is: who created it, who approved it,
when, the rationale, the inputs, the scenario parameters, the model and dataset
versions, the constraints evaluated, the recommendation, and the actual result.

---

## 35. Defects found and corrected

Documented because a technical report that lists only successes is not a
technical report. Each was found by reading code or querying the live database.

### 35.1 Fabricated values presented as measurements

| Defect | Evidence | Resolution |
|---|---|---|
| **Invented confidence** | `model_conf = 85.0 if baseline_backed else 60.0`, graded `HIGH if > 80 else MEDIUM` — LOW unreachable | Replaced with five-factor evidence quality (§10.4) |
| **Hardcoded SHAP** | `intelligence.py:451` — three literal dicts tagged `"type": "model_shap"`, `"confidence": "HIGH"`; no explainer invoked | Removed |
| **Constant gains** | `optimizer.candidate_actions[].base_gain` = 48.0 / 36.0 / 24.0 / 30.0 / 12.0 t surfaced as `expected_gain_t` | Module deleted; effects now model counterfactuals or declared estimates |
| **Fabricated material flow** | Six hardcoded stages, one labelled `"BOTTLENECK"`, endpoint took no `mine_id` — every mine saw identical figures | Replaced by `core/bottleneck.py` |
| **Fabricated loading state** | `production/page.tsx`: `useState(42.8)` for p50, `useState(14)` for shortfall probability, plus `FALLBACK_FORECAST` — an invented production curve (3.2 t, 3.6 t, …) complete with a peak marker, rendered before any request and retained if the request failed | Initial state is now `null`; fallbacks return empty; UI renders "Not available" |
| **Hardcoded confidence** | `scenarios.py`: `"model_confidence": 87 if confidence == "HIGH" else 74` | Removed |

### 35.2 Semantic errors

| Defect | Evidence | Resolution |
|---|---|---|
| **Gap labelled as probability** | `shortfall_prob = (plan − production) / plan`, rendered as "Shortfall Risk 6.8%" | Renamed `production_gap_t` / `production_gap_pct`; calibrated probability kept separate |
| **Root cause overclaim** | Named a stage "the binding stage" at 63% utilisation | Claim made only when `CONSTRAINED` or `SATURATED`; otherwise states no stage is constrained |
| **Urgency from magnitude** | `"HIGH" if delta > 50` conflated *how much it helps* with *how soon it must happen* | Urgency now derives from the action's horizon |

### 35.3 Safety and security

| Defect | Evidence | Resolution |
|---|---|---|
| **RBAC failing open** | `check_mine_access` ended in `return True`; no Clerk user carries scoping → every user reached every mine | Fails closed in production; reads `allowed_mines` from Clerk metadata |
| **Default mine ID** | `mine_id: str = "mine-01"` on 4 endpoints — an unscoped request answered for an arbitrary mine, and nothing in the response looked wrong | `resolve_mine_context()`; refuses rather than substitutes |
| **Missing telemetry as permission** | `"No live data available; assuming typical availability"` with feasibility multiplier 1.0 | `NOT_EVALUATED` blocks hard constraints |
| **Best-effort audit** | `except Exception: pass` around audit writes — a broken ledger was indistinguishable from a working one | Audit shares the transaction; failure rolls back the change |

### 35.4 Correctness

| Defect | Evidence | Resolution |
|---|---|---|
| **Triplicated scenario logic** | `_HEURISTIC` and `_ADJUSTABLE` byte-identical in `scenario_engine.py` and `scenarios.py`; overlapping in `optimizer.py` | One catalogue; guard test prevents recurrence |
| **Scope mismatch** | Zone-shift production compared against mine-wide fleet — haulage read 4% utilised at every mine | Truck count scaled to the production record's grain |
| **Flat cost model** | `cost = abs(delta) × ₹1,200/t` — cost proportional to benefit, so cost could not influence ranking | Derived from the mine's own cost lines |
| **Lifecycle drift** | 8 rows marked `RECOMMENDED` + `executed` simultaneously | `CHECK (status = lower(lifecycle_state))`; migration promoted rather than demoted |
| **Duplicate history as evidence** | One decision recorded 37 times presented as 5 independent cases | Collapsed on the outcome tuple |
| **NL intent collision** | `"target"` in both production and exploration keyword lists, production tested first → "exploration target" classified as production | Phrase-first scoring; ambiguous tokens own by nobody. 10/10 on the test set |
| **Soft penalty on passing checks** | `soft_penalty` charged penalties for constraints that *passed* | Only unsatisfied checks contribute |
| **Playbook stage blindness** | A haulage playbook fired on a face constraint | `evidence_field` / `equals` narrowing clauses |

### 35.5 Outstanding — found but NOT fixed

| Defect | Impact |
|---|---|
| **`leakage_status: PASS` hardcoded** in 4 training scripts | Validation output claims a check that never ran (§13.4) |
| **Data validator check 18 is a stub** — always passes with "Strict chronological walk-forward split enforced", computes nothing | One of 25 quality checks is decorative |
| **Prospectivity "spatial" split is positional** | The declared validation type is not the one performed (§13.3) |
| **SHAP fallback is silent** | Caller cannot distinguish attribution from importance |
| **No alert generator** | The alerts surface is read-only (§24.1) |
| **`ops.incidents` has no writer** | Incident lifecycle and replay cannot function (§24.2) |
| **~20 `except: pass`** remain in non-critical routers | Not individually audited |

---

## 36. Limitations

Stated plainly. **This system is a working prototype, not production-ready.**

### Data

1. **All data is synthetic.** No accuracy figure transfers to a real mine.
2. **The benchmark is historical** — ends 2025-06-30, 14 months before this
   report. The platform runs on a BENCHMARK clock and declares it, but this is
   not live operation.
3. **Equipment and production data do not overlap** — equipment covers 10 days
   against production's 12 months, and trails it by ~8 months.
4. **Dispatch throughput does not exist** in the schema; one flow stage can never
   be measured.
5. **`ops.mines.district` is NULL** for every mine.

### Models

6. **Leakage is asserted, not tested.** The single most significant caveat.
7. **Prospectivity's "spatial" split is positional**, with latitude and longitude
   as model inputs — the exact condition spatial blocking exists to prevent.
8. **Equipment failure prediction is near-chance** (ROC-AUC 0.602). Defensible for
   inspection prioritisation (1.51× lift), not for asserting a machine will fail.
9. **Shortfall's test PR-AUC is not trustworthy** — nearly double validation,
   most likely a fold-balance artefact.
10. **Gradient boosting adds nothing** over linear/logistic baselines here.
11. **No cross-validation** — single holdout only, so no variance estimate on any
    metric.
12. **No model quality regression tests** — a retrained model that degraded would
    not fail any test.

### Platform

13. **Cold page load ~18 s**, warm 2.7 s, bounded by 1.2 s database round trips.
    Infrastructural, not algorithmic.
14. **`CRUCIBLE_SHARED_SECRET` is unset**, so engine request signing is inert. Safe
    only because the engine is loopback-bound. **Must be set before deployment.**
15. **Unscoped users are permitted outside production** — correct for development,
    but mine scoping must be configured in Clerk before production use.
16. **No rate limiting.**
17. **No alert generation** (§24.1).
18. **No incident creation** (§24.2) — so no incident replay.
19. **No command palette.**
20. **Mobile tree excludes the Command Center.**
21. **No shift handover UI** (API exists).
22. **No frontend tests, no end-to-end tests.**
23. **No load testing.**
24. **Docker and CI configs exist but are not exercised** — no deployment has been
    performed.

### Scope

25. **Costs are modelled, not quoted** — observed unit rates applied to a
    proportional change.
26. **No financial ROI is claimed**, because no validated financial model exists.
27. **The do-nothing projection is linear persistence** of a measured rate, not a
    forecast model.
28. **No resource or reserve estimation.** Prospectivity ranks ground for
    investigation; it does not quantify contained metal.
29. **No automatic retraining.**
30. **Groq LLM is used for exploration narrative only** — it produces no
    operational number.

---

## 37. Requirements for real-world deployment

What would have to be true before this system could be used at an operating mine.

### 37.1 Data

| Requirement | Why |
|---|---|
| Real operational data with documented provenance | Every performance figure must be re-established |
| Continuous telemetry ingestion | The platform assumes a live feed; it currently replays a benchmark |
| Overlapping equipment and production coverage | The current 10-day vs 12-month mismatch makes cross-domain inference unsound |
| Dispatch throughput instrumentation | To close the material-flow model |
| Real geological survey data with sample locations | Synthetic prospectivity labels cannot validate a real targeting model |
| Site-specific cost data | Confirming or replacing the derived rates |

### 37.2 Models

| Requirement | Why |
|---|---|
| **Computed leakage testing at training time** | Replace the hardcoded `PASS` (§13.4) |
| **Genuine spatial block CV for prospectivity** | The machinery exists in Crucible AI and must be used |
| **Remove or justify lat/lon as model inputs** | Currently allows location memorisation |
| Retrain and re-validate on real data | All current metrics become void |
| Cross-validation with variance estimates | A single holdout gives no confidence interval |
| Model quality regression tests | So a degraded retrain fails the build |
| Recalibration on real class balance | Brier scores are meaningless otherwise |
| Drift monitoring | Feature and prediction distribution shift |
| Re-evaluate equipment failure entirely | ROC-AUC 0.602 is not deployable |

### 37.3 Platform

| Requirement | Why |
|---|---|
| **Set `CRUCIBLE_SHARED_SECRET`** | Request signing is currently inert |
| **Configure `allowed_mines` in Clerk for every user** | Unscoped users are refused in production |
| **Set `ENVIRONMENT=production`** | Activates fail-closed RBAC |
| **Disable `DEMO_BOOTSTRAP_ENABLED`** | Enforced by `validate_production_config()` |
| Co-locate the database with the API | 1.2 s round trips make cold loads unusable |
| Rate limiting | None exists |
| Alert generation | The surface is read-only |
| Incident creation | Downstream lifecycle is built and unreachable |
| Load testing | Never benchmarked |
| Secret management (vault, rotation) | Currently `.env` files |
| Backup and restore procedure | Not documented |
| Monitoring and on-call alerting | Health endpoints exist; nothing consumes them |

### 37.4 Organisational and regulatory

| Requirement | Why |
|---|---|
| **Reconcile every constraint threshold with the site's approved procedures** | `MAINTENANCE_LOCKOUT_DAYS`, `MAX_CRUSHER_TRIM`, the S3 blast prohibition, `MAX_SHIFT_OPERATING_HOURS` are named constants awaiting site review |
| Formal DGMS compliance review | Crucible AI asserts no regulatory authority; site procedure is authoritative |
| Playbooks authored by site personnel | Built-ins are a starting point, not authority |
| Role assignment agreed with the mine's own authority structure | The six roles are a model, not a mandate |
| Operator training on evidence quality | The MODEL_BACKED / HEURISTIC distinction only helps if it is understood |
| Defined escalation for INSUFFICIENT_DATA | The platform declines to answer; someone must decide what happens then |

---

## 38. Conclusion

### What was built

A decision support platform that connects detection to explanation to simulation
to decision to approval to outcome to learning, across production, equipment,
exploration and haulage. Four ML pipelines served through a governed registry
with human approval gates; a constraint-aware scenario engine; a response plan
lifecycle with role-gated approval and transactional audit; and a Command Center
that presents this in decision order.

130 API routes, ~15,200 lines of backend domain logic, 13 frontend pages, 27
database tables, 144 passing tests.

### What is genuinely novel here

Not the individual models — a logistic regression on tabular features is not
novel, and this report says so in §12.5. What is unusual is the **honesty
architecture**: the platform distinguishes, structurally and in every payload,
between a model prediction, a declared estimate and an absence of data; it refuses
to act on unevaluated safety constraints; it collapses duplicate history rather
than counting it as corroboration; and it reports the stages it cannot measure.

Implementing that discipline was not decoration. It exposed that three of five
intervention effect estimates were silently falling back to declared values, that
one flow stage had never been measurable, that mine isolation was failing open,
and that a production gap had been displayed as a probability for the platform's
entire history. None of those were visible before the system was required to
declare what it knew.

### What this report does not claim

That Crucible AI is production-ready. That any metric here predicts real mining
performance. That the models are sophisticated. That the leakage checks passed.

### The honest summary

> Crucible AI is a working prototype of a mining decision operating platform,
> demonstrated end to end on synthetic data. Its engineering contribution is the
> separation of what the system knows from what it is guessing, enforced at the
> type level and carried through to the interface. Its principal limitation is
> that everything it currently knows, it knows about data we generated ourselves.

---

*Report compiled 12 September 2026 by direct audit of source code, the deployed
PostgreSQL schema, and committed model artifacts. Every metric is traceable to a
file in the repository. Where documentation and code disagreed, the code was taken
as authoritative and the disagreement recorded in §35.*
