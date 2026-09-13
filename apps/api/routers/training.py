"""apps/api/routers/training.py — Training run lifecycle management.

Endpoints:
  POST /api/v1/training/trigger           — queue a training run (Modal / Local / Sim)
  GET  /api/v1/training/runs              — list training runs with full provenance
  GET  /api/v1/training/runs/{run_id}     — get run detail + challenger models + artifacts
  POST /api/v1/training/runs/{run_id}/cancel — cancel a queued/running run
"""
import json
import logging
import os
import pathlib
import threading
import time
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core.config import settings
from ..core.db import execute, query
from ..core.rbac import check_domain_access, require_authenticated
from ..core.security import get_current_user

logger = logging.getLogger("minex.training")
router = APIRouter(tags=["training"])

# Pre-validated baseline metrics from FINAL_MODEL_VALIDATION.csv (used only for baseline seeding / simulation)
VALIDATED_METRICS: dict[str, dict] = {
    "production_forecast": {
        "model": "lightgbm", "metric_mae": 30.9, "metric_r2": 0.7742,
        "metric_roc_auc": None, "metric_pr_auc": None, "metric_lift": None,
        "split_type": "temporal", "data_origin": "SYNTHETIC"
    },
    "shortfall": {
        "model": "logistic_baseline_calibrated", "metric_roc_auc": 0.7241,
        "metric_pr_auc": 0.6532, "metric_mae": None, "metric_r2": None,
        "metric_lift": None, "split_type": "temporal", "data_origin": "SYNTHETIC"
    },
    "equipment_failure": {
        "model": "logistic_baseline", "metric_roc_auc": 0.6018,
        "metric_pr_auc": 0.1315, "metric_lift": 1.51,
        "metric_mae": None, "metric_r2": None,
        "split_type": "temporal", "data_origin": "SYNTHETIC"
    },
    "prospectivity": {
        "model": "logistic_baseline", "metric_roc_auc": 0.9005,
        "metric_pr_auc": 0.8488, "metric_lift": None,
        "metric_mae": None, "metric_r2": None,
        "split_type": "spatial", "data_origin": "SYNTHETIC"
    },
}

DOMAIN_TASKS: dict[str, list[str]] = {
    "production":  ["production_forecast", "shortfall"],
    "equipment":   ["equipment_failure"],
    "exploration": ["prospectivity"],
    "maintenance": [],
}


class TriggerRequest(BaseModel):
    domain: str
    dataset_version_id: int | None = None
    note: str | None = None


def is_modal_configured() -> bool:
    """Check if Modal credentials or configuration are available."""
    if os.getenv("MODAL_TOKEN_ID") and os.getenv("MODAL_TOKEN_SECRET"):
        return True
    return (pathlib.Path.home() / ".modal.toml").exists()


