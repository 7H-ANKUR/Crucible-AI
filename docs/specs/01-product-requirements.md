# 01 — Product Requirements
# MINEx — Mining Intelligence Operating Platform
## SIH26009 | MANGANESIS Architecture | v1.0

---

## 1. Product Identity

| Field | Value |
|-------|-------|
| **Platform name** | MINEx |
| **Architecture name** | MANGANESIS |
| **Tagline** | One Mine. One Intelligence Layer. |
| **Hackathon** | Smart India Hackathon 2026 — Problem SIH26009 |
| **Problem owner** | Ministry of Steel / MOIL Ltd. |
| **Type** | Decision-support platform (NOT autonomous mine control) |
| **Primary mineral** | Manganese |
| **Study region** | Central Indian belt — Balaghat, Chhindwara, Bhandara/Nagpur (MP, MH, OD) |

---

## 2. Problem Statement (SIH26009)

MOIL faces a gap between exploration/resource understanding and operational production outcomes:

- Exploration relies on manual surveys, drilling, and paper records
- Production diverges from plan due to equipment downtime, weather delays, blasting issues, maintenance gaps
- No integrated system links exploration evidence to production risk to corrective action

**Required output:** A user-friendly dashboard showing predicted exploration/resource information, production trends, shortfall risks, and corrective actions.

---

## 3. The Three Core Objectives

```
OBJ-1: IDENTIFY   → Rank Indian manganese exploration targets with evidence + uncertainty
OBJ-2: PREDICT    → Forecast production shortfalls before the shift starts
OBJ-3: RECOMMEND  → Rank feasible corrective interventions with expected recovery
```

---

## 4. Product Vision

> **Turn fragmented Indian mineral and mine data into an evidence-backed decision loop:**
> `Discover → Validate → Forecast → Explain → Simulate → Optimize → Review`

The product is a **digital control room for exploration and production decisions**, not a static report or alert dashboard.

---

## 5. Personas

### P1 — Exploration Geologist
**Goal:** Rank manganese targets; understand what subsurface evidence supports each score.
**Needs:** Prospectivity map, geological evidence panel, drill/assay overlay, uncertainty, target maturity status, target ranking.

### P2 — Mine Planning Engineer
**Goal:** Identify schedule risk before committing the plan.
**Needs:** Production forecast, mine constraints, schedule risk, scenario comparison, optimizer results.

### P3 — Maintenance / Operations Engineer
**Goal:** Prevent equipment failure before it causes downtime.
**Needs:** Equipment failure risk scores, downtime drivers, maintenance priority queue, sensor trend charts.

### P4 — Production Manager
**Goal:** Know whether tomorrow's target is at risk before the shift starts.
**Needs:** Daily/shift target, P10/P50/P90 forecast, shortfall probability, root cause ranking, corrective recommendation.

### P5 — Management
**Goal:** Strategic oversight of exploration priorities and production risk portfolio.
**Needs:** Mine comparison, strategic exploration priorities, expected production recovery, cost/risk trade-off, decision history.

### P6 — Platform Admin
**Goal:** Govern data, model releases, roles, and audit trail.
**Needs:** Dataset approval queue, model promotion gating, user management, audit log.

---

## 6. Core Product Modules

### Module 1 — Exploration Intelligence
- Inputs: Mn occurrences, geology, structure, remote sensing, DEM, environmental context, drill/assay data
- Outputs: `prospectivity_probability`, `confidence`, `uncertainty`, `evidence_summary`, `priority_rank`
- Constraint: Never label a prospectivity score as a "reserve"

### Module 2 — Subsurface Explorer
- Visualise: boreholes, assay intervals, lithology, depth profile, cross-section, 3D block benchmark
- Answers: "What supports this target below the surface?"

### Module 3 — Production Forecast
- Inputs: production history, equipment state, maintenance, blasting, weather, ore, stockpile, schedule
- Outputs: forecast, target, gap, P10/P50/P90 intervals

