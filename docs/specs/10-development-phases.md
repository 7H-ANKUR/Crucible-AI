# 10 — Development Phases
# MINEx — SIH26009 | v1.0

---

## 1. Overview

Development is structured across 5 sprints of 3–4 days each, targeting a fully demonstrable prototype in 18 days.

```
Sprint 1: Foundation         Day 1–3    Infrastructure + data loading
Sprint 2: Intelligence Core  Day 4–7    ML pipelines + API core
Sprint 3: Command Center      Day 8–11   Production + Scenario UI
Sprint 4: Exploration + Gov   Day 12–15  Exploration map + governance screens
Sprint 5: Polish + Demo Prep  Day 16–18  UI polish + demo rehearsal
```

---

## 2. Sprint 1 — Foundation (Days 1–3)

**Goal:** Environment running, data loaded, APIs responding, India compliance passing.

### Backend Tasks
- [ ] Set up `docker-compose.yml` with PostgreSQL 15 + PostGIS 3.4 + Redis 7
- [ ] Create `infra/postgres/init.sql` (enable PostGIS extensions, create schemas)
- [ ] Run Alembic initial migration (all tables from spec 05)
- [ ] Implement `packages/py-core/india_compliance.py` — `assert_india_only()` + batch check
- [ ] Implement `scripts/seed_db.py` — load all 12 datasets from `SIH26009_DATA/`
- [ ] Implement `scripts/validate_india.py` — batch compliance report
- [ ] Implement `scripts/check_leakage.py` — minimum distance + target leakage checks
- [ ] `GET /api/v1/health` endpoint working
- [ ] `GET /api/v1/mines` returning 3 mine entities
- [ ] `GET /api/v1/data-health` returning domain freshness
- [ ] RBAC middleware (JWT decode + role injection)

### Frontend Tasks
- [ ] Next.js 14 App Router scaffold
- [ ] Design tokens + globals.css (liquid-glass theme, DM Mono / Manrope fonts)
- [ ] `packages/ui` — DataOriginBadge, FreshnessBadge, ConfidenceBadge
- [ ] Landing page — hero, evidence strip, workflow band, trust chips
- [ ] Auth — login page, JWT session handling, role-based redirect

### ML Tasks
- [ ] `apps/ml/synthetic/causal_graph.py` — define causal dependency graph
- [ ] `apps/ml/synthetic/generate_operations.py` — generate production, equipment, maintenance, blast, stockpile (seed=26009)
- [ ] `apps/ml/synthetic/generate_prospectivity.py` — FFT Gaussian random field for spatial continuity
- [ ] Verify: equipment failures correlate with age + overdue maintenance (not random)
- [ ] Verify: shortfall correlates with rainfall + equipment downtime (not random)

### Sprint 1 Deliverable
```
✓ docker-compose up
✓ python scripts/seed_db.py  (no errors, 0 India violations)
✓ GET /api/v1/health → 200
✓ GET /api/v1/mines → 3 mines
✓ Landing page renders
✓ Login works, routes to role workspace
```

---

## 3. Sprint 2 — Intelligence Core (Days 4–7)

**Goal:** All 4 ML models trained and serving via API. SHAP attribution working.

### ML Tasks
- [ ] `apps/ml/data/feature_engineering.py` — all feature groups (production, prospectivity, equipment)
- [ ] `apps/ml/data/split_strategy.py` — temporal split + spatial block split
- [ ] `apps/ml/evaluation/leakage_audit.py` — per-model leakage report
- [ ] **Prospectivity pipeline:**
  - [ ] Build exploration_feature_grid from synthetic occurrences + EO features + terrain
  - [ ] Spatial block split (3 sub-regions)
  - [ ] Train RF + XGB + calibration
  - [ ] SHAP attribution
  - [ ] Spatial block evaluation → report metrics
- [ ] **Production Forecast pipeline:**
  - [ ] Build lag/rolling features from production records
  - [ ] Temporal split (70/15/15)
  - [ ] Train XGB Regressor + quantile regression (P10/P50/P90)
  - [ ] Temporal evaluation → report metrics
- [ ] **Shortfall Classifier pipeline:**
  - [ ] Build features (same base + forecast gap)
  - [ ] Same temporal split as production
  - [ ] Train XGB + calibration
  - [ ] SHAP attribution
  - [ ] Evaluate: ROC-AUC, PR-AUC, FN-rate, Brier
