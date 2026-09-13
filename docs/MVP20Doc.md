# MVP Tech Doc.md

# MANGANESIS — SIH26009 MVP Technical Specification

## 1. MVP Objective

Build a demonstrable, reproducible, India-specific prototype that solves the three PS requirements:

1. identify manganese exploration targets;
2. predict production shortfalls;
3. recommend corrective actions.

The MVP must distinguish scientifically valid claims from prototype simulation.

---

# 2. MVP Scope

## Must Have

### Exploration

- Indian study region
- geological/spatial data ingestion
- Sentinel-2-derived feature ingestion where accessible
- terrain features
- occurrence/subsurface evidence
- prospectivity model
- confidence and evidence panel
- spatial validation

### Production

- historical production baseline
- synthetic operational time series
- weather features
- equipment state
- maintenance
- blasting
- stockpile
- shortfall model
- root-cause attribution

### Decision

- scenario generator
- feasibility constraints
- intervention optimizer
- projected production recovery

### Dashboard

- map
- risk cards
- trend chart
- evidence
- uncertainty
- scenario comparison
- action recommendation.

---

# 3. Explicit Non-Goals for MVP

Do not attempt:

- nationwide reserve certification
- real-time autonomous mine control
- live machine control
- safety-critical operational automation
- exact ore tonnage from satellite-only evidence
- enterprise ERP integration
- full-scale 3D geological resource certification
- real MOIL telemetry unless officially supplied.

---

# 4. Dataset Strategy

## Real

Prefer:

- Indian manganese occurrence information
- Indian geological layers
- Indian NMET exploration information
- Sentinel-2
- DEM
- rainfall
- soil moisture
- IBM/MOIL public production data.

## Synthetic

Use only where detailed operational data is unavailable:

- equipment telemetry
- maintenance
- detailed shift production
- blasting
- stockpile
- mine schedules
- equipment allocation
- operational scenarios
- benchmark block models.

---

# 5. Existing Synthetic Dataset Package

Current observed datasets from the provided ZIP include approximately:

| Dataset | Rows | Columns | MVP status |
|---|---:|---:|---|
| Mine operations | 134,685 | 63 | Repaired; use leakage-free ML view |
| Equipment telemetry | 361,350 | 38 | Repaired; synthetic benchmark only |
| Maintenance | 20,000 | 17 | Repaired; synthetic events |
| Blasting | 7,774 | 20 | Usable |
| Stockpile | 29,930 | 17 | Usable |
| Schedule | 89,790 | 18 | Usable |
| Block model | 75,000 | 43 | Repaired; synthetic benchmark |
| Allocation | 21,900 | 16 | Usable |
| Synthetic boreholes | 21,144 | 28 | Benchmark only |
| Prospectivity | 15,173 | 43 | Repaired; spatial validation required |

The manifest must be regenerated from actual files.

---

# 6. Minimum Data Volumes

Do not maximize row counts blindly.

## Prospectivity

Target:

- 20k–100k spatial samples for synthetic/derived training;
- 100–500+ genuine occurrence points if obtainable;
- real Indian drill/assay intervals wherever recoverable.

The number of spatial samples is not equal to the number of independent geological observations.

## Production

300k–500k synthetic observations are more than sufficient for prototype training.

Existing 134,685 rows are already useful.

## Equipment

150k–250k rows is a useful prototype target if enough failure-positive examples exist.

The reported post-repair package contains 361,350 rows. Its equipment model remains limited by synthetic feature fidelity and must not be presented as field-ready predictive maintenance.

## Maintenance

The reported post-repair package contains 20,000 synthetic events. Any future expansion must preserve causal temporal relationships rather than duplicate rows.

## Blasting

15k–25k is a useful synthetic range; current 7,774 is already usable.

## Block model

50k–100k blocks are sufficient for MVP.

Current 75k is sufficient.

---

# 7. Critical Data Quality Rules

All datasets must be checked for:

- duplicate rows
- invalid types
- impossible values
- inconsistent units
- spatial leakage
- temporal leakage
- target leakage
- synthetic generator leakage.

---

# 8. India Compliance

Implement:

```python
assert_india_only(df)
```

Requirements:

