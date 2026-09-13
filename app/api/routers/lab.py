"""app/api/routers/lab.py — Crucible AI gateway in front of the Crucible AI engine.

Every Crucible AI capability reaches the browser through here, and only through here.
That gives the engine the three things it does not have on its own: an
authenticated caller, a role check, and a public surface it does not control.

Endpoints (mounted at /api/v1/lab):

  Datasets     GET  /datasets                          list engine datasets
               POST /datasets/upload                   register a file with the engine
               GET  /datasets/{id}/profile             deep statistical profile
               GET  /datasets/{id}/feature-roles       detected roles per column
               GET  /datasets/{id}/leakage             leakage risk report

  Pipelines    POST /pipelines/run                     start an AutoML run
               GET  /pipelines                         list runs
               GET  /pipelines/{id}                    run detail
               GET  /pipelines/{id}/status             lifecycle status
               GET  /pipelines/{id}/nodes              node DAG with per-node state
               GET  /pipelines/{id}/checkpoints        checkpoints with trust state

  Models       GET  /pipelines/{id}/candidates         candidate models considered
               GET  /pipelines/{id}/model              winning model
               GET  /pipelines/{id}/model/metrics      validation metrics
               GET  /pipelines/{id}/model/validation-strategy

  Inference    POST /pipelines/{id}/predict            predict from a trained run

  Diagnosis    GET  /pipelines/{id}/fault              fault detection
               GET  /pipelines/{id}/fault/localization where it failed
               GET  /pipelines/{id}/fault/root-cause   why it failed
               GET  /pipelines/{id}/recovery/decision  what the engine would do
               GET  /pipelines/{id}/recovery/plan      the concrete plan
               GET  /pipelines/{id}/recovery/result    what a run actually did
               GET  /pipelines/{id}/self-healing       self-healing state
               POST /pipelines/{id}/self-healing/trigger   role-gated, human-initiated

  Platform     GET  /integrity/artifacts               SHA-256 manifest status
               GET  /audit/events                      engine audit log
               GET  /observability/summary             execution telemetry
               GET  /status                            engine + bridge health

Reads require an authenticated user. Writes — starting a run, triggering
self-healing — require an elevated role, because they consume compute and change
state the whole team sees.
"""

import logging
from typing import Any

from fastapi import APIRouter, Depends, File, Query, UploadFile

from ..core.crucible_client import get_client
from ..core.rbac import require_any_role, require_authenticated
from ..core.security import get_current_user

logger = logging.getLogger("crucible.lab")
router = APIRouter(tags=["lab"])

#: Roles permitted to spend engine compute or mutate engine state.
WRITE_ROLES = ["super_admin", "management", "production_admin", "mine_planner", "exploration_admin", "equipment_admin", "guest", "unassigned"]


def _proxy(method: str, path: str, **kw: Any) -> dict[str, Any]:
    """Call the engine and shape the result for the frontend.

    Always returns a payload. An unreachable engine yields
    ``{"engine_available": false, ...}`` rather than an exception, so a lab
    outage degrades one panel instead of failing the page.
    """
    return get_client().request(method, path, **kw).to_payload()


# ── Datasets ─────────────────────────────────────────────────────────────────

@router.get("/datasets")
def list_datasets(user=Depends(require_authenticated())):
    return _proxy("GET", "/v1/datasets")


@router.post("/datasets/upload")
async def upload_dataset(
    file: UploadFile = File(...),
    user=Depends(require_any_role(WRITE_ROLES)),
):
    """Register a dataset with the engine.

    Streams straight through rather than going via `_proxy`, which is JSON-only.
    """
    import requests as _requests

    from ..core.crucible_client import get_client as _get_client

    client = _get_client()
    content = await file.read()
    try:
        response = _requests.post(
            f"{client.base_url}/v1/datasets/upload",
            files={"file": (file.filename, content, file.content_type)},
            timeout=60,
        )
        response.raise_for_status()
        payload = response.json()
        return {"engine_available": True, "data": payload.get("data", payload)}
    except _requests.RequestException as exc:
        logger.warning("Dataset upload to Crucible AI failed: %s", exc)
        return {
            "engine_available": False,
            "reason": "The Crucible AI engine could not accept the upload.",
            "degraded": "unreachable",
        }


@router.get("/datasets/{dataset_id}/profile")
def dataset_profile(dataset_id: str, user=Depends(require_authenticated())):
    return _proxy("GET", f"/v1/datasets/{dataset_id}/profile")


@router.get("/datasets/{dataset_id}/feature-roles")
def dataset_feature_roles(
    dataset_id: str,
    target: str | None = Query(None),
    user=Depends(require_authenticated()),
):
    params = {"target": target} if target else None
    return _proxy("GET", f"/v1/datasets/{dataset_id}/feature-roles", params=params)


@router.get("/datasets/{dataset_id}/leakage")
def dataset_leakage(
    dataset_id: str,
    target: str | None = Query(None),
    user=Depends(require_authenticated()),
):
    params = {"target": target} if target else None
    return _proxy("GET", f"/v1/datasets/{dataset_id}/leakage", params=params)


# ── Pipelines ────────────────────────────────────────────────────────────────

@router.post("/pipelines/run")
def run_pipeline(body: dict, user=Depends(require_any_role(WRITE_ROLES))):
    logger.info(
        "Lab run requested by %s for dataset %s",
        user.get("sub") or user.get("username"),
        body.get("dataset_id"),
    )
    return _proxy("POST", "/v1/pipelines/run", json_body=body)


