# MINEx System Architecture & Engineering Blueprint

## 1. Executive Summary

MINEx (Mining Intelligence Operating Platform) is an AI-powered industrial intelligence system designed for open-cast and underground manganese mining operations, calibrated on the Sausar Belt geological deposit (Madhya Pradesh / Maharashtra, India).

The platform transforms disparate operational silos (pit extraction, haulage fleet telemetry, exploration geophysics, and mill beneficiation) into a coherent, real-time decision operating system with auditable machine learning, human approval gates, and immutable ledger recording.

---

## 2. System Topology

```
                  ┌──────────────────────────────────────────────┐
                  │          Next.js 14 Web Application          │
                  │  (Dark Industrial Glassmorphism / MapLibre)  │
                  └───────────────────────┬──────────────────────┘
                                          │ HTTPS / REST (JSON)
                                          ▼
                  ┌──────────────────────────────────────────────┐
                  │            FastAPI Backend Engine            │
                  │             (Python 3.11+ / Uvicorn)         │
                  └─────────┬─────────────┬─────────────┬────────┘
                            │             │             │
              ┌─────────────▼─┐   ┌───────▼───────┐   ┌─▼───────────────┐
              │ Core Runtimes │   │  ML Artifacts │   │  Database Layer │
              │ - RBAC Engine │   │  - LightGBM   │   │  Aiven Postgres │
              │ - Schema Map  │   │  - Logit Calib│   │  - ops schema   │
              │ - Validator   │   │  - TreeExpl   │   │  - geo schema   │
              │ - Tiered Cache│   │  - Quantiles  │   │  - ml schema    │
              │   * L1 Monotic│   │  - Scalers    │   │  - gov schema   │
              │   * L2 Upstash│   └───────────────┘   │  - hub schema   │
              │   * Stampede  │                       └─────────────────┘
              └───────────────┘
```

### Hybrid Tiered Caching Architecture (L1 + L2 + Stampede Protection)

- **Authority Rule:** PostgreSQL / ML Producer is authoritative. Redis is an accelerator, never the source of truth.
- **L1 In-Memory Micro-Cache:** Process-local, bounded LRU (1000 entries max), monotonic clock expiration (`time.monotonic()`), 5–30s TTL. Protects against burst queries and multi-widget dashboard re-renders.
- **L2 Upstash Redis:** Shared across Render instances over TLS (`rediss://`), connection pooled with strict timeouts (`1.0s` connect, `1.5s` socket). 15–600s TTL.
- **Single-Flight Request Coalescing:** Process-local per-key mutex locks ensure that 100 concurrent requests on an uncached key produce exactly 1 database/ML producer execution.
- **Circuit Breaker:** Automatic fast-fail after 3 consecutive failures (`CLOSED -> OPEN`), 30-second cooldown before probing (`HALF_OPEN -> CLOSED/OPEN`).
- **Resilient Fallback:** If Redis is down, misconfigured, or unreachable, requests succeed seamlessly via L1 and the producer with zero user-facing 500 errors.
- **Event-Driven Invalidation:** Automated cache invalidation hooked into Model Promotion / Rollback (`invalidate_model`) and Data Hub upload/approval (`invalidate_dataset`).
- **Compression & Serialization:** Deterministic JSON encoder supporting NumPy, Pandas, UUID, Decimal, and Pydantic models. Transparent `zlib` compression for payloads > 25KB with zip-bomb guards (< 10MB).

---

## 3. Backend Routers & API Surface (14 Active Routers)

| Router | Prefix | Responsibility |
|---|---|---|
| `health` | `/api/v1` | Unauthenticated liveness probe and database connection status |
| `auth` | `/api/v1/auth` | JWT token issuing, demo credential bootstrap, current identity |
| `mines` | `/api/v1/mines` | Mine site metadata, boundaries, operational zones |
| `production` | `/api/v1/production` | P10/P50/P90 quantiles, SHAP drivers, physical volume gap vs calibrated shortfall risk |
| `equipment` | `/api/v1/equipment` | Fleet telemetry, machine health indices, 24h failure probability |
| `exploration`| `/api/v1/exploration`| Prospectivity grid, AI anomaly targets, mineral assay correlation |
| `scenarios` | `/api/v1/scenarios` | Constraint-aware operational optimizer, what-if shift simulations |
| `alerts` | `/api/v1/alerts` | Safety and operational threshold alerts with operator acknowledge |
| `ledger` | `/api/v1/ledger` | Immutable prediction audit ledger, Data Health Center, Decision Memory |
| `governance` | `/api/v1/governance`| Champion/challenger model registry health, dataset freshness |
| `data_hub` | `/api/v1/data` | Multi-step CSV/XLSX upload, auto column mapping, 10-check data validation |
| `training` | `/api/v1/training` | Governed training run lifecycle, evaluation runs, background simulation |
| `model_approval`| `/api/v1/models` | Human approval gate, champion promotion, emergency rollback |
| `decisions` | `/api/v1/decisions` | Operational decision logging, post-shift outcome feedback loop |
| `intelligence`| `/api/v1/intelligence`| Unified Mine Pulse, NL reasoning engine, Root Cause Explorer, Material Flow |

---

## 4. Validated Machine Learning Models

Model artifacts are persisted in `apps/ml/artifacts/` and evaluated strictly on out-of-sample temporal/spatial test splits. Benchmark numbers from `apps/ml/FINAL_MODEL_VALIDATION.csv`:

| Task | Champion Model | Split | Metric | Measured Value | Baseline Reference |
|---|---|---|---|---|---|
| **Production Forecast** | `LightGBM Regressor` | Temporal | $R^2$ / MAE | **0.7742** / **30.9 t** | Linear Baseline: 0.6120 |
| **Shortfall Classifier**| `Calibrated Logistic`| Temporal | ROC-AUC / PR-AUC | **0.7241** / **0.6532** | Uncalibrated: 0.6810 |
| **Equipment Failure** | `Logistic Baseline` | Temporal | ROC-AUC / Lift | **0.6018** / **1.51×** | Base rate: 8.2% |
| **Prospectivity AI** | `Logistic Baseline` | Spatial | ROC-AUC / PR-AUC | **0.9005** / **0.8488** | Random: 0.5000 |

*Zero target leakage verified across all feature pipelines (`leakage_status = 'PASS'`).*

---

## 5. Database Schema Architecture (Aiven PostgreSQL)

1. **`ops` (Operations)**:
   - `production_records`: shift-level tonnages, ore grades, planned vs actual
   - `equipment_telemetry`: vibration, temperature, oil pressure, failure risks
   - `alerts`: system and safety threshold notifications
2. **`geo` (Geospatial & Exploration)**:
   - `prospectivity_grid`: scored geospatial cells across the Sausar belt
   - `exploration_targets`: screened AI deposit candidates
3. **`ml` (Inference Ledger)**:
   - `predictions`: immutable log of every model inference with quantiles and top drivers
4. **`gov` (Governance & Audit)**:
   - `model_registry`: versioned champion/challenger catalog with measured test metrics
   - `model_approvals`: auditable trail of human promotions and rollbacks
   - `training_runs`: status, triggers, and artifacts of retraining runs
   - `audit_log`: immutable security and operational event stream
   - `decisions` & `decision_outcomes`: shift-level interventions and effectiveness tracking
5. **`hub` (Data Hub)**:
   - `datasets` & `dataset_versions`: uploaded raw files with lineage
   - `dataset_column_mappings`: source-to-canonical column alignments
   - `dataset_validation_reports`: deterministic data health scorecards (0-100)
