# system Design.md

# MANGANESIS — SYSTEM DESIGN

## 1. System Purpose

This document describes the implementable system design for SIH26009.

The system consists of five major computational planes:

```text
DATA
  ↓
GEOINTELLIGENCE
  ↓
OPERATIONAL INTELLIGENCE
  ↓
DECISION INTELLIGENCE
  ↓
USER INTERFACE
```

All planes share a common provenance, validation and uncertainty framework.

---

# 2. High-Level Architecture

```text
                         ┌─────────────────────────┐
                         │       DATA SOURCES       │
                         │                         │
                         │ GSI / NGDR / NMET       │
                         │ IBM / MOIL              │
                         │ Sentinel / DEM           │
                         │ IMD / ISRO              │
                         │ Synthetic Prototype     │
                         └────────────┬────────────┘
                                      │
                                      v
                         ┌─────────────────────────┐
                         │   INGESTION + REGISTRY   │
                         │ schema + provenance      │
                         │ checksum + quality       │
                         └────────────┬────────────┘
                                      │
                                      v
                         ┌─────────────────────────┐
                         │ COMMON DATA MODEL        │
                         │ Geo + Time + Mine IDs    │
                         └───────┬─────────┬─────────┘
                                 │         │
                    ┌────────────┘         └─────────────┐
                    v                                    v
          ┌───────────────────┐               ┌───────────────────┐
          │ EXPLORATION PLANE │               │ OPERATIONS PLANE  │
          │                   │               │                   │
          │ geology           │               │ production        │
          │ satellite         │               │ equipment         │
          │ drill/assay       │               │ maintenance       │
          │ terrain           │               │ blast             │
          │ structures        │               │ stockpile         │
          └─────────┬─────────┘               └─────────┬─────────┘
                    │                                   │
                    v                                   v
          ┌───────────────────┐               ┌───────────────────┐
          │ PROSPECTIVITY ML   │               │ FORECAST / RISK ML │
          └─────────┬─────────┘               └─────────┬─────────┘
                    │                                   │
                    └────────────────┬──────────────────┘
                                     v
                         ┌─────────────────────────┐
                         │ UNCERTAINTY + EVIDENCE  │
                         └────────────┬────────────┘
                                      v
                         ┌─────────────────────────┐
                         │ DIGITAL MINE TWIN        │
                         └────────────┬────────────┘
                                      v
                         ┌─────────────────────────┐
                         │ COUNTERFACTUAL ENGINE    │
                         └────────────┬────────────┘
                                      v
                         ┌─────────────────────────┐
                         │ OPTIMIZER                │
                         └────────────┬────────────┘
                                      v
                         ┌─────────────────────────┐
                         │ MOIL COMMAND CENTER      │
                         └─────────────────────────┘
```

---

# 3. Services

## 3.1 API Gateway

FastAPI exposes:

```text
GET  /health
GET  /sources
GET  /regions
GET  /exploration/map
GET  /exploration/target/{id}
GET  /production/{mine}
GET  /production/{mine}/forecast
GET  /risk/{mine}
GET  /equipment/{machine}
POST /scenarios
POST /optimize
GET  /predictions/{id}
GET  /lineage/{prediction_id}
```

---

# 4. Data Ingestion Service

Responsibilities:

- fetch
- validate
- normalize
- register
- version
- store.

Every ingestion job creates:

```text
source_id
dataset_id
ingestion_id
timestamp
checksum
row_count
schema_hash
```

---

# 5. India Compliance Service

Every coordinate passes:

```python
assert_india_only(latitude, longitude)
```

For production:

- mine IDs must map to India;
- no foreign geography enters the model.

Validation output:

```json
{
  "india_compliance": "PASS",
  "records_checked": 100000,
  "outside_india": 0
}
```

---

# 6. Data Quality Service

Checks:

### Schema

- expected columns
- expected types

### Range

- physical limits

### Missingness

- rate
- pattern

### Duplicate

- exact
- spatial
- temporal

### Leakage

- target leakage
- future leakage
- post-event features.

---

# 7. Storage Design

## PostgreSQL/PostGIS

Use for:

- mines
- spatial grids
- occurrences
- geological polygons
- boreholes
- prediction metadata.

## Object storage

Use for:

