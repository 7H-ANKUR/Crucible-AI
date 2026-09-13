# 06 — API Contracts
# MINEx — SIH26009 | FastAPI v1 | v1.0

---

## 1. API Design Principles

- **Style:** REST, resource-oriented
- **Version prefix:** `/api/v1/`
- **Auth:** Bearer JWT in `Authorization` header
- **Content-Type:** `application/json` (uploads: `multipart/form-data`)
- **Error format:** RFC 7807 Problem Details
- **Pagination:** cursor-based (`next_cursor`, `limit`) for all list endpoints
- **Naming:** snake_case for all fields
- **Data origin:** Every prediction response includes `data_origin` and `freshness_status`
- **Uncertainty:** Every prediction response includes confidence and bounds

---

## 2. Global Response Schemas

### `HealthResponse`
```json
{
  "status": "ok",
  "version": "1.0.0",
  "timestamp": "2026-08-28T07:00:00Z",
  "database": "ok",
  "redis": "ok"
}
```

### `ErrorResponse` (RFC 7807)
```json
{
  "type": "https://minex.io/errors/validation-failed",
  "title": "Validation Failed",
  "status": 422,
  "detail": "latitude 50.0 is outside India boundary (6.0 – 37.5)",
  "instance": "/api/v1/exploration/map"
}
```

### `PredictionMetadata` (embedded in all prediction responses)
```json
{
  "prediction_id": "pred_f7a2b1c9",
  "model_version": "v4.2",
  "dataset_version": "ds_2026_08_01",
  "as_of_time": "2026-08-28T09:00:00+05:30",
  "confidence": "MEDIUM",
  "freshness_status": "FRESH",
  "data_origin": "SYNTHETIC",
  "limitation": "Operational telemetry is synthetic prototype data (seed=26009)"
}
```

---

## 3. Utility Endpoints

```
GET  /api/v1/health
GET  /api/v1/sources
GET  /api/v1/regions
GET  /api/v1/mines
```

### `GET /api/v1/mines`
**Response:**
```json
{
  "mines": [
    {
      "mine_id": "uuid",
      "mine_code": "BAL-001",
      "mine_name": "Balaghat Mine",
      "state": "Madhya Pradesh",
      "mine_type": "underground",
      "freshness_status": "FRESH",
      "data_origin": "SYNTHETIC"
    }
  ]
}
```

---

## 4. Exploration API

### `GET /api/v1/exploration/map`
Returns prospectivity grid cells for a region and zoom level.

**Query params:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `region_id` | uuid | Yes | Target region |
| `bbox` | string | No | `minLon,minLat,maxLon,maxLat` |
| `resolution_m` | int | No | Grid resolution (default 500) |

**Response:**
```json
{
  "prediction_metadata": { ...PredictionMetadata },
  "cells": [
    {
      "grid_id": "uuid",
      "geometry": { "type": "Polygon", "coordinates": [...] },
      "prospectivity_probability": 0.81,
      "confidence": "HIGH",
      "uncertainty": 0.07,
      "data_quality_score": 0.74,
      "top_evidence": ["structural_density", "host_rock_flag", "swir_ratio"]
    }
  ],
  "india_compliance": {
    "status": "PASS",
    "records_checked": 2847,
    "outside_india": 0
  }
}
```

### `GET /api/v1/exploration/target/{target_id}`
Returns full evidence panel for a single prospectivity cell.

**Response:**
```json
{
  "grid_id": "uuid",
  "prospectivity_probability": 0.81,
  "confidence": "HIGH",
  "uncertainty": 0.07,
  "data_quality_score": 0.74,
  "maturity_status": "Geologically supported",
  "evidence": {
    "top_drivers": [
      { "feature": "structural_density", "shap_value": 0.23, "direction": "increases_risk" },
      { "feature": "host_rock_flag", "shap_value": 0.18, "direction": "increases_risk" }
    ],
    "feature_values": {
      "ndvi": 0.41, "slope_deg": 12.3, "fault_distance_km": 0.4,
      "occ_distance_km": 1.2, "swir_ratio": 1.84
    }
  },
  "nearby_boreholes": [
    { "borehole_id": "uuid", "borehole_code": "BH-007", "distance_km": 0.8 }
  ],
  "prediction_metadata": { ...PredictionMetadata }
}
```

### `GET /api/v1/exploration/target/{target_id}/boreholes`
Returns borehole list for a prospectivity target.

### `GET /api/v1/exploration/boreholes/{borehole_id}`
Returns full borehole profile: header + intervals.

