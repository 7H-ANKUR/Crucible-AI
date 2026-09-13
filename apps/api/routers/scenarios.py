"""apps/api/routers/scenarios.py — Scenario simulation and optimiser.

Intervention effects are model-informed: the production champion re-scores the
latest record's features with intervention-adjusted inputs. When the model or
features are unavailable, a deterministic heuristic tied to the intervention
magnitude is used.
"""
import datetime
import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..core.db import execute, query
from ..core.features import build_production_features
from ..core.ml_loader import ensure_active_model, get_model
from ..core.optimizer import check_operational_constraints, optimize_interventions
from ..core.rbac import require_authenticated, require_mine_access
from ..core.contracts import ScenarioControls, ScenarioResponse
from ..core.scenario_engine import evaluate_scenario

router = APIRouter(tags=["scenarios"])


class Intervention(BaseModel):
    type: str                       # equipment_redeploy | maintenance_defer | blast_reschedule | fleet_reroute | crusher_speed_trim
    description: str | None = None
    detail: str | None = None    # frontend alias
    magnitude: float | None = None
    equipment_id: str | None = None
    shift: str | None = None
    delta_hours: float | None = None


class ScenarioRequest(BaseModel):
    mine_id: str
    baseline_date: str | None = None
    interventions: list[Intervention] = []
    notes: str | None = None


def _latest_features(mine_id: str):
    rows = query(
        """SELECT * FROM ops.production_records
           WHERE mine_id = %s ORDER BY date DESC LIMIT 1""",
        (mine_id,)
    )
    if not rows:
        return None, None
    feat_names = get_model("prod_feats")
    if not feat_names:
        return None, rows[0]
    medians = get_model("prod_medians") or {}
    df, _ = build_production_features(rows[0], feat_names, medians)
    return df, rows[0]



# Deterministic fallbacks (fraction of baseline production) per intervention type
_HEURISTIC = {
    "equipment_redeploy":  (+0.10, 0.88),
    "fleet_reroute":       (+0.09, 0.87),
    "blast_reschedule":    (+0.07, 0.74),
    "crusher_speed_trim":  (+0.05, 0.80),
    "maintenance_defer":   (-0.04, 0.62),
}
# Which model feature each intervention type scales up (first available wins)
_ADJUSTABLE = {
    "equipment_redeploy":  ["utilization_pct", "equipment_availability_pct", "operating_hours"],
    "fleet_reroute":       ["utilization_pct", "operating_hours"],
    "blast_reschedule":    ["ore_available_t", "ore_tonnes", "ore_feed_t"],
    "crusher_speed_trim":  ["processing_capacity_t", "crusher_throughput_t"],
    "maintenance_defer":   [],
}


def _model_delta(mine_id: str, baseline_pred: float, X, iv: Intervention) -> tuple:
    """Return (delta_t, feasibility, model_backed, reason, constraints_checked).
    Validates physical constraints against operational rules, then re-scores features."""
    mag = iv.magnitude if iv.magnitude is not None else 0.1
    mag = max(0.0, min(mag, 0.30))
    model = get_model("prod_forecast")

    # Check physical constraints
    c_check = check_operational_constraints(mine_id, iv.type, {
        "magnitude": mag,
        "shift": iv.shift,
        "equipment_id": iv.equipment_id,
    })

    pct, feas = _HEURISTIC.get(iv.type, (+0.06, 0.75))
    feas = feas * c_check["multiplier"]

    if not c_check["feasible"]:
        # Constraint violation
        return 0.0, 0.1, False, f"Constraint violation: {c_check['reason']}", c_check["constraints_checked"]

    if model is None or X is None:
        reason = "Heuristic fallback — model features unavailable. " + c_check["reason"]
        return baseline_pred * pct * (mag / 0.1), feas, False, reason, c_check["constraints_checked"]

    adjustable = _ADJUSTABLE.get(iv.type, [])
    col = next((c for c in adjustable if c in X.columns), None)
    if col is None:
        reason = f"Heuristic fallback — feature column not in schema. {c_check['reason']}"
        return baseline_pred * pct * (mag / 0.1), feas, False, reason, c_check["constraints_checked"]

    X_adj = X.copy()
    X_adj[col] = X_adj[col] * (1.0 + mag)
    try:
        base = float(model.predict(X)[0])
        scen = float(model.predict(X_adj)[0])
        delta = max(-base * 0.25, scen - base)
        return delta, min(0.95, (0.75 + mag) * c_check["multiplier"]), True, c_check["reason"], c_check["constraints_checked"]
    except Exception:
        reason = "Heuristic fallback — model prediction exception. " + c_check["reason"]
        return baseline_pred * pct * (mag / 0.1), feas, False, reason, c_check["constraints_checked"]


