# MINEx Role-Based Access Control (RBAC) Specification

## 1. Role Hierarchy & Principles

MINEx enforces strict zero-trust Role-Based Access Control (RBAC) across all mutation and decision endpoints. Read operations default to guest or authenticated roles, while all operational interventions, dataset approvals, and model promotions are protected by dedicated guards in `apps/api/core/rbac.py`.

```
                    ┌─────────────────────────┐
                    │       super_admin       │ (Full Platform Control)
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │        management       │ (Executive / Cross-Domain Read & Decisions)
                    └────────────┬────────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         │                       │                       │
┌────────▼───────────┐ ┌─────────▼───────────┐ ┌─────────▼───────────┐
│  production_admin  │ │  equipment_admin    │ │  exploration_admin  │
│  (Shift Operations)│ │  (Fleet Maint & PM) │ │  (Geology & Assays) │
└────────┬───────────┘ └─────────┬───────────┘ └─────────┬───────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │      mine_planner       │ (Scenario Simulation & Planning)
                    └─────────────────────────┘
```

---

## 2. Permission Matrix

| Capability / Action | `super_admin` | `management` | `production_admin` | `equipment_admin` | `exploration_admin` | `mine_planner` |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **View Dashboards & Ledger** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Simulate Scenarios** | ✓ | ✓ | ✓ | — | — | ✓ |
| **Acknowledge Alerts** | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| **Upload Dataset to Data Hub** | ✓ | — | ✓ (Prod) | ✓ (Equip) | ✓ (Geo) | — |
| **Approve Dataset for Training**| ✓ | — | ✓ (Prod) | ✓ (Equip) | ✓ (Geo) | — |
| **Trigger ML Training Run** | ✓ | — | ✓ (Prod) | ✓ (Equip) | ✓ (Geo) | — |
| **Approve Challenger Model** | ✓ | — | ✓ (Prod) | ✓ (Equip) | ✓ (Geo) | — |
| **Promote Model to Champion** | ✓ | — | ✓ (Prod) | ✓ (Equip) | ✓ (Geo) | — |
| **Emergency Model Rollback** | ✓ | — | — | — | — | — |
| **Record Governed Decision** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Record Post-Shift Outcome** | ✓ | ✓ | ✓ | — | — | — |

---

## 3. Enforcement Implementation

- Protected FastAPI routes utilize `Depends(require_role(...))` or `Depends(require_any_role(...))`.
- When an unauthorized role attempts a privileged action, the API returns `HTTP 403 Forbidden` with an explicit reason string.
- When an unauthenticated client accesses a protected endpoint, the API returns `HTTP 401 Unauthorized`.
- Every privileged action automatically writes an immutable entry to `gov.audit_log` recording `(event_type, actor_id, actor_role, entity_id, payload)`.
