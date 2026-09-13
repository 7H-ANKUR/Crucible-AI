"""app/api/routers/governance.py — Model registry / champion-challenger health"""
from fastapi import APIRouter, Depends

from ..core.db import query
from ..core.security import get_current_user

router = APIRouter(tags=["governance"])


@router.get("/model-health")
def model_health(user=Depends(get_current_user)):
    """Champion/challenger registry backed by gov.model_registry."""
    rows = query(
        """SELECT task, model, status, metric_roc_auc, metric_pr_auc, metric_mae,
                  metric_r2, metric_lift, split_type, leakage_status
           FROM gov.model_registry
           ORDER BY task, status DESC, registered_at DESC"""
    )
    models = [dict(r) for r in rows]
    champions = [m for m in models if m.get("status") == "champion"]
    return {
        "models":     models,
        "champions":  champions,
        "count":      len(models),
        "data_origin": "SYNTHETIC",
    }