- [ ] **Equipment Failure pipeline:**
  - [ ] Build 24h prediction windows
  - [ ] Temporal + entity split
  - [ ] Train XGB + class weighting
  - [ ] Evaluate: PR-AUC vs baseline; document limitation
- [ ] Populate `FINAL_MODEL_VALIDATION.csv`
- [ ] Save model artifacts to `apps/ml/models/`

### Backend Tasks
- [ ] `apps/api/ml/` wrappers — load models, run inference, compute SHAP
- [ ] `GET /api/v1/production/{mine_id}/forecast` — full P10/P50/P90 + root causes
- [ ] `GET /api/v1/production/{mine_id}/history` — time series records
- [ ] `GET /api/v1/equipment/{mine_id}` — fleet health with failure probs
- [ ] `GET /api/v1/equipment/{mine_id}/{machine_id}` — machine detail
- [ ] `GET /api/v1/exploration/map` — prospectivity grid serving
- [ ] `GET /api/v1/exploration/target/{id}` — evidence panel
- [ ] ML Service layer + Prediction Ledger writes
- [ ] Uncertainty output (P10/P50/P90, confidence tier, Brier)

### Sprint 2 Deliverable
```
✓ All 4 models trained with correct split type
✓ FINAL_MODEL_VALIDATION.csv populated
✓ GET /api/v1/production/BAL-001/forecast → P10/P50/P90 + root causes (SHAP-derived)
✓ GET /api/v1/exploration/map → 3,200+ cells with prospectivity scores
✓ All prediction responses include data_origin + confidence + model_version
```

---

## 4. Sprint 3 — Command Center (Days 8–11)

**Goal:** Production Command Center and Scenario workspace fully functional.

### Backend Tasks
- [ ] `domain/mine_state.py` — MineState assembly from DB
- [ ] `domain/scenario.py` — Scenario dataclass + constraint validator
- [ ] `services/twin_service.py` — scenario simulation logic
  - [ ] Equipment redeployment
  - [ ] Maintenance rescheduling
  - [ ] Blast rescheduling
  - [ ] Ore routing change
  - [ ] Schedule adjustment
- [ ] `services/twin_service.py` — constraint checks (equipment conflicts, ore limits, safety buffers)
- [ ] Objective function scorer with configurable weights
- [ ] `GET /api/v1/scenarios/{mine_id}/state`
- [ ] `POST /api/v1/scenarios`
- [ ] `POST /api/v1/scenarios/optimize`

### Frontend Tasks
- [ ] `app/(app)/production/page.tsx` — Production Command Center
  - [ ] KPI card row: Target, Forecast (P50), Shortfall prob, Risk level
  - [ ] P10/P50/P90 time series chart (Recharts)
  - [ ] Root cause bar chart (SHAP-derived)
  - [ ] Evidence panel (click a driver)
  - [ ] Data origin + freshness + confidence badges
  - [ ] "Find feasible response" CTA
- [ ] `app/(app)/scenarios/page.tsx` — Scenario builder
  - [ ] MineState display (current baseline)
  - [ ] Intervention picker
  - [ ] "Run simulation" → result card
  - [ ] Constraint violations display
- [ ] `app/(app)/scenarios/compare/page.tsx` — Scenario comparison table
- [ ] `app/(app)/scenarios/optimizer/page.tsx` — Ranked recommendation list

### Sprint 3 Deliverable
```
✓ Production Command Center: P10/P50/P90 visible, risk=HIGH badge, root cause chart
✓ Scenario: run "Redeploy + Reschedule Blast", see production gain
✓ Optimizer returns ranked scenarios, all feasible
✓ SYNTHETIC badge visible on all cards
✓ Limitation text visible on equipment card
```

---

## 5. Sprint 4 — Exploration + Governance (Days 12–15)

**Goal:** Exploration map fully interactive. Data governance screens visible.

### Frontend Tasks
- [ ] `app/(app)/exploration/page.tsx` — Prospectivity map
  - [ ] MapLibre GL canvas with prospectivity grid
  - [ ] Layer toggles: geology, structures, occurrences, uncertainty, boreholes
  - [ ] Cell hover → probability + confidence + data quality
  - [ ] Cell click → evidence side panel (SHAP attribution)
  - [ ] Maturity status badge on target
  - [ ] India compliance badge in legend
- [ ] `app/(app)/exploration/[target_id]/page.tsx` — Target evidence panel
  - [ ] Full SHAP waterfall
  - [ ] Feature values at inference time
  - [ ] Nearby boreholes list
  - [ ] Maturity workflow