- GeoTIFF
- Sentinel-2 assets
- Parquet
- model artifacts
- reports.

## Parquet

Use for large analytical datasets.

---

# 8. Canonical Entities

## Region

```text
region_id
name
state
geometry
```

## Mine

```text
mine_id
mine_name
state
district
mine_type
geometry
source
```

## Equipment

```text
machine_id
mine_id
machine_type
mine_type
commission_date
```

## Exploration Point

```text
occurrence_id
latitude
longitude
host_rock
formation
source
```

## Borehole

```text
borehole_id
latitude
longitude
elevation
total_depth
project_id
```

## Production Observation

```text
timestamp
mine_id
shift
planned_production
actual_production
```

---

# 9. Data Model — Exploration

```text
occurrences
   |
   +--- geology
   |
   +--- structures
   |
   +--- satellite features
   |
   +--- terrain
   |
   +--- drillholes
   |
   v
exploration_feature_grid
```

Schema:

```text
grid_id
geometry
geology_features...
remote_sensing_features...
terrain_features...
structural_features...
subsurface_features...
data_quality...
prospectivity_label
```

---

# 10. Data Model — Operations

```text
production
    |
equipment
    |
maintenance
    |
blasting
    |
stockpile
    |
schedule
    |
weather
    |
    v
operational_feature_table
```

All events are aligned to a common:

```text
mine_id
zone_id
timestamp
```

---

# 11. Feature Pipeline

## Exploration

```text
raw raster/vector
      ↓
reproject
      ↓
clip study region
      ↓
resample
      ↓
feature extraction
      ↓
spatial join
      ↓
feature table
```

## Operations

```text
events
 ↓
time alignment
 ↓
lag features
 ↓
rolling features
 ↓
constraint features
 ↓
ML table
```

---

# 12. Prospectivity Model Pipeline

```text
Feature table
    ↓
Quality filter
    ↓
Negative/background sampling
    ↓
Spatial block split
    ↓
Baseline models
    ↓
Calibration
    ↓
Uncertainty
    ↓
Spatial prediction
    ↓
Evidence attribution
    ↓
GIS raster/vector output
```

Outputs:

```text
prospectivity_probability
confidence
uncertainty
evidence_rank
```

---

# 13. Prospectivity Leakage Controls

Forbidden:

- target encoded as input
- occurrence ID as target proxy
- spatial duplicates between train/test
- future geological information.

The system should calculate:

```text
minimum_distance_train_test
spatial_overlap
duplicate_geometry_rate
```

and fail validation if leakage exceeds configured thresholds.

---

# 14. Production Forecast Pipeline

```text
Historical operational table
         ↓
time sorting
         ↓
feature generation
         ↓
temporal split
         ↓
baseline
         ↓
ML model
         ↓
prediction interval
         ↓
forecast
```

No future values may enter the features.

---

# 15. Shortfall Pipeline

```text
Forecast
   +
Target
   +
Operational state
        ↓
Shortfall probability
        ↓
Calibration
        ↓
Root-cause attribution
```

---

# 16. Equipment Failure Pipeline

```text
Telemetry
    +
Maintenance
    +
Historical failures
        ↓
window construction
        ↓
label = failure in next 24h
        ↓
temporal split
        ↓
model
        ↓
probability
```

The label must be created using only future event timestamps.

---

# 17. Synthetic Data Architecture

Synthetic generation must use a causal dependency graph.

```text
WEATHER
   |
   +--> GROUND CONDITION
   |        |
   |        +--> HAUL TIME
   |
   +--> EQUIPMENT STRESS
             |
             +--> FAILURE
             |
             +--> DOWNTIME
                       |
                       v
                    PRODUCTION
```

Maintenance:

```text
machine age
engine hours
overdue maintenance
vibration
temperature
       ↓
failure hazard
```

Geology:

```text
lithology
structure
spatial continuity
surface proxy
       ↓
latent mineralization
       ↓
grade
```

---

# 18. Synthetic Spatial Continuity

When geostatistical libraries are unavailable:

Use:

```text
FFT Gaussian random field
```

to create correlated latent surfaces.

Apply:

- configurable length scale
- Gaussian noise
- anisotropy where justified.

Do not produce independent random block grades.

---

# 19. Underground Mining Model

Every underground production scenario should support:

