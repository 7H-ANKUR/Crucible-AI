# 09 — Engineering Scope Definition
# MINEx — SIH26009 | MVP vs Future | v1.0

---

## 1. Purpose

This document defines the precise engineering boundary for the SIH 2026 prototype. It draws a hard line between:
- **IN SCOPE (MVP):** Must be built and demonstrable by demonstration day
- **OUT OF SCOPE (Phase 2+):** Architecturally designed for but not implemented in MVP
- **EXPLICITLY EXCLUDED:** Will not be built in this system at any stage

---

## 2. IN SCOPE — Must Demo

### 2.1 Data Layer

| Item | Detail |
|------|--------|
| Synthetic datasets loaded | 12 datasets from `SIH26009_DATA/` via `seed_db.py` |
| India compliance validation | `assert_india_only()` on all coordinates, report generated |
| Data classification tags | REAL / DERIVED_REAL / SYNTHETIC badge on every record |
| 3 mine entities | Balaghat, Chhindwara, Bhandara (synthetic operational data) |
| Prospectivity grid | 500m cells, Central Indian belt, ~3,000+ cells |
| Boreholes + assay intervals | 50+ synthetic boreholes with lithology + grade profiles |
| Production records | 365+ daily records per mine, 3 shifts/day |
| Equipment telemetry | 8 machines per mine, hourly telemetry, 180+ days |
| Maintenance events | Causal: linked to equipment age + operating hours |
| Blasting events | Causal: linked to blast schedule and fragmentation |

### 2.2 Backend API

| Item | Endpoint |
|------|---------|
| Health check | `GET /api/v1/health` |
| Mine list | `GET /api/v1/mines` |
| Prospectivity map | `GET /api/v1/exploration/map` |
| Target evidence panel | `GET /api/v1/exploration/target/{id}` |
| Borehole profile | `GET /api/v1/exploration/boreholes/{id}` |
| Production forecast | `GET /api/v1/production/{mine_id}/forecast` |
| Production history | `GET /api/v1/production/{mine_id}/history` |
| Equipment fleet | `GET /api/v1/equipment/{mine_id}` |
| Machine detail | `GET /api/v1/equipment/{mine_id}/{machine_id}` |
| MineState snapshot | `GET /api/v1/scenarios/{mine_id}/state` |
| Run scenario | `POST /api/v1/scenarios` |
| Optimizer | `POST /api/v1/scenarios/optimize` |
| Data health | `GET /api/v1/data-health` |
| Alerts | `GET /api/v1/alerts` |
| Prediction ledger | `GET /api/v1/ledger` |

### 2.3 ML Models

| Model | Must Deliver |
|-------|-------------|
| Prospectivity | Trained RF/XGB, SHAP attribution, spatial block validation |
| Production Forecast | Trained XGB, P10/P50/P90, temporal validation |
| Shortfall Classifier | Trained XGB, calibrated probability, SHAP root causes, temporal validation |
| Equipment Failure | Trained XGB, calibrated probability (with honest limitation documented) |
| All models | `FINAL_MODEL_VALIDATION.csv` with correct split type |

### 2.4 Digital Twin & Optimizer

| Item | Detail |
|------|--------|
| MineState assembly | From current DB state (equipment, ore, weather, blast, maintenance, stockpile) |
| Scenario simulation | 5 intervention types, constraint validation, outcome estimation |
| Optimizer | Generates 5 candidate scenarios, ranks by objective function |
| Constraint validation | Equipment conflicts, ore limits, maintenance windows, safety buffers |

### 2.5 Frontend

| Screen | Priority |
|--------|---------|
| Landing page | P1 — must be polished |
| Auth (login) | P1 — must work |
| Production Command Center | P1 — core demo screen |
| Scenario workspace + comparison | P1 — core demo screen |
| Exploration Intelligence map | P2 |
| Data Health Center | P2 |
| Equipment fleet view | P2 |
| Model Health (read-only view) | P3 (static mock if time-constrained) |
| Prediction Ledger | P3 |
| Dataset upload flow | P3 (can be demo via API if time-constrained) |
| AI Mine Copilot | P4 — only if P1–P3 complete |

---

## 3. OUT OF SCOPE — Phase 2+ (Architecturally Designed For)

| Item | Why Phase 2+ |
|------|-------------|
| Real MOIL operational telemetry | Requires official data sharing agreement |
| GSI/NGDR data (machine-readable) | Portal-access; requires registration and manual download |
| Real Sentinel-2 imagery (live download) | Requires BHOONIDHI/MOSDAC API key and processing |
| Real weather API (live) | IMD API registration; can use cached historical |
| Advanced kriging / variogram modelling | `PyKrige`/`GSTools` — Tier 3 dependency; FFT fallback sufficient for MVP |
| 3D geological block model visualisation | Requires Three.js or WebGL scene; deferred to Phase 2 |
| Full champion-challenger promotion UI | Backend logic complete; UI can be admin-only API in MVP |
| Streaming IoT ingestion | Event queue (Kafka/Redis Streams); deferred to Phase 3 |
| Enterprise ERP integration | SAP/Oracle hooks; deferred to Phase 3 |
| Multi-region database replication | Single-node PostgreSQL sufficient for MVP |
| Advanced MLOps (MLflow, DVC) | Manual model registry sufficient for MVP |
| Full production-grade RBAC | Simplified JWT roles sufficient for demo |
| Full alert notification system | Email/SMS alerts deferred; in-app only for MVP |

---

## 4. EXPLICITLY EXCLUDED (All Phases)