### Module 4 — Shortfall Risk
- Outputs: `shortfall_probability`, `risk_level` (HIGH/MEDIUM/LOW), `expected_shortfall_t`

### Module 5 — Root Cause Attribution
- SHAP-driven ranked causes
- Example: Equipment downtime 31%, Rainfall 24%, Blasting 18%, Ore availability 15%, Other 12%
- Constraint: Percentages must be model-derived, not hard-coded

### Module 6 — Digital Mine Twin
- Scenarios: normal, heavy rainfall, equipment failure, maintenance delay, blast delay, ore shortage, combined disruptions
- State object: `MineState(production_target, ore, stockpile, equipment, maintenance, blast, weather, schedule)`

### Module 7 — Decision Optimizer
- Interventions: equipment redeployment, maintenance timing, blast rescheduling, ore routing, schedule adjustment
- Outputs per scenario: `expected_production_gain`, `shortfall_probability_change`, `cost_change`, `risk_change`, `confidence`
- Ranking: multi-objective score = production_gain - cost - risk_penalty - disruption_penalty

---

## 7. Functional Requirements

### Core Intelligence (FR-01 to FR-13)

| ID | Requirement |
|----|------------|
| FR-01 | **India Compliance** — all geospatial analysis enforces India-only boundary (`assert_india_only()`) |
| FR-02 | **Data Provenance** — every model input is traceable to a classified source (REAL / DERIVED_REAL / SYNTHETIC) |
| FR-03 | **Spatial Feature Extraction** — observations mapped to spatial grid features |
| FR-04 | **Prospectivity** — probability score + confidence + uncertainty per grid cell |
| FR-05 | **Drill Integration** — drillholes and assays overlaid where available |
| FR-06 | **Production Forecast** — time-series forecast with prediction intervals |
| FR-07 | **Shortfall Prediction** — calibrated shortfall probability |
| FR-08 | **Explainability** — SHAP-based top risk driver ranking |
| FR-09 | **Scenario Generation** — generate feasible intervention scenarios |
| FR-10 | **Scenario Simulation** — estimate outcome under each scenario using MineState |
| FR-11 | **Recommendation** — rank feasible actions by multi-objective score |
| FR-12 | **Uncertainty** — P10/P50/P90 for production; probability + calibration for classification; spatial uncertainty for prospectivity |
| FR-13 | **Audit Trail** — model version + data version + source per every prediction |

### Governed Learning (FR-14 to FR-19)

| ID | Requirement |
|----|------------|
| FR-14 | **Role-based onboarding** — users upload only to approved domains; system proposes, user confirms schema mapping |
| FR-15 | **Versioning & rollback** — every accepted upload is immutable with uploader, source, checksum, parent version, timestamp; prior version selectable |
| FR-16 | **Data quality & drift** — completeness, freshness, schema validity, duplicates, anomalies, data drift, and performance drift reported separately |
| FR-17 | **Champion-challenger governance** — new training run is a challenger; promotion requires holdout, calibration, FN-rate, and stability gates |
| FR-18 | **Feedback & decision memory** — authorised users record actual outcomes, corrected causes, actual intervention effects with reviewer and versions |
| FR-19 | **Human approval** — upload, model promotion, and action recommendations are auditable human decisions; no control commands to mine equipment |

### Extended Platform (FR-20 to FR-32)

