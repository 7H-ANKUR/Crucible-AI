"""app/api/routers/ledger.py — Prediction Ledger, Data Health, Decision Memory"""
import datetime

from fastapi import APIRouter, Depends, Query

from ..core.db import query
from ..core.security import get_current_user

router = APIRouter(tags=["ledger"])

@router.get("")
def prediction_ledger(
    task:       str   = Query(None),
    mine_id:    str   = Query(None),
    limit:      int   = Query(50, le=200),
    offset:     int   = Query(0, ge=0),
    user=Depends(get_current_user)
):
    """Paginated prediction ledger — all model outputs with lineage."""
    sql    = "SELECT * FROM ml.predictions WHERE 1=1"
    params = []
    if task:
        sql += " AND task=%s"; params.append(task)
    if mine_id:
        sql += " AND entity_id LIKE %s"; params.append(f"%{mine_id}%")
    sql += " ORDER BY predicted_at DESC LIMIT %s OFFSET %s"
    params += [limit, offset]

    rows = query(sql, params)
    return {
        "predictions": rows,
        "ledger":      rows,
        "count":       len(rows),
        "offset":      offset,
        "data_origin": "SYNTHETIC",
        "note":        "All predictions use synthetic prototype data.",
    }


@router.get("/decision-memory")
def decision_memory(user=Depends(get_current_user)):
    """Decision Memory — governed interventions from the audit log + scenario ledger."""
    decisions = []
    # 1. Primary: Governed operational decisions from gov.decisions
    try:
        dec_rows = query(
            """SELECT d.id, d.problem, d.recommendation, d.decided_by, d.decided_at, d.status,
                      o.predicted_value, o.actual_value, o.delta, o.effectiveness
               FROM gov.decisions d
               LEFT JOIN gov.decision_outcomes o ON d.id = o.decision_id
               ORDER BY d.decided_at DESC LIMIT 10"""
        )
        for d in dec_rows:
            outcome_text = f" | Outcome: Δ {d.get('delta'):+.1f}t (Eff: {float(d.get('effectiveness') or 0)*100:.0f}%)" if d.get("delta") is not None else " | Outcome: Pending shift close"
            decisions.append({
                "id":            d.get("id"),
                "decision_type": "operational_decision",
                "problem":       d.get("problem"),
                "summary":       f"{d.get('problem')}: {d.get('recommendation')}{outcome_text}",
                "actor":         d.get("decided_by"),
                "status":        d.get("status"),
                "predicted_value": d.get("predicted_value"),
                "actual_value":  d.get("actual_value"),
                "delta":         d.get("delta"),
                "effectiveness": d.get("effectiveness"),
                "created_at":    str(d.get("decided_at", "")),
                "data_origin":   "SYNTHETIC",
            })
    except Exception:
        pass

    try:
        rows = query(
            """SELECT event_type, actor_id, actor_role, entity_type, entity_id, payload, created_at
               FROM gov.audit_log
               ORDER BY created_at DESC LIMIT 6"""
        )
        for r in rows:
            decisions.append({
                "decision_type": r.get("event_type"),
                "summary":       r.get("payload") or f"{r.get('event_type')} by {r.get('actor_id')}",
                "actor":         r.get("actor_id"),
                "entity":        r.get("entity_id"),
                "created_at":    str(r.get("created_at", "")),
                "data_origin":   "SYNTHETIC",
            })
    except Exception:
        pass

    # Scenario runs are decisions too — surface them from the predictions ledger
    try:
        scen = query(
            """SELECT entity_id, prediction_value, confidence_tier, predicted_at, top_driver_1
               FROM ml.predictions WHERE task='scenario'
               ORDER BY predicted_at DESC LIMIT 6"""
        )
        for s in scen:
            decisions.append({
                "decision_type": "scenario_deployed",
                "summary":       f"Scenario evaluated for {s.get('entity_id')} — projected output {s.get('prediction_value')} t, key driver {s.get('top_driver_1') or 'n/a'}",
                "entity":        s.get("entity_id"),
                "created_at":    str(s.get("predicted_at", "")),
                "data_origin":   "SYNTHETIC",
            })
    except Exception:
        pass

    if not decisions:
        decisions = [{
            "decision_type": "baseline",
            "summary": "No governed decisions recorded yet — run and deploy a scenario.",
            "created_at": datetime.datetime.utcnow().isoformat() + "Z",
            "data_origin": "SYNTHETIC",
        }]

    return {"decisions": decisions, "count": len(decisions), "data_origin": "SYNTHETIC"}


@router.get("/data-health")
def data_health(user=Depends(get_current_user)):
    """Data Health Center — real row counts and freshness per domain.
    Single round-trip: one query with scalar subselects (Aiven RTT adds up)."""
    sql = """
    SELECT
      (SELECT COUNT(*) FROM ops.production_records)   AS production_rows,
      (SELECT MAX(date)::text FROM ops.production_records) AS production_latest,
      (SELECT COUNT(*) FROM ops.equipment_telemetry)  AS equipment_rows,
      (SELECT MAX(datetime)::text FROM ops.equipment_telemetry) AS equipment_latest,
      (SELECT COUNT(*) FROM geo.prospectivity_grid)   AS exploration_rows,
      (SELECT MAX(created_at)::text FROM geo.prospectivity_grid) AS exploration_latest,
      (SELECT COUNT(*) FROM ml.predictions)           AS predictions_rows,
      (SELECT MAX(predicted_at)::text FROM ml.predictions) AS predictions_latest,
      (SELECT COUNT(*) FROM gov.alerts)               AS alerts_rows,
      (SELECT MAX(created_at)::text FROM gov.alerts)  AS alerts_latest,
      (SELECT COUNT(*) FROM gov.audit_log)            AS audit_rows,
      (SELECT MAX(created_at)::text FROM gov.audit_log) AS audit_latest
    """
    r = query(sql)[0]

    def domain(name, rows_key, latest_key):
        rows_n = int(r.get(rows_key) or 0)
        latest = str(r.get(latest_key) or "—")
        return {
            "domain":      name,
            "rows":        rows_n,
            "latest":      latest,
            "freshness":   "FRESH" if rows_n > 0 and latest != "—" else "STALE",
            "data_origin": "SYNTHETIC",
        }

    domains = [
        domain("Production",  "production_rows",  "production_latest"),
        domain("Equipment",   "equipment_rows",   "equipment_latest"),
        domain("Exploration", "exploration_rows", "exploration_latest"),
        domain("Predictions", "predictions_rows", "predictions_latest"),
        domain("Alerts",      "alerts_rows",      "alerts_latest"),
        domain("Audit Log",   "audit_rows",       "audit_latest"),
    ]
    agg = "STALE" if any(d["freshness"] == "STALE" for d in domains) else "FRESH"
    return {"aggregate_status": agg, "domains": domains, "data_origin": "SYNTHETIC"}