```text
mine_type = underground
level_id
stope_id
ore_pass_status
shaft_status
ventilation_status
ground_condition
underground_haul_distance
development_delay
```

Example constraint:

```text
if ventilation_status == "restricted":
    productive_hours *= restriction_factor
```

Example:

```text
if ore_pass_status == "blocked":
    ore_outflow = 0
```

All coefficients must be documented as synthetic assumptions.

---

# 20. Decision Scenario Engine

A scenario is:

```python
Scenario(
    equipment_changes=[],
    maintenance_changes=[],
    blast_changes=[],
    routing_changes=[],
    schedule_changes=[]
)
```

The simulator returns:

```text
scenario_production
shortfall_probability
cost
risk
constraint_violations
```

The optimizer evaluates only feasible scenarios.

---

# 21. Optimization Algorithm

MVP:

```text
Generate candidates
        ↓
Filter constraints
        ↓
Simulate
        ↓
Score
        ↓
Rank
```

No reinforcement learning required.

Later:

- mixed-integer optimization
- Bayesian optimization
- reinforcement learning.

---

# 22. Objective Function

Conceptually:

```text
maximize:
    expected_production
    - cost
    - risk
    - disruption
```

Weights must be configurable.

Never hide weights in code.

---

# 23. Uncertainty Architecture

Each prediction stores:

```text
prediction_id
model_version
prediction
lower_bound
upper_bound
confidence
uncertainty_score
uncertainty_type
data_quality
```

---

# 24. Explainability Architecture

For ML:

- SHAP
- permutation importance

For optimizer:

- intervention delta
- cost delta
- risk delta
- constraint explanation.

Dashboard should answer:

```text
WHY?
WHAT IF?
WHY THIS ACTION?
```

---

# 25. Model Registry

Store:

```text
model_id
model_version
dataset_version
feature_schema_version
training_period
validation_method
metrics
artifact_path
git_commit
random_seed
limitations
```

Do not overwrite models silently.

---

# 26. API Prediction Contract

Example:

```json
{
  "prediction_id": "pred_001",
  "entity_id": "mine_01",
  "timestamp": "2026-08-27T10:00:00Z",
  "prediction": {
    "production_t": 8200,
    "target_t": 9000,
    "shortfall_probability": 0.74
  },
  "confidence": "MEDIUM",
  "top_drivers": [
    "equipment_downtime",
    "rainfall_7d",
    "blast_delay"
  ],
  "data_origin": "SYNTHETIC_PROTOTYPE"
}
```

---

# 27. Scenario Response Contract

```json
{
  "scenario_id": "sc_003",
  "baseline_production_t": 8200,
  "scenario_production_t": 8850,
  "baseline_shortfall_probability": 0.74,
  "scenario_shortfall_probability": 0.21,
  "cost_inr": 185000,
  "recommended": true,
  "action": [
    "reassign loader to zone 3",
    "reschedule maintenance",
    "move blast to shift 2"
  ],
  "confidence": "MEDIUM"
}
```

---

# 28. Frontend Structure

```text
/app
  /dashboard
  /exploration
  /subsurface
  /operations
  /equipment
  /scenarios
  /optimizer
  /data-lineage
```

Common UI state:

```text
selected_region
selected_mine
selected_date
selected_scenario
data_quality
```

---

# 29. Command Center Screens

## Screen 1 — Overview

- production risk
- exploration priorities
- equipment risk
- alerts
- recommendations.

## Screen 2 — Exploration

- map
- prospectivity
- geology
- drillholes
- uncertainty.

## Screen 3 — Mine Operations

- production forecast
- target
- shortfall
- risk.

## Screen 4 — Explainability

- driver chart
- evidence.

## Screen 5 — What-if Simulator

- interventions
- comparison table
- chart.

## Screen 6 — Data Trust

- source
- real/synthetic
- freshness
- quality.

---

# 30. Observability

Log:

```text
request_id
dataset_version
model_id
latency
prediction
error
```

Metrics:

- API latency
- ingestion failures
- model failures
- data-quality failures
- scenario execution time.

---

# 31. Testing

## Unit

- India boundary
- feature formulas
- mass balance
- time windows
- scenario constraints.

## Data tests

- schema
- ranges
- nulls
- duplicates
- leakage.

## ML tests