- all coordinates are within the approved India boundary;
- source agency is verified;
- no foreign training data is included;
- every record has source classification.

Produce:

```text
INDIA COMPLIANCE: PASS
```

at the beginning of the validation report.

---

# 9. Production Model

## Target

For shortfall classification:

```text
shortfall_flag
```

For forecasting:

```text
actual_production_t
```

or future production.

## Important

Do NOT use:

```text
actual_production_t
production_shortfall_t
production_shortfall_pct
```

as input features when predicting shortfall.

Do not use future values.

Also audit:

```text
production_risk_score
maintenance_risk_score
equipment_failure_risk
```

for leakage.

---

# 10. Production Feature Set

Target approximately 25–40 meaningful variables.

### Historical

- lag 1
- lag 7
- rolling mean 7
- rolling mean 30
- planned production
- target gap

### Operations

- ore availability
- stockpile
- working hours
- shift efficiency

### Equipment

- availability
- utilization
- downtime
- breakdown count
- component availability

### Blasting

- delay
- fragmentation
- success

### Logistics

- haul distance
- cycle time
- queue time
- routing delay
- road condition

### Environment

- rainfall 24h
- rainfall 7d
- soil moisture
- temperature

### Underground

- level
- stope
- ore-pass availability
- ventilation status
- ground condition.

---

# 11. Production Model Candidates

Start with:

```text
Naive/seasonal baseline
Linear/Elastic Net
Random Forest
XGBoost/LightGBM
```

Optional:

```text
TCN/LSTM
```

Only use deep learning if it genuinely improves temporal validation.

---

# 12. Shortfall Model

Target:

```text
shortfall_flag
```

Models:

- logistic regression
- random forest
- XGBoost/LightGBM

Metrics:

- PR-AUC
- ROC-AUC
- precision
- recall
- F1
- Brier score
- calibration
- false-negative rate.

---

# 13. Equipment Failure Model

Target:

```text
failure_next_24h
```

The original audit package contained only 8 positive failure records out of 65,700 rows.

This is a **critical class-imbalance problem**.

Before final training:

- regenerate equipment telemetry;
- target approximately 3–10% positive failures for synthetic benchmark;
- ensure failure probability is driven by realistic wear/maintenance variables;
- do not make target deterministic.

Recommended final target:

~150k–250k rows with several thousand failure-positive events.

---

# 14. Maintenance Generator

The original audit package contained only 469 maintenance rows, which was insufficient.

Generate 10k–20k events.

Relationships:

```text
machine_age
+ engine_hours
+ overload
+ maintenance_overdue
+ vibration
    ↓
failure hazard
```

Use event time correctly.

---

# 15. Prospectivity Model

## Target

```text
prospectivity_label
```

The target-generation system must use a latent geological process.

Correct:

```text
latent_geological_favorability
+
structural control
+
spatial continuity
+
surface response
+
noise
→ target
```

Incorrect:

```python
label = gondite_probability > threshold
```

when gondite probability is also given to the model.

---

# 16. Prospectivity Feature Set

Target 30–50 predictors.

### EO

10–15 raw/derived spectral features.

### Terrain

5–10.

### Geology

5–10.

### Structure

3–8.

### Context

3–8.

---

# 17. Prospectivity Evaluation

Do not rely on random train/test splitting.

Use geographic holdout.

Example:

```text
TRAIN:
Balaghat subregions A/B

VALIDATION:
Balaghat subregion C

TEST:
Chhindwara/Bhandara holdout
```

Exact splits depend on actual data availability.

Report:

- ROC-AUC
- PR-AUC
- F1
- balanced accuracy
- Brier score
- calibration
- spatial generalization.

---

# 18. Exploration Output

Each grid cell should produce:

```text
prospectivity_probability
confidence
uncertainty
data_quality_score
drilling_density
evidence_summary
```

Example:

```text
Prospectivity: HIGH
Probability: 0.82
Confidence: MEDIUM
Drilling density: LOW

Supporting evidence:
- favorable host-rock association
- structural proximity
- compatible spectral response
- elevated exploration continuity
```

Avoid saying:

> "Manganese definitely exists here."

Use:

> "This area is prioritized for follow-up exploration."

---

# 19. Subsurface Intelligence

