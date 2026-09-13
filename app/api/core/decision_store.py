"""app/api/core/decision_store.py — persistence for the decision loop.

Two properties this module exists to guarantee:

**1. Illegal transitions are refused, not recorded.** The lifecycle is a state
machine with declared edges. Previously any router could write any value into
`lifecycle_state`, and `status` was written separately — which is how rows ended
up marked RECOMMENDED and 'executed' at the same time.

**2. An audit failure fails the operation.** The routers this replaces wrote
their audit entries inside ``try: ... except Exception: pass``. A broken audit
log therefore looked exactly like a working one, and the ledger is the only
thing that makes a decision reconstructable afterwards. Here the audit write
shares the transaction with the state change: if it cannot be recorded, the
change does not happen.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from enum import Enum
from typing import Any

from .db import query, transaction
from .errors import IllegalStateTransition

logger = logging.getLogger("crucible.decision_store")


class LifecycleState(str, Enum):
    DRAFT = "DRAFT"
    SIMULATED = "SIMULATED"
    READY_FOR_REVIEW = "READY_FOR_REVIEW"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    EXECUTING = "EXECUTING"
    COMPLETED = "COMPLETED"
    MEASURED = "MEASURED"
    LEARNED = "LEARNED"


#: Permitted edges. Anything absent is refused.
#:
#: Notable choices:
#: * REJECTED can return to DRAFT — a rejection usually means "not like that",
#:   and forcing a new record would sever the history of what was asked.
#: * APPROVED can reach REJECTED: authorisation can be withdrawn before work starts.
#: * Nothing leaves LEARNED. It is terminal by design; a superseding decision is
#:   a new decision, so the record of what was believed at the time stays intact.
TRANSITIONS: dict[LifecycleState, set[LifecycleState]] = {
    LifecycleState.DRAFT: {LifecycleState.SIMULATED, LifecycleState.REJECTED},
    LifecycleState.SIMULATED: {LifecycleState.READY_FOR_REVIEW, LifecycleState.DRAFT, LifecycleState.REJECTED},
    LifecycleState.READY_FOR_REVIEW: {LifecycleState.APPROVED, LifecycleState.REJECTED, LifecycleState.DRAFT},
    LifecycleState.APPROVED: {LifecycleState.EXECUTING, LifecycleState.REJECTED},
    LifecycleState.REJECTED: {LifecycleState.DRAFT},
    LifecycleState.EXECUTING: {LifecycleState.COMPLETED},
    LifecycleState.COMPLETED: {LifecycleState.MEASURED},
    LifecycleState.MEASURED: {LifecycleState.LEARNED},
    LifecycleState.LEARNED: set(),
}


def can_transition(current: LifecycleState, target: LifecycleState) -> bool:
    return target in TRANSITIONS.get(current, set())


def allowed_from(current: LifecycleState) -> list[str]:
    return sorted(s.value for s in TRANSITIONS.get(current, set()))


@dataclass(frozen=True)
class AuditEntry:
    event_type: str
    actor_id: str
    actor_role: str
    entity_type: str
    entity_id: str
    payload: dict[str, Any]


def _write_audit(tx, entry: AuditEntry) -> None:
    """Audit write inside the caller's transaction.

    Deliberately not wrapped in try/except. A failure here propagates and rolls
    back the whole operation, because an unrecorded state change is worse than
    no state change.
    """
    tx.execute(
        """INSERT INTO gov.audit_log
             (event_type, actor_id, actor_role, entity_type, entity_id, payload)
           VALUES (%s, %s, %s, %s, %s, %s)""",
        (
            entry.event_type,
            entry.actor_id,
            entry.actor_role,
            entry.entity_type,
            entry.entity_id,
            json.dumps(entry.payload, default=str),
        ),
    )


# ---------------------------------------------------------------------------
# Response plans
# ---------------------------------------------------------------------------

def next_plan_ref(tx) -> str:
    rows = tx.query("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM gov.response_plans")
    return f"RP-{rows[0]['n']:06d}"


def create_plan(
    *,
    mine_id: str,
    objective: str,
    situation: str,
    actions: list[dict[str, Any]],
    created_by: str,
    actor_role: str = "system",
    incident_id: int | None = None,
    shift_id: str | None = None,
    root_cause: str | None = None,
    expected_delta_t: float | None = None,
    residual_gap_t: float | None = None,
    calculation_mode: str | None = None,
    evidence_quality: str | None = None,
    evidence_detail: dict | None = None,
    constraints_checked: list | None = None,
    model_version: str | None = None,
    dataset_version: str | None = None,
    scenario_id: str | None = None,
    owner: str | None = None,
) -> dict[str, Any]:
    """Persist a response plan and its ordered actions atomically."""
    with transaction() as tx:
        plan_ref = next_plan_ref(tx)
        rows = tx.query(
            """INSERT INTO gov.response_plans
                 (plan_ref, incident_id, mine_id, shift_id, objective, situation,
                  root_cause, expected_delta_t, residual_gap_t, lifecycle_state,
                  calculation_mode, evidence_quality, evidence_detail, constraints_checked,
                  model_version, dataset_version, scenario_id, owner, created_by)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'SIMULATED',%s,%s,%s,%s,%s,%s,%s,%s,%s)
               RETURNING id, plan_ref, lifecycle_state, created_at""",
            (
                plan_ref, incident_id, mine_id, shift_id, objective, situation,
                root_cause, expected_delta_t, residual_gap_t,
                calculation_mode, evidence_quality,
                json.dumps(evidence_detail or {}, default=str),
                json.dumps(constraints_checked or [], default=str),
                model_version, dataset_version, scenario_id, owner, created_by,
            ),
        )
        plan = rows[0]

        for position, action in enumerate(actions, start=1):
            tx.execute(
                """INSERT INTO gov.response_plan_actions
                     (plan_id, position, intervention_key, title, description, horizon,
                      magnitude, expected_delta_t, cost_inr, cost_basis, risk_delta,
                      calculation_mode, method, tradeoffs, owner)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (
                    plan["id"], position,
                    action["key"], action["title"], action.get("description"),
                    action.get("horizon", "NEXT"),
                    action.get("magnitude"), action.get("expected_delta_t"),
                    action.get("cost_inr"), action.get("cost_basis"),
                    action.get("risk_delta"),
                    action.get("calculation_mode"), action.get("method"),
                    json.dumps(action.get("tradeoffs") or [], default=str),
                    action.get("owner"),
                ),
            )

        _write_audit(
            tx,
            AuditEntry(
                event_type="response_plan.created",
                actor_id=created_by,
                actor_role=actor_role,
                entity_type="response_plan",
                entity_id=plan_ref,
                payload={
                    "mine_id": mine_id,
                    "objective": objective,
                    "action_count": len(actions),
                    "expected_delta_t": expected_delta_t,
                    "calculation_mode": calculation_mode,
                    "evidence_quality": evidence_quality,
                },
            ),
        )

        if incident_id is not None:
            tx.execute(
                """INSERT INTO ops.incident_events
                     (incident_id, event_type, actor_id, description, payload)
                   VALUES (%s,'PLAN_GENERATED',%s,%s,%s)""",
                (
                    incident_id, created_by,
                    f"Response plan {plan_ref} generated with {len(actions)} action(s).",
                    json.dumps({"plan_ref": plan_ref}, default=str),
                ),
            )

    return {"id": plan["id"], "plan_ref": plan["plan_ref"], "lifecycle_state": plan["lifecycle_state"]}