- no target leakage
- split correctness
- calibration
- reproducibility.

## Integration

```text
ingestion
→ feature
→ model
→ scenario
→ API
→ UI
```

---

# 32. Reproducibility

Every run stores:

```text
random_seed
git_commit
dataset_version
model_version
environment_lock
```

Synthetic datasets must be regenerable from the same seed.

---

# 33. Failure Modes

## No satellite data

Fall back to cached derived feature store.

## No geospatial package

Use pure NumPy preprocessing where possible.

## No drill data

Exploration becomes prospectivity-only, with lower confidence.

## No operational real data

Run clearly labelled synthetic operational twin.

## Model failure

Fall back to baseline.

## Data quality failure

Do not produce a falsely confident recommendation.

---

# 34. Implementation Priority

### P0

- India gate
- data registry
- production model
- prospectivity model
- dashboard
- scenario engine.

### P1

- drill integration
- equipment model
- SHAP
- uncertainty
- data lineage UI.

### P2

- advanced geostatistics
- 3D subsurface
- advanced optimizer
- MLOps.

---

# 35. Definition of Done

The system is complete for SIH when:

- all three PS requirements are demonstrable;
- the data provenance is visible;
- India compliance passes;
- prospectivity has spatial validation;
- production has temporal validation;
- equipment failure has a reasonable positive class;
- no leakage is detected;
- recommendations respect constraints;
- synthetic assumptions are disclosed;
- every dashboard prediction can be traced to a model/data version.

---

# 36. Governed Dataset and Model Lifecycle

## 36.1 Ingestion APIs and controls

Extend the API contract with:

```text
POST /datasets/upload
POST /datasets/{dataset_id}/validate
POST /datasets/{dataset_id}/approve
GET  /datasets/{dataset_id}/versions
GET  /data-health
GET  /models/{model_id}/candidates
POST /models/{model_id}/promote
POST /feedback/predictions/{prediction_id}
POST /feedback/decisions
```

Uploads are placed in a quarantine area before validation. The ingestion record includes `data_domain`, `parent_dataset_version`, `uploader_id`, `data_origin`, `validation_status`, `schema_hash`, `checksum` and `row_count`. The service suggests a mapping only; approval is explicit and role-scoped.

## 36.2 Versioned entities

```text
dataset_version(dataset_version_id, dataset_id, parent_version, origin, status, checksum)
validation_run(validation_id, dataset_version_id, ruleset_version, outcome, findings)
model_release(model_version, dataset_version_id, role, metrics, approval_status)
prediction_feedback(prediction_id, actual_outcome, expert_reason, reviewer, reviewed_at)
decision_memory(decision_id, scenario_id, action, predicted_impact, actual_impact, reviewer)
```

Immutable dataset versions and explicit model releases make rollback a version selection rather than a destructive overwrite.

## 36.3 Champion-challenger release path

```text
approved dataset -> feature build -> challenger -> holdout + calibration + drift checks
                 -> compare with champion -> approve promotion or retain champion
```

One active champion exists for a model family. A challenger is promoted only after an auditable approval records the evaluator, metric comparison, calibration, false-negative rate, constraints, decision and timestamp. Upload success never causes a model release.

## 36.4 Monitoring and confidence

Data health measures freshness, completeness, schema conformance, duplicates and anomaly rate. Data drift measures changing inputs; performance drift measures degradation against observed outcomes. Monitoring events are time-stamped and are attached to prediction confidence so that a recommendation can be reviewed in the context of current evidence quality.

---

# 37. Extended Operating-Platform Services

These services implement the MANGANESIS **Governed Continuous Learning** lifecycle: new evidence may improve a future model only through validation, versioning, challenger evaluation and explicit approval.

## 37.1 AI-Assisted Dataset Onboarding Service

The service accepts CSV, XLSX, Parquet and approved geospatial files into quarantine. It profiles headers, types, units, timestamps and spatial metadata; classifies a probable domain; proposes canonical mappings with confidence; and requires explicit role-scoped confirmation. It then applies schema, unit, date, duplicate, mine/region, provenance, quality and leakage rules before emitting an approved immutable version or a rejection with findings.

## 37.2 Freshness and Data Health Service