| Item | Reason |
|------|--------|
| Mine equipment control commands | Safety boundary — human approval is the boundary |
| Autonomous blasting decisions | Safety — never implemented |
| Regulatory reserve certification | Legal — never implemented |
| Claim of satellite direct underground detection | Scientific — not physically possible |
| Presenting SYNTHETIC data as MOIL production data | Integrity — always tagged |
| Random-split as primary evaluation | Scientific — never the primary result |
| Hard-coded SHAP percentages | Model integrity — must be computed |
| Competitor product comparison (by name) | Scope |

---

## 5. Dependency Tiers

### Tier 1 — Core (no fallback needed)
```
Python 3.11+
NumPy, Pandas, scikit-learn
XGBoost, LightGBM
SHAP
FastAPI, Uvicorn
SQLAlchemy (async), Alembic
Pydantic v2
Next.js 14, React 18, TypeScript
Zustand, React Query
Recharts
```

### Tier 2 — Important (graceful degradation if unavailable)
```
GeoPandas          → fallback: pure NumPy coordinate ops
Rasterio           → fallback: GeoTIFF not served (pre-processed Parquet instead)
Shapely            → fallback: bounding box only (no polygon ops)
pyproj             → fallback: assume WGS84 only
MapLibre GL JS     → fallback: static PNG map tiles
PostGIS            → fallback: pure PostgreSQL with WKT text storage
```

### Tier 3 — Optional (feature flag)
```
PyKrige / GSTools   → fallback: FFT Gaussian random field (pure NumPy)
OR-Tools            → fallback: exhaustive candidate enumeration
openpyxl            → fallback: CSV only for upload
```

---

## 6. Performance Targets

| Endpoint | P95 latency | Note |
|----------|------------|------|
| `GET /api/v1/health` | < 50ms | Health check |
| `GET /api/v1/exploration/map` | < 2s | Pre-computed cells, spatial index |
| `GET /api/v1/exploration/target/{id}` | < 1s | Cached SHAP values |
| `GET /api/v1/production/{mine_id}/forecast` | < 1.5s | Model inference + SHAP |
| `POST /api/v1/scenarios` | < 5s | Simulation + constraint check |
| `POST /api/v1/scenarios/optimize` | < 8s | 5 scenarios × simulation |
| Dashboard page load | < 2s | Next.js SSR + API parallel fetch |

---

## 7. Data Volume Targets (MVP)

| Entity | Volume |
|--------|--------|
| Mines | 3 |
| Equipment | 24 (8 per mine) |
| Production records | ~3,285 (3 mines × 365 days × 3 shifts) |
| Equipment telemetry | ~1,036,800 (24 machines × 365 days × 24h × 5 readings) — sample at 1h: ~210,240 |
| Maintenance events | ~1,800 (avg 75 per machine × 24 machines) |
| Blasting events | ~540 (avg 180 per mine × 3 mines) |
| Prospectivity grid cells | ~3,200 (500m grid, ~800 km²) |
| Boreholes | 150 (50 per mine/region) |
| Borehole intervals | ~3,000 (avg 20 per borehole) |
| Mn occurrences | ~500 (real + synthetic calibrated) |

---

## 8. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Equipment failure model near-random (low positive rate) | HIGH | LOW | Document honestly; report PR-AUC vs baseline; limitation badge on card |
| Spatial leakage in prospectivity (insufficient buffer) | MEDIUM | HIGH | Enforce 5km minimum distance check in `check_leakage.py` |
| Synthetic data too "easy" (inflated metrics) | MEDIUM | HIGH | Causal generation with realistic difficulty; validate metric is below 0.97 |
| Rasterio unavailable on Windows | MEDIUM | MEDIUM | Pre-process all GeoTIFF → Parquet; Tier 2 graceful degradation |
| API overload during demo (slow responses) | LOW | HIGH | Pre-compute prospectivity + SHAP; Redis cache; demo on local hardware |
| Judge asks "is this real MOIL data?" | HIGH | MEDIUM | Every card shows SYNTHETIC badge; limitation text always visible |

---

## 9. Definition of Done (per module)

### Data Layer
- [ ] All 12 datasets loaded via `seed_db.py` with no errors
- [ ] India compliance report generated (0 violations)
- [ ] All records have `data_origin` = 'SYNTHETIC' correctly set
- [ ] Causal structure verified: equipment failures correlate with age + overdue maintenance

### ML Models
- [ ] All 4 models trained with correct split type
- [ ] `FINAL_MODEL_VALIDATION.csv` populated and committed
- [ ] No target leakage detected in any model
- [ ] Calibration status set (PASS/WARN/FAIL) for classification models
- [ ] SHAP values computed and returned by API

### Backend API
- [ ] All P1 endpoints return correct response schemas
- [ ] India compliance check active on all coordinate inputs
- [ ] `data_origin` field present on every prediction response
- [ ] RBAC: upload endpoints blocked for Management role

### Frontend
- [ ] Production Command Center renders P10/P50/P90 chart
- [ ] Root cause bar chart shows SHAP-derived values (not placeholder)
- [ ] Scenario workspace: run simulation, see comparison table
- [ ] SYNTHETIC badge visible on all prediction cards
- [ ] Data Health Center shows FRESH/AGING/STALE status per domain
- [ ] Exploration map renders prospectivity grid with layer toggles

### Demo Readiness
- [ ] Full chain demonstrable: geology → prospectivity → production risk → root cause → scenario → recommendation
- [ ] No broken API calls during demo walkthrough
- [ ] Limitation text visible on equipment failure card
- [ ] Demo script prepared (10 min + 5 min Q&A)
