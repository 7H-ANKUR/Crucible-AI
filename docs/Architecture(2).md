# Architecture.md

# MANGANESIS
## India-First AI + Geoscience + Mine Operations Intelligence Platform for SIH26009

> **Working product name:** MANGANESIS  
> **Purpose:** A scientifically constrained, uncertainty-aware decision intelligence platform for Indian manganese exploration and production continuity.  
> **Primary study region for MVP:** Central Indian manganese belt, centered on Balaghat–Chhindwara–Bhandara/Nagpur, with expansion hooks for Odisha and other Indian belts.
>
> This architecture is designed to maximize SIH 2026 competitiveness without making unsupported claims. It treats **prospectivity, resource estimation, and reserves** as different problems and never represents a satellite-only probability map as a reserve estimate.

---

## 1. Executive Architecture

SIH26009 asks for a system that combines geological data, historical production, equipment performance and space-derived inputs to improve manganese exploration, predict production shortfalls, and recommend corrective actions.

MANGANESIS implements this as one closed-loop decision system:

```text
                  INDIA-ONLY DATA PLANE
                         |
       +-----------------+------------------+
       |                 |                  |
       v                 v                  v
   GEOSCIENCE        EARTH OBS.        OPERATIONS
   GSI/NGDR/NMET     Sentinel/DEM      IBM/MOIL + Synthetic
       |                 |                  |
       +-----------------+------------------+
                         |
                         v
                COMMON SPATIAL/TEMPORAL
                    DATA MODEL
                         |
          +--------------+--------------+
          |                             |
          v                             v
  EXPLORATION INTELLIGENCE       PRODUCTION INTELLIGENCE
          |                             |
          v                             v
  GEOLOGY-CONSTRAINED             FORECAST + RISK
  PROSPECTIVITY ENGINE             + ROOT CAUSE
          |                             |
          +--------------+--------------+
                         |
                         v
              UNCERTAINTY / EVIDENCE
                         |
                         v
                 DIGITAL MINE TWIN
                         |
                         v
             COUNTERFACTUAL SCENARIOS
                         |
                         v
                DECISION OPTIMIZER
                         |
                         v
                 MOIL COMMAND CENTER
```

The key differentiator is not an isolated ML model. It is the **closed loop from evidence -> prediction -> uncertainty -> intervention -> simulated outcome**.

---

# 2. Design Principles

## 2.1 India-only is an enforcement rule

Every spatial dataset and every geospatial transformation passes:

```python
assert_india_only()
```

The source registry must reject foreign training sources for Indian ground truth.

The pipeline must fail closed when:

- latitude/longitude is outside the accepted India operational region;
- an unapproved foreign source is being promoted to model training;
- a dataset is marked India-specific without verified provenance.

Foreign research may be used for methodology review only.

---

## 2.2 Real data is preferred over synthetic data

Data lineage is mandatory.

Every record/dataset is classified as:

- `REAL`
- `REAL_NEEDS_CLEANING`
- `DERIVED_REAL`
- `SYNTHETIC`
- `SYNTHETIC_CALIBRATED_BY_REAL`
- `PORTAL_ONLY`

Synthetic data must never be presented as MOIL data.

---

## 2.3 Physics/geology constrains ML

The model is not allowed to claim that satellite imagery directly detects deep underground manganese.

The primary scientific target is:

**mineral prospectivity / exploration targeting**

with resource intelligence added only when adequate drill/assay evidence exists.

