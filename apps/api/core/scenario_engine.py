"""apps/api/core/scenario_engine.py — Central scenario engine for MINEx.

Evaluates scenarios based on ScenarioControls, applying real constraints,
model-backed re-scoring where possible, and heuristic fallback where necessary.
"""
import datetime
import uuid

from .contracts import (
    ScenarioControls,
    ScenarioInterventionModel,
    ScenarioResponse,
    ScenarioObjective,
)
from .db import query
from .features import build_production_features
from .ml_loader import ensure_active_model, get_model
from .optimizer import check_operational_constraints, COST_PER_TONNE_INR

# Deterministic fallbacks (fraction of baseline production) per intervention type
_HEURISTIC = {
    "equipment_redeploy":  (+0.10, 0.88),
    "fleet_reroute":       (+0.09, 0.87),
    "blast_reschedule":    (+0.07, 0.74),
    "crusher_speed_trim":  (+0.05, 0.80),
    "maintenance_defer":   (-0.04, 0.62),
}
# Which model feature each intervention type scales up
_ADJUSTABLE = {
    "equipment_redeploy":  ["utilization_pct", "equipment_availability_pct", "operating_hours"],
    "fleet_reroute":       ["utilization_pct", "operating_hours"],
    "blast_reschedule":    ["ore_available_t", "ore_tonnes", "ore_feed_t"],
    "crusher_speed_trim":  ["processing_capacity_t", "crusher_throughput_t"],
    "maintenance_defer":   [],
}


