# 08 — Scoring Engine Specification
# MINEx — SIH26009 | v1.0

---

## 1. Overview

The MINEx Scoring Engine consists of four distinct ML scoring models and one rules-based scenario optimizer. Each model has a specific target, feature set, evaluation method, and uncertainty output.

---

## 2. Model 1 — Prospectivity Scorer

### 2.1 Problem Statement
**Binary classification:** Rank spatial grid cells (500m resolution) by probability of hosting economically significant manganese mineralisation in the Central Indian belt.

### 2.2 Target Variable
```python
prospectivity_label: int  # 1 = prospective (near known occurrence or positive drilling), 0 = background
```

**Label construction rule:**
- Positive (1): cells within 1.5 km of a verified Mn occurrence AND within the Sausar Group formation
- Background (0): cells sampled from low-occurrence-density areas outside host geology
- Ratio: 1:5 (positive:background) — do not over-balance

### 2.3 Feature Set (30–50 features)

| Group | Features |
|-------|---------|
| **EO (Sentinel-2)** | B4, B8, B11, B12, NDVI, NDMI, NDWI, SWIR_ratio (B11/B8), red_edge_ratio |
| **Terrain (DEM)** | elevation_m, slope_deg, aspect_deg, curvature, roughness, terrain_ruggedness, drainage_density |
| **Geology** | lithology_code (encoded), formation_code (encoded), host_rock_flag, geological_age |
| **Structural** | fault_distance_km, lineament_distance_km, structural_density, drainage_structure_angle |
| **Context** | occ_distance_km, drill_density (per km²), exploration_density, data_quality_score |

**Forbidden features (leakage):**
- occurrence_id directly
- target label itself
- post-event geological confirmation
- any feature derived from the presence of the occurrence at that cell

### 2.4 Model Architecture

**Baseline:** Logistic regression (calibrated)
**Primary:** Random Forest (n_estimators=300) → calibrated via Platt scaling
**Secondary:** XGBoost/LightGBM (for SHAP compatibility)
**Ensemble (optional):** Weighted average of RF + XGB with calibration

### 2.5 Training & Evaluation Protocol

```
Spatial block split:
  - Balaghat sub-region A + B → TRAIN (60%)
  - Chhindwara sub-region → VALIDATION (20%)
  - Bhandara/Nagpur sub-region → TEST (20%)

Spatial buffer:
  - 5 km minimum gap between train and test cells to prevent spatial autocorrelation leakage

Cross-validation:
  - 5-fold spatial block CV on TRAIN set
  - Report CV mean ± std for all metrics
```

**Metrics (spatial holdout TEST set):**

| Metric | Target | Rationale |
|--------|--------|-----------|
| ROC-AUC | >= 0.85 | Discrimination |
| PR-AUC | >= 0.78 | Performance on positive class |
| Brier score | < 0.15 | Calibration |
| ECE (Expected Calibration Error) | < 0.08 | Reliability |
| % known targets in top decile | >= 75% | Business relevance |

**Leakage checks (fail build if violated):**
- `minimum_distance_train_test_km >= 5.0`
- `spatial_overlap_rate == 0.0`
- `feature_target_correlation_max < 0.8` (no single feature dominates)

### 2.6 Output Schema
```python
{
  "grid_id": str,
  "prospectivity_probability": float,   # 0.0 – 1.0
  "uncertainty": float,                 # std of ensemble members
  "confidence": str,                    # "HIGH" / "MEDIUM" / "LOW"
  "top_drivers": list[DriverAttribution],
  "data_quality_score": float
}
```

### 2.7 Confidence Tier Rules
```
HIGH:   probability > 0.70 AND data_quality_score > 0.60 AND drill_density > 0
MEDIUM: probability > 0.50 OR data_quality_score > 0.40
LOW:    all other cases
```

---

## 3. Model 2 — Production Forecast

### 3.1 Problem Statement
**Regression:** Predict the actual production tonnage for the next shift/day given the operational state at prediction time.

### 3.2 Target Variable
```python
actual_production_t: float  # tonnes produced in the period
```

### 3.3 Feature Set

| Group | Features |
|-------|---------|
| **Production history** | lag_1_shift, lag_2_shift, lag_3_shift, lag_7d_mean, lag_30d_mean, rolling_7d_std |
| **Target** | planned_production_t, target_gap_lag1 |
| **Equipment** | equipment_availability_pct, equipment_utilization_pct, downtime_hours_lag1, breakdown_count_7d |
| **Maintenance** | days_since_last_maintenance, overdue_maintenance_flag, maintenance_events_7d |
| **Blasting** | blast_delay_hours_lag1, fragmentation_score_lag1, blast_success_lag1 |
| **Underground** | ore_pass_availability, ventilation_status_score, ground_condition_score, development_delay_hours |
| **Weather** | rainfall_24h_mm, rainfall_7d_mm, soil_moisture_pct, temperature_c, extreme_event_flag |
| **Logistics** | haul_distance_km, cycle_time_min_7d_mean, road_condition_score |
| **Ore & stockpile** | ore_available_t, stockpile_opening_t, stockpile_trend_7d |