Where real assay/drill data exists, construct:

```text
borehole_id
depth_from
depth_to
lithology
Mn%
Fe%
SiO2%
ore_flag
```

Then support:

- depth profile
- cross-section
- 3D point cloud
- block model.

Synthetic boreholes should remain a clearly marked benchmark.

---

# 20. Production Digital Twin

Implement a state object:

```python
MineState(
    production_target,
    ore_available,
    stockpile,
    equipment_state,
    maintenance_state,
    blast_state,
    weather_state,
    schedule_state,
)
```

The simulator accepts interventions:

```python
scenario = Scenario(
    equipment_change=...,
    maintenance_change=...,
    blast_change=...,
    routing_change=...,
)
```

Outputs:

```text
expected_production
shortfall_probability
cost
risk
constraint_violations
```

---

# 21. Optimization

Use a constrained scenario-ranking approach first.

For MVP:

1. generate feasible scenarios;
2. simulate;
3. rank by objective;
4. return top recommendation.

Do not spend the MVP on reinforcement learning.

Possible objective:

```text
score =
production_gain_value
- intervention_cost
- risk_penalty
- disruption_penalty
```

---

# 22. Explainability

Use:

- SHAP
- permutation importance
- feature contribution
- scenario delta.

Dashboard must show:

```text
WHY IS RISK HIGH?
WHAT CAN CHANGE IT?
HOW MUCH IMPROVEMENT IS EXPECTED?
```

---

# 23. Uncertainty

Production:

```text
P10
P50
P90
```

Classification:

```text
probability
calibration
confidence
```

Prospectivity:

```text
probability
spatial uncertainty
data-quality score
```

No fake precision.

---

# 24. Technology Stack

### Frontend

- Next.js/React
- MapLibre
- charting library
- responsive design

### Backend

- FastAPI
- Python

### Database

- PostgreSQL
- PostGIS

### Data

- Parquet
- GeoParquet
- GeoTIFF
- CSV for small tables

### ML

- scikit-learn
- XGBoost/LightGBM
- NumPy
- optional PyTorch

### Geospatial

- GeoPandas
- Rasterio
- Shapely
- pyproj

### Optimization

- OR-Tools/scipy where appropriate.

---

# 25. MVP User Flow

```text
OPEN COMMAND CENTER
       ↓
Choose region
       ↓
VIEW EXPLORATION MAP
       ↓
Click high-prospectivity area
       ↓
See geological + satellite + subsurface evidence
       ↓
See confidence
       ↓
Switch to OPERATIONS
       ↓
Select mine/date
       ↓
View forecast
       ↓
Shortfall probability
       ↓
Root causes
       ↓
"Fix It" button
       ↓
Scenario simulation
       ↓
Recommended intervention
       ↓
Projected recovery
```

---

# 26. SIH Demo Sequence

A 5–7 minute demo should be:

### 0:00–0:45

Problem:

> India needs more dependable manganese supply; exploration and production uncertainty remain linked operational challenges.

### 0:45–2:00

Show exploration map.

Click a high-priority zone.

Show:

- prospectivity
- evidence
- confidence
- uncertainty.

### 2:00–3:30

Open operations.

Show:

> Target = X  
> Forecast = Y  
> Shortfall risk = Z

### 3:30–4:30

Show root causes.

### 4:30–5:45

Run counterfactual optimizer:

> Move equipment  
> reschedule maintenance  
> change blast  
> reroute ore

### 5:45–6:30

Show:

> baseline vs intervention.

### 6:30–7:00

Explain:

> what is real data, what is derived, and what is synthetic.

That last step builds trust.

---

# 27. Key MVP Acceptance Criteria

The prototype is complete only when:

- India gate passes;
- prospectivity model has spatial validation;
- no target leakage is present;
- production model has temporal validation;
- equipment model has enough positive failures;
- uncertainty is displayed;
- optimizer respects constraints;
- synthetic data is explicitly labelled;
- dashboard explains predictions;
- all dataset metadata matches actual files.

---

# 28. Governed Update Loop