| ID | Requirement |
|----|------------|
| FR-20 | **Data Update Schedule** — each domain stores expected cadence, last success, next expected, FRESH/AGING/STALE/CRITICAL status |
| FR-21 | **AI-Assisted Onboarding** — support CSV, XLSX, Parquet, geospatial; suggest domain + field mappings with confidence; require user confirmation |
| FR-22 | **Data Health Center** — explainable health by domain (completeness, freshness, schema, units, duplicates, anomalies, drift, lineage) |
| FR-23 | **Controlled Retraining** — triggers: scheduled, sufficient-new-data, drift, performance, authorised manual; all route to challenger evaluation |
| FR-24 | **Model Freeze & Rollback** — permit freeze; select last approved stable model; full incident/audit record |
| FR-25 | **Model Hierarchy** — global → regional → mine-specific with explicit cold-start policy and configurable data-sufficiency thresholds |
| FR-26 | **Prediction Ledger** — persist prediction, lineage, confidence, drivers, recommendation, actual outcome, error, review status |
| FR-27 | **Intervention Learning** — persist baseline, predicted effect, observed effect, cost, risk, execution status for reviewed recommendations |
| FR-28 | **Alert Engine** — role-routed alerts: production, equipment, data freshness, drift, exploration priority, model health |
| FR-29 | **AI Mine Copilot** — natural-language interface; retrieves model/simulator/optimiser outputs; invokes approved scenarios; never invents numerical values |
| FR-30 | **Exploration Target Maturity** — track Detected → Screened → Geologically supported → Drill recommended → Drilled → Validated → Resource candidate |
| FR-31 | **Change Explanation** — summarise measured differences after approved data/model update; no fabricated business gains |
| FR-32 | **Validation Evidence** — per-task matrix with split type, independent entities, baseline, score, leakage status, calibration, ablation |

---

## 8. Non-Goals (MVP Will NOT)

- Certify regulatory mineral reserves
- Replace geological field investigation
- Issue safety-critical mine-control commands
- Claim satellite-only underground mineral detection
- Represent synthetic operational data as actual MOIL telemetry
- Provide autonomous blasting decisions
- Control real mine equipment

---

## 9. Data Classification Policy

Every dataset/record is classified as one of:

| Class | Meaning |
|-------|---------|
| `REAL` | Verified from an authorised Indian source |
| `REAL_NEEDS_CLEANING` | Real but requires quality remediation |
| `DERIVED_REAL` | Computed from real inputs (e.g., spectral ratios from Sentinel-2) |
| `SYNTHETIC` | Computationally generated; not actual MOIL data |
| `SYNTHETIC_CALIBRATED_BY_REAL` | Synthetic but constrained by real parameters |
| `PORTAL_ONLY` | Source exists but machine access requires registration/auth |

Synthetic data must **never** be presented as MOIL data in the dashboard.

---

## 10. Trust & Safety Requirements

Every critical prediction card must display:

| Element | Values |
|---------|--------|
| DATA QUALITY | High / Medium / Low |
| CONFIDENCE | High / Medium / Low |
| DATA ORIGIN | Real / Derived / Synthetic |
| FRESHNESS | FRESH / AGING / STALE / CRITICAL |
| LIMITATION | Descriptive text |

---

## 11. Success Metrics

### Exploration (Prospectivity)
- Spatial ROC-AUC >= 0.85 (spatial holdout)
- Spatial PR-AUC >= 0.80
- Calibration: Brier score < 0.15

### Production Forecast
- R2 >= 0.75 (chronological holdout)
- MAPE <= 22%

### Shortfall Classification
- ROC-AUC >= 0.70 (chronological holdout)
- PR-AUC >= 0.60
- FN-rate <= 0.45

### Equipment Failure
- PR-AUC > baseline; FN-rate tracked

### Decision Engine
- Constraint violation rate = 0 for recommended scenarios

---

## 12. MVP Acceptance Criteria

- [ ] India compliance gate passes for all datasets
- [ ] Prospectivity model has spatial block validation (not random split)
- [ ] No target leakage detected in any feature set
- [ ] Production model has chronological temporal validation
- [ ] Equipment model has enough positive failure events (>= 3%)
- [ ] Uncertainty displayed on every prediction card
- [ ] Optimizer scenarios respect all configured constraints
- [ ] Synthetic data explicitly labelled on every dashboard card
- [ ] Dashboard explains predictions (WHY? WHAT IF? WHY THIS ACTION?)
- [ ] All dataset metadata matches actual files
