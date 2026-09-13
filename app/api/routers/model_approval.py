"""app/api/routers/model_approval.py — Human approval gate, champion promotion & safe rollback.

Endpoints:
  GET  /api/v1/models/all              — list all models across all statuses with lineage
  GET  /api/v1/models/pending          — list challenger/approved models pending review
  POST /api/v1/models/{model_id}/approve  — mark a challenger as approved (leakage & artifact checks)
  POST /api/v1/models/{model_id}/promote  — promote approved model to champion with safe hot-reload & smoke tests
  POST /api/v1/models/{model_id}/reject   — reject a challenger model
  POST /api/v1/models/{model_id}/rollback — emergency rollback to previous champion with hot-reload
  GET  /api/v1/models/approvals        — audit trail of all model approval/promotion decisions
"""
import json
import logging
import pathlib

import joblib
from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel

from ..core.config import ARTIFACTS
from ..core.db import execute, query, transaction
from ..core.ml_loader import (
    ACTIVE_SERVING_VERSIONS,
    invalidate_model_metadata,
    reload_model,
    smoke_test_model,
)
from ..core.rbac import require_any_role
from ..core.security import get_current_user
from ..core.storage import compute_sha256, get_storage_service

logger = logging.getLogger("crucible.model_approval")
router = APIRouter(tags=["model_approval"])

TASK_DOMAINS = {
    "production_forecast": ["super_admin", "production_admin"],
    "shortfall":           ["super_admin", "production_admin"],
    "equipment_failure":   ["super_admin", "equipment_admin"],
    "prospectivity":       ["super_admin", "exploration_admin"],
}

TASK_MODEL_KEYS = {
    "production_forecast": "prod_forecast",
    "shortfall":           "shortfall",
    "equipment_failure":   "equipment",
    "prospectivity":       "prospectivity",
}


class ApprovalActionRequest(BaseModel):
    note: str | None = None


@router.get("/all")
def list_all_models(user=Depends(get_current_user)):
    """List all models in registry with full metrics and governance status."""
    rows = query(
        """SELECT m.id, m.task, m.model, m.version, m.status, m.champion_metric, m.champion_value,
                  m.metric_roc_auc, m.metric_pr_auc, m.metric_mae, m.metric_r2, m.metric_lift,
                  m.split_type, m.data_origin, m.leakage_status, m.approved_by, m.approved_at,
                  m.promoted_at, m.rollback_of, m.registered_at, m.training_run_id,
                  m.artifact_drive_file_id, m.artifact_sha256, m.artifact_size_bytes,
                  m.smoke_test_status, a.status as artifact_storage_status
           FROM gov.model_registry m
           LEFT JOIN gov.model_artifacts a ON a.model_id = m.id
           ORDER BY m.task,
                    CASE m.status
                        WHEN 'champion' THEN 1
                        WHEN 'approved' THEN 2
                        WHEN 'challenger' THEN 3
                        WHEN 'retired' THEN 4
                        ELSE 5
                    END,
                    m.registered_at DESC"""
    )
    return {"models": rows, "count": len(rows)}


@router.get("/pending")
def list_pending_models(user=Depends(get_current_user)):
    """List challenger and approved models that are candidates for review and promotion."""
    rows = query(
        """SELECT m.id, m.task, m.model, m.version, m.status, m.champion_metric, m.champion_value,
                  m.metric_roc_auc, m.metric_pr_auc, m.metric_mae, m.metric_r2, m.metric_lift,
                  m.split_type, m.data_origin, m.leakage_status, m.approved_by, m.approved_at,
                  m.registered_at, m.artifact_sha256, m.artifact_drive_file_id, m.training_run_id
           FROM gov.model_registry m
           WHERE m.status IN ('challenger', 'approved')
           ORDER BY m.registered_at DESC"""
    )
    return {"challengers": rows, "count": len(rows)}


