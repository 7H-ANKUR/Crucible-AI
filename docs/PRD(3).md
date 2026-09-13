# PRD.md

# MANGANESIS
## AI + Geoscience + Mine Operations Decision Intelligence for Indian Manganese

**Document:** Product Requirements Document  
**Version:** 1.0  
**Target:** Smart India Hackathon 2026 — SIH26009  
**Organization:** Ministry of Steel / MOIL Ltd.  
**Product Type:** Decision-support platform  
**Primary Users:** MOIL exploration geologists, mine planning engineers, production managers, maintenance/operations teams, management.

---

# 1. Executive Summary

MANGANESIS is an India-first AI decision-support platform designed around the three linked needs in SIH26009:

1. identify and prioritize manganese exploration areas;
2. predict production shortfalls before they occur;
3. recommend feasible actions that reduce the predicted shortfall.

The product combines:

- geology
- exploration evidence
- remote sensing
- terrain
- weather
- production history
- equipment state
- maintenance
- blasting
- stockpile
- scheduling
- uncertainty
- scenario simulation
- optimization.

The system is explicitly **not** a claim that satellite imagery alone can see underground reserves.

---

# 2. Problem

MOIL's SIH problem describes a gap between exploration/resource understanding and operational production outcomes: exploration relies on manual surveys/drilling/records, while production can diverge from plan due to constraints such as equipment downtime, weather and blasting delays.

The required output is a user-friendly dashboard showing predicted exploration/resource information, production trends, shortfall risks and corrective actions. [Source: SIH26009 problem statement]

---

# 3. Product Vision

> **Turn fragmented Indian mineral and mine data into an evidence-backed decision loop: Discover -> Validate -> Forecast -> Explain -> Simulate -> Optimize.**

The product should feel less like a dashboard and more like a **digital control room for exploration and production decisions**.

---

# 4. Product Positioning

Do not position MANGANESIS as:

> "another AI mining dashboard."

Position it as:

> **A geology-constrained, uncertainty-aware, counterfactual decision intelligence system for Indian manganese mining.**

The advantage is integration.

Existing mining AI systems commonly address components such as predictive maintenance or digital twins. The platform differentiates by connecting:

**exploration -> subsurface evidence -> production risk -> intervention simulation -> optimization**

in one India-specific system.

MOIL itself has described initiatives around mine planning, production scheduling, underground equipment tracking and equipment health monitoring, which means our differentiation should be the integration of these signals into one decision loop rather than claiming those individual capabilities are new. [Source: MOIL Annual Report 2021-22]

---

# 5. Goals

## G1 — Improve exploration prioritization

Generate an India-specific prospectivity map with:

- probability
- confidence
- evidence
- uncertainty
- recommended follow-up areas.

## G2 — Predict production shortfalls

Forecast future production and shortfall probability.

## G3 — Explain the shortfall

Identify the highest-contributing constraints.

## G4 — Recommend actions

Test alternative interventions.

## G5 — Quantify improvement

Show expected production recovery, risk reduction and intervention cost.

## G6 — Preserve scientific honesty

Separate:

- real observations
- derived variables
- synthetic prototype data.

---

# 6. Non-Goals

MVP will not:

- certify regulatory mineral reserves;
- replace geological field investigation;
- issue safety-critical mine-control commands;
- claim satellite-only underground detection;
- represent synthetic operational data as MOIL telemetry;
- provide autonomous blasting decisions;
- control real equipment.

---

# 7. Personas

## Exploration Geologist

Needs:

- prospectivity map
- geological evidence
- drill information
- uncertainty
- target ranking.

## Mine Planning Engineer

Needs:

- production forecast
- mine constraints
- schedule risk
- scenario comparison.

## Maintenance/Operations Engineer

Needs:

- equipment failure risk
- downtime drivers
- maintenance priorities.

## Production Manager

Needs:

- daily/shift target
- shortfall probability
- root cause
- corrective recommendation.