@router.post("/run")
def run_scenario(
    req: ScenarioRequest,
    user=Depends(require_authenticated()),
):
    """Simulate a scenario with interventions and return comparison vs baseline."""
    require_mine_access(req.mine_id, user)
    scenario_id = f"SC-{uuid.uuid4().hex[:6].upper()}"

    model, meta = ensure_active_model("production_forecast")
    m_ver = str(meta.get("version", "v1.0"))
    serving_m_ver = str(meta.get("serving_model_version", m_ver))
    authoritative_m_ver = str(meta.get("authoritative_model_version", m_ver))
    serving_status = str(meta.get("serving_status", "ACTIVE"))
    dataset_ver = str(meta.get("dataset_version", "v1.0"))
    username = user.get("username", "user") if isinstance(user, dict) else getattr(user, "username", "user")

    X, latest_row = _latest_features(req.mine_id)
    if latest_row is None:
        return {
            "scenario_id":   scenario_id,
            "mine_id":       req.mine_id,
            "created_at":    datetime.datetime.utcnow().isoformat() + "Z",
            "created_by":    username,
            "status":        "insufficient_data",
            "model_version": m_ver,
            "serving_model_version": serving_m_ver,
            "authoritative_model_version": authoritative_m_ver,
            "serving_status": serving_status,
            "dataset_version": dataset_ver,
            "calculation_mode": "INSUFFICIENT_DATA",
            "data_quality": {
                "status": "INSUFFICIENT_DATA",
                "reason": f"No production telemetry available for mine '{req.mine_id}'",
            },
            "baseline": {"production_t": 0.0, "p50": 0.0, "shortfall_prob": 0.0},
            "scenario": {"production_t": 0.0, "p50": 0.0, "shortfall_prob": 0.0, "net_delta_t": 0.0, "net_cost_inr": 0.0},
            "actions_applied": [],
            "interventions": [],
            "confidence_tier": "LOW",
            "model_confidence": 0,
            "data_origin": "NO_DATA",
            "disclaimer": "Insufficient telemetry recorded for this mine to run simulation.",
        }

    if X is not None and model is not None:
        baseline_prod = float(model.predict(X)[0])
        baseline_backed = True
    else:
        baseline_prod = float(latest_row.get("actual_production_t") or latest_row.get("planned_production_t") or 0.0)
        baseline_backed = False

    total_delta = 0.0
    intervention_results = []
    any_model_backed = False
    for iv in req.interventions:
        delta, feasibility, model_backed, reason, constraints_checked = _model_delta(req.mine_id, baseline_prod, X, iv)
        if model_backed:
            any_model_backed = True
        risk_reduction = 0.0 if delta <= 0 else round(min(0.25, delta / max(baseline_prod, 1) * 2), 3)
        if iv.type == "maintenance_defer":
            risk_reduction = -round(min(0.10, (iv.magnitude or 0.1) / 2), 3)

        cost_est = round(abs(delta) * 1200, 0)
        intervention_results.append({
            "type":                iv.type,
            "intervention":        iv.type,
            "detail":              iv.detail or iv.description or "Model-evaluated operational adjustment.",
            "description":         iv.detail or iv.description or "Model-evaluated operational adjustment.",
            "magnitude":           iv.magnitude,
            "expected_delta_t":    round(delta, 1),
            "feasibility":         round(feasibility, 2),
            "risk_reduction":      risk_reduction,
            "cost_inr":            cost_est,
            "urgency":             "HIGH" if delta > 50 else "MEDIUM" if delta > 0 else "LOW",
            "model_backed":        model_backed,
            "calculation_mode":    "MODEL_BACKED" if model_backed else "HEURISTIC",
            "production_delta_source": "MODEL" if model_backed else "HEURISTIC",
            "cost_source":         "SYNTHETIC_ASSUMPTION",
            "reason":              reason,
            "constraints_checked": constraints_checked,
            "assumption_tag":      "Illustrative prototype cost assumption: ₹1,200/t",
        })
        total_delta += delta

    scenario_prod  = max(0.0, baseline_prod + total_delta)
    plan = float(latest_row.get("planned_production_t") or baseline_prod)
    shortfall_base = max(0.0, (plan - baseline_prod) / max(plan, 1)) if plan > 0 else 0.0
    shortfall_scen = max(0.0, (plan - scenario_prod) / max(plan, 1)) if plan > 0 else 0.0
    confidence = "HIGH" if baseline_backed and any_model_backed else "MEDIUM"
    calc_mode = "MODEL_BACKED" if any_model_backed else "HEURISTIC"
    data_origin = latest_row.get("data_origin") or "REAL_USER_UPLOADED"

    result = {
        "scenario_id":   scenario_id,
        "mine_id":       req.mine_id,
        "created_at":    datetime.datetime.utcnow().isoformat() + "Z",
        "created_by":    username,
        "status":        "simulated",
        "model_version": m_ver,
        "serving_model_version": serving_m_ver,
        "authoritative_model_version": authoritative_m_ver,
        "serving_status": serving_status,
        "dataset_version": dataset_ver,
        "calculation_mode": calc_mode,
        "data_quality": {
            "status": "AUTHORITATIVE",
            "reason": f"Telemetry resolved for mine '{req.mine_id}'",
        },
        "baseline": {
            "production_t":       round(baseline_prod, 1),
            "p50":                round(baseline_prod, 1),
            "shortfall_prob":     round(shortfall_base, 3),
        },
        "scenario": {
            "production_t":       round(scenario_prod, 1),
            "p50":                round(scenario_prod, 1),
            "shortfall_prob":     round(shortfall_scen, 3),
            "net_delta_t":        round(total_delta, 1),
            "net_cost_inr":       round(sum(r["cost_inr"] for r in intervention_results), 0),
        },
        "actions_applied":  intervention_results,
        "interventions":    intervention_results,
        "confidence_tier":  confidence,
        "model_confidence": 87 if confidence == "HIGH" else 74,
        "data_origin":      data_origin,
        "disclaimer":       "Scenario outputs are model-assisted estimates under DGMS-informed safety constraints. Not for autonomous action.",
    }

    try:
        execute(
            """INSERT INTO ml.predictions
               (task, entity_id, model_version, prediction_value, probability, confidence_tier, top_driver_1, data_origin)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
            ("scenario", scenario_id, m_ver,
             round(scenario_prod, 1), round(1 - shortfall_scen, 3), confidence,
             intervention_results[0]["type"] if intervention_results else None, data_origin)
        )
    except Exception:
        pass

    return result


@router.post("/evaluate", response_model=ScenarioResponse)
def evaluate_new_scenario(
    controls: ScenarioControls,
    user=Depends(require_authenticated()),
):
    """Evaluate a scenario using standard controls and full constraint engine."""
    require_mine_access(controls.mine_id, user)
    username = user.get("username", "user") if isinstance(user, dict) else getattr(user, "username", "user")
    
    response = evaluate_scenario(controls, username)
    
    # Store scenario decision record in prediction ledger
    try:
        execute(
            """INSERT INTO ml.predictions
               (task, entity_id, model_version, prediction_value, probability, confidence_tier, top_driver_1, data_origin)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
            ("scenario_evaluate", response.scenario_id, response.model_version,
             response.scenario["production_t"], round(1 - response.scenario["shortfall_prob"], 3), response.confidence_tier,
             response.actions_applied[0].type if response.actions_applied else None, response.data_origin)
        )
    except Exception:
        pass
        
    return response