@router.post("/{model_id}/approve")
def approve_model(
    model_id: int,
    body: ApprovalActionRequest = Body(default=ApprovalActionRequest()),
    user=Depends(require_any_role(["super_admin", "production_admin", "exploration_admin", "equipment_admin"])),
):
    """Mark a challenger model as approved by human reviewer after verifying leakage status."""
    rows = query("SELECT * FROM gov.model_registry WHERE id=%s", (model_id,))
    if not rows:
        raise HTTPException(404, f"Model {model_id} not found.")
    m = rows[0]

    if m["status"] not in ("challenger",):
        raise HTTPException(422, f"Can only approve models in 'challenger' status. Current: {m['status']}")

    if m.get("leakage_status") != "PASS":
        raise HTTPException(422, f"Cannot approve model: Leakage audit status is '{m.get('leakage_status')}'. Must be 'PASS'.")

    allowed_roles = TASK_DOMAINS.get(m["task"], ["super_admin"])
    if user["role"] not in allowed_roles:
        raise HTTPException(
            403,
            f"Role '{user['role']}' is not authorized to approve models for task '{m['task']}'. Required: {allowed_roles}"
        )

    with transaction() as tx:
        tx.execute(
            "UPDATE gov.model_registry SET status='approved', approved_by=%s, approved_at=NOW() WHERE id=%s",
            (user["username"], model_id)
        )
        tx.execute(
            """INSERT INTO gov.model_approvals (model_id, action, actor_id, actor_role, note)
               VALUES (%s, 'approved', %s, %s, %s)""",
            (model_id, user["username"], user["role"], body.note or "Approved by domain reviewer")
        )
        try:
            audit_payload = json.dumps({
                "action": "model_approved",
                "task": m["task"],
                "version": m["version"],
                "note": body.note or "",
                "approved_by": user["username"]
            })
            tx.execute(
                """INSERT INTO gov.audit_log (event_type, actor_id, actor_role, entity_type, entity_id, payload)
                   VALUES ('model_approved', %s, %s, 'model_registry', %s, %s)""",
                (user["username"], user["role"], str(model_id), audit_payload)
            )
        except Exception as e:
            logger.error("Failed to write audit log for model_approved %s: %s", model_id, e)


    return {
        "model_id":    model_id,
        "status":      "approved",
        "approved_by": user["username"],
        "message":     f"Model {m['version']} approved. Ready for promotion to champion.",
    }


