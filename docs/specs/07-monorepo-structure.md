# 07 — Monorepo Structure
# MINEx — SIH26009 | Turborepo | v1.0

---

## 1. Monorepo Philosophy

MINEx uses a **Turborepo**-managed monorepo with a clear package boundary:

| Tier | Language | Package |
|------|----------|---------|
| Frontend | TypeScript / Next.js 14 | `apps/web` |
| API | Python / FastAPI | `apps/api` |
| ML Pipeline | Python / scikit-learn / XGBoost | `apps/ml` |
| Shared UI components | TypeScript | `packages/ui` |
| Shared types | TypeScript | `packages/types` |
| Shared Python utils | Python | `packages/py-core` |
| Data (reference datasets) | CSV / Parquet | `data/` |
| Documentation | Markdown | `docs/` |

---

## 2. Root Directory Layout

```
SIH26009/
├── .github/
│   └── workflows/
│       ├── ci.yml                    ← Lint + test on PR
│       ├── ml-validation.yml         ← ML pipeline validation
│       └── docker-build.yml          ← Docker image build
├── apps/
│   ├── web/                          ← Next.js 14 frontend
│   ├── api/                          ← FastAPI backend
│   └── ml/                           ← ML training & evaluation
├── packages/
│   ├── ui/                           ← Shared React components
│   ├── types/                        ← Shared TypeScript types
│   └── py-core/                      ← Shared Python utilities
├── data/
│   ├── raw/                          ← Original downloaded / synthetic source files
│   ├── processed/                    ← Validated, schema-compliant datasets
│   └── README.md                     ← Dataset catalogue
├── docs/
│   ├── specs/                        ← All 12 specification documents (this file)
│   ├── Architecture(2).md
│   ├── system Design.md
│   ├── MVP20Doc.md
│   ├── PRD(3).md
│   └── MINEx_UI_Design_Specification.md
├── infra/
│   ├── docker-compose.yml            ← Local dev stack
│   ├── docker-compose.prod.yml       ← Production overrides
│   └── postgres/
│       └── init.sql                  ← Schema creation + PostGIS extensions
├── scripts/
│   ├── seed_db.py                    ← Load synthetic datasets into DB
│   ├── validate_india.py             ← India compliance check on all datasets
│   └── check_leakage.py             ← Target leakage audit script
├── turbo.json                        ← Turborepo pipeline config
├── package.json                      ← Root workspace (Node)
├── pyproject.toml                    ← Root Python workspace
├── .env.example                      ← Environment variable template
└── README.md
```

---

## 3. `apps/web` — Next.js Frontend

```
apps/web/
├── app/
│   ├── (public)/
│   │   ├── page.tsx                  ← Landing page
│   │   └── auth/
│   │       ├── login/
│   │       │   └── page.tsx
│   │       └── callback/
│   │           └── route.ts
│   └── (app)/
│       ├── layout.tsx                ← Global shell (command bar + sidebar)
│       ├── exploration/
│       │   ├── page.tsx              ← Prospectivity map
│       │   ├── [target_id]/
│       │   │   └── page.tsx          ← Target evidence panel
│       │   └── drillholes/
│       │       └── page.tsx
│       ├── production/
│       │   ├── page.tsx              ← Production Command Center
│       │   ├── risk/
│       │   │   └── page.tsx
│       │   └── outcomes/
│       │       └── page.tsx
│       ├── equipment/
│       │   ├── page.tsx              ← Fleet overview
│       │   └── [machine_id]/
│       │       └── page.tsx
│       ├── scenarios/
│       │   ├── page.tsx              ← Scenario builder
│       │   ├── compare/
│       │   │   └── page.tsx
│       │   └── optimizer/
│       │       └── page.tsx
│       ├── portfolio/
│       │   ├── page.tsx              ← Management overview
│       │   └── decisions/
│       │       └── page.tsx
│       ├── admin/
│       │   ├── governance/
│       │   │   └── page.tsx
│       │   ├── datasets/
│       │   │   └── page.tsx
│       │   ├── models/
│       │   │   └── page.tsx
│       │   └── users/
│       │       └── page.tsx
│       └── shared/
│           ├── data-health/
│           │   └── page.tsx
│           ├── ledger/
│           │   └── page.tsx
│           ├── memory/
│           │   └── page.tsx
│           ├── alerts/
│           │   └── page.tsx
│           └── copilot/
│               └── page.tsx
├── components/
│   ├── map/
│   │   ├── ProspectivityMap.tsx
│   │   ├── BoreholeMarkers.tsx
│   │   ├── LayerToggle.tsx
│   │   └── ComplianceBadge.tsx
│   ├── charts/
│   │   ├── ForecastBand.tsx          ← P10/P50/P90
│   │   ├── RootCauseBar.tsx
│   │   ├── EquipmentRiskTrend.tsx
│   │   └── ProductionHistory.tsx
│   ├── cards/
│   │   ├── PredictionCard.tsx        ← Shared card with badges
│   │   ├── EvidencePanel.tsx
│   │   ├── ActionCard.tsx
│   │   └── AlertCard.tsx
│   ├── governance/
│   │   ├── DatasetUploadFlow.tsx
│   │   ├── ModelHealthTable.tsx
│   │   ├── ChampionChallengerView.tsx
│   │   └── AuditLogTable.tsx
│   ├── copilot/
│   │   └── CopilotPanel.tsx
│   └── layout/
│       ├── CommandBar.tsx
│       ├── Sidebar.tsx
│       └── MineSelector.tsx
├── lib/
│   ├── api/
│   │   ├── client.ts                 ← Typed fetch wrapper
│   │   ├── exploration.ts
│   │   ├── production.ts
│   │   ├── equipment.ts
│   │   ├── scenarios.ts
│   │   ├── datasets.ts
│   │   └── governance.ts
│   ├── auth/
│   │   ├── session.ts
│   │   └── middleware.ts
│   └── state/
│       ├── mine-store.ts             ← Zustand: selected mine + MineState
│       └── scenario-store.ts         ← Zustand: scenario workspace state
├── styles/
│   └── globals.css                   ← Design tokens (liquid-glass)
├── public/
│   └── assets/
├── next.config.ts
├── tsconfig.json
└── package.json
```