The MVP demonstrates **Governed Continuous Learning** as a controlled workflow, never as unattended retraining. An authorised department user uploads CSV/XLSX data; the platform proposes a domain and column mapping, requires confirmation, then performs schema, date, unit, duplicate, missingness, India/mine-scope and leakage checks. Accepted data creates an immutable version; rejected data receives a visible reason.

An eligible version triggers a challenger evaluation, not a deployment. The challenger is compared with the active champion using the correct holdout, calibration, false-negative rate and stability checks. The demo must expose dataset version, model version, data origin, validation result and promotion decision.

## 29. Data Health and Decision Memory

Provide a compact panel for exploration, production, equipment and maintenance that shows freshness, completeness, schema status, anomalies and open warnings. Users can close a prediction with the actual outcome and an expert-confirmed reason, and close a scenario with actual versus predicted impact. That feedback is reviewable evidence for future training, not automatic ground truth.

## 30. Smart Onboarding and Freshness MVP

Support CSV, XLSX, Parquet and approved geospatial formats. For a file such as `August_Production_Report.xlsx`, the MVP may propose a dataset domain and mappings (for example, `Prod Date -> timestamp`, `MineName -> mine_id`, `Actual Qty -> actual_production_t`) with confidence, but the authorised user must confirm before ingestion.

The onboarding sequence is: file inspection, classification, schema mapping, preview, unit/date/duplicate/mine-scope/leakage checks, quality score, approval, immutable version, feature refresh and training eligibility. A per-domain schedule tracks expected cadence, last successful update, next expected update and `FRESH`/`AGING`/`STALE`/`CRITICAL` status. Staleness must appear beside predictions and in the Data Health Center.

## 31. Model Operations MVP

Implement a demonstrable model-health view for one production/shortfall model family. It shows the champion, challenger, correct temporal metrics, calibration, drift state, dataset version and decision to promote or retain. Demonstrate a Model Freeze and rollback record in the UI; these are version-control actions, not production equipment controls.

Use Global -> Regional -> Mine-specific model selection as a policy, with Cold Start Mode using a global baseline plus regional features for mines with insufficient history. The threshold policy must be configurable and labelled as a prototype policy.

## 32. Operational Learning MVP

Record a Prediction Ledger entry whenever a forecast/risk output is issued. When the outcome becomes known, an authorised user can attach actual production, reviewed root cause and review status. Record selected scenarios in Decision Memory with baseline, predicted impact, actual impact, cost, risk and execution status. Show a simple “What changed?” report only from measured comparison data; never invent an improvement claim.

## 33. Alerts, Copilot and Exploration Maturity

Demonstrate role-routed production, equipment, stale-data, drift and high-priority exploration alerts. Each action card includes confidence, feasibility, expected impact, cost, risk reduction and urgency; INR/ROI values stay visibly synthetic unless validated by real data.

An optional Mine Copilot may answer questions using retrieved platform results and invoke the scenario service. It must not generate predictions itself. Exploration targets must show maturity from Detected through Resource Candidate, so a high-prospectivity map cell is never presented as a reserve or immediate production substitute.

## 34. Role-Aligned MVP Workspaces

The MVP demonstrates the same access model as the target platform: Platform Admin controls users, policies, sources, audit and promotion approval; Exploration Admin manages geological/occurrence/drill/assay inputs and prospectivity review; Equipment Admin manages telemetry, maintenance and failure inputs; Production Admin manages production, targets, ore, stockpile and outcome confirmation; Mine Planning Admin manages schedules, allocation, routing and scenario constraints; Management is read-only for strategic dashboards, recommendation acknowledgement, decision history and synthetic ROI review. Management cannot modify raw operational datasets.

## 35. Evaluation Evidence Pack

The MVP must generate a final validation matrix with `task`, `model`, `split_type`, train/validation/test rows, unique independent entities, metric, score, baseline score, leakage status and calibration status. It reports rows separately from unique locations/geological zones for spatial work and separately from unique mines/machines/dates for temporal work.

Required evidence: spatial holdout plus feature ablation for prospectivity; chronological holdout plus baseline comparison for production; chronological shortfall metrics including PR-AUC/recall/calibration; chronological and machine-holdout checks plus post-event-feature audit for equipment. A high score is not an acceptance criterion by itself, and no synthetic generator is tuned to hit a target metric.