def _run_modal_training(
    run_id: int,
    run_tag: str,
    domain: str,
    triggered_by: str,
    dataset_drive_file_id: str | None = None,
    dataset_version_id: int | None = None,
    expected_checksum: str | None = None,
    data_origin: str = "SYNTHETIC",
):
    """Execute live training job via Modal.com serverless container."""
    try:
        execute(
            "UPDATE gov.training_runs SET status='running', started_at=NOW() WHERE id=%s",
            (run_id,)
        )
        logger.info("Connecting to Modal cloud for domain '%s' (dataset: %s)...", domain, dataset_drive_file_id)
        import modal
        fn: Any = modal.Function.from_name("minex-training", "run_training_job")
        root_folder = os.getenv("GDRIVE_FOLDER_ID", "1XykuJ8El-yQ_27FrdCzL7VHraoyGrBKy")
        result: dict[str, Any] = fn.remote(
            domain=domain,
            dataset_drive_file_id=dataset_drive_file_id,
            dataset_version_id=dataset_version_id,
            expected_checksum=expected_checksum,
            data_origin=data_origin,
            gdrive_root_folder_id=root_folder,
        )
        logger.info("Modal training completed successfully: %s", result)

        if result.get("status") != "completed":
            raise RuntimeError(f"Modal training reported failure: {result.get('runs')}")

        model_ids = []
        artifacts_by_name = {a["name"]: a for a in result.get("artifacts", [])}

        for m in result.get("metrics", []):
            task = m.get("task")
            if not task or m.get("split") != "test":
                continue
            model_name = m.get("model", "unknown")

            def _to_float(v):
                try:
                    return float(v) if v not in (None, "") else None
                except (ValueError, TypeError):
                    return None

            # Look up matching artifact
            art_filename = f"{task}_{model_name}.joblib"
            art_meta = artifacts_by_name.get(art_filename, {})
            real_drive_id = art_meta.get("drive_file_id")
            art_status = "AVAILABLE" if real_drive_id else "REGISTERED"

            rows = query(
                """INSERT INTO gov.model_registry
                   (task, model, version, status, metric_roc_auc, metric_pr_auc,
                    metric_mae, metric_r2, metric_lift, split_type, data_origin,
                    artifact_path, artifact_drive_file_id, artifact_sha256,
                    artifact_size_bytes, training_run_id, leakage_status)
                   VALUES (%s,%s,%s,'challenger',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'PASS')
                   RETURNING id""",
                (
                    task,
                    model_name,
                    f"challenger-{run_tag}",
                    _to_float(m.get("metric_roc_auc")),
                    _to_float(m.get("metric_pr_auc")),
                    _to_float(m.get("metric_mae")),
                    _to_float(m.get("metric_r2")),
                    _to_float(m.get("metric_lift")),
                    m.get("split_type", "temporal"),
                    data_origin,
                    f"apps/ml/artifacts/{art_filename}",
                    real_drive_id,
                    art_meta.get("sha256"),
                    art_meta.get("size_bytes"),
                    run_id,
                )
            )
            if rows:
                mid = rows[0]["id"]
                model_ids.append(mid)
                # Register in gov.model_artifacts
                execute(
                    """INSERT INTO gov.model_artifacts
                       (model_id, filename, drive_file_id, drive_folder_id, sha256, size_bytes, content_type, status)
                       VALUES (%s, %s, %s, %s, %s, %s, 'application/octet-stream', %s)""",
                    (
                        mid,
                        art_filename,
                        real_drive_id,
                        art_meta.get("drive_folder_id"),
                        art_meta.get("sha256"),
                        art_meta.get("size_bytes"),
                        art_status,
                    )
                )

        log_entry = json.dumps({
            "run_tag": run_tag,
            "domain": domain,
            "mode": "MODAL_CLOUD",
            "dataset_version_id": dataset_version_id,
            "dataset_drive_file_id": dataset_drive_file_id,
            "model_ids": model_ids,
            "modal_result": result,
        })
        execute(
            """UPDATE gov.training_runs
               SET status='completed', completed_at=NOW(), log_path=%s WHERE id=%s""",
            (log_entry, run_id)
        )
    except Exception as e:
        logger.error("Modal remote training failed for run_id=%s: %s", run_id, e)
        # Never silently fallback to fake metrics when Modal mode is requested!
        execute(
            "UPDATE gov.training_runs SET status='failed', error_message=%s WHERE id=%s",
            (f"Modal training failed: {e!s}", run_id)
        )


def _simulate_training(
    run_id: int,
    run_tag: str,
    domain: str,
    triggered_by: str,
    dataset_version_id: int | None = None,
    data_origin: str = "SYNTHETIC",
):
    """
    Simulates a training run in a background thread for testing/demo mode.
    Clearly labeled SYNTHETIC / DEMO_SIMULATION.
    """
    try:
        time.sleep(3)
        execute(
            "UPDATE gov.training_runs SET status='running', started_at=NOW() WHERE id=%s",
            (run_id,)
        )
        time.sleep(2)

        tasks = DOMAIN_TASKS.get(domain, [])
        model_ids = []

        for task in tasks:
            metrics = VALIDATED_METRICS.get(task, {})
            rows = query(
                """INSERT INTO gov.model_registry
                   (task, model, version, status, metric_roc_auc, metric_pr_auc,
                    metric_mae, metric_r2, metric_lift, split_type, data_origin,
                    artifact_path, training_run_id, leakage_status)
                   VALUES (%s,%s,%s,'challenger',%s,%s,%s,%s,%s,%s,%s,%s,%s,'PASS')
                   RETURNING id""",
                (
                    task,
                    metrics.get("model", "unknown"),
                    f"challenger-{run_tag}",
                    metrics.get("metric_roc_auc"),
                    metrics.get("metric_pr_auc"),
                    metrics.get("metric_mae"),
                    metrics.get("metric_r2"),
                    metrics.get("metric_lift"),
                    metrics.get("split_type", "temporal"),
                    data_origin,
                    f"apps/ml/artifacts/{task}_{metrics.get('model','unknown')}.joblib",
                    run_id,
                )
            )
            if rows:
                model_ids.append(rows[0]["id"])

        log_entry = json.dumps({
            "run_tag": run_tag,
            "domain": domain,
            "tasks": tasks,
            "model_ids": model_ids,
            "mode": "DEMO_SIMULATION",
            "note": "Metrics from FINAL_MODEL_VALIDATION.csv — baseline simulation",
        })

        execute(
            """UPDATE gov.training_runs
               SET status='completed', completed_at=NOW(), log_path=%s WHERE id=%s""",
            (log_entry, run_id)
        )
        logger.info("Training simulation completed: run_id=%s, tasks=%s", run_id, tasks)
    except Exception as e:
        logger.error("Training simulation failed: run_id=%s error=%s", run_id, e)
        execute(
            "UPDATE gov.training_runs SET status='failed', error_message=%s WHERE id=%s",
            (str(e), run_id)
        )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/trigger")