## Management

Needs:

- strategic exploration priorities
- production risk
- expected recovery
- cost/risk trade-off.

---

# 8. Core Product Modules

## Module 1 — Exploration Intelligence

Inputs:

- manganese occurrence evidence
- geology
- structure
- remote sensing
- DEM
- environmental context
- drilling/assay data.

Output:

```text
prospectivity_probability
confidence
uncertainty
evidence
priority_rank
```

---

## Module 2 — Subsurface Explorer

Visualize:

- boreholes
- intervals
- assay grade
- lithology
- depth
- cross-section
- 3D block benchmark.

Output:

> "What supports this target below the surface?"

---

## Module 3 — Production Forecast

Input:

- production history
- operational state
- weather
- equipment
- maintenance
- blasting
- ore
- stockpile
- schedule.

Output:

- forecast
- target
- gap
- confidence interval.

---

## Module 4 — Shortfall Risk

Output:

```text
shortfall_probability
risk_level
expected_shortfall
```

---

## Module 5 — Root Cause

Rank causes using explainability.

Example:

```text
Equipment downtime     31%
Rainfall               24%
Blasting                18%
Ore availability       15%
Other                   12%
```

---

## Module 6 — Digital Twin

Create mine scenarios.

Examples:

- normal
- heavy rainfall
- equipment failure
- maintenance delay
- blast delay
- ore shortage
- combined disruptions.

---

## Module 7 — Decision Optimizer

Possible interventions:

- equipment redeployment
- maintenance timing
- blast rescheduling
- ore routing
- schedule adjustment.

Output:

```text
recommended_action
expected_production_gain
shortfall_probability_change
cost_change
risk_change
confidence
```

---

# 9. Core User Stories

### Exploration

> As an exploration geologist, I want to click a high-prospectivity region and see the geological, spectral and subsurface evidence behind its score.

### Production

> As a production manager, I want to know whether tomorrow's production target is at risk before the shift starts.

### Root Cause

> As an operations manager, I want to know what is driving the predicted shortfall.

### Optimization

> As a mine planner, I want to compare multiple interventions before changing the schedule.

### Trust

> As a decision-maker, I want to know whether a result is backed by real data, synthetic benchmark data, or limited observations.

---

# 10. Functional Requirements

## FR-01 — India Compliance

All geospatial analysis must enforce India-only rules.

## FR-02 — Data Provenance

Every model input must be traceable to a source.

## FR-03 — Spatial Feature Extraction

Map observations to spatial features.

## FR-04 — Prospectivity

Produce prospectivity scores and confidence.

## FR-05 — Drill Integration

Overlay drillholes and assays where available.

## FR-06 — Production Forecast

Generate a future production forecast.

## FR-07 — Shortfall Prediction

Generate shortfall probability.

## FR-08 — Explainability

Show top risk drivers.

## FR-09 — Scenario Generation

Generate feasible interventions.

## FR-10 — Scenario Simulation

Estimate outcome under each intervention.

## FR-11 — Recommendation

Rank feasible actions.

## FR-12 — Uncertainty

Show uncertainty and confidence.

## FR-13 — Audit Trail

Record model/version/data source for every prediction.

---

# 11. Dashboard Requirements

## Home / Command Center

Display:

- overall production risk
- mines at risk
- high-priority exploration zones
- critical equipment risks
- recommended actions
- data quality warning.

## Exploration Screen

Map layers:

- prospectivity
- geology
- known occurrences
- structures
- boreholes
- satellite evidence
- uncertainty.

## Operations Screen

Cards:

```text
Target
Forecast
Shortfall
Probability
Confidence
```

## What-if Screen

Show:

```text
BASELINE
ACTION A
ACTION B
ACTION C
```

with:

- production
- risk
- cost
- improvement.

---

# 12. UX Principles