- [ ] `app/(app)/equipment/page.tsx` — Fleet health table
- [ ] `app/(app)/equipment/[machine_id]/page.tsx` — Machine detail + risk trend
- [ ] `app/(app)/shared/data-health/page.tsx` — Data Health Center
  - [ ] Domain table: FRESH/AGING/STALE/CRITICAL pills
  - [ ] Explainable score components
  - [ ] Last successful update timestamp
- [ ] `app/(app)/admin/models/page.tsx` — Model Health (read-only)
  - [ ] Champion + challenger metrics table
  - [ ] Calibration + stability status
  - [ ] FINAL_MODEL_VALIDATION table embed
- [ ] `app/(app)/shared/ledger/page.tsx` — Prediction Ledger table

### Backend Tasks
- [ ] `GET /api/v1/exploration/boreholes/{id}` — borehole + interval profile
- [ ] `GET /api/v1/ledger` — paginated prediction ledger
- [ ] `GET /api/v1/alerts` — role-routed alert list
- [ ] `POST /api/v1/feedback/predictions/{id}` — outcome recording

### Sprint 4 Deliverable
```
✓ Exploration map renders, layer toggles work
✓ Click cell → evidence panel with SHAP drivers
✓ Data Health Center shows correct domain status
✓ Model Health shows validation metrics and limitation text
```

---

## 6. Sprint 5 — Polish + Demo Prep (Days 16–18)

**Goal:** Every screen is polished, all badges correct, demo rehearsed.

### Polish Tasks
- [ ] Responsive layout (1280px min width, graceful at 1440px)
- [ ] Skeleton loaders on all data-fetching components
- [ ] Empty states for all screens (no blank screens)
- [ ] Error boundary on all pages
- [ ] Toast notifications for successful scenario save / alert acknowledgement
- [ ] Command Bar mine selector — switching mine reloads all data correctly
- [ ] Copilot panel (basic: query → API → cite response) — if Sprint 4 on schedule
- [ ] AI Mine Copilot boundary text visible: "Copilot cannot approve data or control equipment"

### Demo Script
Write and rehearse a 10-minute demo walkthrough:
1. (1 min) Landing page — explain MINEx identity and capability
2. (1 min) Sign in → Production Manager workspace
3. (3 min) Production Command Center — explain forecast, shortfall 74%, root causes
4. (3 min) Scenario workspace — run "Redeploy LHD-03 + reschedule blast", show comparison, accept recommendation
5. (1 min) Exploration map — show prospectivity score, click a cell, show evidence
6. (1 min) Data Health Center — explain SYNTHETIC badge, freshness, limitation disclosure

### Quality Gates Before Demo
- [ ] `validate_india.py` → 0 violations
- [ ] `check_leakage.py` → all PASS
- [ ] `FINAL_MODEL_VALIDATION.csv` → committed, all rows filled
- [ ] All API endpoints return `data_origin` on every prediction response
- [ ] No hardcoded SHAP values in frontend code
- [ ] Equipment failure card shows limitation text
- [ ] Demo walkthrough completed 3× without API errors

---

## 7. Task Ownership Template

| Domain | Owner | Sprint |
|--------|-------|--------|
| Synthetic data generation | ML Engineer | 1 |
| ML pipelines + validation | ML Engineer | 2 |
| FastAPI core + DB | Backend Engineer | 1–2 |
| Scenario engine | Backend Engineer | 3 |
| Governance APIs | Backend Engineer | 4 |
| Landing + Auth | Frontend Engineer | 1 |
| Production Command Center | Frontend Engineer | 3 |
| Exploration map | Frontend Engineer | 4 |
| Data Health + Model Health | Frontend Engineer | 4 |
| Demo script + polish | All | 5 |

---

## 8. Daily Standup Template

```
Yesterday: What did you complete?
Today: What are you working on?
Blockers: What is blocking you?
Demo risk: Is there any risk to demo-day readiness?
```

Track progress using `task.md` (created after this plan is approved).

---

## 9. Rollback Plan (Demo Day)

If any system fails on demo day:

| Failure | Fallback |
|---------|---------|
| API down | Pre-recorded walkthrough video |
| DB connection lost | JSON fixture files served via static API |
| ML model load failure | Pre-computed prediction fixtures |
| Map rendering fails | Screenshot carousel of key screens |
| Scenario timeout | Pre-computed scenario results from fixtures |

Keep `demo_fixtures/` directory with static JSON responses for all key API calls, loadable via a `DEMO_FIXTURES=true` env flag.
