# Crucible AI → Decision Operating Platform — Implementation Plan

Target loop: **DETECT → UNDERSTAND → DECIDE → SIMULATE → APPROVE → ACT → MEASURE → LEARN**

Sequencing principle: nothing is built on top of a number that lies. Truth
primitives land first, the canonical engine second, the product surfaces third.

---

## Phase 1 — Truth primitives  *(spec §10, 11, 25, 31, 33, 43)*

| Step | Deliverable | Files |
|---|---|---|
| 1.1 | `CalculationMode`, `EvidenceQuality`, `Scope`, `Provenance` contracts | `core/provenance.py` (new) |
| 1.2 | Evidence-quality engine — derived from freshness, feature completeness, model availability, historical support, constraint completeness | `core/evidence.py` (new) |
| 1.3 | Fix shortfall semantics: `shortfall_prob` → `production_gap_pct`; ML probability kept separate as `probability_of_shortfall` | `scenario_engine.py`, `contracts.py`, web clients |
| 1.4 | Delete fabricated confidence; `model_confidence` removed from contract | `scenario_engine.py`, `scenarios.py` |
| 1.5 | Structured `InsufficientData` error + `CrucibleError` envelope | `core/errors.py` (new) |

**Exit test:** no field named `*_prob*` carries a ratio; `EvidenceQuality` can return LOW.

---

## Phase 2 — Constraint engine  *(spec §21)*

| Step | Deliverable | Files |
|---|---|---|
| 2.1 | `HardConstraint` / `SoftPreference` split; `ConstraintReport` with PASSED/FAILED/NOT_EVALUATED | `core/constraints.py` (new) |
| 2.2 | Remove "assuming typical availability" — missing telemetry ⇒ NOT_EVALUATED ⇒ blocks safety-sensitive recommendation | `core/constraints.py` |
| 2.3 | Retire `optimizer.check_operational_constraints` into the new module | `core/optimizer.py` (shrinks to adapter) |

**Exit test:** with equipment telemetry absent, no redeploy recommendation is emitted.

---

## Phase 3 — Mine context and authorization  *(spec §3.1, 42)*

| Step | Deliverable | Files |
|---|---|---|
| 3.1 | `check_mine_access` fails closed | `core/rbac.py` |
| 3.2 | `resolve_mine_context()` — backend-determined scope, never trusts frontend `mine_id` | `core/mine_context.py` (new) |
| 3.3 | Remove all `mine_id = "mine-01"` defaults | `routers/intelligence.py` |

**Exit test:** request with no mine context returns 400, not mine-01 data.

---

## Phase 4 — Canonical scenario engine  *(spec §9, 24, 38)*

| Step | Deliverable | Files |
|---|---|---|
| 4.1 | `core/scenario/` package: Config, Context, Intervention, Constraint, Result, Comparison, Recommendation, Evidence, Provenance | new package |
| 4.2 | Single intervention catalogue and single scoring path | `core/scenario/engine.py` |
| 4.3 | Objective-driven ranking (production / balanced / cost / risk) — no universal "best" | `core/scenario/ranking.py` |
| 4.4 | Why-this / why-not rejection reasons per alternative | `core/scenario/explain.py` |
| 4.5 | `scenarios.py`, `optimizer.py`, `scenario_engine.py` reduced to adapters | 3 files |
| 4.6 | Rename control label to "Maximum Additional Fuel" | `contracts.py`, web |

**Exit test:** `_HEURISTIC` and `_ADJUSTABLE` each appear exactly once in the tree.

---

## Phase 5 — Database: incidents, plans, outcomes, playbooks  *(spec §35, 36, 37)*

| Step | Deliverable | Files |
|---|---|---|
| 5.1 | Migration extending `gov.decisions.lifecycle_state` to the 9-state machine (DRAFT, SIMULATED, READY_FOR_REVIEW, APPROVED, REJECTED, EXECUTING, COMPLETED, MEASURED, LEARNED) | `infra/postgres/migrations/002_decision_os.sql` |
| 5.2 | New tables: `ops.incidents`, `ops.incident_events`, `gov.response_plans`, `gov.response_plan_actions`, `gov.decision_scenarios`, `gov.decision_approvals`, `gov.playbooks` | same |
| 5.3 | Transactional state transitions with audit that raises on failure | `core/decision_store.py` (new) |

**Exit test:** an illegal transition raises; audit failure rolls back the transition.

---

## Phase 6 — Detection: state, bottleneck, attention  *(spec §3.2, 4, 16, 17)*

