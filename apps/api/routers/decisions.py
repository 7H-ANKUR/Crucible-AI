"""apps/api/routers/decisions.py — Decision Memory, State Machine & Task-Aware Outcome Tracking.

Endpoints:
  GET  /api/v1/decisions              — list decisions with recorded outcomes and lifecycle state
  POST /api/v1/decisions              — create a decision (starts in RECOMMENDED or UNDER_REVIEW)
  POST /api/v1/decisions/{id}/review  — review decision (approve or reject)
  POST /api/v1/decisions/{id}/execute — mark decision as executed in the field
  POST /api/v1/decisions/{id}/outcome — record realized outcome, calculate task-aware metrics
  GET  /api/v1/decisions/{id}         — get single decision detail + history
"""
import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core.db import query, transaction
from ..core.rbac import require_any_role, require_authenticated
from ..core.security import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(tags=["decisions"])


class CreateDecisionRequest(BaseModel):
    problem: str
    prediction_id: int | None = None
    recommendation: str
    status: str | None = "recommended"
    lifecycle_state: str = "RECOMMENDED"  # RECOMMENDED | UNDER_REVIEW | APPROVED


class ReviewDecisionRequest(BaseModel):
    action: str  # approve | reject
    note: str | None = None


class RecordOutcomeRequest(BaseModel):
    predicted_value: float
    actual_value: float
    metric_type: str | None = "generic"  # production_forecast | shortfall | equipment_failure | exploration
    details: dict | None = None
    note: str | None = None


@router.get("")
def list_decisions(lifecycle_state: str | None = None, user=Depends(get_current_user)):
    """List decisions with their post-shift actual outcomes, effectiveness, and state machine progress."""
    sql = """
        SELECT d.id, d.problem, d.prediction_id, d.recommendation, d.decided_by,
               d.decided_at, d.status, d.lifecycle_state, d.reviewed_by, d.reviewed_at,
               d.executed_by, d.executed_at, d.data_origin,
               o.id as outcome_id, o.predicted_value, o.actual_value, o.delta,
               o.effectiveness, o.metric_type, o.metric_details, o.recorded_at
        FROM gov.decisions d
        LEFT JOIN gov.decision_outcomes o ON d.id = o.decision_id
        WHERE 1=1
    """
    params = []
    if lifecycle_state:
        sql += " AND d.lifecycle_state = %s"
        params.append(lifecycle_state.upper())
    sql += " ORDER BY d.decided_at DESC LIMIT 50"

    rows = query(sql, params)
    return {
        "decisions": rows,
        "count": len(rows),
        "data_origin": "DERIVED",
    }


@router.get("/{decision_id}")
def get_decision(decision_id: int, user=Depends(get_current_user)):
    """Get single decision detail with outcome feedback."""
    rows = query(
        """SELECT d.*, o.id as outcome_id, o.predicted_value, o.actual_value,
                  o.delta, o.effectiveness, o.metric_type, o.metric_details, o.recorded_at
           FROM gov.decisions d
           LEFT JOIN gov.decision_outcomes o ON d.id = o.decision_id
           WHERE d.id = %s""",
        (decision_id,)
    )
    if not rows:
        raise HTTPException(404, f"Decision {decision_id} not found.")
    return {"decision": rows[0]}


@router.post("")
def record_decision(
    body: CreateDecisionRequest,
    user=Depends(require_authenticated()),
):
    """Record a proposed operational intervention into governed memory."""
    state = body.lifecycle_state.upper()
    if body.status and body.status.lower() == "approved":
        state = "APPROVED"
    if state == "APPROVED":
        # Only admins can create directly in APPROVED state
        if user.get("role") not in ("super_admin", "management", "production_admin", "equipment_admin", "exploration_admin"):
            state = "RECOMMENDED"
    elif state not in ("RECOMMENDED", "UNDER_REVIEW"):
        state = "RECOMMENDED"

    with transaction() as tx:
        rows = tx.query(
            """INSERT INTO gov.decisions
               (problem, prediction_id, recommendation, decided_by, status, lifecycle_state, data_origin)
               VALUES (%s, %s, %s, %s, %s, %s, 'DERIVED')
               RETURNING id, decided_at""",
            (body.problem, body.prediction_id, body.recommendation, user["username"], state.lower(), state)
        )
        decision_id = rows[0]["id"]

        try:
            audit_payload = json.dumps({
                "problem": body.problem,
                "recommendation": body.recommendation,
                "prediction_id": body.prediction_id,
                "initial_state": state
            })
            tx.execute(
                """INSERT INTO gov.audit_log (event_type, actor_id, actor_role, entity_type, entity_id, payload)
                   VALUES ('decision_created', %s, %s, 'decision', %s, %s)""",
                (user["username"], user.get("role", "operator"), str(decision_id), audit_payload)
            )
        except Exception as e:
            logger.error("Failed to write audit log for decision_created %s: %s", decision_id, e)

    return {
        "decision_id":     decision_id,
        "lifecycle_state": state,
        "decided_by":      user["username"],
        "message":         f"Operational decision recorded in state {state}.",
    }