---

## 4. `apps/api` — FastAPI Backend

```
apps/api/
├── main.py                           ← App factory, CORS, middleware, router mount
├── routers/
│   ├── health.py
│   ├── exploration.py
│   ├── production.py
│   ├── equipment.py
│   ├── scenarios.py
│   ├── datasets.py
│   ├── models.py
│   ├── feedback.py
│   ├── alerts.py
│   └── admin.py
├── services/
│   ├── geo_service.py
│   ├── ml_service.py
│   ├── twin_service.py
│   ├── ingestion_service.py
│   ├── governance_service.py
│   └── alert_service.py
├── domain/
│   ├── mine_state.py                 ← MineState dataclass + assembly
│   ├── scenario.py                   ← Scenario dataclass + validator
│   ├── prediction.py                 ← Prediction dataclass
│   ├── india_compliance.py           ← assert_india_only()
│   └── feature_pipeline.py          ← Feature engineering logic
├── ml/
│   ├── models/                       ← Trained model artifacts (.joblib/.json)
│   ├── prospectivity_model.py        ← Load + infer prospectivity
│   ├── production_model.py           ← Load + infer forecast
│   ├── shortfall_model.py            ← Load + infer shortfall prob
│   ├── equipment_model.py            ← Load + infer failure prob
│   └── shap_attribution.py          ← SHAP wrapper
├── schemas/
│   ├── exploration.py                ← Pydantic request/response models
│   ├── production.py
│   ├── equipment.py
│   ├── scenarios.py
│   ├── datasets.py
│   └── common.py                     ← PredictionMetadata, ErrorResponse
├── models/
│   ├── base.py
│   ├── mine.py
│   ├── production.py
│   ├── equipment.py
│   └── governance.py                 ← SQLAlchemy ORM models
├── db/
│   ├── session.py                    ← Async SQLAlchemy session
│   ├── init_db.py
│   └── migrations/                   ← Alembic revisions
├── core/
│   ├── config.py                     ← pydantic-settings
│   ├── security.py                   ← JWT encode/decode
│   ├── rbac.py                       ← Role dependency injection
│   └── logging.py
├── tests/
│   ├── test_india_compliance.py
│   ├── test_feature_pipeline.py
│   ├── test_scenario_engine.py
│   └── test_api_*.py
├── pyproject.toml
└── Dockerfile
```

---

## 5. `apps/ml` — ML Training & Evaluation

```
apps/ml/
├── pipelines/
│   ├── prospectivity_pipeline.py     ← Spatial feature build + train + validate
│   ├── production_pipeline.py        ← Temporal feature build + train + validate
│   ├── shortfall_pipeline.py         ← Shortfall classification pipeline
│   └── equipment_pipeline.py         ← Equipment failure pipeline
├── evaluation/
│   ├── spatial_cv.py                 ← Spatial block cross-validation
│   ├── temporal_cv.py                ← Chronological temporal split
│   ├── leakage_audit.py             ← Target + future leakage detection
│   ├── calibration.py               ← Brier score, reliability diagram
│   └── validation_report.py         ← FINAL_MODEL_VALIDATION.csv generator
├── data/
│   ├── feature_engineering.py        ← All feature transformations
│   ├── negative_sampling.py          ← Background/negative class sampling
│   └── split_strategy.py            ← Train/val/test splits
├── synthetic/
│   ├── generate_operations.py        ← Causal operational data generation
│   ├── generate_prospectivity.py     ← FFT Gaussian random field generation
│   ├── causal_graph.py              ← Causal dependency definitions
│   └── seed_config.py               ← seed=26009, all generation params
├── registry/
│   ├── model_registry.py             ← Save/load model versions to DB
│   └── champion_challenger.py        ← Gate checks + promotion logic
├── notebooks/                        ← EDA and experimental notebooks (not production)
│   ├── 01_data_exploration.ipynb
│   ├── 02_prospectivity_eda.ipynb
│   └── 03_production_forecast_eda.ipynb
├── FINAL_MODEL_VALIDATION.csv        ← Signed-off validation matrix
├── pyproject.toml
└── README.md
```