| Step | Deliverable | Files |
|---|---|---|
| 6.1 | `MineState` engine — NORMAL / WATCH / DISRUPTION / CRITICAL, each signal carrying value, source, timestamp, scope, severity, reason | `core/state_engine.py` (new) |
| 6.2 | Bottleneck finder across face → load → haul → crush → process → stockpile → dispatch | `core/bottleneck.py` (new) |
| 6.3 | Attention queue ranked by severity × impact × urgency × evidence | `core/attention.py` (new) |
| 6.4 | Recommended-actions engine sourced from real signals | `core/recommendations.py` (new) |

**Exit test:** state is reproducible from its listed signals; no constant contributes.

---

## Phase 7 — Decision products  *(spec §5, 6, 7, 8, 20, 39)*

| Step | Deliverable | Files |
|---|---|---|
| 7.1 | Do-nothing projection over 30 min / 2 h / shift / day | `core/projection.py` (new) |
| 7.2 | Response plan generator (situation → evidence → root cause → NOW / NEXT / NEXT-SHIFT → impact → constraints → risks → approvals → owner) | `core/response_plan.py` (new) |
| 7.3 | Option comparison matrix with per-objective winners | `core/scenario/comparison.py` |
| 7.4 | Decision value (operational; financial only when a validated model exists) | `core/decision_value.py` (new) |
| 7.5 | Decision Package export | `core/decision_package.py` (new) |

---

## Phase 8 — Learning loop  *(spec §12, 13, 15)*

| Step | Deliverable | Files |
|---|---|---|
| 8.1 | Decision-memory similarity retrieval — what happened last time | `core/decision_memory.py` (new) |
| 8.2 | Outcome tracking: predicted vs actual, variance, model error | extends `routers/decisions.py` |
| 8.3 | Incident replay timeline with counterfactual | `core/replay.py` (new) |

---

## Phase 9 — Shift handover, playbooks, disruption centre  *(spec §14, 22, 23, 40)*

| Step | Deliverable | Files |
|---|---|---|
| 9.1 | Structured shift-handover facts; LLM used only for prose, every sentence citing a stored fact | `core/handover.py` (new) |
| 9.2 | Playbook definition and trigger evaluation | `core/playbooks.py` (new) |
| 9.3 | Disruption centre orchestration — decision support only, never autonomous control | `routers/disruption.py` (new) |

---

## Phase 10 — API consolidation  *(spec §44)*

New/consolidated routers: `command_center.py`, `incidents.py`, `response_plans.py`,
`bottlenecks.py`, `playbooks.py`. `decisions.py` extended with approve / reject /
outcome and `decision-memory/similar`. Pagination everywhere; `SELECT *` eliminated
outside the two commented feature-vector cases.

---

## Phase 11 — Frontend component system  *(spec §45, 27)*

`OperationalStateBanner, AttentionQueue, RecommendationCard, ResponsePlanCard,
DecisionComparison, WhatIfChart, EvidenceQuality, ProvenanceBadge, ConstraintSummary,
IncidentTimeline, ShiftHandover, BottleneckCard, DecisionMemoryCard, OutcomeComparison,
ScenarioControlPanel, DecisionPackage, MineContextBar`

Industrial control-room visual language: high density, restrained motion, colour only
where operationally meaningful.

---

## Phase 12 — Command Center and navigation  *(spec §3, 26, 28, 29, 46)*

| Step | Deliverable |
|---|---|
| 12.1 | `/command-center` page, information hierarchy exactly as §26 |
| 12.2 | Default post-login landing set to Command Center |
| 12.3 | Navigation regrouped: COMMAND CENTER / OPERATIONS / EQUIPMENT / EXPLORATION / SCENARIOS / DECISIONS / INCIDENTS, secondary DATA / MODELS / GOVERNANCE / ADMIN |
| 12.4 | Ctrl+K command palette |
| 12.5 | Skeleton loading states, never spinners over stale operational numbers |

---

## Phase 13 — Domain pages re-pointed at decisions  *(spec §17, 18, 19)*

Equipment → production exposure plus simulate options. Exploration → target
prioritisation with why / why-not. Material flow → simulate-removing-this-bottleneck,
pre-populating the scenario panel.

---

## Phase 14 — Query, caching, honesty, hardening  *(spec §30, 34, 41)*

NL intent precedence (fixes "exploration target" misclassified as production);
cache policy additions with correct invalidation; synthetic-data badge; removal of
silent `pass` in critical paths; tests.

---

## Cross-cutting rules

1. Every numeric surfaced to a manager carries `calculation_mode` in
   {MODEL_BACKED, HEURISTIC, INSUFFICIENT_DATA}.
2. No confidence percentage unless it is a calibrated model probability.
3. Missing safety-relevant telemetry means INSUFFICIENT_DATA, never an assumed default.
4. Crucible AI recommends; humans approve. No UI verb implies machine control.
5. Synthetic benchmark data is badged once, clearly, not repeatedly.