1. Explain before recommending.
2. Show uncertainty.
3. Avoid red/green alarm overload.
4. Show evidence on demand.
5. Never hide synthetic-data status.
6. Make the "why?" and "what next?" paths one click away.

---

# 13. Success Metrics

## Exploration

Primary:

- spatial PR-AUC
- spatial ROC-AUC
- calibration
- target ranking quality.

Business-style metric:

> percentage of known validated target zones captured in the top exploration percentile.

## Production

- MAE
- RMSE
- MAPE
- temporal holdout performance.

## Shortfall

- PR-AUC
- recall
- F1
- calibration.

## Equipment

- PR-AUC
- recall
- false-negative rate.

## Decision Engine

- expected production uplift
- risk reduction
- intervention cost
- constraint violation rate.

---

# 14. Trust / Safety Requirements

The system must display:

### DATA QUALITY

High / Medium / Low

### CONFIDENCE

High / Medium / Low

### DATA ORIGIN

Real / Derived / Synthetic.

### LIMITATION

Examples:

> "Satellite evidence is surface-derived."

> "Operational telemetry is synthetic prototype data."

> "Sparse drilling limits subsurface confidence."

---

# 15. Business Impact Hypothesis

If deployed with real MOIL operational data, the platform could support:

- better exploration targeting
- fewer unnecessary follow-up investigations
- earlier identification of production risk
- improved equipment utilization
- better coordination of maintenance and mine schedules
- reduced disruption
- more predictable ore availability.

Do not claim exact percentage savings without validated field data.

---

# 16. Competitive Moat

The moat is not the use of a particular algorithm.

It is:

### Data fusion

Indian geology + EO + subsurface + operations.

### Domain constraints

Sausar Group/gondite context and underground mine logic.

### Uncertainty

Decision-makers see confidence, not false precision.

### Counterfactual reasoning

The system predicts the effect of an intervention.

### Provenance

Every output can be traced back to its evidence.

### India-first architecture

No dependency on foreign training ground truth.

### Human-in-the-loop

Recommendations are reviewed by the mine expert before action.

---

# 17. MVP Success Definition

The MVP succeeds if a judge can:

1. select an Indian region;
2. inspect a prospective manganese zone;
3. understand why it is ranked highly;
4. see uncertainty;
5. switch to a mine;
6. view production risk;
7. understand root causes;
8. test an intervention;
9. see predicted recovery;
10. distinguish real from synthetic data.

That is the complete story.

---

# 18. Future Roadmap

## Phase 2

- more Indian exploration reports
- better real drill integration
- additional geological layers
- stronger spatial validation.

## Phase 3

- real MOIL telemetry
- streaming equipment health
- enterprise integration
- advanced resource modeling.

## Phase 4

- multi-mine optimization
- real-time decision support
- full digital twin
- deployment at operational scale.

---

# 19. Governed Data, Learning and Trust Requirements

MANGANESIS is a continuously improving decision-support product, not an autonomous mine-control system. The following requirements make the learning loop safe, explainable and appropriate for an industrial setting.

| ID | Requirement | Acceptance condition |
|---|---|---|
| FR-14 | Role-based data onboarding | Exploration, equipment, production and planning users can upload only to approved domains; the system proposes but does not silently accept a classification or schema mapping. |
| FR-15 | Versioning and rollback | Every accepted upload has uploader, source, checksum, parent version, validation status and timestamp; a prior approved version can be selected without deletion. |
| FR-16 | Data quality and drift | The product displays completeness, freshness, schema/unit/date validity, duplicate/anomaly findings and separately reports data versus performance drift. |
| FR-17 | Champion-challenger governance | A new training run is a challenger. Promotion requires correct spatial/temporal validation, calibration, false-negative and stability checks against the champion. |
| FR-18 | Feedback and decision memory | Authorised users can record actual outcomes, corrected causes and actual intervention effects with reviewer and model/dataset versions. |
| FR-19 | Human approval | Upload, model promotion and operational action recommendations remain auditable human decisions; the product never sends control commands to mine equipment. |