**Response:**
```json
{
  "borehole_id": "uuid",
  "borehole_code": "BH-007",
  "total_depth_m": 120.0,
  "data_origin": "SYNTHETIC",
  "intervals": [
    {
      "depth_from_m": 0, "depth_to_m": 20.0,
      "lithology": "Weathered Laterite", "ore_flag": false
    },
    {
      "depth_from_m": 20.0, "depth_to_m": 35.0,
      "lithology": "Mn-bearing shale", "mn_pct": 32.4, "ore_flag": true
    }
  ]
}
```

---

## 5. Production API

### `GET /api/v1/production/{mine_id}/forecast`
Returns production forecast for next shift/period.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `horizon` | string | `shift`, `day`, `week` (default `shift`) |
| `as_of` | ISO datetime | Prediction timestamp (default now) |

**Response:**
```json
{
  "mine_id": "uuid",
  "mine_code": "BAL-001",
  "mine_name": "Balaghat Mine",
  "horizon": "shift",
  "target_t": 9000.0,
  "forecast": {
    "p10": 7200.0,
    "p50": 8200.0,
    "p90": 9100.0
  },
  "shortfall_probability": 0.74,
  "risk_level": "HIGH",
  "expected_shortfall_t": 800.0,
  "root_causes": [
    { "driver": "equipment_downtime_hours", "contribution_pct": 31.0 },
    { "driver": "rainfall_7d_mm", "contribution_pct": 24.0 },
    { "driver": "blast_delay_hours", "contribution_pct": 18.0 },
    { "driver": "ore_pass_availability", "contribution_pct": 15.0 },
    { "driver": "other", "contribution_pct": 12.0 }
  ],
  "prediction_metadata": { ...PredictionMetadata }
}
```

### `GET /api/v1/production/{mine_id}/history`
**Query params:** `start_date`, `end_date`, `granularity` (shift/day/week)

**Response:**
```json
{
  "mine_id": "uuid",
  "records": [
    {
      "date": "2026-08-01",
      "shift": 1,
      "planned_t": 9000,
      "actual_t": 8450,
      "shortfall_flag": false,
      "data_origin": "SYNTHETIC"
    }
  ]
}
```

### `GET /api/v1/production/{mine_id}/risk`
Returns a standalone shortfall risk card.

---

## 6. Equipment API

### `GET /api/v1/equipment/{mine_id}`
Returns fleet health overview for a mine.

**Response:**
```json
{
  "mine_id": "uuid",
  "as_of_time": "2026-08-28T09:00:00+05:30",
  "machines": [
    {
      "machine_id": "uuid",
      "machine_code": "LHD-03",
      "machine_type": "LHD",
      "failure_prob_24h": 0.61,
      "risk_level": "HIGH",
      "last_maintenance_date": "2026-07-15",
      "engine_hours": 4820,
      "top_drivers": ["overdue_maintenance", "vibration_g", "engine_hours"],
      "freshness_status": "FRESH",
      "data_origin": "SYNTHETIC"
    }
  ],
  "prediction_metadata": { ...PredictionMetadata }
}
```

### `GET /api/v1/equipment/{mine_id}/{machine_id}`
Returns single machine detail: risk trend + top drivers + maintenance history.

---

## 7. Scenario API

### `GET /api/v1/scenarios/{mine_id}/state`
Returns current MineState snapshot used as baseline.

**Response:**
```json
{
  "mine_id": "uuid",
  "state_timestamp": "2026-08-28T09:00:00+05:30",
  "production_target_t": 9000.0,
  "ore_available_t": 11200.0,
  "stockpile_t": 3400.0,
  "equipment": {
    "total": 8,
    "available": 6,
    "in_maintenance": 2
  },
  "next_blast_scheduled": "2026-08-28T14:00:00+05:30",
  "weather": {
    "rainfall_24h_mm": 18.5,
    "temperature_c": 28.0
  },
  "data_origin": "SYNTHETIC"
}
```

### `POST /api/v1/scenarios`
Creates and evaluates a new scenario.

**Request body:**
```json
{
  "mine_id": "uuid",
  "scenario_name": "Redeploy + Reschedule Blast",
  "as_of_time": "2026-08-28T09:00:00+05:30",
  "interventions": [
    {
      "type": "equipment_redeployment",
      "params": { "machine_id": "uuid", "from_zone": "L3", "to_zone": "L4" }
    },
    {
      "type": "blast_reschedule",
      "params": { "shift_to": 1, "zone": "bench-7" }
    }
  ]
}
```

**Response:**
```json
{
  "scenario_id": "uuid",
  "baseline_production_t": 8200.0,
  "scenario_production_t": 8850.0,
  "baseline_shortfall_prob": 0.74,
  "scenario_shortfall_prob": 0.21,
  "production_gain_t": 650.0,
  "cost_inr": 185000,
  "risk_change": -0.53,
  "objective_score": 0.82,
  "constraint_violations": [],
  "recommended": true,
  "prediction_metadata": { ...PredictionMetadata }
}
```