This is aligned with published work demonstrating multi-sensor earth-observation targeting of stratiform manganese deposits in the Balaghat/Sausar Group setting. The paper describes VIS-NIR-SWIR and L-band approaches supported by laboratory/field evidence. [Source: https://doi.org/10.1016/j.asr.2023.03.044]

---

## 2.4 Underground-first operational model

The operational digital twin must not assume generic open-pit mining.

MOIL has historically operated both underground and opencast mines, with the company describing seven of its mines as underground and Balaghat as a very deep underground manganese mine. [Source: MOIL public corporate material]

Therefore the core operational model supports:

- shaft/decline
- underground level
- stope
- ore pass
- underground haulage
- development headings
- ventilation
- ground condition
- underground equipment availability
- access delays

Open-pit fields remain optional for appropriate scenarios.

---

## 2.5 Evidence before confidence

Every AI output should answer:

1. What is the prediction?
2. What evidence supports it?
3. How uncertain is it?
4. What data quality supports that confidence?
5. What action can change the outcome?

---

# 3. System Layers

## Layer 0 — Source & Provenance

Responsibilities:

- source discovery
- source verification
- download verification
- licensing
- metadata
- provenance
- India compliance
- versioning

Main sources:

- GSI / NGDR
- NMET
- IBM
- MOIL public documents
- ISRO / NRSC / BHOONIDHI / MOSDAC
- IMD
- state geology/mining departments

NGDR is particularly relevant because the Government's repository states that exploration data are standardized through MERT and converted to GIS-compatible formats for AI/ML applications. [Source: https://geodataindia.gov.in/]

---

## Layer 1 — Common Geospatial Data Model

All geographic observations are normalized into:

```text
entity_id
latitude
longitude
geometry
CRS
state
district
source
source_date
data_quality
spatial_accuracy
```

Time-aware records additionally use:

```text
timestamp
date
time_zone
observation_window
```

---

## Layer 2 — Geological Evidence

Inputs:

- manganese occurrences
- geological formation
- lithology
- structural zones
- faults
- lineaments
- geomorphology
- exploration blocks
- boreholes
- assay intervals
- ore intersections
- resource estimates

Output:

```text
geological_context_layer
subsurface_evidence_layer
```

---

## Layer 3 — Earth Observation

Primary:

- Sentinel-2 L2A
- Sentinel-1 where scientifically useful

Supporting:

- Landsat
- DEM
- other verified EO products

Derived features:

- VNIR bands
- red-edge bands
- SWIR bands
- spectral ratios
- NDVI
- NDMI
- NDWI
- texture
- topographic variables

Satellite observations are interpreted as **surface evidence/proxies**, not direct subsurface measurements.

---

## Layer 4 — Environmental Context

Real data preferred:

- rainfall
- soil moisture
- temperature
- vegetation
- cloud cover
- surface water
- weather events

Temporal features:

- 24-hour rainfall
- 3-day rainfall
- 7-day rainfall
- 30-day rainfall
- rolling means
- rainfall anomaly
- extreme-event flag

---

# 4. Exploration Intelligence Engine

## 4.1 Problem Definition

Primary:

> Rank areas for manganese exploration based on geological, structural, subsurface and remote-sensing evidence.

Secondary where drilling is sufficient:

> Estimate mineralized grade/volume with uncertainty.

Do not collapse these into one target.

---

## 4.2 Feature groups

Target:

**30–50 meaningful predictors**, not 100+ arbitrary variables.

### Earth Observation

- B2–B12 relevant Sentinel-2 bands
- red-edge ratios
- SWIR ratios
- NIR/SWIR ratios
- NDVI
- NDMI
- NDWI
- texture

### Terrain

- elevation
- slope
- aspect
- curvature
- roughness
- terrain ruggedness
- drainage density

### Geology

- lithology
- formation
- structural unit
- host rock
- geological age

### Structural

- fault distance
- lineament distance
- structural density
- drainage/structure relationship

### Context

- distance to known manganese occurrence
- exploration density
- drill density
- data quality

---

## 4.3 Prospectivity architecture

```text
Real Indian Geoscience
        +
Real EO
        +
Terrain
        +
Subsurface evidence
        |
        v
Feature Harmonization
        |
        v
Physics/Geology Constraints
        |
        v
Spatial ML
        |
        +----> Probability
        |
        +----> Evidence attribution
        |
        +----> Uncertainty
        |
        v
Prospectivity Map
```

Recommended baseline:

- logistic regression
- random forest
- XGBoost/LightGBM

Optional research models:

- calibrated ensemble
- spatially regularized model
- probabilistic model

---

# 5. Resource Intelligence

Resource intelligence is activated only where subsurface data density and quality justify it.

Pipeline:

```text
Boreholes
  |
Assays
  |
Lithology
  |
Spatial continuity
  |
Geostatistical model
  |
3D block model
  |
Grade estimate
  |
Uncertainty volume
```

Potential techniques:

- variograms
- kriging
- Gaussian random fields for synthetic benchmarks
- 3D block modeling

No reserve number is shown without:

- grade evidence
- volume evidence
- geological constraints
- economic assumptions
- uncertainty.

---

# 6. Production Intelligence Engine

## 6.1 Forecast target

Primary:

```text
future_production_t
```

Secondary:

```text
shortfall_flag
shortfall_t
shortfall_probability
```

---

## 6.2 Inputs

### Historical

- lagged production
- moving averages
- target
- ore availability
- stockpile

### Equipment

- availability
- utilization
- downtime
- breakdown history
- machine state

### Maintenance

- days since maintenance
- overdue maintenance
- failure history

### Blasting

- blast delay
- fragmentation
- clearance

### Underground

- level
- stope
- ore pass
- ventilation
- ground condition
- access/development delay

### Weather

- rainfall
- soil wetness
- temperature

### Logistics

- haul distance
- cycle time
- queue time
- routing delay.

---

# 7. Equipment Failure Intelligence

Target:

```text
failure_next_24h
```

Candidate models:

- logistic regression
- random forest
- XGBoost/LightGBM

Metrics:

- PR-AUC
- ROC-AUC
- recall
- false-negative rate
- calibration

Do not optimize for accuracy alone because failures are naturally imbalanced.

---

# 8. Root-Cause Intelligence

For each production-risk prediction:

```text
Prediction
   |
   +--> SHAP / attribution
   |
   +--> constraint analysis
   |
   +--> temporal context
   |
   v
Root Cause Ranking
```

Example:

```text
Shortfall probability: 74%

1. Equipment downtime      31%
2. Rainfall                 24%
3. Blast delay              18%
4. Ore availability         15%
5. Other                    12%
```

These percentages must be model-derived, not hard-coded.

---

# 9. Digital Twin

The digital twin is a **decision simulator**, not a graphical 3D toy.

State:

```text
Mine
 -> Level/Zone
 -> Equipment
 -> Ore
 -> Stockpile
 -> Schedule
 -> Weather
 -> Maintenance
 -> Blast
```

Transition:

```text
current_state
     |
     v
operational rules
     |
     v
production state
```

The twin evaluates:

- expected production
- downtime
- shortfall probability
- cost
- equipment use
- ore availability.

---

# 10. Counterfactual Decision Engine

This is the main competition differentiator.

The system should not merely say:

> "Shortfall is likely."

It should ask:

> "What intervention produces the best feasible improvement?"

Generate scenarios:

1. baseline
2. equipment redeployment
3. maintenance rescheduling
4. blast rescheduling
5. ore routing change
6. combined intervention

For each:

```text
production
shortfall_probability
cost
risk
equipment_conflicts
operational_constraints
```

Then rank by multi-objective score.

---

# 11. Optimization Objective

Define:

```text
maximize:
    expected_production_gain
    - intervention_cost
    - risk_penalty
    - operational_disruption
```

Subject to:

```text
equipment capacity
maintenance windows
underground access
ore availability
processing capacity
stockpile balance
blast constraints
schedule constraints
safety constraints
```

The optimizer must produce:

```text
recommended_action
expected_gain_t
risk_change
cost_change
confidence
```

---

# 12. Uncertainty Engine

Every major AI output receives:

```text
prediction
lower_bound
upper_bound
confidence
data_quality
uncertainty_source
```

Explore:

- aleatoric uncertainty
- epistemic uncertainty
- spatial uncertainty
- calibration
- prediction intervals
- uncertainty propagation.

For exploration:

```text
Prospectivity
Confidence
Drilling density
Data quality
Spatial uncertainty
```

For production:

```text
P10
P50
P90
Shortfall probability
```

---

# 13. Why This Can Beat Generic Competition

The competitive position should NOT be:

> "We use AI."

Instead:

### Competitor-type solution

```text
Satellite
  ↓
ML
  ↓
Map
```

or:

```text
Production history
  ↓
Forecast
```

### MANGANESIS

```text
GEOSCIENCE
   +
REMOTE SENSING
   +
SUBSURFACE EVIDENCE
   +
OPERATIONS
   +
WEATHER
   +
EQUIPMENT
   +
UNCERTAINTY
   ↓
PREDICT
   ↓
EXPLAIN
   ↓
SIMULATE
   ↓
OPTIMIZE
   ↓
ACT
```

This is a **closed-loop decision system**.

Existing industry practice already includes components such as digital mine planning, production scheduling, underground equipment tracking and equipment health monitoring at MOIL. Therefore the innovation should be the **integration and decision loop**, not claiming that each individual capability is novel. [Source: https://www.moil.nic.in/userfiles/file/InvRel/Annual_Report_2021-22.pdf]

---

# 14. MVP vs Future R&D

## MVP

Must implement:

- India-only data gate
- Central Indian study region
- geological feature pipeline
- real EO ingestion where accessible
- prospectivity baseline
- confidence/uncertainty
- synthetic operational digital twin
- production forecasting
- shortfall prediction
- root cause
- counterfactual scenarios
- optimization
- dashboard.

## Future R&D

- real MOIL telemetry integration
- large-scale 3D geological model
- advanced kriging
- fleet tracking
- streaming IoT
- real-time control
- enterprise integration
- production-grade MLOps.

---

# 15. Deployment Architecture

```text
Frontend
  React / Next.js
       |
API Gateway
       |
FastAPI
       |
+------+---------+-------------+
|                |             |
Geo Service    ML Service    Twin/Optimizer
|                |             |
PostGIS        Model Store   Scenario Store
|                |             |
Raster/Vector   ML Models     Simulation
       |
Object Storage
```

Recommended practical stack:

- Next.js / React
- MapLibre or equivalent map renderer
- FastAPI
- PostgreSQL + PostGIS
- Parquet
- object storage
- Python ML stack
- XGBoost/LightGBM
- NumPy
- GeoPandas
- Rasterio when available
- OR-Tools / scipy optimization where justified

---

# 16. Dependency Strategy

Core MVP must work even if optional scientific wheels fail.

Tier 1:

- Python
- NumPy
- Pandas/Polars
- scikit-learn
- XGBoost/LightGBM

Tier 2:

- GeoPandas
- Rasterio
- Shapely
- pyproj

Tier 3:

- PyKrige / GSTools
- specialized 3D/geostatistical libraries

Synthetic spatial continuity should have a pure-NumPy FFT Gaussian random field fallback.

---

# 17. Security and Governance

Do not expose:

- credentials
- API keys
- proprietary MOIL data
- personal information.

Every dataset gets:

- provenance
- source
- license
- access date
- version
- checksum
- data-quality status.

Every synthetic dataset gets:

- generator version
- random seed
- assumptions
- causal graph
- synthetic flag.

---

# 18. Architecture Success Criterion

The system is successful when it can demonstrate a complete chain:

```text
Indian geology
       ↓
surface evidence
       ↓
subsurface evidence
       ↓
prospectivity
       ↓
uncertainty
       ↓
production state
       ↓
forecast
       ↓
shortfall risk
       ↓
root cause
       ↓
scenario
       ↓
optimization
       ↓
expected recovery
```

That closed loop is the architectural north star.

---

# 19. Governed Data and Learning Loop

MANGANESIS improves from new evidence without treating an uploaded spreadsheet as an automatic production-model deployment. It is a single operational-intelligence layer in which departmental users contribute data, the platform validates and versions it, and model candidates are evaluated before release.

## 19.1 Departmental workspaces and ownership

| Role | Controlled contribution | Primary decision view |
|---|---|---|
| Platform Admin | users, source policy, approvals, audit log | organization and release governance |
| Exploration Admin | occurrences, drillholes, assays and maps | exploration evidence and target quality |
| Equipment Admin | telemetry, operating hours, failures and maintenance | equipment health and maintenance review |
| Production Admin | shift/daily/monthly production, target, ore and stockpile | forecast inputs and outcome feedback |
| Mine Planning Admin | schedule, allocation, routing and constraints | scenario feasibility |
| Management | approved decision and outcome review | strategic prioritisation, not raw-data override |

Each contribution carries a source, user, timestamp, data domain and dataset version. Roles have least-privilege access, and no role may silently overwrite history.

## 19.2 Dataset onboarding contract

```text
Upload -> classify -> map schema -> preview -> validate -> quality score
       -> duplicate/unit/date/leakage checks -> immutable version -> approval/rejection
       -> feature refresh -> eligible training candidate
```

The UI may suggest a dataset type and column mapping, but the responsible user confirms it. Checks cover required fields, India/mine scope, entity keys, units, time coverage, missingness, outliers, duplicates, causal timing and target leakage. A rejected file remains visible with its reason; an accepted file creates an approved version that can be rolled back by selecting a previous approved version.

## 19.3 Champion-challenger model governance

New evidence may create a training candidate but never directly publishes a model.

```text
approved dataset version -> challenger evaluation -> holdout, calibration and drift gates
                         -> champion comparison -> approved promotion or rejection
```

The challenger must satisfy the correct temporal/spatial holdout, calibration, false-negative and operational-constraint gates. A better aggregate score does not justify promotion if calibration or safety-relevant performance worsens. Every prediction stores model version, feature schema version and dataset version.

## 19.4 Feedback, decision memory and drift

Predictions are linked to actual outcomes. Expert corrections to a root cause and actual results of an accepted intervention are kept as reviewable feedback: action, reason, predicted effect, actual effect, reviewer and versions. This *decision memory* informs later analysis and retraining review; it never triggers unapproved control actions.

The platform reports separately: **data drift** (changed inputs or data quality), **performance/concept drift** (forecast error or calibration degradation), and **data health** (freshness, completeness, schema conformance, duplicate rate and unresolved warnings). This makes the system operationally credible without overclaiming self-learning autonomy.

---

# 20. One Mine, One Intelligence Layer, Governed Continuous Learning

MANGANESIS is an **India-first Mining Intelligence Operating Platform**, not merely a dashboard, isolated ML model, digital twin or predictive-maintenance tool. It consolidates exploration intelligence, geology, subsurface interpretation, production forecasting, equipment health, maintenance, stockpiles, planning, environmental context, scenario analysis, optimisation, model monitoring and data onboarding into one governed decision workflow.

Individual industry products may address several of these capabilities. The defensible differentiation is their integration into an India-specific workflow where every important prediction, recommendation and later outcome is traceable.

```text
UPLOAD -> VALIDATE -> VERSION -> FEATURE REFRESH -> TRAIN CHALLENGER
       -> EVALUATE -> APPROVE/PROMOTE -> PREDICT -> EXPLAIN
       -> SIMULATE -> RECOMMEND -> HUMAN DECISION -> ACTUAL OUTCOME
       -> REVIEWED FEEDBACK -> DRIFT/ERROR ANALYSIS -> FUTURE IMPROVEMENT
```

## 20.1 Data update schedules and freshness

Each data domain has a configurable expected update frequency, `last_successful_update`, `next_expected_update` and `freshness_status`:

| Domain | Typical supported cadence |
|---|---|
| Equipment | real-time integration where available, daily file or event-based |
| Production and stockpile | shift, daily, weekly or monthly |
| Maintenance and failure records | event-based |
| Planning, allocation and routing | weekly or monthly |
| Exploration | project/campaign-based |
| Weather/environment | daily or approved automated feed |

Freshness is explicitly classified as `FRESH`, `AGING`, `STALE` or `CRITICAL`. A stale feature source lowers confidence and surfaces a warning; it must never be hidden behind a seemingly precise prediction.

## 20.2 Data Health Center

The Data Health Center provides a drill-down health status for production, equipment, maintenance, exploration, environment and planning. Its score is explainable through completeness, freshness, schema validity, unit validity, duplicate rate, anomaly count, drift status, lineage completeness and last successful update. It routes the actionable issue to the responsible role, for example a stale production feed to the Production Admin.

---

# 21. Model Hierarchy, Readiness and Safe Release

## 21.1 Global, regional and mine-specific models

The platform avoids requiring an isolated model for every mine from day one:

```text
Global model -> regional calibration -> mine-specific adaptation
```

For a mine with limited history, **Cold Start Mode** uses the global baseline, regional/context features and limited mine data. As evidence accumulates, the platform may assess a mine-specific candidate. The readiness policy is configurable; illustrative bands are: less than three months of useful history, global baseline; three to twelve months, global plus calibration; beyond twelve months, mine-specific candidate evaluation. These are policy defaults, not universal scientific thresholds.

## 21.2 Retraining triggers, freeze and rollback

Challenger evaluation can be requested by scheduled cadence, sufficient newly approved observations, data drift, performance/concept drift, or an authorised manual request. A Model Freeze prevents promotion while retaining the serving champion and collecting new evidence. Emergency rollback selects the last approved stable release and records `incident_id`, model version, reason, initiator, timestamp and rollback target.

## 21.3 Model Health Dashboard

For every model family, display champion version, status, evaluation date, correct holdout metrics, calibration, stability, drift state, current dataset version and challenger comparison. A challenger is retained only when its overall evidence is better; a single improved metric cannot outweigh degraded calibration, stability or false-negative performance.

---

# 22. Prediction Ledger, Decision Memory and Intervention Learning

The **Prediction Ledger** permanently records significant outputs: `prediction_id`, entity, timestamp, model version, dataset version, prediction, target, confidence, uncertainty, top drivers, recommended action, data origin, actual outcome, error and review status.

The **Decision Memory** stores each recommended/selected intervention with baseline, predicted effect, actual effect, cost, risk, execution status, reviewer and outcome. **Intervention Learning** compares predicted and observed effects across reviewed decisions to improve future scenario estimation. It remains decision support: reviewed feedback is evidence, not automatic truth, and no record creates autonomous mine control.

---

# 23. Mine State, Alerts and Assisted Interaction

## 23.1 Timestamped mine state

`MineState` is the shared digital-twin object at time T: production, equipment, maintenance, ore, stockpile, weather, blasting, schedule, geology/exploration and risk. The twin applies a validated scenario to current state to estimate a future state, enabling a consistent link between forecast, constraints and recommendation.

## 23.2 Alert engine

The Alert Engine handles production-risk, equipment-risk, stale-data, drift, exploration-priority and model-health alerts. Alerts are role routed: Production Admin receives production alerts; Equipment Admin equipment alerts; Exploration Admin exploration alerts; Mine Planning Admin scenario/constraint alerts; Management only critical or strategic alerts. Each recommendation shows confidence, feasibility, expected impact, cost, risk reduction and urgency.

## 23.3 AI Mine Copilot

The optional copilot provides a natural-language interface to approved outputs, for example “Why is this mine at risk tomorrow?” or “What if Loader 4 also fails?” It must use the actual scenario engine for counterfactuals. The boundary is strict: **ML models are the prediction source; the simulator is the scenario source; the optimiser is the action source; the LLM is an interface/orchestrator.** The copilot never invents operational values.

## 23.4 Exploration-to-operations connection

Exploration targets progress through `Detected -> Screened -> Geologically supported -> Drill recommended -> Drilled -> Validated -> Resource candidate`. Prospectivity informs resource confidence, which informs ore availability, mine sequence and production risk only at its approved maturity. A high-prospectivity zone with sparse subsurface evidence cannot be used to claim near-term ore supply.

---

# 24. Evaluation Integrity

The platform earns confidence through correct validation, not unusually high synthetic metrics. Prospectivity evaluation uses geographically separated holdouts; production, shortfall and equipment evaluation use time-based holdouts, with machine/entity holdout where applicable. Random-split results may be recorded for diagnosis but are never the primary operational claim.

Every reported model result includes split type, rows, independent entities/locations/dates, baseline comparison, leakage status, calibration status and ablation findings. The product must not tune synthetic data toward a predetermined ROC-AUC or R-squared threshold; realistic causal generation, reproducibility, appropriate validation and meaningful signal are the success criteria.