## Data Trust Screen

The dashboard includes a Data Trust screen with per-domain health, data origin, latest approved version, unresolved validation warnings, model champion/challenger status and the complete lineage of the selected prediction.

## Competitive value of the governed loop

The defensible advantage is not a claim that MANGANESIS invents every mining component. It is the integration of validated field updates, evidence-backed prediction, uncertainty, counterfactual simulation, action review and outcome feedback in one India-specific workflow. That gives a judge a practical answer to the question: “How does this improve after the demo?”

---

# 20. Extended Governed Platform Requirements

| ID | Requirement | Acceptance condition |
|---|---|---|
| FR-20 | Data Update Schedule | Each domain stores expected cadence, last success, next expected update and `FRESH`/`AGING`/`STALE`/`CRITICAL` status. A stale source is visible on dependent predictions. |
| FR-21 | AI-Assisted Dataset Onboarding | Support CSV, XLSX, Parquet and approved geospatial formats; suggest domain and field mappings with confidence; require user confirmation before approval. |
| FR-22 | Data Health Center | Present explainable health by domain using completeness, freshness, schema/unit validity, duplicates, anomalies, drift, lineage and update status. |
| FR-23 | Controlled Retraining | Allow scheduled, sufficient-new-data, drift, performance and authorised manual triggers; route every eligible run to challenger evaluation. |
| FR-24 | Model Freeze and Rollback | Permit a release freeze and selection of a last approved stable model, with a complete incident/audit record. |
| FR-25 | Model Hierarchy | Use global, regional and mine-specific candidate models with an explicit cold-start policy and configurable data-sufficiency thresholds. |
| FR-26 | Prediction Ledger | Persist prediction, lineage, confidence, drivers, recommendation, outcome, error and review status. |
| FR-27 | Intervention Learning | Persist baseline, predicted effect, observed effect, cost, risk and execution status for reviewed recommendations. |
| FR-28 | Alert Engine | Generate role-routed production, equipment, data, drift, exploration and model-health alerts. |
| FR-29 | AI Mine Copilot | Provide a natural-language interface that retrieves model/simulator/optimiser outputs and may invoke approved scenarios; it never becomes the numerical source of truth. |
| FR-30 | Exploration Target Maturity | Track each target from Detected to Resource Candidate and prevent prospectivity-only results from being represented as reserves or near-term ore supply. |
| FR-31 | Change Explanation | Summarise only measured differences after an approved data/model update, including data versions, metrics and unresolved limitations. |
| FR-32 | Validation Evidence | Produce a per-task matrix containing split type, independent entities, baseline, score, leakage status, calibration and ablation evidence; never treat random splits as the primary operational result. |

## Product statement

**One Mine. One Intelligence Layer. Governed Continuous Learning.** MANGANESIS unifies discovery, resource confidence, production state, prediction, explanation, intervention, outcome feedback and measured model improvement. It does not promise unattended autonomous operation.

## Role and Access Matrix

| Role | Permitted responsibilities | Explicit boundary |
|---|---|---|
| Platform Admin | user/role management, source approval, policies, audit review, model governance and promotion approval | cannot bypass validation or audit logging |
| Exploration Admin | geological, occurrence, drillhole, assay and exploration-report uploads; dataset management; prospectivity review | cannot certify a reserve from prospectivity alone |
| Equipment Admin | telemetry, maintenance and failure-record uploads; equipment-health review | cannot directly control equipment through MANGANESIS |
| Production Admin | production/target/ore/stockpile updates; forecast review; actual-outcome confirmation | feedback remains reviewed evidence, not automatic truth |
| Mine Planning Admin | schedules, allocation, routing and constraints; scenario execution | cannot publish a model release |
| Management | strategic dashboards, mine comparison, recommendation acknowledgement, decision history and ROI review | read-only for raw operational datasets; cannot silently change data |