@router.get("/optimise/{mine_id}")
def optimise(mine_id: str, user=Depends(require_mine_access)):
    """Constraint-aware operational optimizer. Ranks actions by (expected_gain × feasibility) / cost."""
    X, latest_row = _latest_features(mine_id)
    if latest_row is None:
        return {
            "mine_id":        mine_id,
            "as_of":          datetime.datetime.utcnow().isoformat() + "Z",
            "baseline_p50":   0.0,
            "target_plan_t":  0.0,
            "ranked_actions": [],
            "data_origin":    "NO_DATA",
            "data_quality": {
                "status": "INSUFFICIENT_DATA",
                "reason": f"No production telemetry available for mine '{mine_id}'",
            },
            "disclaimer":     "No production data available for this mine.",
        }

    model, meta = ensure_active_model("production_forecast")
    m_ver = str(meta.get("version", "v1.0"))
    baseline_prod = float(model.predict(X)[0]) if (X is not None and model is not None) else 0.0
    plan = float(latest_row.get("planned_production_t") or baseline_prod)

    ranked_actions = optimize_interventions(mine_id, baseline_prod, plan)

    return {
        "mine_id":        mine_id,
        "as_of":          datetime.datetime.utcnow().isoformat() + "Z",
        "model_version":  m_ver,
        "serving_model_version": str(meta.get("serving_model_version", m_ver)),
        "authoritative_model_version": str(meta.get("authoritative_model_version", m_ver)),
        "baseline_p50":   round(baseline_prod, 1),
        "target_plan_t":  round(plan, 1),
        "ranked_actions": ranked_actions,
        "data_origin":    latest_row.get("data_origin") or "REAL_USER_UPLOADED",
        "disclaimer":     "Actions evaluated against DGMS-informed safety constraints, equipment availability & haul gradients. Requires human review and approval before execution.",
    }