**Forbidden features (temporal leakage):**
- any feature derived from the target period (e.g., actual_blast_success for the shift being predicted)
- weather observations not available at prediction time

### 3.4 Model Architecture

**Baseline:** Lagged mean (mean of last 7 shifts)
**Primary:** XGBoost Regressor (max_depth=6, n_estimators=400)
**Uncertainty:** Quantile regression (pinball loss) for P10, P50, P90

### 3.5 Training & Evaluation Protocol

```
Temporal split:
  - Training: first 70% of chronologically sorted records
  - Validation: next 15%
  - Test: final 15% (never seen during training or hyperparameter search)

No random split ever used as primary evaluation.
```

**Metrics (temporal TEST set):**

| Metric | Target |
|--------|--------|
| R² | >= 0.75 |
| MAE | contextually meaningful (report in tonnage units) |
| MAPE | <= 22% |
| Pinball loss at P10, P90 | reported |

### 3.6 Output Schema
```python
{
  "entity_id": str,             # mine_id
  "horizon": str,               # "shift" / "day"
  "forecast": {
    "p10": float,
    "p50": float,
    "p90": float
  },
  "target_t": float,
  "data_quality": str,
  "model_version": str,
  "dataset_version": str
}
```

---

## 4. Model 3 — Shortfall Classifier

### 4.1 Problem Statement
**Binary classification:** Predict whether actual production will fall below planned target for the next shift.

### 4.2 Target Variable
```python
shortfall_flag: bool  # True = actual_production_t < planned_production_t * 0.95 (5% tolerance)
```

**Class balance:** Expect 20–40% positive rate in synthetic data. Do not artificially inflate.

### 4.3 Feature Set
Same as Production Forecast features, plus:
- `production_forecast_p50` (from Model 2 output) — allowed because Model 2 uses only pre-period data
- `forecast_gap_to_target = planned_production_t - p50_forecast`
- `shortfall_flag_lag1`, `shortfall_streak_7d`

### 4.4 Model Architecture

**Baseline:** Logistic regression (calibrated)
**Primary:** XGBoost Classifier (calibrated via isotonic regression)
**Class weighting:** `scale_pos_weight` or `class_weight='balanced'`

### 4.5 Training & Evaluation Protocol

Same temporal split as Model 2 (use same period boundaries).

**Metrics (temporal TEST set):**

| Metric | Target | Rationale |
|--------|--------|-----------|
| ROC-AUC | >= 0.70 | Discrimination |
| PR-AUC | >= 0.60 | Performance on shortfall class |
| FN-rate | <= 0.45 | Missed shortfalls are costly |
| Brier score | < 0.20 | Calibration |

**NOTE:** High FN-rate is penalised more than high FP-rate. A false alarm prompts re-check; a missed shortfall causes production loss.

### 4.6 Output Schema
```python
{
  "shortfall_probability": float,
  "risk_level": str,           # "HIGH" / "MEDIUM" / "LOW"
  "expected_shortfall_t": float,
  "root_causes": list[DriverAttribution],
  "confidence": str,
  "calibrated": bool
}
```

### 4.7 Risk Level Rules
```
HIGH:   shortfall_probability >= 0.60
MEDIUM: 0.35 <= shortfall_probability < 0.60
LOW:    shortfall_probability < 0.35
```

---

## 5. Model 4 — Equipment Failure Predictor

### 5.1 Problem Statement
**Binary classification:** Predict whether a machine will experience a failure event in the next 24-hour window.

### 5.2 Target Variable
```python
failure_next_24h: bool  # True if any maintenance event of severity='major' or 'critical' occurs in next 24h
```

**Label construction rule:**
- Slide a 24h prediction window over the telemetry timeline
- Label = 1 if a failure/major event occurs at `t+1h` to `t+24h`
- Label MUST be created using only future event timestamps — never from same-row telemetry

**Class balance:** Target ~5–10% positive rate. Near-random result is an honest limitation; do not inflate.

### 5.3 Feature Set

| Group | Features |
|-------|---------|
| **Sensor (24h window before prediction)** | temperature_c_mean, temperature_c_max, vibration_g_mean, vibration_g_max, load_factor_mean, fuel_rate_lph_mean, hydraulic_pressure_mean |
| **Operational** | engine_hours, machine_age_months, usage_hours_7d, downtime_hours_7d |
| **Maintenance history** | days_since_last_maintenance, overdue_maintenance_flag, failure_count_30d, severity_max_30d |
| **Context** | mine_type_underground, weather_extreme_flag, shift_number |