def transition_plan(
    plan_id: int,
    target: LifecycleState,
    *,
    actor_id: str,
    actor_role: str,
    rationale: str | None = None,
    modifications: dict | None = None,
) -> dict[str, Any]:
    """Move a plan to a new state, refusing edges the machine does not permit."""
    with transaction() as tx:
        rows = tx.query(
            """SELECT id, plan_ref, lifecycle_state, incident_id, mine_id
               FROM gov.response_plans WHERE id = %s FOR UPDATE""",
            (plan_id,),
        )
        if not rows:
            raise IllegalStateTransition("Response plan", "UNKNOWN", target.value)

        plan = rows[0]
        current = LifecycleState(plan["lifecycle_state"])

        if not can_transition(current, target):
            raise IllegalStateTransition(
                f"Response plan {plan['plan_ref']}",
                current.value,
                target.value,
                allowed=allowed_from(current),
            )

        tx.execute(
            """UPDATE gov.response_plans
               SET lifecycle_state = %s, updated_at = NOW()
               WHERE id = %s""",
            (target.value, plan_id),
        )

        if target in (LifecycleState.APPROVED, LifecycleState.REJECTED):
            tx.execute(
                """INSERT INTO gov.decision_approvals
                     (plan_id, required_role, decision, actor_id, actor_role,
                      rationale, modifications)
                   VALUES (%s,%s,%s,%s,%s,%s,%s)""",
                (
                    plan_id,
                    actor_role,
                    "MODIFIED" if modifications else target.value,
                    actor_id,
                    actor_role,
                    rationale,
                    json.dumps(modifications, default=str) if modifications else None,
                ),
            )

        _write_audit(
            tx,
            AuditEntry(
                event_type=f"response_plan.{target.value.lower()}",
                actor_id=actor_id,
                actor_role=actor_role,
                entity_type="response_plan",
                entity_id=plan["plan_ref"],
                payload={
                    "from": current.value,
                    "to": target.value,
                    "rationale": rationale,
                    "modifications": modifications,
                },
            ),
        )

        if plan["incident_id"] is not None:
            event_type = {
                LifecycleState.APPROVED: "PLAN_APPROVED",
                LifecycleState.REJECTED: "PLAN_REJECTED",
                LifecycleState.EXECUTING: "ACTION_STARTED",
                LifecycleState.COMPLETED: "ACTION_COMPLETED",
                LifecycleState.MEASURED: "OUTCOME_RECORDED",
            }.get(target)
            if event_type:
                tx.execute(
                    """INSERT INTO ops.incident_events
                         (incident_id, event_type, actor_id, description, payload)
                       VALUES (%s,%s,%s,%s,%s)""",
                    (
                        plan["incident_id"], event_type, actor_id,
                        f"Plan {plan['plan_ref']}: {current.value} to {target.value}.",
                        json.dumps({"rationale": rationale}, default=str),
                    ),
                )

    return {
        "plan_id": plan_id,
        "plan_ref": plan["plan_ref"],
        "from": current.value,
        "to": target.value,
    }


