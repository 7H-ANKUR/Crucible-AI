# 04 — System Architecture
# MINEx — SIH26009 | MANGANESIS | v1.0

---

## 1. Architectural Philosophy

MINEx follows **Clean Architecture** with domain-driven boundaries:
- Domain logic is independent of frameworks, databases, and UI
- Dependencies point inward (UI → Services → Domain → Data)
- Every component is independently testable
- The closed-loop (evidence → prediction → uncertainty → intervention → outcome) is the architectural north star

Pattern: **Layered Monolith for MVP** (FastAPI backend + Next.js frontend), designed to decompose into microservices in Phase 3.

---

## 2. High-Level System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT TIER                              │
│   Next.js 14 (App Router)  +  MapLibre GL  +  Recharts         │
│   Role-scoped SPA │ Landing page │ All department dashboards    │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTPS / REST + SSE
┌───────────────────────────────▼─────────────────────────────────┐
│                      API GATEWAY TIER                           │
│   FastAPI (Python 3.11+)  │  Auth middleware (JWT/session)      │
│   RBAC enforcement  │  Request logging  │  Rate limiting        │
│   /api/v1/*  │  OpenAPI 3.1 spec auto-generated                 │
└──────┬──────────┬──────────┬──────────┬──────────┬─────────────┘
       │          │          │          │          │
       ▼          ▼          ▼          ▼          ▼
┌──────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────────┐
│   GEO    │ │   ML   │ │  TWIN  │ │  DATA  │ │  GOVERNANCE  │
│ SERVICE  │ │SERVICE │ │OPTIMIZER│ │INGESTION│ │   SERVICE   │
│          │ │        │ │        │ │SERVICE  │ │              │
│PostGIS   │ │Model   │ │Scenario│ │Quarant. │ │Dataset vers. │
│Raster    │ │Store   │ │Engine  │ │Validate │ │Model registry│
│GeoTIFF   │ │SHAP    │ │Optim.  │ │Version  │ │Audit log     │
│Spatial Q │ │Predict │ │        │ │Lineage  │ │Champion-chal.│
└──────────┘ └────────┘ └────────┘ └────────┘ └──────────────┘
       │          │          │          │          │
       └──────────┴──────────┴──────────┴──────────┘
                                │
              ┌─────────────────▼──────────────────┐
              │            DATA TIER               │
              │                                    │
              │  PostgreSQL 15 + PostGIS 3.4       │
              │  ┌──────────────────────────────┐  │
              │  │ Core: mines, predictions,    │  │
              │  │ datasets, models, audit log  │  │
              │  └──────────────────────────────┘  │
              │                                    │
              │  Object Storage (local / S3-compat)│
              │  ┌──────────────────────────────┐  │
              │  │ Parquet datasets, GeoTIFF,   │  │
              │  │ model artifacts, reports     │  │
              │  └──────────────────────────────┘  │
              │                                    │
              │  Redis 7 (cache + session store)   │
              └────────────────────────────────────┘
```

---

## 3. Service Descriptions

### 3.1 Geo Service
**Responsibility:** All geospatial computation and serving.
- PostGIS spatial queries (prospectivity grid, occurrence points, geological polygons)
- Raster tile serving (GeoTIFF → XYZ tiles for MapLibre)
- `assert_india_only()` enforcement on all coordinate inputs
- Feature extraction pipeline (raster sampling, spatial joins)
- India compliance validation report generation

**Key dependencies:** `GeoPandas`, `Rasterio`, `Shapely`, `pyproj`, `psycopg2`

### 3.2 ML Service
**Responsibility:** Model inference, SHAP attribution, prediction ledger writes.
- Load champion model from Model Store
- Run production forecast (P10/P50/P90 via quantile regression or bootstrap)
- Run shortfall classification
- Run equipment failure prediction
- Run prospectivity inference
- Compute SHAP values for root cause attribution
- Write prediction record to Prediction Ledger

**Key dependencies:** `scikit-learn`, `xgboost`, `lightgbm`, `shap`, `numpy`, `pandas`

### 3.3 Digital Twin / Optimizer Service
**Responsibility:** Scenario simulation and feasibility-constrained ranking.
- Assemble `MineState` from current operational data
- Accept `Scenario` objects with intervention sets
- Evaluate constraint satisfaction (equipment capacity, ore availability, blast windows, maintenance windows)
- Simulate production under each scenario using causal rules
- Score scenarios by objective function
- Return ranked feasible scenarios

**Key dependencies:** Pure Python + NumPy; optional `scipy.optimize` or `ortools`

### 3.4 Data Ingestion Service
**Responsibility:** Dataset upload, quarantine, validation, versioning.
- Accept CSV, XLSX, Parquet, GeoJSON
- Profile headers, types, units, spatial metadata
- Classify probable data domain
- Propose canonical column mappings
- Apply validation ruleset (schema, India scope, units, dates, duplicates, leakage)
- Create immutable dataset version on approval
- Trigger feature refresh flag on approved version

**Key dependencies:** `pandas`, `openpyxl`, `pyarrow`, `great_expectations` (or custom validators)

### 3.5 Governance Service
**Responsibility:** Model registry, champion-challenger, audit log, role enforcement.
- Store model metadata (version, dataset_version, metrics, approval_status)
- Manage champion promotion flow with gate checks
- Implement model freeze and emergency rollback
- Write audit events for all significant actions
- Enforce RBAC policy at service boundary

---

## 4. Frontend Architecture (Next.js 14 App Router)

```
apps/web/
├── app/
│   ├── (public)/              ← unauthenticated routes
│   │   ├── page.tsx           ← Landing page
│   │   └── auth/
│   │       └── login/page.tsx
│   └── (app)/                 ← authenticated shell
│       ├── layout.tsx         ← Global shell (command bar + sidebar)
│       ├── exploration/
│       ├── production/
│       ├── equipment/
│       ├── scenarios/
│       ├── portfolio/
│       ├── admin/
│       └── shared/            ← data-health, ledger, memory, alerts
├── components/
│   ├── map/                   ← MapLibre wrappers
│   ├── charts/                ← Recharts wrappers
│   ├── cards/                 ← Prediction cards, evidence panels
│   ├── governance/            ← Upload flow, model health, champion-challenger
│   └── copilot/               ← AI Mine Copilot panel
├── lib/
│   ├── api/                   ← API client (typed fetch wrappers)
│   ├── auth/                  ← Session / JWT helpers
│   └── state/                 ← Zustand stores (MineState, selected scenario)
└── styles/
    └── globals.css            ← Design tokens, liquid-glass utilities
```

**State management:** Zustand (client state) + React Query / SWR (server state + caching)

---

## 5. Backend Architecture (FastAPI)

```
apps/api/
├── main.py                    ← App factory, middleware registration
├── routers/
│   ├── exploration.py         ← /api/v1/exploration/*
│   ├── production.py          ← /api/v1/production/*
│   ├── equipment.py           ← /api/v1/equipment/*
│   ├── scenarios.py           ← /api/v1/scenarios/*
│   ├── datasets.py            ← /api/v1/datasets/*
│   ├── models.py              ← /api/v1/models/*
│   ├── feedback.py            ← /api/v1/feedback/*
│   └── admin.py               ← /api/v1/admin/*
├── services/
│   ├── geo_service.py
│   ├── ml_service.py
│   ├── twin_service.py
│   ├── ingestion_service.py
│   └── governance_service.py
├── domain/
│   ├── mine_state.py          ← MineState dataclass
│   ├── scenario.py            ← Scenario dataclass
│   ├── prediction.py          ← Prediction dataclass
│   └── india_compliance.py    ← assert_india_only()
├── models/                    ← SQLAlchemy ORM models
├── schemas/                   ← Pydantic v2 request/response schemas
├── db/
│   ├── session.py             ← SQLAlchemy async session
│   └── migrations/            ← Alembic migration files
└── core/
    ├── config.py              ← Settings (pydantic-settings)
    ├── security.py            ← JWT auth
    └── logging.py             ← Structured JSON logging
```

---

## 6. ML Pipeline Architecture

```
Raw datasets (Parquet / CSV)
       │
       ▼
Feature Engineering Pipeline
  ├── Production features: lag-1, lag-7, rolling-7, rolling-30, equipment state,
  │   maintenance state, blast state, stockpile, weather, underground fields
  ├── Prospectivity features: EO bands, terrain, geology, structural, context
  └── Equipment features: sensor aggregations, maintenance history windows
       │
       ▼
Train/Validation/Test Split
  ├── Production: chronological temporal split
  ├── Prospectivity: geographic block split (Balaghat A/B train, C val, Chhindwara/Bhandara test)
  └── Equipment: chronological + machine holdout
       │
       ▼
Model Training (per task)
  ├── Baseline: Naive / ElasticNet
  ├── Candidate: Random Forest, XGBoost/LightGBM
  └── Challenger registered in Model Registry
       │
       ▼
Challenger Evaluation Gates
  ├── Correct holdout type (temporal/spatial)
  ├── Leakage audit: no target in features, no future values
  ├── Calibration check (Brier score)
  ├── FN-rate check (shortfall / equipment)
  ├── Stability check (multiple seeds)
  └── Champion comparison (all gates must pass)
       │
       ▼
Champion Promotion (Platform Admin approval)
       │
       ▼
Inference Service (ML Service)
  ├── Load champion artifact from Model Store
  ├── Feature assembly from current operational data
  ├── Predict + compute SHAP
  └── Write to Prediction Ledger
```

---

## 7. Data Flow Architecture

```
INDIA DATA SOURCES
  GSI/NGDR/NMET ─────────────────────────────┐
  IBM/MOIL public ────────────────────────────┤
  Sentinel-2 / DEM ───────────────────────────┤
  IMD / ISRO ─────────────────────────────────┤   → Geo Service
  Synthetic datasets (seed=26009) ────────────┘     (assert_india_only)
                                                          │
                                               Common Spatial/Temporal
                                                   Data Model
                                               (mine_id, zone_id, timestamp,
                                                lat, lon, geometry, CRS,
                                                state, district, data_origin)
                                                          │
                              ┌───────────────────────────┤
                              │                           │
                    EXPLORATION PLANE             OPERATIONS PLANE
                    (geology, EO, terrain,        (production, equipment,
                     drill, structures)            maintenance, blast,
                              │                    stockpile, schedule)
                              │                           │
                    Prospectivity ML              Forecast + Risk ML
                              │                           │
                              └───────────────────────────┘
                                               │
                                    Uncertainty + Evidence
                                               │
                                      Digital Mine Twin
                                               │
                                   Counterfactual Engine
                                               │
                                          Optimizer
                                               │
                                    MINEx Command Center
```

---

## 8. Security Architecture

### Authentication
- JWT-based auth with short-lived access tokens (15 min) + refresh tokens (7 days)
- Session store in Redis
- SSO integration hook (SAML/OIDC) for Phase 3

### Authorization (RBAC)
- Role checked at API Gateway middleware (FastAPI dependency injection)
- Data domain access enforced at service layer (dataset upload validation)
- No role can bypass validation or audit logging

### Data Security
- All coordinates pass `assert_india_only()` before storage
- Synthetic data tagged at source; never merged with REAL classification silently
- No credentials or API keys in codebase (pydantic-settings from env)
- Parquet/model artifacts stored with checksum verification

### Audit Trail
- Every significant action creates an audit event: `(actor, action, entity, timestamp, before_state, after_state)`
- Audit log is append-only (no UPDATE/DELETE)

---

## 9. Deployment Architecture (MVP)

```
Local / Dev:
  docker-compose up
  ├── postgres:15-postgis      ← port 5432
  ├── redis:7                  ← port 6379
  ├── api (FastAPI/uvicorn)    ← port 8000
  ├── worker (background tasks)
  └── web (Next.js dev)        ← port 3000

Production (Phase 2+):
  Container orchestration (Docker / k8s)
  ├── API pods (2+ replicas)
  ├── Worker pods (background ingestion / training)
  ├── Managed PostgreSQL + PostGIS
  ├── Managed Redis
  ├── Object storage (MinIO or cloud equivalent)
  └── CDN for frontend static assets
```

---

## 10. Architecture Success Criterion

The system is successful when a judge can complete this chain without breaking:

```
Indian geology → surface evidence → subsurface evidence → prospectivity → uncertainty
→ production state → forecast → shortfall risk → root cause → scenario
→ optimization → expected recovery → decision recorded
```

Every step must carry: prediction, evidence, confidence, freshness, and data origin.