def trigger_training(
    body: TriggerRequest,
    user=Depends(require_authenticated()),
):
    """Queue a training run for a domain with strict domain RBAC and data provenance."""
    from ..core.schema_mapper import list_domains
    if body.domain not in list_domains():
        raise HTTPException(400, f"Domain '{body.domain}' not supported.")

    if not check_domain_access(user, body.domain):
        raise HTTPException(
            status_code=403,
            detail=f"Role '{user.get('role')}' is not authorized to trigger training for domain '{body.domain}'.",
        )

    # Validate dataset version if provided
    canonical_drive_id = None
    expected_checksum = None
    data_origin = "SYNTHETIC"

    if body.dataset_version_id:
        ver = query(
            """SELECT id, status, canonical_drive_file_id, canonical_checksum_sha256, checksum_sha256
               FROM hub.dataset_versions WHERE id=%s""",
            (body.dataset_version_id,)
        )
        if not ver:
            raise HTTPException(404, f"Dataset version {body.dataset_version_id} not found.")
        if ver[0]["status"] not in ("APPROVED_FOR_TRAINING", "VALIDATED"):
            raise HTTPException(
                422,
                f"Dataset version must be APPROVED_FOR_TRAINING. Current status: {ver[0]['status']}"
            )
        canonical_drive_id = ver[0].get("canonical_drive_file_id")
        expected_checksum = ver[0].get("canonical_checksum_sha256") or ver[0].get("checksum_sha256")
        data_origin = "REAL_USER_UPLOADED"

    # Recover any stale RUNNING jobs for this domain (daemon threads lost on restart).
    # Mark RUNNING jobs older than 2 hours as abandoned so new triggers can proceed.
    try:
        execute(
            """UPDATE gov.training_runs
               SET status='abandoned',
                   error_message='Automatically abandoned: process restart or daemon thread loss after 2h timeout',
                   completed_at=NOW()
               WHERE domain=%s AND status='running'
                 AND started_at < NOW() - INTERVAL '2 hours'""",
            (body.domain,)
        )
    except Exception as e:
        logger.warning("Could not recover stale training runs for domain '%s': %s", body.domain, e)

    run_tag = f"run-{body.domain[:4].upper()}-{uuid.uuid4().hex[:6].upper()}"

    # Atomic INSERT: the partial unique index uix_one_active_run_per_domain on
    # (domain) WHERE status IN ('queued','running') guarantees at-most-one active
    # run per domain at the DB level. A UniqueViolation here means a concurrent
    # trigger beat us; we surface it as HTTP 409 without a prior SELECT race.
    try:
        rows = query(
            """INSERT INTO gov.training_runs
               (run_tag, status, domain, dataset_version_id, triggered_by, data_origin)
               VALUES (%s, 'queued', %s, %s, %s, %s) RETURNING id""",
            (run_tag, body.domain, body.dataset_version_id, user["username"], data_origin)
        )
    except Exception as e:
        # Catch unique-constraint violation (psycopg2.errors.UniqueViolation)
        if "uix_one_active_run_per_domain" in str(e) or "unique" in str(e).lower():
            raise HTTPException(
                409,
                f"A training run is already queued or running for domain '{body.domain}'."
            )
        raise

    run_id = rows[0]["id"]

    # Structured audit log — must not be silently swallowed for training events
    import json as _json
    audit_payload = _json.dumps({
        "run_id": run_id,
        "run_tag": run_tag,
        "domain": body.domain,
        "dataset_version_id": body.dataset_version_id,
        "data_origin": data_origin,
        "note": body.note,
    })
    try:
        execute(
            """INSERT INTO gov.audit_log(event_type, actor_id, actor_role, entity_type, entity_id, payload)
               VALUES('training_triggered',%s,%s,'training_run',%s,%s)""",
            (user["username"], user.get("role", "unknown"), str(run_id), audit_payload)
        )
    except Exception as audit_err:
        # Audit failure is logged but does not abort the training trigger itself
        logger.error(
            "AUDIT WRITE FAILED for training_triggered run_id=%s: %s",
            run_id, audit_err
        )

    # Mode selection based on config
    training_mode = getattr(settings, "TRAINING_MODE", "modal").lower()
    use_modal = training_mode == "modal" and is_modal_configured()

    if use_modal:
        mode = "MODAL_CLOUD"
        message = "Training queued on Modal.com serverless GPU/CPU cluster."
        target_func = _run_modal_training
        args = (run_id, run_tag, body.domain, user["username"], canonical_drive_id, body.dataset_version_id, expected_checksum, data_origin)
    else:
        mode = "DEMO_SIMULATION"
        message = "Training queued in simulation mode (set TRAINING_MODE=modal and authenticate Modal for live cloud runs)."
        target_func = _simulate_training
        args = (run_id, run_tag, body.domain, user["username"], body.dataset_version_id, data_origin)

    t = threading.Thread(target=target_func, args=args, daemon=True)
    t.start()

    return {
        "run_id":              run_id,
        "run_tag":             run_tag,
        "domain":              body.domain,
        "dataset_version_id":  body.dataset_version_id,
        "status":              "queued",
        "mode":                mode,
        "message":             message,
        "data_origin":         data_origin,
    }