### `POST /api/v1/scenarios/optimize`
Runs optimizer and returns ranked feasible scenarios.

**Request body:**
```json
{
  "mine_id": "uuid",
  "as_of_time": "2026-08-28T09:00:00+05:30",
  "objective_weights": {
    "production_gain": 0.5,
    "cost_penalty": 0.25,
    "risk_penalty": 0.25
  }
}
```

**Response:**
```json
{
  "mine_id": "uuid",
  "ranked_scenarios": [
    {
      "rank": 1,
      "scenario_id": "uuid",
      "action_description": "Redeploy LHD-03 to Level 4 + move blast to Shift 1",
      "expected_gain_t": 650.0,
      "shortfall_prob_change": -0.53,
      "cost_inr": 185000,
      "risk_change": -0.53,
      "urgency": "HIGH",
      "confidence": "MEDIUM",
      "feasibility": true,
      "objective_score": 0.82
    }
  ],
  "prediction_metadata": { ...PredictionMetadata }
}
```

---

## 8. Dataset / Governance API

### `POST /api/v1/datasets/upload`
**Content-Type:** `multipart/form-data`
**Fields:** `file`, `data_domain`, `source_description`, `data_origin`
**Auth:** Role must have write access to the specified domain.

**Response:**
```json
{
  "dataset_version_id": "uuid",
  "dataset_id": "09_mine_operations",
  "status": "quarantine",
  "proposed_mapping": [
    { "source_column": "Prod_Date", "target_field": "shift_date", "confidence": 0.95 }
  ],
  "next_step": "POST /api/v1/datasets/{dataset_version_id}/validate"
}
```

### `POST /api/v1/datasets/{dataset_version_id}/validate`
Runs validation rules on the quarantined file.

**Response:**
```json
{
  "dataset_version_id": "uuid",
  "validation_status": "pass",
  "findings": {
    "schema": "pass",
    "india_compliance": "pass",
    "missingness_rate": 0.01,
    "duplicate_rate": 0.0,
    "leakage_check": "pass",
    "warnings": ["Column 'blast_cost_inr' has 12% missing values"]
  }
}
```

### `POST /api/v1/datasets/{dataset_version_id}/approve`
**Auth:** Platform Admin only.

### `GET /api/v1/datasets/{dataset_id}/versions`
Lists all versions of a dataset.

### `GET /api/v1/data-health`
Returns freshness and health status for all data domains.

### `GET /api/v1/models/{model_family}/candidates`
Lists champion and challenger models for a model family.

### `POST /api/v1/models/{model_version_id}/promote`
**Auth:** Platform Admin only. Promotes challenger to champion.

**Request body:**
```json
{
  "reason": "Challenger passed all gates; ROC-AUC +0.04, calibration stable"
}
```

---

## 9. Feedback API

### `POST /api/v1/feedback/predictions/{prediction_id}`
Records actual outcome and expert review for a prediction.

**Request body:**
```json
{
  "actual_outcome": 7850.0,
  "reviewer_correction": "Blast delay was longer than forecast — ore pass was blocked",
  "review_status": "corrected"
}
```

### `POST /api/v1/feedback/decisions`
Records the actual outcome of an adopted intervention.

**Request body:**
```json
{
  "scenario_id": "uuid",
  "prediction_id": "uuid",
  "actual_effect_t": 620.0,
  "execution_status": "adopted",
  "reviewer_notes": "Equipment redeployment partially successful"
}
```

---

## 10. Prediction Ledger API

### `GET /api/v1/ledger`
**Query params:** `mine_id`, `prediction_type`, `start_date`, `end_date`, `status`, `limit`, `cursor`

Returns paginated ledger records.

---

## 11. Alert API

### `GET /api/v1/alerts`
Returns active alerts routed to the current user's role.

**Response:**
```json
{
  "alerts": [
    {
      "alert_id": "uuid",
      "type": "production_risk",
      "severity": "HIGH",
      "entity": "BAL-001",
      "message": "Shortfall probability 74% for next shift",
      "created_at": "2026-08-28T06:30:00+05:30",
      "acknowledged": false
    }
  ]
}
```

---

## 12. API Security Rules

| Rule | Enforcement |
|------|-------------|
| All endpoints require `Authorization: Bearer <JWT>` | FastAPI middleware |
| Upload endpoints check role × data_domain | Service layer |
| Promote/Approve require Platform Admin role | Service layer |
| India compliance check on all coordinate inputs | `assert_india_only()` called before DB insert |
| Audit event written for every write action | Governance service |
| Response always includes `data_origin` | Pydantic response model (required field) |
| Synthetic data never returns without `SYNTHETIC` badge | Pydantic validator enforced |
