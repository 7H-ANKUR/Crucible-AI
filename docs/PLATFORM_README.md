---
title: Crucible AI Mining Intelligence Platform
emoji: ⛏️
colorFrom: blue
colorTo: indigo
sdk: gradio
sdk_version: 4.44.0
app_file: app.py
pinned: false
---

# Crucible AI — Mining Intelligence Operating Platform

> **SIH26009** — Production-grade AI operating platform for heavy industrial mining.  
> Built for the Sausar Belt (21.95°N, 79.25°E) manganese corridor. DGMS-compliant.

[![Build](https://img.shields.io/badge/build-passing-brightgreen)](#)
[![Tests](https://img.shields.io/badge/tests-146%20passed-brightgreen)](#)
[![Cache](https://img.shields.io/badge/cache-hybrid%20L1%2FL2-blue)](#)
[![License](https://img.shields.io/badge/license-Proprietary-red)](#)

---

## What is Crucible AI?

Crucible AI is a governed, AI-driven mine operating system that fuses four real ML models, geospatial intelligence, a constraint-aware scenario engine, and a full data governance lifecycle into a single Next.js glassmorphic interface.

It is **not** a dashboard — it is an **operating platform** with:
- A **Data Hub** for upload → validate → version → approve pipelines
- A **Training + Model Approval** gate (champion/challenger, human approval required)
- A **Command Center** that answers what needs attention, what to do, and what happens if nothing is done
- A **response plan lifecycle** — propose, approve, act, measure — with audit that shares the transaction
- A **Decision Memory** that surfaces comparable past decisions and what they actually achieved
- Full **RBAC** with mine-level isolation across 19 routers and 130 routes

---

## 🧠 ML Models (Validated)

| Task | Algorithm | Metric | Value |
|---|---|---|---|
| Production Forecast | LightGBM | R² (test) | **0.7742** |
| Production Forecast | LightGBM | MAE (test) | **30.9 t** |
| Shortfall Classifier | Logistic (calibrated) | ROC-AUC | **0.7241** |
| Equipment Failure | Logistic (baseline) | ROC-AUC | **0.6018** |
| Prospectivity | Logistic (baseline) | ROC-AUC | **0.9005** |

All values from `app/ml/FINAL_MODEL_VALIDATION.csv`, measured on held-out test splits.

> **Read these with the caveats in [docs/TECHNICAL_REPORT.md §4](docs/TECHNICAL_REPORT.md) before quoting them.**
>
> - All training data is **synthetic**. No figure here transfers to a real mine.
> - `leakage_status: PASS` is a **hardcoded literal** in the training scripts, not a computed result.
> - Equipment failure at ROC-AUC 0.602 is **near-chance**; its value is a 1.51x lift for prioritising inspections, not a claim that a given machine will fail.
> - A **linear baseline matches LightGBM** on production forecasting (MAE 27.55 vs 27.46). The gradient booster earns nothing here.

---

## 🚀 Platform Capabilities

### Command Center (`/command-center`) — the landing page
- Operational state: NORMAL / WATCH / DISRUPTION / CRITICAL, from five measured signals
- Ranked attention queue with production at stake, or an explicit "not estimated"
- Recommended actions, each with expected effect, cost, owner and approver
- "If nothing is done" projection over 30 min / 2 h / shift / day
- Material flow with the binding stage identified

### Production (`/production`)
- P10/P50/P90 forecast with **separate** production gap and calibrated shortfall probability
- SHAP driver attribution per prediction
- Prediction ledger with outcome history

### Exploration & Prospectivity (`/exploration`)
- MapLibre GL geospatial grid scoring for manganese deposits
- Groq LLM target brief generation
- Spectral, terrain, and geochem feature fusion

### Equipment Fleet (`/equipment`)
- Predictive failure risk per machine (ROC-AUC 0.60)
- Fleet availability heatmap
- Maintenance scheduling with backlog tracking

### Scenario Optimisation (`/scenario`)
- Constraint-aware intervention engine (DGMS blast rules, shift constraints, equipment availability)
- `model_backed: true/false` transparency on every action
- Optimizer ranks actions by `(expected_gain × feasibility) / cost`
- Heuristic fallback with labeled reason when model features unavailable

### Intelligence Center (`/intelligence`)
- **Mine Pulse**: Unified 0-100 health score across 5 pillars
- **NL Query Engine**: Structured intent routing (no arbitrary SQL)
- **Root Cause Explorer**: SHAP drivers + observed events + unmeasured factors
- **Mine Replay**: Immutable chronological operational timeline
- **Material Flow**: 6-stage mass balance with bottleneck detection

### Data Hub (`/data-hub`)
- Multi-step upload wizard: Domain → Upload → Schema Mapping → Validation → Approve
- Auto column mapping with fuzzy matching + confidence badges
- Data Health Report (quality score, validation checks, row counts)
- Dataset versioning with `APPROVED_FOR_TRAINING` gate

### Governance & Model Approval (`/governance`)
- Champion vs Challenger comparison matrix (MAE / R² / ROC-AUC / PR-AUC)
- Human approval gate: Approve → Promote / Reject / Rollback
- Training run status tracking
- Decision Memory with outcome feedback loop (predicted vs actual Δ)

---

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| **Frontend** | Next.js 14 (App Router), React 18, Tailwind CSS v4, GSAP, MapLibre GL, Recharts |
| **Backend** | FastAPI, Python 3.11+, Pydantic V2, Uvicorn |
| **Caching** | Hybrid Tiered Cache: L1 Monotonic In-Memory + L2 Upstash Redis (`rediss://` TLS) + Single-Flight |
| **ML** | LightGBM, Scikit-Learn, SHAP, joblib artifacts |
| **Database** | PostgreSQL (Aiven) — schemas: `ops`, `ml`, `gov`, `hub` |
| **Auth** | Clerk RS256 JWKS (frontend + backend token validation) + Demo JWT (dev mode) |
| **Durable Storage** | Google Drive (datasets, canonical snapshots, model artifacts, audit logs) |
| **Cloud Training** | Modal.com serverless GPU/CPU containers (`app/ml/modal_train.py`) |
| **AI** | Groq (LLM target brief + NL reasoning) |

---

## 📂 Project Structure

```
SIH26009/
├── apps/
│   ├── api/                    # FastAPI backend
│   │   ├── core/
│   │   │   ├── canonicalizer.py # Canonical dataset materialization + Drive persistence
│   │   │   ├── config.py       # Settings (TRAINING_MODE, GDRIVE_FOLDER_ID, MODAL_*)
│   │   │   ├── contracts.py    # Canonical Pydantic schemas
│   │   │   ├── data_validator.py # 25-point deterministic quality checks
│   │   │   ├── db.py           # PostgreSQL connection pool
│   │   │   ├── ml_loader.py    # Joblib model registry + smoke test
│   │   │   ├── optimizer.py    # Constraint-aware scenario optimizer
│   │   │   ├── rbac.py         # Role guards + domain access checks
│   │   │   ├── schema_mapper.py # Column mapping with fuzzy matching
│   │   │   ├── security.py     # Clerk RS256 JWKS verification (strict 401)
│   │   │   └── storage.py      # Google Drive object storage abstraction
│   │   ├── routers/
│   │   │   ├── alerts.py
│   │   │   ├── auth.py
│   │   │   ├── data_hub.py     # Upload → validate → version → approve
│   │   │   ├── decisions.py    # Decision memory + outcome feedback
│   │   │   ├── equipment.py
│   │   │   ├── exploration.py
│   │   │   ├── governance.py
│   │   │   ├── intelligence.py # Pulse, top-issues, NL query, root cause, replay, flow
│   │   │   ├── model_approval.py
│   │   │   ├── production.py
│   │   │   ├── scenarios.py
│   │   │   └── training.py
│   │   └── tests/              # 31 tests across all domains
│   ├── ml/
│   │   ├── artifacts/          # Trained .joblib models (ephemeral cache)
│   │   ├── FINAL_MODEL_VALIDATION.csv
│   │   ├── modal_train.py      # Modal.com serverless training + Drive artifact storage
│   │   └── train_all_models.py
│   └── web/                    # Next.js 14 frontend
│       └── src/app/(app)/
│           ├── data-hub/       # Upload wizard
│           ├── equipment/
│           ├── exploration/
│           ├── governance/     # Model approval + decision memory
│           ├── intelligence/   # Mine pulse + NL query + material flow
│           ├── production/
│           └── scenario/
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DATA_HUB.md
│   ├── LEARNING_LIFECYCLE.md
│   ├── RBAC.md
│   └── SYNTHETIC_DATA_POLICY.md
├── infra/                      # Docker Compose + DB init scripts
├── seed_db.py
├── CRUCIBLE_CREDENTIALS.md        # Local dev credentials (gitignored)
└── README.md
```

---

## ⚙️ Getting Started

### Prerequisites
- Node.js v18+
- Python 3.11+
- PostgreSQL database (Aiven or local)
- Clerk API keys (frontend auth)
- Groq API key (optional, for AI features)

### 1. Environment Setup

Copy `.env.example` and fill in your values:
```bash
cp .env.example .env
```

Key variables:
```env
DATABASE_URL="postgresql://user:password@host:port/db?sslmode=require"
DEMO_BOOTSTRAP_ENABLED=true          # enables demo JWT login in dev
DEMO_ADMIN_PASSWORD=your-password    # see CRUCIBLE_CREDENTIALS.md
DEMO_USER_PASSWORD=your-password
GROQ_API_KEY="gsk_..."

# Google Drive durable object storage
GDRIVE_FOLDER_ID=1XykuJ8El-yQ_27FrdCzL7VHraoyGrBKy
GDRIVE_FOLDER_URL=https://drive.google.com/drive/folders/1XykuJ8El-yQ_27FrdCzL7VHraoyGrBKy

# Modal.com serverless training (get from https://modal.com/settings/tokens)
TRAINING_MODE=modal
MODAL_TOKEN_ID=ak-...
MODAL_TOKEN_SECRET=as-...
```

> **Production (Render) Environment Variables**: Set all of the above, plus `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and ensure `DEMO_BOOTSTRAP_ENABLED=false`. Google Drive folder must be publicly shared (Anyone with link → Viewer) or `GOOGLE_SERVICE_ACCOUNT_JSON` must be provided.

### 2. Database Setup
```bash
python seed_db.py
```
Creates all schemas (`ops`, `ml`, `gov`, `hub`) and seeds synthetic operational data.

### 3. Backend
```bash
pip install -r app/api/requirements.txt
python -m uvicorn app.api.main:app --port 8000 --reload
```

### 4. Frontend
```bash
cd web
npm install --legacy-peer-deps
npm run dev          # http://localhost:3000
```

### 5. Run Tests
```bash
python -m pytest app/api/tests/ -q
```
Expected: **56 passed** (including unit, integration, RBAC, storage, model approval, and tiered cache test suites)

### 6. Run Cache & Stampede Benchmarks
```bash
python scripts/benchmark_cache.py
```
Validates cold vs L1 vs L2 latency and confirms single-flight coalescing under 100 concurrent requests.

---

## ⚡ Hybrid Tiered Caching & Performance Architecture

Crucible AI implements a production-hardened hybrid caching layer designed for multi-instance Render deployments:

```
                        API REQUEST
                            |
                            v
                  +--------------------+
                  | TieredCacheManager |
                  +---------+----------+
                            |
                        Check L1
                   In-memory micro-cache
                            |
                +-----------+-----------+
                |                       |
             L1 HIT                  L1 MISS
                |                       |
                |                       v
                |                    Check L2
                |                 Upstash Redis
                |                       |
                |           +-----------+-----------+
                |           |                       |
                |        L2 HIT                  L2 MISS
                |           |                       |
                |           |                       v
                |           |                Single-flight
                |           |                request coalescing
                |           |                       |
                |           |                       v
                |           |                Database / ML
                |           |                  producer
                |           |                       |
                +-----------+-----------------------+
                            |
                            v
                     L2 + L1 populate
                            |
                            v
                      RETURN RESULT
```

### Core Tenets
1. **Accelerator, Never Source of Truth**: PostgreSQL / ML producers remain authoritative. If Redis is unconfigured, unreachable, or times out, requests succeed via L1 / producer fallback with zero user-facing 500 errors.
2. **Circuit Breaker**: Automatic fast-fail after 3 consecutive Redis errors with a 30s probe cooldown (`HALF_OPEN -> CLOSED/OPEN`).
3. **Stampede Protection**: Per-key process-local single-flight mutex locks guarantee that 100 simultaneous cold misses execute the expensive producer exactly **once**.
4. **Version-Aware & Lineage-Safe Keys**: Keys incorporate domain, resource, entity ID, canonical params hash, active champion `model_version`, and `dataset_version`.
5. **Event-Driven Invalidation**: Post-commit hooks on model promotion/rollback (`invalidate_model`) and dataset version approval (`invalidate_dataset`) immediately purge stale namespaces.
6. **Safety-Sensitive Policies**: Strict zero-stale tolerance (`allow_stale=False`) on equipment failure alerts.
7. **Observability**: Live telemetry exposed at `GET /api/v1/health/cache` reporting hit rates, circuit state, stampedes prevented, and latencies.

---

## 🔐 RBAC — Role Hierarchy

```
super_admin
  └── management
        ├── production_admin   → write to production, scenarios
        ├── equipment_admin    → write to equipment, maintenance
        ├── exploration_admin  → write to exploration
        └── mine_planner       → read + scenario simulation
              └── operator     → read only
```

Role is read from `publicMetadata.role` in Clerk (production) or from the demo JWT payload (dev mode).  
See [`docs/RBAC.md`](docs/RBAC.md) for full permission matrix.

---

## 🏗️ Data Governance Lifecycle

```
Upload CSV/XLSX  →  Schema Mapping  →  Validation Report
       ↓
 Dataset Version (PENDING_REVIEW → APPROVED_FOR_TRAINING)
       ↓
 Training Run (queued → running → complete)
       ↓
 Challenger Model registered in gov.model_registry
       ↓
 Human Review: Compare vs Champion (metric delta table)
       ↓
 Approve → Promote (Challenger becomes Champion)
       ↓
 Decisions recorded → Outcomes measured → Effectiveness tracked
```

See [`docs/LEARNING_LIFECYCLE.md`](docs/LEARNING_LIFECYCLE.md) and [`docs/DATA_HUB.md`](docs/DATA_HUB.md).

---

## ⚡ Serverless Cloud Training (Modal.com)

Crucible AI supports remote model training using [Modal.com](https://modal.com) serverless GPU/CPU containers (`app/ml/modal_train.py`).

```bash
# Authenticate
python -m modal setup

# Dispatch remote training in cloud
modal run app/ml/modal_train.py --domain production
modal run app/ml/modal_train.py --all
```

When `MODAL_TOKEN_ID` is set in `.env` and `TRAINING_MODE=modal`, training triggered from the `/governance` UI (`POST /api/v1/training/trigger`) automatically:
1. Downloads the approved canonical dataset from Google Drive.
2. Verifies SHA-256 checksums of the downloaded artifact.
3. Dispatches the training run to a Modal serverless container (GPU/CPU).
4. Saves trained model artifacts back to Google Drive under `models/{task}/`.
5. Records challenger metrics, SHA-256, and Drive storage IDs in `gov.model_registry` and `gov.model_artifacts`.

There is **no silent fallback** to local training when `TRAINING_MODE=modal` — a failed dispatch returns a 500 with the actual Modal error.

---

## 🟡 Synthetic Data Policy

All operational data displayed in demo mode is clearly labeled **SYNTHETIC OPERATIONAL BENCHMARK** and sourced from statistically calibrated distributions matching Indian manganese mining baselines.  
No synthetic data is ever promoted as real without an approved dataset version.

See [`docs/SYNTHETIC_DATA_POLICY.md`](docs/SYNTHETIC_DATA_POLICY.md).

---

## 📝 License
Proprietary. Created for **SIH26009**.