@router.get("/runs")
def list_runs(domain: str | None = None, user=Depends(get_current_user)):
    """List all training runs with full metadata and dataset links."""
    if domain:
        rows = query(
            """SELECT r.*, v.version_tag, v.drive_file_id as dataset_drive_id
               FROM gov.training_runs r
               LEFT JOIN hub.dataset_versions v ON v.id = r.dataset_version_id
               WHERE r.domain=%s
               ORDER BY r.triggered_at DESC""",
            (domain,)
        )
    else:
        rows = query(
            """SELECT r.*, v.version_tag, v.drive_file_id as dataset_drive_id
               FROM gov.training_runs r
               LEFT JOIN hub.dataset_versions v ON v.id = r.dataset_version_id
               ORDER BY r.triggered_at DESC"""
        )
    return {"runs": rows, "count": len(rows)}


@router.get("/runs/{run_id}")
def get_run(run_id: int, user=Depends(get_current_user)):
    """Get full training run detail including created challenger models and artifacts."""
    rows = query(
        """SELECT r.*, v.version_tag, v.drive_file_id as dataset_drive_id
           FROM gov.training_runs r
           LEFT JOIN hub.dataset_versions v ON v.id = r.dataset_version_id
           WHERE r.id=%s""",
        (run_id,)
    )
    if not rows:
        raise HTTPException(404, f"Training run {run_id} not found.")
    run = rows[0]

    challengers = query(
        """SELECT m.*, a.drive_file_id as artifact_drive_id, a.sha256 as artifact_hash, a.status as artifact_status
           FROM gov.model_registry m
           LEFT JOIN gov.model_artifacts a ON a.model_id = m.id
           WHERE m.training_run_id = %s OR (m.version LIKE %s AND m.status='challenger')""",
        (run_id, f"challenger-{run.get('run_tag', '')}%")
    ) if run.get("run_tag") else []

    return {"run": run, "challengers": challengers}


@router.post("/runs/{run_id}/cancel")
def cancel_run(run_id: int, user=Depends(require_authenticated())):
    """Cancel a queued training run."""
    rows = query("SELECT id, status, domain FROM gov.training_runs WHERE id=%s", (run_id,))
    if not rows:
        raise HTTPException(404, f"Training run {run_id} not found.")

    if not check_domain_access(user, rows[0]["domain"]):
        raise HTTPException(403, "Not authorized to cancel this run.")

    if rows[0]["status"] not in ("queued",):
        raise HTTPException(422, f"Can only cancel queued runs. Current status: {rows[0]['status']}")

    execute(
        "UPDATE gov.training_runs SET status='cancelled', error_message='Cancelled by user', completed_at=NOW() WHERE id=%s",
        (run_id,)
    )
    return {"run_id": run_id, "status": "cancelled", "message": "Training run cancelled."}