---

## 6. `packages/` — Shared Code

### `packages/types` (TypeScript)
```
packages/types/
├── src/
│   ├── api/
│   │   ├── prediction.ts             ← PredictionMetadata, PredictionCard
│   │   ├── scenario.ts               ← Scenario, MineState
│   │   ├── exploration.ts            ← ProspectivityCell, BoreholRecord
│   │   └── governance.ts             ← DatasetVersion, ModelRelease, AuditEvent
│   ├── enums/
│   │   ├── data-origin.ts            ← REAL, SYNTHETIC, etc.
│   │   ├── freshness.ts              ← FRESH, AGING, STALE, CRITICAL
│   │   └── risk-level.ts             ← HIGH, MEDIUM, LOW
│   └── index.ts
└── package.json
```

### `packages/ui` (TypeScript React)
```
packages/ui/
├── src/
│   ├── badges/
│   │   ├── DataOriginBadge.tsx       ← REAL/SYNTHETIC badge
│   │   ├── FreshnessBadge.tsx        ← FRESH/AGING/STALE/CRITICAL pill
│   │   ├── ConfidenceBadge.tsx       ← HIGH/MEDIUM/LOW
│   │   └── ComplianceBadge.tsx       ← India-only pass/fail
│   ├── cards/
│   │   ├── KpiCard.tsx
│   │   └── LimitationCard.tsx
│   └── index.ts
└── package.json
```

### `packages/py-core` (Python)
```
packages/py-core/
├── src/py_core/
│   ├── india_compliance.py           ← assert_india_only() + batch check
│   ├── data_classification.py        ← DataOrigin enum + validation
│   ├── feature_utils.py             ← Lag, rolling, temporal feature helpers
│   ├── uncertainty.py               ← P10/P50/P90 bootstrap + Brier
│   └── logging.py                   ← Structured JSON logging helpers
└── pyproject.toml
```

---

## 7. `turbo.json` — Pipeline Config

```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "dist/**"]
    },
    "lint": {
      "outputs": []
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": [],
      "cache": false
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

---

## 8. Environment Variables (`.env.example`)

```bash
# Database
DATABASE_URL=postgresql+asyncpg://minex:password@localhost:5432/minex_db
REDIS_URL=redis://localhost:6379

# Auth
JWT_SECRET_KEY=change_this_in_production
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=15
REFRESH_TOKEN_EXPIRE_DAYS=7

# API
API_HOST=0.0.0.0
API_PORT=8000
CORS_ORIGINS=http://localhost:3000

# ML
MODEL_STORE_PATH=apps/ml/models
RANDOM_SEED=26009

# Storage (local or S3-compatible)
STORAGE_BACKEND=local        # 'local' or 's3'
STORAGE_PATH=./storage
# S3_BUCKET=
# S3_ENDPOINT_URL=

# Data
DATA_PATH=./data
SYNTHETIC_SEED=26009
```

---

## 9. Naming Conventions

| Item | Convention | Example |
|------|-----------|---------|
| Python files | `snake_case.py` | `geo_service.py` |
| Python classes | `PascalCase` | `ProspectivityModel` |
| TypeScript files | `PascalCase.tsx` | `PredictionCard.tsx` |
| TypeScript components | `PascalCase` | `ForecastBand` |
| API routes | `kebab-case` | `/data-health` |
| DB tables | `schema.snake_case` | `ops.production_records` |
| DB columns | `snake_case` | `shortfall_probability` |
| Environment vars | `UPPER_SNAKE_CASE` | `DATABASE_URL` |
| Dataset IDs | `NN_descriptive_name` | `09_mine_operations` |
| Model versions | `vMAJOR.MINOR` | `v4.2` |

---

## 10. Developer Commands

```bash
# Install all dependencies
npm install                          # JS workspace
uv sync --all-packages               # Python workspace

# Start dev servers (all services)
npm run dev                          # Turborepo starts web + api

# Database
docker-compose up -d postgres redis
python scripts/seed_db.py           # Load synthetic datasets

# ML pipeline
cd apps/ml
python pipelines/production_pipeline.py   # Train + validate
python evaluation/validation_report.py    # Generate FINAL_MODEL_VALIDATION.csv

# Tests
npm run test                         # All JS tests via Turborepo
pytest apps/api/tests/               # API unit + integration tests
pytest packages/py-core/tests/       # Core utility tests

# Lint
npm run lint                         # ESLint + TypeScript
ruff check apps/api apps/ml packages/py-core

# Build for demo
npm run build
```
