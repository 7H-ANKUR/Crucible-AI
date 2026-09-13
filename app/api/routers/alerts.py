"""app/api/routers/alerts.py — DB-backed alerts with audit-logged acknowledgements"""
import datetime
import json
import logging

from fastapi import APIRouter, Body, Depends, HTTPException

from ..core.db import execute, query
from ..core.rbac import check_mine_access, require_authenticated
from ..core.security import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(tags=["alerts"])

# Categories a role may see (None means everything — super_admin / management)
ROLE_CATEGORIES = {
    "super_admin":       None,
    "management":        None,
    "production_admin":  ["production", "data_freshness", "shortfall_risk", "production_forecast"],
    "equipment_admin":   ["equipment", "data_freshness", "equipment_failure"],
    "exploration_admin": ["exploration", "prospectivity_update"],
    "mine_planner":      ["production", "equipment", "shortfall_risk", "production_forecast"],
}


@router.get("")
def list_alerts(
    mine_id: str | None = None,
    unread_only: bool = False,
    limit: int = 50,
    user=Depends(get_current_user),
):
    if mine_id and not check_mine_access(user, mine_id):
        raise HTTPException(
            status_code=403,
            detail=f"User is not authorized to access alerts for mine '{mine_id}'."
        )

    sql = "SELECT * FROM gov.alerts WHERE 1=1"
    params = []
    allowed = ROLE_CATEGORIES.get(user.get("role"), None)
    if allowed is not None:
        sql += " AND alert_type = ANY(%s)"
        params.append(allowed)
    if mine_id:
        sql += " AND (mine_id = %s OR mine_id = 'ALL')"
        params.append(mine_id)
    elif user.get("role") not in ("super_admin", "management") and user.get("mine_id"):
        sql += " AND (mine_id = %s OR mine_id = 'ALL')"
        params.append(user.get("mine_id"))

    if unread_only:
        sql += " AND acknowledged = FALSE"
    sql += " ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at DESC LIMIT %s"
    params.append(limit)

    rows = query(sql, params or None)
    alerts = [
        {
            "id":           r["id"],
            "alert_type":   r.get("alert_type"),
            "severity":     (r.get("severity") or "info").lower(),
            "mine_id":      r.get("mine_id"),
            "entity_id":    r.get("entity_id"),
            "message":      r.get("message"),
            "acknowledged": bool(r.get("acknowledged")),
            "created_at":   str(r.get("created_at", "")),
            "data_origin":  r.get("data_origin", "SYNTHETIC"),
        }
        for r in rows
    ]
    return {
        "alerts": alerts,
        "count":  len(alerts),
        "unread": sum(1 for a in alerts if not a["acknowledged"]),
        "data_origin": "SYNTHETIC",
    }


@router.post("/{alert_id}/acknowledge")
def acknowledge_alert(
    alert_id: int,
    note: str = Body(default="", embed=True),
    user=Depends(require_authenticated()),
):
    rows = query("SELECT id, mine_id FROM gov.alerts WHERE id = %s", (alert_id,))
    if not rows:
        raise HTTPException(404, f"Alert {alert_id} not found")

    alert_mine = rows[0].get("mine_id")
    if alert_mine and alert_mine != "ALL" and not check_mine_access(user, alert_mine):
        raise HTTPException(
            status_code=403,
            detail=f"User is not authorized to acknowledge alerts for mine '{alert_mine}'."
        )

    execute(
        """UPDATE gov.alerts SET acknowledged = TRUE WHERE id = %s""",
        (alert_id,)
    )
    try:
        audit_payload = json.dumps({
            "action": "alert_acknowledged",
            "alert_id": alert_id,
            "mine_id": alert_mine,
            "acknowledged_by": user["username"],
            "note": note or ""
        })
        execute(
            "INSERT INTO gov.audit_log(event_type, actor_id, actor_role, entity_type, entity_id, payload) VALUES(%s,%s,%s,%s,%s,%s)",
            ("alert_acknowledged", user["username"], user.get("role", "operator"), "alert", str(alert_id), audit_payload)
        )
    except Exception as e:
        logger.error("Failed to write audit log for alert_acknowledged %s: %s", alert_id, e)

    return {
        "status": "acknowledged",
        "alert_id": alert_id,
        "ack_by": user["username"],
        "ack_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