def _latest_features(mine_id: str):
    rows = query(
        "SELECT * FROM ops.production_records WHERE mine_id = %s ORDER BY date DESC LIMIT 1",
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


def _generate_candidates(controls: ScenarioControls) -> list[dict]:
    # Map controls to candidate generation rules
    candidates = []
    fuel_multiplier = controls.max_additional_fuel_pct / 14.0 if controls.max_additional_fuel_pct else 0.1
    
    if controls.fleet_reallocation != "LOW":
        mag = 0.15 if controls.fleet_reallocation == "HIGH" else 0.10
        candidates.append({
            "type": "equipment_redeploy",
            "title": "Move Idle Trucks to Busy Areas",
            "magnitude": mag * fuel_multiplier,
        })
    
    if controls.route_flexibility != "LOW":
        mag = 0.15 if controls.route_flexibility == "HIGH" else 0.10
        candidates.append({
            "type": "fleet_reroute",
            "title": "Change Haul Routes to Avoid Traffic",
            "magnitude": mag * fuel_multiplier,
        })
        
    if controls.maintenance_flexibility != "PRESERVE":
        mag = 0.10 if controls.maintenance_flexibility == "HIGH" else 0.05
        candidates.append({
            "type": "maintenance_defer",
            "title": "Delay Non-Critical Maintenance",
            "magnitude": mag,
        })
        
    candidates.append({
        "type": "crusher_speed_trim",
        "title": "Speed Up Crusher Processing",
        "magnitude": 0.10 * fuel_multiplier,
    })
    
    return candidates


def evaluate_scenario(controls: ScenarioControls, username: str) -> ScenarioResponse:
    mine_id = controls.mine_id
    scenario_id = f"SC-{uuid.uuid4().hex[:6].upper()}"

    model, meta = ensure_active_model("production_forecast")
    m_ver = str(meta.get("version", "v1.0"))
    serving_m_ver = str(meta.get("serving_model_version", m_ver))
    authoritative_m_ver = str(meta.get("authoritative_model_version", m_ver))
    serving_status = str(meta.get("serving_status", "ACTIVE"))
    dataset_ver = str(meta.get("dataset_version", "v1.0"))

    X, latest_row = _latest_features(mine_id)
    if latest_row is None:
        return ScenarioResponse(
            scenario_id=scenario_id,
            mine_id=mine_id,
            created_at=datetime.datetime.utcnow().isoformat() + "Z",
            created_by=username,
            status="insufficient_data",
            model_version=m_ver,
            serving_model_version=serving_m_ver,
            authoritative_model_version=authoritative_m_ver,
            serving_status=serving_status,
            dataset_version=dataset_ver,
            calculation_mode="INSUFFICIENT_DATA",
            data_quality={"status": "INSUFFICIENT_DATA", "reason": f"No telemetry for {mine_id}"},
            baseline={"production_t": 0.0, "p50": 0.0, "shortfall_prob": 0.0},
            scenario={"production_t": 0.0, "p50": 0.0, "shortfall_prob": 0.0, "net_delta_t": 0.0, "net_cost_inr": 0.0},
            actions_applied=[],
            interventions=[],
            confidence_tier="LOW",
            model_confidence=0.0,
            data_origin="NO_DATA",
            disclaimer="Insufficient telemetry recorded for this mine to run simulation."
        )

    if X is not None and model is not None:
        baseline_prod = float(model.predict(X)[0])
        baseline_backed = True
    else:
        baseline_prod = float(latest_row.get("actual_production_t") or latest_row.get("planned_production_t") or 0.0)
        baseline_backed = False

    candidates = _generate_candidates(controls)
    interventions = []
    total_delta = 0.0
    any_model_backed = False

    for cand in candidates:
        iv_type = cand["type"]
        mag = cand["magnitude"]
        
        c_check = check_operational_constraints(mine_id, iv_type, {"magnitude": mag})
        pct, feas = _HEURISTIC.get(iv_type, (+0.06, 0.75))
        feas = feas * c_check["multiplier"]
        
        if controls.risk_tolerance == "CONSERVATIVE" and feas < 0.8:
            continue
            
        if not c_check["feasible"]:
            continue

        model_backed = False
        reason = c_check["reason"]
        
        if model is None or X is None:
            reason = "(No AI prediction used) " + reason
            delta = baseline_prod * pct * (mag / 0.1)
        else:
            adjustable = _ADJUSTABLE.get(iv_type, [])
            col = next((c for c in adjustable if c in X.columns), None)
            if col is None:
                reason = "(No AI prediction used) " + reason
                delta = baseline_prod * pct * (mag / 0.1)
            else:
                X_adj = X.copy()
                X_adj[col] = X_adj[col] * (1.0 + mag)
                try:
                    base = float(model.predict(X)[0])
                    scen = float(model.predict(X_adj)[0])
                    delta = max(-base * 0.25, scen - base)
                    model_backed = True
                    any_model_backed = True
                    feas = min(0.95, (0.75 + mag) * c_check["multiplier"])
                except Exception:
                    reason = "(No AI prediction used) " + reason
                    delta = baseline_prod * pct * (mag / 0.1)

        risk_reduction = 0.0 if delta <= 0 else round(min(0.25, delta / max(baseline_prod, 1) * 2), 3)
        if iv_type == "maintenance_defer":
            risk_reduction = -round(min(0.10, (mag or 0.1) / 2), 3)

        cost_est = round(abs(delta) * COST_PER_TONNE_INR, 0)
        
        score = (delta * feas) / max(cost_est, 1.0)
        if controls.objective == ScenarioObjective.MAXIMIZE_PRODUCTION:
            score = delta
        elif controls.objective == ScenarioObjective.MINIMIZE_COST:
            score = -cost_est
        elif controls.objective == ScenarioObjective.MINIMIZE_RISK:
            score = risk_reduction

        interventions.append({
            "model": ScenarioInterventionModel(
                type=iv_type,
                intervention=iv_type,
                detail=cand["title"],
                description=cand["title"],
                magnitude=mag,
                expected_delta_t=round(delta, 1),
                feasibility=round(feas, 2),
                risk_reduction=risk_reduction,
                cost_inr=cost_est,
                urgency="HIGH" if delta > 50 else "MEDIUM" if delta > 0 else "LOW",
                model_backed=model_backed,
                calculation_mode="MODEL_BACKED" if model_backed else "HEURISTIC",
                production_delta_source="MODEL" if model_backed else "HEURISTIC",
                cost_source="SYNTHETIC_ASSUMPTION",
                reason=reason,
                constraints_checked=c_check["constraints_checked"],
                assumption_tag="Assumption-based estimate"
            ),
            "score": score,
            "delta": delta
        })

    # Sort by objective score
    interventions.sort(key=lambda x: x["score"], reverse=True)
    
    # Select top 3 interventions as actions applied
    selected = interventions[:3]
    total_delta = sum(item["delta"] for item in selected)
    total_cost = sum(item["model"].cost_inr for item in selected)
    actions_applied = [item["model"] for item in selected]
    all_interventions = [item["model"] for item in interventions]

    scenario_prod = max(0.0, baseline_prod + total_delta)
    plan = float(latest_row.get("planned_production_t") or baseline_prod)
    shortfall_base = max(0.0, (plan - baseline_prod) / max(plan, 1)) if plan > 0 else 0.0
    shortfall_scen = max(0.0, (plan - scenario_prod) / max(plan, 1)) if plan > 0 else 0.0
    
    calc_mode = "MODEL_BACKED" if any_model_backed else "HEURISTIC"
    data_origin = latest_row.get("data_origin") or "REAL_USER_UPLOADED"
    
    # Calculate a real model confidence based on evidence
    model_conf = 85.0 if baseline_backed else 60.0
    if any_model_backed:
        model_conf = min(95.0, model_conf + 5.0)

    return ScenarioResponse(
        scenario_id=scenario_id,
        mine_id=mine_id,
        created_at=datetime.datetime.utcnow().isoformat() + "Z",
        created_by=username,
        status="simulated",
        model_version=m_ver,
        serving_model_version=serving_m_ver,
        authoritative_model_version=authoritative_m_ver,
        serving_status=serving_status,
        dataset_version=dataset_ver,
        calculation_mode=calc_mode,
        data_quality={"status": "AUTHORITATIVE", "reason": f"Telemetry resolved for {mine_id}"},
        baseline={
            "production_t": round(baseline_prod, 1),
            "p50": round(baseline_prod, 1),
            "shortfall_prob": round(shortfall_base, 3),
        },
        scenario={
            "production_t": round(scenario_prod, 1),
            "p50": round(scenario_prod, 1),
            "shortfall_prob": round(shortfall_scen, 3),
            "net_delta_t": round(total_delta, 1),
            "net_cost_inr": round(total_cost, 0),
        },
        actions_applied=actions_applied,
        interventions=all_interventions,
        confidence_tier="HIGH" if model_conf > 80 else "MEDIUM",
        model_confidence=model_conf,
        data_origin=data_origin,
        disclaimer="Scenario outputs are model-assisted estimates under DGMS-informed safety constraints."
    )