@router.post("/{decision_id}/review")
def review_decision(
    decision_id: int,
    body: ReviewDecisionRequest,
    user=Depends(require_any_role(["super_admin", "management", "production_admin", "equipment_admin", "exploration_admin"])),
):
    """Review an intervention: approve or reject."""
    with transaction() as tx:
        dec = tx.query("SELECT id, lifecycle_state FROM gov.decisions WHERE id=%s FOR UPDATE", (decision_id,))
        if not dec:
            raise HTTPException(404, f"Decision {decision_id} not found.")

        current_state = dec[0]["lifecycle_state"]
        if current_state not in ("RECOMMENDED", "UNDER_REVIEW"):
            raise HTTPException(
                422,
                f"Cannot review decision in state '{current_state}'. Only 'RECOMMENDED' or 'UNDER_REVIEW' decisions can be reviewed."
            )

        target_state = "APPROVED" if body.action.lower() == "approve" else "REJECTED"
        tx.execute(
            """UPDATE gov.decisions
               SET lifecycle_state=%s, status=%s, reviewed_by=%s, reviewed_at=NOW()
               WHERE id=%s""",
            (target_state, target_state.lower(), user["username"], decision_id)
        )
        try:
            audit_payload = json.dumps({
                "action": target_state,
                "note": body.note or "",
                "previous_state": current_state
            })
            tx.execute(
                """INSERT INTO gov.audit_log (event_type, actor_id, actor_role, entity_type, entity_id, payload)
                   VALUES ('decision_reviewed', %s, %s, 'decision', %s, %s)""",
                (user["username"], user.get("role", "operator"), str(decision_id), audit_payload)
            )
        except Exception as e:
            logger.error("Failed to write audit log for decision_reviewed %s: %s", decision_id, e)

    return {
        "decision_id":     decision_id,
        "lifecycle_state": target_state,
        "reviewed_by":     user["username"],
        "message":         f"Decision marked as {target_state}.",
    }


@router.post("/{decision_id}/execute")
def execute_decision(
    decision_id: int,
    user=Depends(require_any_role(["super_admin", "management", "production_admin", "equipment_admin", "mine_planner"])),
):
    """Mark an approved intervention as dispatched/executed in the mine field."""
    with transaction() as tx:
        dec = tx.query("SELECT id, lifecycle_state FROM gov.decisions WHERE id=%s FOR UPDATE", (decision_id,))
        if not dec:
            raise HTTPException(404, f"Decision {decision_id} not found.")

        if dec[0]["lifecycle_state"] != "APPROVED":
            raise HTTPException(422, f"Can only execute APPROVED decisions. Current state: {dec[0]['lifecycle_state']}")

        tx.execute(
            """UPDATE gov.decisions
               SET lifecycle_state='EXECUTED', status='executed', executed_by=%s, executed_at=NOW()
               WHERE id=%s""",
            (user["username"], decision_id)
        )
        try:
            audit_payload = json.dumps({
                "action": "EXECUTED",
                "dispatched_by": user["username"],
                "note": "Dispatched to field operations"
            })
            tx.execute(
                """INSERT INTO gov.audit_log (event_type, actor_id, actor_role, entity_type, entity_id, payload)
                   VALUES ('decision_executed', %s, %s, 'decision', %s, %s)""",
                (user["username"], user.get("role", "operator"), str(decision_id), audit_payload)
            )
        except Exception as e:
            logger.error("Failed to write audit log for decision_executed %s: %s", decision_id, e)

    return {
        "decision_id":     decision_id,
        "lifecycle_state": "EXECUTED",
        "executed_by":     user["username"],
        "message":         "Decision executed in operational field.",
    }