def get_plan(plan_id: int) -> dict[str, Any] | None:
    rows = query(
        """SELECT id, plan_ref, incident_id, mine_id, shift_id, objective, situation,
                  root_cause, expected_delta_t, residual_gap_t, lifecycle_state,
                  calculation_mode, evidence_quality, evidence_detail, constraints_checked,
                  model_version, dataset_version, scenario_id, owner,
                  created_by, created_at, updated_at
           FROM gov.response_plans WHERE id = %s""",
        (plan_id,),
    )
    if not rows:
        return None

    plan = rows[0]
    plan["actions"] = query(
        """SELECT id, position, intervention_key, title, description, horizon,
                  magnitude, expected_delta_t, cost_inr, cost_basis, risk_delta,
                  calculation_mode, method, tradeoffs, owner, status,
                  started_at, completed_at, completed_by, note
           FROM gov.response_plan_actions
           WHERE plan_id = %s ORDER BY position""",
        (plan_id,),
    )
    plan["approvals"] = query(
        """SELECT required_role, decision, actor_id, actor_role, rationale,
                  modifications, decided_at
           FROM gov.decision_approvals
           WHERE plan_id = %s ORDER BY decided_at""",
        (plan_id,),
    )
    return plan


def list_plans(
    mine_id: str,
    *,
    lifecycle_state: str | None = None,
    limit: int = 25,
    offset: int = 0,
) -> dict[str, Any]:
    """Paginated. The endpoints this replaces returned unbounded result sets."""
    limit = max(1, min(limit, 100))

    where = ["mine_id = %s"]
    params: list[Any] = [mine_id]
    if lifecycle_state:
        where.append("lifecycle_state = %s")
        params.append(lifecycle_state)
    clause = " AND ".join(where)

    total = query(f"SELECT COUNT(*) AS c FROM gov.response_plans WHERE {clause}", tuple(params))[0]["c"]
    rows = query(
        f"""SELECT id, plan_ref, incident_id, mine_id, objective, situation,
                   expected_delta_t, residual_gap_t, lifecycle_state,
                   calculation_mode, evidence_quality, owner, created_by, created_at
            FROM gov.response_plans
            WHERE {clause}
            ORDER BY created_at DESC
            LIMIT %s OFFSET %s""",
        tuple(params) + (limit, offset),
    )
    return {
        "items": rows,
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": offset + len(rows) < total,
    }


__all__ = [
    "AuditEntry",
    "LifecycleState",
    "TRANSITIONS",
    "allowed_from",
    "can_transition",
    "create_plan",
    "get_plan",
    "list_plans",
    "transition_plan",
]