@router.post("/{model_id}/promote")
def promote_model(
    model_id: int,
    body: ApprovalActionRequest = Body(default=ApprovalActionRequest()),
    user=Depends(require_any_role(["super_admin", "production_admin", "exploration_admin", "equipment_admin"])),
):
    """
    Promote an approved model to champion with safe hot-reload:
    1. Rejects immediately if model is not 'approved' (HTTP 422).
    2. Verifies artifact availability and checksum.
    3. Loads artifact and runs smoke test inference on baseline features.
    4. Hot-reloads in-memory registry.
    5. Demotes active champion to 'retired' and updates DB atomically.
    """
    rows = query("SELECT * FROM gov.model_registry WHERE id=%s", (model_id,))
    if not rows:
        raise HTTPException(404, f"Model {model_id} not found.")
    target = rows[0]

    # Gate: Model must be explicitly approved before promotion
    if target["status"] != "approved":
        raise HTTPException(
            status_code=422,
            detail=f"Model must be in 'approved' status prior to promotion. Current status: '{target['status']}'."
        )

    allowed_roles = TASK_DOMAINS.get(target["task"], ["super_admin"])
    if user["role"] not in allowed_roles:
        raise HTTPException(
            403,
            f"Role '{user['role']}' not authorized to promote models for task '{target['task']}'."
        )

    # 1. Resolve local artifact path
    art_path = None
    storage = get_storage_service()

    if target.get("artifact_path") and pathlib.Path(target["artifact_path"]).exists():
        art_path = pathlib.Path(target["artifact_path"])
    elif target.get("artifact_drive_file_id"):
        # Download from storage to immutable versioned artifact path
        dest = ARTIFACTS / f"{target['task']}_{target['model']}_{target['version']}.joblib"
        try:
            storage.download_file(target["artifact_drive_file_id"], dest)
            art_path = dest
        except Exception as e:
            logger.warning("Could not download artifact by drive ID %s: %s", target["artifact_drive_file_id"], e)

    # Check fallback candidate naming in ARTIFACTS
    if not art_path or not art_path.exists():
        candidate_name_ver = f"{target['task']}_{target['model']}_{target['version']}.joblib"
        candidate_name_raw = f"{target['task']}_{target['model']}.joblib"
        if (ARTIFACTS / candidate_name_ver).exists():
            art_path = ARTIFACTS / candidate_name_ver
        elif (ARTIFACTS / candidate_name_raw).exists():
            art_path = ARTIFACTS / candidate_name_raw

    if not art_path or not art_path.exists():
        raise HTTPException(
            status_code=422,
            detail=f"Candidate artifact file for model {target['version']} not found. Cannot verify or promote without exact artifact."
        )

    # 2. Verify SHA-256 if recorded
    if target.get("artifact_sha256"):
        actual_hash = compute_sha256(art_path.read_bytes())
        if actual_hash != target["artifact_sha256"]:
            raise HTTPException(
                status_code=422,
                detail=f"Artifact checksum mismatch! Expected: {target['artifact_sha256']}, actual: {actual_hash}. Promotion aborted."
            )

    # 3. Load model object and run smoke test
    try:
        model_obj = joblib.load(art_path)
    except Exception as e:
        raise HTTPException(422, f"Failed to load artifact file with joblib: {e}")

    smoke_passed, smoke_msg = smoke_test_model(target["task"], model_obj)
    if not smoke_passed:
        execute(
            "UPDATE gov.model_registry SET smoke_test_status=%s WHERE id=%s",
            (f"FAILED: {smoke_msg}", model_id)
        )
        raise HTTPException(
            status_code=422,
            detail=f"Model smoke test failed: {smoke_msg}. Promotion aborted to protect live operations."
        )

    # 4. In-process hot-reload (MUST SUCCEED prior to DB transition)
    model_key = TASK_MODEL_KEYS.get(target["task"])
    if model_key:
        reloaded = reload_model(model_key, str(art_path))
        if not reloaded:
            raise HTTPException(
                status_code=500,
                detail=f"In-memory hot-reload failed for '{model_key}'. Promotion aborted; previous champion remains active in memory and database."
            )

    # 5. Database state transition: Demote old champion, promote new (atomic transaction)
    demoted_id = None
    with transaction() as tx:
        current_champions = tx.query(
            "SELECT id, version FROM gov.model_registry WHERE task=%s AND status='champion' FOR UPDATE",
            (target["task"],)
        )
        if current_champions:
            demoted_id = current_champions[0]["id"]
            tx.execute("UPDATE gov.model_registry SET status='retired', retired_at=NOW() WHERE id=%s", (demoted_id,))

        tx.execute(
            """UPDATE gov.model_registry
               SET status='champion', promoted_at=NOW(), smoke_test_status=%s
               WHERE id=%s""",
            (f"PASSED ({smoke_msg})", model_id)
        )

        # Record approval action
        tx.execute(
            """INSERT INTO gov.model_approvals (model_id, action, actor_id, actor_role, note)
               VALUES (%s, 'promoted', %s, %s, %s)""",
            (model_id, user["username"], user["role"],
             f"Promoted to champion. Previous champion ID: {demoted_id}. Smoke test: {smoke_msg}. Note: {body.note or ''}")
        )

        # Audit log
        try:
            audit_payload = json.dumps({
                "action": "model_promoted",
                "task": target["task"],
                "version": target["version"],
                "demoted_champion_id": demoted_id,
                "smoke_test": smoke_msg,
                "note": body.note or "",
                "promoted_by": user["username"]
            })
            tx.execute(
                """INSERT INTO gov.audit_log (event_type, actor_id, actor_role, entity_type, entity_id, payload)
                   VALUES ('model_promoted', %s, %s, 'model_registry', %s, %s)""",
                (user["username"], user["role"], str(model_id), audit_payload)
            )
        except Exception as e:
            logger.error("Failed to write audit log for model_promoted %s: %s", model_id, e)


    # Invalidate model-dependent cache and metadata cache after successful state commit
    try:
        from ..core.cache import invalidate_model
        invalidate_model(target["task"])
        invalidate_model_metadata(target["task"])
        ACTIVE_SERVING_VERSIONS[target["task"]] = target["version"]
    except Exception as e:
        logger.warning("Cache invalidation hook failed after model promotion: %s", e)

    return {
        "model_id":                     model_id,
        "task":                         target["task"],
        "version":                      target["version"],
        "status":                       "champion",
        "demoted_previous_champion_id": demoted_id,
        "smoke_test_status":            f"PASSED ({smoke_msg})",
        "promoted_by":                  user["username"],
        "message":                      f"Model {target['version']} successfully promoted to champion for {target['task']}.",
    }