@router.post("/{decision_id}/outcome")
def record_outcome(
    decision_id: int,
    body: RecordOutcomeRequest,
    user=Depends(require_any_role(["super_admin", "management", "production_admin", "equipment_admin", "mine_planner"])),
):
    """
    Record post-shift actual outcome for a decision to calculate task-aware effectiveness.
    State requirement: Can only record outcomes for EXECUTED (or APPROVED) decisions.
    Evaluates:
      - Production: Absolute variance and realization ratio.
      - Shortfall: Predicted probability vs actual event occurrence.
      - Equipment: Predicted failure vs realized uptime.
    """
    delta = round(body.actual_value - body.predicted_value, 2)

    # Task-aware effectiveness calculation
    m_type = body.metric_type or "generic"
    calc_details = body.details or {}

    if m_type == "production_forecast":
        abs_err = abs(delta)
        pct_err = round(abs_err / max(abs(body.predicted_value), 1.0) * 100, 2)
        effectiveness = round(max(0.0, 1.0 - (abs_err / max(abs(body.predicted_value), 1.0))), 3)
        calc_details.update({"absolute_error_tonnes": abs_err, "percentage_error": pct_err})
    elif m_type == "shortfall":
        # actual_value: 0 (no shortfall) or 1 (shortfall occurred)
        hit = int(body.actual_value == (1 if body.predicted_value >= 0.3 else 0))
        effectiveness = 1.0 if hit else 0.0
        calc_details.update({"shortfall_hit": hit, "brier_score": round((body.predicted_value - body.actual_value)**2, 4)})
    elif m_type == "equipment_failure":
        hit = int(body.actual_value == (1 if body.predicted_value >= 0.5 else 0))
        effectiveness = 1.0 if hit else 0.0
        calc_details.update({"prediction_hit": hit})
    else:
        effectiveness = round(body.actual_value / max(body.predicted_value, 1.0), 3) if abs(body.predicted_value) > 0.001 else 1.0

    # Clamp effectiveness to [0.0, 1.0] for DB CHECK constraint safety
    effectiveness = max(0.0, min(1.0, effectiveness))

    with transaction() as tx:
        dec = tx.query("SELECT id, lifecycle_state FROM gov.decisions WHERE id=%s FOR UPDATE", (decision_id,))
        if not dec:
            raise HTTPException(404, f"Decision {decision_id} not found.")

        current_state = dec[0]["lifecycle_state"]
        if current_state not in ("EXECUTED", "APPROVED"):
            raise HTTPException(
                422,
                f"Can only record outcomes for 'EXECUTED' (or 'APPROVED') decisions. Current state: '{current_state}'."
            )

        outcome_rows = tx.query(
            """INSERT INTO gov.decision_outcomes
               (decision_id, predicted_value, actual_value, delta, effectiveness, metric_type, metric_details, data_origin)
               VALUES (%s, %s, %s, %s, %s, %s, %s, 'REAL_USER_UPLOADED')
               RETURNING id, recorded_at""",
            (decision_id, body.predicted_value, body.actual_value, delta, effectiveness, m_type, json.dumps(calc_details))
        )

        # Advance state to OUTCOME_RECORDED
        tx.execute("UPDATE gov.decisions SET lifecycle_state='OUTCOME_RECORDED', status='executed' WHERE id=%s", (decision_id,))

        # Audit log
        try:
            audit_payload = json.dumps({
                "decision_id": decision_id,
                "predicted_value": body.predicted_value,
                "actual_value": body.actual_value,
                "delta": delta,
                "effectiveness": effectiveness,
                "metric_type": m_type
            })
            tx.execute(
                """INSERT INTO gov.audit_log (event_type, actor_id, actor_role, entity_type, entity_id, payload)
                   VALUES ('outcome_recorded', %s, %s, 'decision_outcome', %s, %s)""",
                (
                    user["username"],
                    user.get("role", "operator"),
                    str(outcome_rows[0]["id"]),
                    audit_payload,
                )
            )
        except Exception as e:
            logger.error("Failed to write audit log for outcome_recorded %s: %s", outcome_rows[0]["id"], e)

    return {
        "outcome_id":      outcome_rows[0]["id"],
        "decision_id":     decision_id,
        "predicted_value": body.predicted_value,
        "actual_value":    body.actual_value,
        "delta":           delta,
        "effectiveness":   effectiveness,
        "metric_type":     m_type,
        "metric_details":  calc_details,
        "status":          "executed",
        "lifecycle_state": "OUTCOME_RECORDED",
        "message":         f"Outcome recorded: {delta:+.1f} variance, effectiveness {effectiveness*100:.1f}%.",
    }
