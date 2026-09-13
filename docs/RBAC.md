# Crucible AI Role-Based Access Control (RBAC) Specification

## 1. Role Hierarchy & Principles

Crucible AI enforces strict zero-trust Role-Based Access Control (RBAC) across all mutation and decision endpoints. Read operations default to guest or authenticated roles, while all operational interventions, dataset approvals, and model promotions are protected by dedicated guards in `app/api/core/rbac.py`.

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

---

## Mine-level isolation

Role checks answer *what* a user may do. Mine scoping answers *where*. Both must
hold.

### The hole this closed

`check_mine_access` ended in a bare `return True`, and no Clerk user carries mine
scoping in `publicMetadata` — so the fallthrough was the only path anyone took,
and **every authenticated user reached every mine in the platform**. Mine-level
isolation was failing open in its entirety.

### Current behaviour

Resolution order in `core/rbac.check_mine_access`:

1. `super_admin` — all mines.
2. `allowed_mines` present in Clerk `publicMetadata` — enforced. `"*"` or `"all"` grants all.
3. `mine_id` present — that mine only.
4. **Unscoped** — refused when `ENVIRONMENT=production`; permitted elsewhere with
   a WARNING logged once per user.

An unscoped account in production is a misconfiguration, and the safe reading of
a misconfiguration is "no access", not "all access".

### Granting access

```json
{ "role": "production_admin", "allowed_mines": ["MH-NAGPUR-01", "MP-BALAGHAT-01"] }
```

Set in the user's Clerk `publicMetadata`. A comma-separated string is also accepted.

### Mine context is resolved by the backend

`core/mine_context.resolve_mine_context(mine_id, user)` never trusts a
frontend-supplied `mine_id` beyond treating it as a *request*. It authorises it,
and raises `MineContextRequired` rather than substituting one.

Endpoints previously declared `mine_id: str = "mine-01"`, so a caller that
omitted the parameter received a confident, fully-populated answer about a mine
it had not asked for and might not be authorised to see. Nothing about the
response looked wrong. That default is gone.

**An unauthorised mine returns the same shape as an unknown mine.** Telling a
caller that a mine exists is itself a disclosure.

### Approval authority

A response plan is approved as a whole, so the **strictest action governs**: a
plan containing a maintenance deferral requires the equipment approver even if
its other actions do not. Otherwise the role model could be bypassed by bundling.

Declared per action in `core/scenario/catalogue.py` as `approval_roles`.

### Audit

Every role change, approval and lifecycle transition writes to `gov.audit_log`
**inside the same transaction as the change**. An audit write that fails rolls
back the operation — the routers this replaced used `except Exception: pass`, so
a broken audit log was indistinguishable from a working one.