@router.post("/{model_id}/reject")
def reject_model(
    model_id: int,
    body: ApprovalActionRequest = Body(default=ApprovalActionRequest()),
    user=Depends(require_any_role(["super_admin", "production_admin", "exploration_admin", "equipment_admin"])),
):
    """Reject a challenger model."""
    rows = query("SELECT * FROM gov.model_registry WHERE id=%s", (model_id,))
    if not rows:
        raise HTTPException(404, f"Model {model_id} not found.")
    m = rows[0]

    if m["status"] == "champion":
        raise HTTPException(422, "Cannot reject an active champion directly. Promote a new champion or rollback.")

    with transaction() as tx:
        tx.execute("UPDATE gov.model_registry SET status='rejected' WHERE id=%s", (model_id,))

        tx.execute(
            """INSERT INTO gov.model_approvals (model_id, action, actor_id, actor_role, note)
               VALUES (%s, 'rejected', %s, %s, %s)""",
            (model_id, user["username"], user["role"], body.note or "Rejected by reviewer")
        )

        try:
            audit_payload = json.dumps({
                "action": "model_rejected",
                "task": m["task"],
                "version": m["version"],
                "note": body.note or "Rejected by reviewer",
                "rejected_by": user["username"]
            })
            tx.execute(
                """INSERT INTO gov.audit_log (event_type, actor_id, actor_role, entity_type, entity_id, payload)
                   VALUES ('model_rejected', %s, %s, 'model_registry', %s, %s)""",
                (user["username"], user["role"], str(model_id), audit_payload)
            )
        except Exception as e:
            logger.error("Failed to write audit log for model_rejected %s: %s", model_id, e)

    return {"model_id": model_id, "status": "rejected", "message": f"Model {m['version']} rejected."}