@router.get("/pipelines")
def list_pipelines(user=Depends(require_authenticated())):
    return _proxy("GET", "/v1/pipelines")


@router.get("/pipelines/{execution_id}")
def get_pipeline(execution_id: str, user=Depends(require_authenticated())):
    return _proxy("GET", f"/v1/pipelines/{execution_id}")


@router.get("/pipelines/{execution_id}/status")
def pipeline_status(execution_id: str, user=Depends(require_authenticated())):
    return _proxy("GET", f"/v1/pipelines/{execution_id}/status")


@router.get("/pipelines/{execution_id}/nodes")
def pipeline_nodes(execution_id: str, user=Depends(require_authenticated())):
    return _proxy("GET", f"/v1/pipelines/{execution_id}/nodes")


@router.get("/pipelines/{execution_id}/checkpoints")
def pipeline_checkpoints(execution_id: str, user=Depends(require_authenticated())):
    return _proxy("GET", f"/v1/pipelines/{execution_id}/checkpoints")


# ── Models ───────────────────────────────────────────────────────────────────

@router.get("/pipelines/{execution_id}/candidates")
def model_candidates(execution_id: str, user=Depends(require_authenticated())):
    return _proxy("GET", f"/v1/pipelines/{execution_id}/candidates")


@router.get("/pipelines/{execution_id}/model")
def model_detail(execution_id: str, user=Depends(require_authenticated())):
    return _proxy("GET", f"/v1/pipelines/{execution_id}/model")


@router.get("/pipelines/{execution_id}/model/metrics")
def model_metrics(execution_id: str, user=Depends(require_authenticated())):
    return _proxy("GET", f"/v1/pipelines/{execution_id}/model/metrics")


@router.get("/pipelines/{execution_id}/model/validation-strategy")
def model_validation_strategy(execution_id: str, user=Depends(require_authenticated())):
    return _proxy("GET", f"/v1/pipelines/{execution_id}/model/validation-strategy")


# ── Inference ────────────────────────────────────────────────────────────────

@router.post("/pipelines/{execution_id}/predict")
def predict(execution_id: str, body: dict, user=Depends(require_authenticated())):
    return _proxy("POST", f"/v1/pipelines/{execution_id}/predict", json_body=body)


# ── Fault diagnosis and recovery ─────────────────────────────────────────────

@router.get("/pipelines/{execution_id}/fault")
def fault(execution_id: str, user=Depends(require_authenticated())):
    return _proxy("GET", f"/v1/pipelines/{execution_id}/fault")


@router.get("/pipelines/{execution_id}/fault/localization")
def fault_localization(execution_id: str, user=Depends(require_authenticated())):
    return _proxy("GET", f"/v1/pipelines/{execution_id}/fault/localization")


@router.get("/pipelines/{execution_id}/fault/root-cause")
def fault_root_cause(execution_id: str, user=Depends(require_authenticated())):
    return _proxy("GET", f"/v1/pipelines/{execution_id}/fault/root-cause")


@router.get("/pipelines/{execution_id}/recovery/decision")
def recovery_decision(execution_id: str, user=Depends(require_authenticated())):
    return _proxy("GET", f"/v1/pipelines/{execution_id}/recovery/decision")


@router.get("/pipelines/{execution_id}/recovery/plan")
def recovery_plan(execution_id: str, user=Depends(require_authenticated())):
    return _proxy("GET", f"/v1/pipelines/{execution_id}/recovery/plan")


@router.get("/pipelines/{execution_id}/recovery/result")
def recovery_result(execution_id: str, user=Depends(require_authenticated())):
    return _proxy("GET", f"/v1/pipelines/{execution_id}/recovery/result")


@router.get("/pipelines/{execution_id}/self-healing")
def self_healing_state(execution_id: str, user=Depends(require_authenticated())):
    return _proxy("GET", f"/v1/pipelines/{execution_id}/self-healing")


@router.post("/pipelines/{execution_id}/self-healing/trigger")
def trigger_self_healing(
    execution_id: str,
    user=Depends(require_any_role(WRITE_ROLES)),
):
    """Run the engine's recovery plan.

    Human-initiated by design. The plan is readable at `/recovery/plan` first,
    and nothing here fires on a schedule or in response to a failure alone.
    """
    logger.info(
        "Self-healing triggered on %s by %s",
        execution_id,
        user.get("sub") or user.get("username"),
    )
    return _proxy("POST", f"/v1/pipelines/{execution_id}/self-healing/trigger")


# ── Platform ─────────────────────────────────────────────────────────────────

@router.get("/integrity/artifacts")
def artifact_integrity(user=Depends(require_authenticated())):
    return _proxy("GET", "/v1/integrity/artifacts")


@router.get("/audit/events")
def audit_events(
    limit: int = Query(100, ge=1, le=1000),
    user=Depends(require_authenticated()),
):
    return _proxy("GET", "/v1/audit/events", params={"limit": limit})


@router.get("/observability/summary")
def observability_summary(user=Depends(require_authenticated())):
    return _proxy("GET", "/v1/observability/summary")


@router.get("/status")
def lab_status(user=Depends(get_current_user)):
    """Bridge and engine health, for the admin page and the degraded-state UI."""
    client = get_client()
    bridge = client.status()
    probe = client.health()
    return {
        "engine_available": probe.ok,
        "bridge": bridge,
        "engine": probe.data if probe.ok else None,
        "reason": None if probe.ok else probe.reason,
    }
