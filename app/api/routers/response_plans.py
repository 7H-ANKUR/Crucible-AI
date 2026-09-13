"""app/api/routers/response_plans.py — the approve / act / measure half of the loop.

Detection and recommendation are read-only. This is where a human commits, so
every endpoint here is a write with an authorisation check, a state-machine
transition and an audit entry that shares the transaction.

Three rules the routes enforce:

* **Crucible AI never executes.** `/start` records that a person has begun the work.
  It does not dispatch anything, and no verb in this module implies otherwise.
* **Approval is role-gated per action.** A plan containing a maintenance deferral
  needs the equipment approver, not just any manager — the catalogue declares
  which roles each action requires, and the check reads that.
* **An unauthorised approval is refused before the transition, not after.**
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from ..core.decision_memory import similar
from ..core.decision_store import (
    LifecycleState,
    allowed_from,
    get_plan,
    list_plans,
    transition_plan,
)
from ..core.errors import ConstraintViolation, InsufficientData, CrucibleError
from ..core.mine_context import MineContext, mine_context, resolve_mine_context
from ..core.rbac import check_mine_access, require_authenticated
from ..core.response_plan import generate as generate_plan
from ..core.scenario import ScenarioObjective
from ..core.scenario.catalogue import spec as catalogue_spec
from ..core.security import get_current_user

logger = logging.getLogger("crucible.response_plans")
router = APIRouter(tags=["response-plans"])


class GenerateRequest(BaseModel):
    mine_id: str | None = None
    item_key: str | None = None
    objective: ScenarioObjective = ScenarioObjective.BALANCED
    incident_id: int | None = None


class DecisionRequest(BaseModel):
    rationale: str | None = Field(
        default=None,
        description="Why. Required on rejection — a refusal with no reason cannot be learned from.",
    )
    modifications: dict | None = Field(
        default=None,
        description="Changes the approver made, when approving something other than what was proposed.",
    )


class OutcomeRequest(BaseModel):
    actual_value: float = Field(..., description="What was actually achieved, tonnes.")
    variance_reason: str | None = Field(
        default=None, description="Why the result differed from the prediction."
    )
    metric_type: str = "production_t"


def _identity(user) -> tuple[str, str]:
    if isinstance(user, dict):
        return (
            user.get("username") or user.get("email") or "user",
            user.get("role", "guest"),
        )
    return getattr(user, "username", "user"), getattr(user, "role", "guest")


def _require_plan(plan_id: int, user) -> dict:
    plan = get_plan(plan_id)
    if plan is None:
        raise InsufficientData(
            f"No response plan with id {plan_id} exists.",
            required_for="plan lookup",
        )
    if not check_mine_access(user, plan["mine_id"]):
        # Same shape as "not found": confirming a plan exists at a mine the
        # caller cannot see is itself a disclosure.
        raise InsufficientData(
            f"No response plan with id {plan_id} exists.",
            required_for="plan lookup",
        )
    return plan


def _check_approval_authority(plan: dict, role: str) -> None:
    """Every action in the plan must be approvable by this role.

    A plan is approved as a whole, so the strictest action governs. Approving a
    plan containing a maintenance deferral without the equipment authority would
    let the roles be bypassed by bundling.
    """
    if role == "super_admin":
        return

    required: set[str] = set()
    for action in plan.get("actions") or []:
        spec = catalogue_spec(action["intervention_key"])
        if spec:
            required.update(spec.approval_roles)

    if not required or role in required:
        return

    raise ConstraintViolation(
        f"Role '{role}' cannot approve this plan. It contains actions requiring "
        f"one of: {', '.join(sorted(required))}.",
        constraint="approval_authority",
        evidence=f"plan {plan['plan_ref']} actions: "
        + ", ".join(a["intervention_key"] for a in plan.get("actions") or []),
    )


# ---------------------------------------------------------------------------
# Read
# ---------------------------------------------------------------------------

@router.get("", summary="List response plans for a mine")
def list_for_mine(
    ctx: MineContext = Depends(mine_context),
    lifecycle_state: str | None = None,
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    return list_plans(
        ctx.mine_id, lifecycle_state=lifecycle_state, limit=limit, offset=offset
    )


@router.get("/{plan_id}", summary="One plan with its actions and approvals")
def read(plan_id: int, user=Depends(require_authenticated())):
    plan = _require_plan(plan_id, user)
    current = LifecycleState(plan["lifecycle_state"])
    plan["allowed_transitions"] = allowed_from(current)
    return plan


@router.get("/{plan_id}/precedent", summary="What happened last time")
def precedent(plan_id: int, user=Depends(require_authenticated())):
    """Decision memory for this plan's actions.

    Answers "we have been here before — did it work?", which a manager tends to
    trust more than a model prediction, because it is about their own mine.
    """
    plan = _require_plan(plan_id, user)
    return {
        "plan_ref": plan["plan_ref"],
        "per_action": [
            {
                "intervention_key": action["intervention_key"],
                "title": action["title"],
                "memory": similar(
                    mine_id=plan["mine_id"],
                    intervention_key=action["intervention_key"],
                    problem=action["title"],
                    limit=3,
                ).as_dict(),
            }
            for action in plan.get("actions") or []
        ],
    }


# ---------------------------------------------------------------------------
# Write
# ---------------------------------------------------------------------------

@router.post("", summary="Generate and file a response plan")
def create(body: GenerateRequest, user=Depends(require_authenticated())):
    """Generates a plan and persists it so it can be approved and tracked."""
    ctx = resolve_mine_context(body.mine_id, user)
    username, role = _identity(user)

    plan = generate_plan(
        ctx.mine_id,
        item_key=body.item_key,
        location=ctx.location,
        objective=body.objective,
        created_by=username,
        actor_role=role,
        persist=True,
        incident_id=body.incident_id,
    )

    if not plan.get("available"):
        raise InsufficientData(
            plan.get("reason") or "No response plan could be generated.",
            required_for="response plan generation",
            remedy="Nothing currently requires attention at this mine.",
        )

    if plan.get("persisted") is False:
        # Surfaced rather than swallowed: an unsaved plan cannot be approved or
        # tracked, so a caller that believes it was saved is holding a plan that
        # will silently vanish.
        raise CrucibleError(
            plan.get("persist_error")
            or "The plan was generated but could not be saved.",
        )

    return plan


@router.post("/{plan_id}/submit", summary="Put a plan forward for a decision")
def submit(plan_id: int, user=Depends(require_authenticated())):
    plan = _require_plan(plan_id, user)
    username, role = _identity(user)
    return transition_plan(
        plan["id"], LifecycleState.READY_FOR_REVIEW, actor_id=username, actor_role=role
    )


@router.post("/{plan_id}/approve", summary="Authorise a plan")
def approve(plan_id: int, body: DecisionRequest, user=Depends(require_authenticated())):
    plan = _require_plan(plan_id, user)
    username, role = _identity(user)
    _check_approval_authority(plan, role)

    return transition_plan(
        plan["id"],
        LifecycleState.APPROVED,
        actor_id=username,
        actor_role=role,
        rationale=body.rationale,
        modifications=body.modifications,
    )


@router.post("/{plan_id}/reject", summary="Decline a plan")
def reject(plan_id: int, body: DecisionRequest, user=Depends(require_authenticated())):
    plan = _require_plan(plan_id, user)
    username, role = _identity(user)

    if not body.rationale:
        raise InsufficientData(
            "A rejection needs a reason.",
            missing=["rationale"],
            required_for="rejecting a response plan",
            remedy=(
                "State why the plan was declined. A refusal with no reason cannot "
                "inform the next one."
            ),
        )

    return transition_plan(
        plan["id"],
        LifecycleState.REJECTED,
        actor_id=username,
        actor_role=role,
        rationale=body.rationale,
    )


@router.post("/{plan_id}/start", summary="Record that work has begun")
def start(plan_id: int, user=Depends(require_authenticated())):
    """Records a human starting the work. Crucible AI dispatches nothing."""
    plan = _require_plan(plan_id, user)
    username, role = _identity(user)
    return transition_plan(
        plan["id"], LifecycleState.EXECUTING, actor_id=username, actor_role=role
    )


@router.post("/{plan_id}/complete", summary="Record that work is finished")
def complete(plan_id: int, user=Depends(require_authenticated())):
    plan = _require_plan(plan_id, user)
    username, role = _identity(user)
    return transition_plan(
        plan["id"], LifecycleState.COMPLETED, actor_id=username, actor_role=role
    )


@router.post("/{plan_id}/outcome", summary="Record what actually happened")
def outcome(plan_id: int, body: OutcomeRequest, user=Depends(require_authenticated())):
    """Close the loop: predicted against actual, and the error between them.

    This is what makes the platform improvable. Without it Crucible AI accumulates
    predictions nobody ever checked.
    """
    from ..core.db import transaction

    plan = _require_plan(plan_id, user)
    username, role = _identity(user)

    predicted = plan.get("expected_delta_t")
    if predicted is None:
        raise InsufficientData(
            f"Plan {plan['plan_ref']} has no predicted effect, so an outcome cannot "
            "be compared against it.",
            required_for="outcome tracking",
        )

    predicted = float(predicted)
    delta = body.actual_value - predicted
    variance_pct = (100.0 * delta / predicted) if predicted else None
    # Bounded at 1: a result that beat the prediction is not "160% effective",
    # it is a prediction that was low, and the variance already says so.
    effectiveness = (
        max(0.0, min(1.0, body.actual_value / predicted)) if predicted > 0 else None
    )

    with transaction() as tx:
        tx.execute(
            """INSERT INTO gov.decision_outcomes
                 (decision_id, plan_id, predicted_value, actual_value, delta,
                  variance_pct, variance_reason, effectiveness, metric_type,
                  calculation_mode, model_version, recorded_by)
               VALUES (NULL,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            (
                plan_id, predicted, body.actual_value, delta,
                variance_pct, body.variance_reason, effectiveness, body.metric_type,
                plan.get("calculation_mode"), plan.get("model_version"), username,
            ),
        )

    transition_plan(
        plan["id"],
        LifecycleState.MEASURED,
        actor_id=username,
        actor_role=role,
        rationale=body.variance_reason,
    )

    return {
        "plan_ref": plan["plan_ref"],
        "predicted_t": round(predicted, 1),
        "actual_t": round(body.actual_value, 1),
        "delta_t": round(delta, 1),
        "variance_pct": round(variance_pct, 1) if variance_pct is not None else None,
        "effectiveness": round(effectiveness, 3) if effectiveness is not None else None,
        "variance_reason": body.variance_reason,
        "note": (
            "Effectiveness is actual over predicted: it measures how well Crucible AI "
            "forecast this result, not whether the decision was a good one."
        ),
        "lifecycle_state": LifecycleState.MEASURED.value,
    }