@router.post("/{model_id}/rollback")
def rollback_model(
    model_id: int,
    body: ApprovalActionRequest = Body(default=ApprovalActionRequest()),
    user=Depends(require_any_role(["super_admin"])),
):
    """
    Emergency rollback: Demotes current champion and restores specified model.
    Runs smoke tests and hot-reloads model into memory.
    Restricted to super_admin.
    """
    rows = query("SELECT * FROM gov.model_registry WHERE id=%s", (model_id,))
    if not rows:
        raise HTTPException(404, f"Target rollback model {model_id} not found.")
    target = rows[0]

    # 1. Resolve exact target artifact
    art_path = None
    storage = get_storage_service()
    if target.get("artifact_path") and pathlib.Path(target["artifact_path"]).exists():
        art_path = pathlib.Path(target["artifact_path"])
    elif target.get("artifact_drive_file_id"):
        dest = ARTIFACTS / f"{target['task']}_{target['model']}_{target['version']}.joblib"
        try:
            storage.download_file(target["artifact_drive_file_id"], dest)
            art_path = dest
        except Exception as e:
            logger.warning("Could not download rollback artifact: %s", e)

    if not art_path or not art_path.exists():
        candidate_name = f"{target['task']}_{target['model']}.joblib"
        if (ARTIFACTS / candidate_name).exists():
            art_path = ARTIFACTS / candidate_name

    if not art_path or not art_path.exists():
        raise HTTPException(
            status_code=422,
            detail=f"Exact artifact for target rollback model '{target['version']}' not found. Cannot rollback."
        )

    # 2. Checksum verification if available
    if target.get("artifact_sha256"):
        actual_hash = compute_sha256(art_path.read_bytes())
        if actual_hash != target["artifact_sha256"]:
            raise HTTPException(
                status_code=422,
                detail=f"Rollback artifact checksum mismatch ({actual_hash} != {target['artifact_sha256']}). Rollback aborted."
            )

    # 3. Smoke test
    model_obj = joblib.load(art_path)
    passed, msg = smoke_test_model(target["task"], model_obj)
    if not passed:
        raise HTTPException(422, f"Rollback target failed smoke test: {msg}")

    # 4. In-memory hot-reload (must succeed before DB demote/restore)
    model_key = TASK_MODEL_KEYS.get(target["task"])
    if model_key:
        reloaded = reload_model(model_key, str(art_path))
        if not reloaded:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to hot-reload rollback model '{model_key}'. Active champion preserved."
            )

    # Demote current champion and restore target atomically
    current_champ_id = None
    with transaction() as tx:
        current = tx.query(
            "SELECT id, version FROM gov.model_registry WHERE task=%s AND status='champion' FOR UPDATE",
            (target["task"],)
        )
        current_champ_id = current[0]["id"] if current else None

        if current_champ_id:
            tx.execute("UPDATE gov.model_registry SET status='rolled_back' WHERE id=%s", (current_champ_id,))

        # Restore target
        tx.execute(
            "UPDATE gov.model_registry SET status='champion', rollback_of=%s, promoted_at=NOW() WHERE id=%s",
            (current_champ_id, model_id)
        )

        tx.execute(
            """INSERT INTO gov.model_approvals (model_id, action, actor_id, actor_role, note)
               VALUES (%s, 'rolled_back', %s, %s, %s)""",
            (model_id, user["username"], user["role"],
             f"Rolled back from {current_champ_id} to {model_id}. Reason: {body.note or 'Emergency rollback'}")
        )

        # Audit log
        try:
            audit_payload = json.dumps({
                "action": "model_rollback",
                "task": target["task"],
                "restored_version": target["version"],
                "demoted_champion_id": current_champ_id,
                "note": body.note or "Emergency rollback",
                "rolled_back_by": user["username"]
            })
            tx.execute(
                """INSERT INTO gov.audit_log (event_type, actor_id, actor_role, entity_type, entity_id, payload)
                   VALUES ('model_rollback', %s, %s, 'model_registry', %s, %s)""",
                (user["username"], user["role"], str(model_id), audit_payload)
            )
        except Exception as e:
            logger.error("Failed to write audit log for model_rollback %s: %s", model_id, e)


    # Invalidate model-dependent cache and metadata cache after successful rollback commit
    try:
        from ..core.cache import invalidate_model
        invalidate_model(target["task"])
        invalidate_model_metadata(target["task"])
        ACTIVE_SERVING_VERSIONS[target["task"]] = target["version"]
    except Exception as e:
        logger.warning("Cache invalidation hook failed after model rollback: %s", e)

    return {
        "model_id":            model_id,
        "task":                target["task"],
        "status":              "champion",
        "demoted_champion_id": current_champ_id,
        "message":             f"Successfully rolled back {target['task']} champion to version {target['version']}.",
    }


@router.get("/approvals")
def list_approvals(limit: int = 50, user=Depends(get_current_user)):
    """List recent model governance approval/promotion events."""
    rows = query(
        """SELECT a.id, a.model_id, a.action, a.actor_id, a.actor_role, a.note, a.created_at,
                  m.task, m.model, m.version
           FROM gov.model_approvals a
           LEFT JOIN gov.model_registry m ON a.model_id = m.id
           ORDER BY a.created_at DESC
           LIMIT %s""",
        (limit,)
    )
    return {"approvals": rows, "count": len(rows)}