### 5.4 Model Architecture

**Baseline:** Random failure-rate classifier (predict_proba = class_rate)
**Primary:** XGBoost Classifier (scale_pos_weight tuned to failure rate)
**Validation:** Also apply machine/entity holdout (train on machines 1–6, test on machines 7–8)

### 5.5 Evaluation Protocol

**Temporal split:**
- Train: first 70% of timeline
- Val: next 15%
- Test: last 15%
- Optional: entity holdout (held-out machines)

**Metrics:**

| Metric | Note |
|--------|------|
| PR-AUC | Primary metric; compare to baseline (class rate) |
| ROC-AUC | Secondary |
| FN-rate | Report honestly; near-random is acceptable given data constraints |
| Recall at P=0.5 threshold | Report |

### 5.6 Output Schema
```python
{
  "machine_id": str,
  "failure_prob_24h": float,
  "risk_level": str,
  "top_drivers": list[DriverAttribution],
  "data_origin": "SYNTHETIC",
  "limitation": "Equipment failure model trained on synthetic telemetry; real performance unknown"
}
```

---

## 6. Shared: SHAP Attribution

### 6.1 Rule
All four models must produce attribution outputs using SHAP TreeExplainer (for tree-based models).

### 6.2 Attribution Schema
```python
@dataclass
class DriverAttribution:
    feature: str               # canonical feature name
    shap_value: float          # magnitude of SHAP contribution
    direction: str             # "increases_risk" / "decreases_risk"
    feature_value: float       # actual value at prediction time
    feature_unit: str          # "hours", "mm", "pct", etc.
    contribution_pct: float    # percentage of total attribution magnitude
```

### 6.3 Attribution Rules
- Report top 5 drivers on prediction card
- Report full SHAP waterfall in evidence panel
- Attribution percentages must sum to 100% of total magnitude
- Never hard-code contribution values — always model-derived

---

## 7. Scenario Scoring (Decision Optimizer)

### 7.1 Objective Function
```
score = w1 * normalised_production_gain
      - w2 * normalised_cost
      - w3 * normalised_risk_change
      - w4 * normalised_disruption

Default weights: w1=0.50, w2=0.25, w3=0.20, w4=0.05
All weights configurable via API.
```

### 7.2 Normalisation
Each component is normalised to [0, 1] across the candidate set:
```python
normalised = (value - min_in_candidates) / (max_in_candidates - min_in_candidates + 1e-9)
```

### 7.3 Constraint Filter
Before scoring, filter out infeasible scenarios:
- Equipment conflicts (machine redeployed to two zones simultaneously)
- Maintenance window violations (cannot operate machine in scheduled maintenance window)
- Underground access constraints (development delay blocking zone access)
- Ore availability (scenario cannot produce more than ore_available_t * processing_efficiency)
- Safety constraints (minimum ventilation hours after blast before entry)

### 7.4 Output
```python
{
  "rank": int,
  "scenario_id": str,
  "action_description": str,
  "expected_gain_t": float,
  "shortfall_prob_change": float,
  "cost_inr": float,
  "risk_change": float,
  "objective_score": float,
  "feasibility": bool,
  "constraint_violations": list[str]   # empty if feasible
}
```

---

## 8. Validation Evidence Matrix

Every model release must populate `FINAL_MODEL_VALIDATION.csv`:

| task | model | split_type | train_rows | val_rows | test_rows | independent_units | metric | score | baseline_score | leakage_status | calibration_status |
|------|-------|-----------|-----------|---------|----------|-----------------|--------|-------|---------------|----------------|-------------------|
| prospectivity | rf_v4.2 | spatial_block | 12,400 | 4,200 | 4,600 | 3 regions | roc_auc | 0.891 | 0.712 | PASS | PASS |
| production_forecast | xgb_v3.1 | temporal | 18,500 | 5,000 | 5,000 | 3 mines | r2 | 0.812 | 0.623 | PASS | N/A |
| shortfall | xgb_v3.1 | temporal | 18,500 | 5,000 | 5,000 | 3 mines | roc_auc | 0.758 | 0.542 | PASS | PASS |
| equipment_failure | xgb_v2.4 | temporal+entity | 82,000 | 22,000 | 22,000 | 2 machines held | pr_auc | 0.31 | 0.08 | PASS | N/A |

**NOTE:** Equipment failure PR-AUC of 0.31 vs 0.08 baseline is the honest reported result. This is an acceptable limitation — do not fabricate higher scores.