Maintain `expected_update_frequency`, `last_successful_update`, `next_expected_update` and `freshness_status` for every data domain. Compute `FRESH`, `AGING`, `STALE` or `CRITICAL` status, plus explainable data-health components: completeness, schema validity, unit validity, duplicate/anomaly rate, drift, lineage completeness and successful-update status. The feature service passes the relevant freshness/health status into the prediction confidence contract.

## 37.3 Retraining Orchestrator and Model Release Controls

Supported triggers are scheduled cadence, sufficient approved new data, data drift, concept/performance drift and authorised manual invocation. The orchestrator selects the correct global, regional or mine-specific candidate based on configurable data-sufficiency policy and records its cold-start status.

`ModelFreeze` blocks promotion but not data collection or challenger evaluation. `EmergencyRollback` selects the last approved stable release and records incident id, affected version, reason, initiator, time and rollback target. Both actions require Platform Admin approval and audit events.

## 37.4 Prediction Ledger and Intervention Learning Service

```text
prediction_ledger(prediction_id, entity_id, timestamp, model_version, dataset_version,
  prediction, target, confidence, uncertainty, top_drivers, recommended_action,
  data_origin, actual_outcome, error, review_status)
intervention_record(intervention_id, scenario_id, intervention_type, baseline,
  predicted_effect, actual_effect, cost, risk, execution_status, reviewer)
```

Actual outcomes and expert cause corrections are stored as reviewed feedback evidence. A separate analysis process compares predicted versus observed intervention effects; it may improve a future challenger but cannot modify a serving model directly.

## 37.5 Alert and Change Services

The alert service evaluates policy thresholds for production shortfall, equipment failure, stale datasets, data/concept drift, high-priority exploration targets and challenger/champion health. It routes alerts by role and retains acknowledgement/escalation history.

The change service creates versioned “What changed?” summaries from measured deltas only: dataset/model version change, observation counts, holdout metric changes, shift in major drivers, calibration/drift changes and unresolved limitations. It must not manufacture a business or ROI gain.

## 37.6 Copilot Boundary

The optional Mine Copilot has read access only to authorised data, predictions, ledgers and scenario APIs. It translates user requests into retrieval or scenario calls and cites returned values. The runtime contract remains: ML model = prediction source; simulator = scenario source; optimiser = action source; LLM = interface/orchestrator. The copilot cannot publish models, change raw data, approve uploads or send mine-control commands.

## 37.7 Exploration Maturity and Mine State

```text
exploration_target(target_id, maturity, prospectivity, geological_evidence,
  subsurface_confidence, drill_recommendation, resource_candidate_status)
mine_state(mine_id, timestamp, production, equipment, maintenance, ore, stockpile,
  weather, blasting, schedule, exploration, risk)
```

Target maturity transitions are `Detected`, `Screened`, `Geologically supported`, `Drill recommended`, `Drilled`, `Validated` and `Resource candidate`. Scenario simulation starts with the timestamped MineState and returns a future state with constraint findings; it cannot interpret prospectivity-only evidence as immediate ore availability.

## 37.8 Role and Policy Enforcement

The authorisation service enforces the following permissions at API and UI layers: Platform Admin manages users, policies, source approval, audit review and model-promotion approval; Exploration Admin owns geological/occurrence/drillhole/assay uploads and prospectivity review; Equipment Admin owns telemetry, maintenance and failure uploads; Production Admin owns production, target, ore and stockpile uploads plus outcome confirmation; Mine Planning Admin owns schedule/allocation/routing updates and scenario constraints; Management has read-only strategic access and may acknowledge recommendations.

Dataset write, approval, model promotion, freeze/rollback, feedback review and scenario execution each require distinct policy checks. Management cannot modify raw operational data, and no role can bypass lineage or validation records.

## 37.9 Validation Reporting Service

For each evaluated release, create a versioned validation record and export a `FINAL_MODEL_VALIDATION.csv`-compatible view with: task, model, split type, train/validation/test rows, independent entities/locations, metric, score, baseline score, leakage status and calibration status. Attach feature-ablation and post-event/future-feature audits where relevant.

The service requires spatially separated evaluation for prospectivity and chronological evaluation for production, shortfall and equipment; equipment also supports machine/entity holdout. It records random-split results only as diagnostic information. A release cannot label a metric as production-ready without the corresponding leakage and validation evidence.
