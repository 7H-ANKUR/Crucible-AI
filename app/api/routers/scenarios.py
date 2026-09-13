"""app/api/routers/scenarios.py — HTTP surface over the canonical scenario engine.

This router holds no evaluation logic. It previously carried its own copies of
`_latest_features`, `_HEURISTIC`, `_ADJUSTABLE` and `_model_delta`, byte-identical
to `core/scenario_engine.py` and overlapping with `core/optimizer.py`; three
implementations that had already drifted apart in what they named things. All of
it now lives in `core/scenario/`.

Endpoints:

* ``POST /run``            — evaluate a caller-specified list of interventions
* ``POST /evaluate``       — evaluate from manager-facing controls
* ``GET  /optimise/{mine}`` — rank every catalogue action for a mine
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..core.db import execute
from ..core.errors import InsufficientData
from ..core.mine_context import MineContext, resolve_mine_context
from ..core.provenance import CalculationMode
from ..core.rbac import require_authenticated
from ..core.scenario import (
    Flexibility,
    RiskTolerance,
    ScenarioControls,
    ScenarioObjective,
    build_context,
    evaluate_intervention,
    run_scenario,
    spec as catalogue_spec,
)
from ..core.scenario.ranking import rank
from ..core.scenario.serialize import intervention_payload, scenario_payload

logger = logging.getLogger("crucible.scenarios")
router = APIRouter(tags=["scenarios"])


# ---------------------------------------------------------------------------
# Request shapes
# ---------------------------------------------------------------------------

class InterventionRequest(BaseModel):
    type: str
    magnitude: float | None = Field(default=None, ge=0.0, le=0.30)
    shift: str | None = None
    equipment_id: str | None = None


class ScenarioRunRequest(BaseModel):
    mine_id: str | None = None
    interventions: list[InterventionRequest] = Field(default_factory=list)
    objective: ScenarioObjective = ScenarioObjective.BALANCED
    notes: str | None = None


class ScenarioControlsRequest(BaseModel):
    """Manager-facing controls.

    `max_additional_fuel_pct` was previously labelled "Fleet Fuel Surge Tolerance"
    in the UI, which is not a phrase a mine manager uses. It is the ceiling on
    extra fuel the scenario may spend in exchange for production.
    """

    mine_id: str | None = None
    objective: ScenarioObjective = ScenarioObjective.BALANCED
    max_additional_fuel_pct: float = Field(default=10.0, ge=0.0, le=30.0)
    fleet_reallocation: Flexibility = Flexibility.MEDIUM
    route_flexibility: Flexibility = Flexibility.MEDIUM
    maintenance_flexibility: Flexibility = Flexibility.NONE
    operating_time_flexibility: Flexibility = Flexibility.NONE
    risk_tolerance: RiskTolerance = RiskTolerance.BALANCED
    max_actions: int = Field(default=3, ge=1, le=6)


def _username(user) -> str:
    if isinstance(user, dict):
        return user.get("username") or user.get("email") or "user"
    return getattr(user, "username", "user")


def _record_prediction(payload: dict, task: str) -> None:
    """Write the scenario to the prediction ledger.

    A failure here is logged, not swallowed. The previous ``except Exception:
    pass`` meant a silently broken ledger looked identical to a working one, and
    the ledger is what makes a decision reconstructable afterwards.
    """
    projected = payload["scenario"]["production_t"]
    if projected is None:
        return
    try:
        execute(
            """INSERT INTO ml.predictions
               (task, entity_id, model_version, prediction_value, confidence_tier,
                top_driver_1, data_origin)
               VALUES (%s,%s,%s,%s,%s,%s,%s)""",
            (
                task,
                payload["scenario_id"],
                payload.get("model_version") or "unknown",
                projected,
                (payload.get("evidence") or {}).get("quality", "UNAVAILABLE"),
                (payload["actions_applied"][0]["key"] if payload["actions_applied"] else None),
                payload.get("data_origin") or "SYNTHETIC",
            ),
        )
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "Prediction ledger write failed for scenario %s: %s",
            payload["scenario_id"], exc,
        )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/run", summary="Evaluate specified interventions")
def run(body: ScenarioRunRequest, user=Depends(require_authenticated())):
    ctx_mine: MineContext = resolve_mine_context(body.mine_id, user)
    ctx = build_context(ctx_mine.mine_id, location=ctx_mine.location)

    if ctx.baseline_production_t is None:
        raise InsufficientData(
            f"No production history is recorded for {ctx_mine.mine_id}, so there is "
            "no baseline to simulate against.",
            missing=["ops.production_records"],
            required_for="scenario simulation",
            remedy="Upload production data for this mine through the Data Hub.",
        )

    outcomes = []
    for item in body.interventions:
        spec = catalogue_spec(item.type)
        if spec is None:
            raise InsufficientData(
                f"'{item.type}' is not a known intervention.",
                missing=[item.type],
                required_for="scenario simulation",
                remedy="Choose an action from GET /scenarios/catalogue.",
            )
        extra = {}
        if item.shift:
            extra["shift"] = item.shift
        if item.equipment_id:
            extra["equipment_id"] = item.equipment_id
        outcomes.append(
            evaluate_intervention(
                spec,
                ctx,
                item.magnitude if item.magnitude is not None else 0.10,
                extra_constraint_inputs=extra,
            )
        )

    controls = ScenarioControls(mine_id=ctx_mine.mine_id, objective=body.objective)
    selected = [o for o in rank(outcomes, controls)]

    from ..core.scenario.types import ScenarioResult
    import datetime as _dt

    result = ScenarioResult(
        scenario_id=f"SC-{ctx_mine.mine_id[:4]}-{_dt.datetime.now(_dt.timezone.utc).strftime('%H%M%S')}",
        mine_id=ctx_mine.mine_id,
        objective=body.objective,
        created_at=_dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        created_by=_username(user),
        baseline_production_t=ctx.baseline_production_t,
        planned_production_t=ctx.planned_production_t,
        selected=selected,
        considered=outcomes,
        provenance=ctx.provenance,
    )
    net = sum(o.delta_t for o in selected if o.delta_t is not None)
    result.projected_production_t = ctx.baseline_production_t + net
    modes = {o.calculation_mode for o in selected}
    result.calculation_mode = (
        CalculationMode.MODEL_BACKED
        if modes == {CalculationMode.MODEL_BACKED}
        else (CalculationMode.HEURISTIC if selected else CalculationMode.INSUFFICIENT_DATA)
    )
    if selected:
        result.evidence = min((o.evidence for o in selected), key=lambda e: e.quality.rank)

    payload = scenario_payload(result)
    _record_prediction(payload, "scenario")
    return payload


@router.post("/evaluate", summary="Evaluate from manager-facing controls")
def evaluate(body: ScenarioControlsRequest, user=Depends(require_authenticated())):
    ctx_mine: MineContext = resolve_mine_context(body.mine_id, user)
    ctx = build_context(ctx_mine.mine_id, location=ctx_mine.location)

    controls = ScenarioControls(
        mine_id=ctx_mine.mine_id,
        objective=body.objective,
        max_additional_fuel_pct=body.max_additional_fuel_pct,
        fleet_reallocation=body.fleet_reallocation,
        route_flexibility=body.route_flexibility,
        maintenance_flexibility=body.maintenance_flexibility,
        operating_time_flexibility=body.operating_time_flexibility,
        risk_tolerance=body.risk_tolerance,
        max_actions=body.max_actions,
    )

    result = run_scenario(controls, ctx, created_by=_username(user))
    payload = scenario_payload(result)
    _record_prediction(payload, "scenario_evaluate")
    return payload


@router.get("/optimise/{mine_id}", summary="Rank every available action for a mine")
def optimise(
    mine_id: str,
    objective: ScenarioObjective = ScenarioObjective.BALANCED,
    user=Depends(require_authenticated()),
):
    """Replaces `core/optimizer.optimize_interventions`.

    That function ranked five hardcoded candidates whose `base_gain` values
    (48.0, 36.0, 24.0, 30.0, 12.0 t) were constants surfaced as `expected_gain_t`.
    Every number here is either a model counterfactual or a declared estimate
    that says so.
    """
    ctx_mine: MineContext = resolve_mine_context(mine_id, user)
    ctx = build_context(ctx_mine.mine_id, location=ctx_mine.location)

    controls = ScenarioControls(
        mine_id=ctx_mine.mine_id,
        objective=objective,
        fleet_reallocation=Flexibility.MEDIUM,
        route_flexibility=Flexibility.MEDIUM,
        maintenance_flexibility=Flexibility.LOW,
        operating_time_flexibility=Flexibility.MEDIUM,
        max_actions=6,
    )
    result = run_scenario(controls, ctx, created_by=_username(user))
    payload = scenario_payload(result)

    ranked = []
    for position, action in enumerate(payload["actions_applied"], start=1):
        ranked.append({**action, "rank": position})

    return {
        "mine_id": ctx_mine.mine_id,
        "objective": objective.value,
        "as_of": payload["provenance"]["generated_at"],
        "baseline_production_t": payload["baseline"]["production_t"],
        "planned_production_t": payload["baseline"]["planned_production_t"],
        "production_gap_t": payload["baseline"]["production_gap_t"],
        "ranked_actions": ranked,
        "rejected_actions": [
            a for a in payload["considered"] if not a["feasible"]
        ],
        "explanation": payload["explanation"],
        "evidence": payload["evidence"],
        "provenance": payload["provenance"],
        "disclaimer": payload["disclaimer"],
    }


@router.get("/catalogue", summary="Every intervention Crucible AI can evaluate")
def catalogue(user=Depends(require_authenticated())):
    from ..core.scenario.catalogue import all_specs

    return {
        "interventions": [
            {
                "key": s.key,
                "title": s.title,
                "description": s.description,
                "horizon": s.horizon,
                "owner": s.owner,
                "approval_roles": list(s.approval_roles),
                "tradeoffs": list(s.tradeoffs),
            }
            for s in all_specs()
        ]
    }
