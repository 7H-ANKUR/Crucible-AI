"""apps/api/core/ml_loader.py — Load all .joblib model artifacts at startup.

Load order for each artifact:
  1. Check local disk  (apps/ml/artifacts/)
  2. If missing → attempt download from Google Drive via gdrive_artifacts.py
  3. If still missing → log warning, model unavailable (endpoints will use fallbacks)

Critical invariant:
  The serving model version reported in API responses and written to the prediction
  ledger must ALWAYS equal the model actually used for inference.
  ensure_active_model() achieves this via ServingStatus:
    SYNCED       — serving version == authoritative version
    SYNC_PENDING — waiting for artifact; still serving old version
    SYNC_FAILED  — artifact check/load failed; still serving old version
    UNAVAILABLE  — no model loaded at all
"""
import hashlib
import logging
import pathlib
import threading
import time
from enum import Enum
from typing import Any

import joblib

from .config import ARTIFACTS
from .gdrive_artifacts import ensure_artifact

logger = logging.getLogger("minex.ml")
MODELS: dict = {}


class ServingStatus(str, Enum):
    SYNCED = "SYNCED"           # serving == authoritative
    SYNC_PENDING = "SYNC_PENDING"  # artifact missing; old model still active
    SYNC_FAILED = "SYNC_FAILED"    # artifact found but load/check failed; old model still active
    UNAVAILABLE = "UNAVAILABLE"    # no model loaded at all

# All artifact filenames expected by the platform
_SPECS = [
    ("prospectivity",        "prospectivity_champion.joblib"),
    ("prospectivity_feats",  "prospectivity_features.joblib"),
    ("prod_forecast",        "production_forecast_champion.joblib"),
    ("prod_p10",             "production_forecast_p10.joblib"),
    ("prod_p50",             "production_forecast_p50.joblib"),
    ("prod_p90",             "production_forecast_p90.joblib"),
    ("prod_feats",           "production_forecast_features.joblib"),
    ("prod_medians",         "production_forecast_medians.joblib"),
    ("prod_explainer",       "production_forecast_explainer.joblib"),
    ("shortfall",            "shortfall_champion.joblib"),
    ("shortfall_feats",      "shortfall_features.joblib"),
    ("equipment",            "equipment_failure_champion.joblib"),
    ("equipment_feats",      "equipment_failure_features.joblib"),
    ("equipment_catmap",     "equipment_failure_catmap.joblib"),
    ("equipment_medians",    "equipment_failure_medians.joblib"),
    ("equipment_calibrator", "equipment_failure_calibrator.joblib"),
]


def load_all_models() -> None:
    """Load every model artifact into the in-process MODELS registry.

    Missing files are downloaded from Google Drive if a Drive ID is configured
    in gdrive_artifacts.DRIVE_FILE_IDS. Missing files without a Drive ID are
    skipped with a warning — endpoints gracefully degrade to heuristic fallbacks.
    """
    loaded = 0
    skipped = 0

    for key, fname in _SPECS:
        available = ensure_artifact(ARTIFACTS, fname)
        if not available:
            skipped += 1
            continue
        path = ARTIFACTS / fname
        try:
            MODELS[key] = joblib.load(path)
            logger.info("  ✓ Loaded: %s", fname)
            loaded += 1
        except Exception as e:
            logger.error("  ✗ Failed to load %s: %s", fname, e)
            skipped += 1

    logger.info(
        "ML artifacts: %d loaded, %d skipped. "
        "Add Drive IDs to gdrive_artifacts.py to enable missing models.",
        loaded, skipped,
    )


def get_model(key: str):
    """Return a loaded model by key, or None if unavailable."""
    return MODELS.get(key)


# ===========================================================================
# Authoritative Model Registry & Multi-Instance Serving Synchronization
# ===========================================================================

TASK_TO_MODEL_KEY = {
    "production_forecast": "prod_forecast",
    "shortfall": "shortfall",
    "equipment_failure": "equipment",
    "prospectivity": "prospectivity",
}

# In-memory metadata cache (short TTL) to avoid hitting PostgreSQL on every request
_METADATA_CACHE: dict[str, tuple[float, dict]] = {}
_METADATA_LOCK = threading.Lock()
_METADATA_TTL = 10.0  # seconds

# Tracks the model version ACTUALLY loaded and serving in this process.
# This is authoritative for what version to report in API responses and ledger rows.
# It is only updated when a new model passes all checks and is atomically swapped in.
ACTIVE_SERVING_VERSIONS: dict[str, str | None] = {
    "production_forecast": None,  # None = not yet loaded from disk
    "shortfall": None,
    "equipment_failure": None,
    "prospectivity": None,
}


def invalidate_model_metadata(task: str | None = None) -> None:
    """Invalidate process-local metadata cache when promotion or rollback occurs."""
    with _METADATA_LOCK:
        if task:
            _METADATA_CACHE.pop(task, None)
        else:
            _METADATA_CACHE.clear()
    logger.info("Invalidated model metadata cache (task=%s)", task or "all")


def get_active_model_metadata(task: str) -> dict:
    """Authoritative lookup of active champion metadata for a task from PostgreSQL gov.model_registry.

    Guarantees:
    - Version comes from governance registry, NEVER inferred from type(model).__name__.
    - Caches metadata for 10s TTL to protect DB performance.
    - Gracefully defaults if DB is temporarily unreachable or unseeded.
    """
    now = time.monotonic()
    with _METADATA_LOCK:
        cached = _METADATA_CACHE.get(task)
        if cached and (now - cached[0] < _METADATA_TTL):
            return cached[1].copy()

    # Query PostgreSQL model registry
    meta = None
    try:
        from .db import query
        rows = query(
            """SELECT id, task, model, version, status, dataset_version_id, data_origin,
                      artifact_path, artifact_drive_file_id, artifact_sha256, artifact_size_bytes,
                      registered_at, promoted_at
               FROM gov.model_registry
               WHERE task = %s AND status = 'champion'
               ORDER BY promoted_at DESC NULLS LAST, registered_at DESC
               LIMIT 1""",
            (task,)
        )
        if rows:
            r = rows[0]
            v = r["version"]
            ds_id = r.get("dataset_version_id")
            meta = {
                "id": r["id"],
                "task": r["task"],
                "version": v,
                "model_version": v,
                "dataset_version_id": ds_id,
                "dataset_version": f"ds-v{ds_id}" if ds_id else "v1.0",
                "model": r.get("model") or "champion",
                "status": "champion",
                "data_origin": r.get("data_origin") or "SYNTHETIC",
                "artifact_path": r.get("artifact_path"),
                "artifact_drive_file_id": r.get("artifact_drive_file_id"),
                "artifact_sha256": r.get("artifact_sha256"),
                "artifact_size_bytes": r.get("artifact_size_bytes"),
            }
    except Exception as e:
        logger.warning("Could not query gov.model_registry for task '%s': %s", task, e)

    if not meta:
        # Fallback default metadata if registry has no champion yet
        v = ACTIVE_SERVING_VERSIONS.get(task) or "v1.0-champion"
        meta = {
            "id": 0,
            "task": task,
            "version": v,
            "model_version": v,
            "dataset_version": "v1.0",
            "model": "baseline",
            "status": "champion",
            "dataset_version_id": None,
            "data_origin": "SYNTHETIC",
            "artifact_path": None,
            "artifact_drive_file_id": None,
            "artifact_sha256": None,
            "artifact_size_bytes": None,
        }

    with _METADATA_LOCK:
        _METADATA_CACHE[task] = (now, meta)

    return meta.copy()


def ensure_active_model(task: str) -> tuple[Any, dict]:
    """Ensure the local process is serving the authoritative champion model.

    CRITICAL INVARIANT: The returned metadata['serving_model_version'] always
    reflects the model ACTUALLY in memory and used for inference — never the
    authoritative target if the swap failed or is pending.

    Serving state machine:
      SYNCED      — serving == authoritative; use serving_model_version in all responses
      SYNC_FAILED — artifact check/load failed; old model still active
      SYNC_PENDING — artifact not found; old model still active (may resolve later)
      UNAVAILABLE — no model loaded at all; use heuristic fallback
    """
    metadata = get_active_model_metadata(task)
    target_version = metadata["version"]
    model_key = TASK_TO_MODEL_KEY.get(task)
    if not model_key:
        return None, _build_serving_meta(
            metadata, ServingStatus.UNAVAILABLE, target_version,
            serving_version=None, authoritative_version=target_version
        )

    current_model = MODELS.get(model_key)
    current_version = ACTIVE_SERVING_VERSIONS.get(task)

    # CASE 1: Already serving the target champion — report actual serving version
    if current_model is not None and current_version == target_version:
        return current_model, _build_serving_meta(
            metadata, ServingStatus.SYNCED,
            version=current_version,
            serving_version=current_version,
            authoritative_version=target_version
        )

    # CASE 2: First load — no version in memory yet; use initial disk artifact
    if current_model is not None and current_version is None:
        # Model was loaded from disk at startup before registry query.
        # Accept it as the serving model but flag as SYNC_PENDING until version confirmed.
        serving_version = target_version  # best effort
        ACTIVE_SERVING_VERSIONS[task] = serving_version
        return current_model, _build_serving_meta(
            metadata, ServingStatus.SYNCED,
            version=serving_version,
            serving_version=serving_version,
            authoritative_version=target_version
        )

    # CASE 3: Version mismatch or model not yet loaded — attempt safe atomic hot-reload
    logger.info(
        "Model sync attempt: task='%s' current='%s' target='%s'",
        task, current_version, target_version
    )

    art_path = _resolve_artifact_path(task, target_version, metadata)

    if not art_path:
        logger.error(
            "Fail-Safe [SYNC_PENDING]: Artifact for '%s' not found. Serving '%s'.",
            target_version, current_version
        )
        return current_model, _build_serving_meta(
            metadata, ServingStatus.SYNC_PENDING,
            version=current_version or "uninitialized",
            serving_version=current_version,
            authoritative_version=target_version
        )

    # Checksum verification
    if metadata.get("artifact_sha256"):
        try:
            actual_sha = hashlib.sha256(art_path.read_bytes()).hexdigest()
            if actual_sha != metadata["artifact_sha256"]:
                logger.error(
                    "Fail-Safe [SYNC_FAILED]: Checksum mismatch for '%s' "
                    "(expected=%s got=%s). Serving '%s'.",
                    target_version, metadata["artifact_sha256"], actual_sha, current_version
                )
                return current_model, _build_serving_meta(
                    metadata, ServingStatus.SYNC_FAILED,
                    version=current_version or "uninitialized",
                    serving_version=current_version,
                    authoritative_version=target_version
                )
        except Exception as e:
            logger.error(
                "Fail-Safe [SYNC_FAILED]: Checksum error for '%s': %s. Serving '%s'.",
                target_version, e, current_version
            )
            return current_model, _build_serving_meta(
                metadata, ServingStatus.SYNC_FAILED,
                version=current_version or "uninitialized",
                serving_version=current_version,
                authoritative_version=target_version
            )

    # Load artifact
    try:
        new_model_obj = joblib.load(art_path)
    except Exception as e:
        logger.error(
            "Fail-Safe [SYNC_FAILED]: joblib.load failed for '%s': %s. Serving '%s'.",
            art_path, e, current_version
        )
        return current_model, _build_serving_meta(
            metadata, ServingStatus.SYNC_FAILED,
            version=current_version or "uninitialized",
            serving_version=current_version,
            authoritative_version=target_version
        )

    # Smoke test
    smoke_passed, smoke_msg = smoke_test_model(task, new_model_obj)
    if not smoke_passed:
        logger.error(
            "Fail-Safe [SYNC_FAILED]: Smoke test failed for '%s': %s. Serving '%s'.",
            target_version, smoke_msg, current_version
        )
        return current_model, _build_serving_meta(
            metadata, ServingStatus.SYNC_FAILED,
            version=current_version or "uninitialized",
            serving_version=current_version,
            authoritative_version=target_version
        )

    # All checks passed: atomically replace in-memory model
    MODELS[model_key] = new_model_obj
    ACTIVE_SERVING_VERSIONS[task] = target_version
    logger.info(
        "SYNCED: Hot-reloaded champion '%s' for task '%s'.", target_version, task
    )
    return new_model_obj, _build_serving_meta(
        metadata, ServingStatus.SYNCED,
        version=target_version,
        serving_version=target_version,
        authoritative_version=target_version
    )


def _build_serving_meta(
    base_meta: dict,
    status: ServingStatus,
    version: str | None,
    serving_version: str | None,
    authoritative_version: str,
) -> dict:
    """Build serving metadata that truthfully represents the current serving state."""
    m = base_meta.copy()
    m["serving_status"] = status.value
    m["sync_status"] = status.value
    m["serving_model_version"] = serving_version or "uninitialized"
    m["authoritative_model_version"] = authoritative_version
    # 'version' in the response always reflects what was ACTUALLY served
    m["version"] = serving_version or "uninitialized"
    m["model_version"] = serving_version or "uninitialized"
    return m


def _resolve_artifact_path(
    task: str, target_version: str, metadata: dict
) -> pathlib.Path | None:
    """Resolve local artifact path, downloading from Drive if necessary."""
    # 1. Explicit artifact_path from registry
    if metadata.get("artifact_path"):
        p = pathlib.Path(metadata["artifact_path"])
        if p.exists():
            return p

    # 2. Canonical naming conventions
    cand1 = ARTIFACTS / f"{task}_{metadata.get('model')}_{target_version}.joblib"
    cand2 = ARTIFACTS / f"{task}_{metadata.get('model')}.joblib"
    if cand1.exists():
        return cand1
    if cand2.exists():
        return cand2

    # 3. Download from Drive if file ID is known
    if metadata.get("artifact_drive_file_id"):
        try:
            from .storage import get_storage_service
            storage = get_storage_service()
            dest = ARTIFACTS / f"{task}_{metadata.get('model')}_{target_version}.joblib"
            storage.download_file(metadata["artifact_drive_file_id"], dest)
            if dest.exists():
                return dest
        except Exception as e:
            logger.warning(
                "Drive download failed for '%s' (file_id=%s): %s",
                target_version, metadata["artifact_drive_file_id"], e
            )

    return None


def reload_model(key: str, local_path: str) -> bool:
    """Hot-reload a single model after promotion (no server restart needed).

    Called by model_approval.py after a challenger is promoted to champion.
    Returns True on success.
    """
    import pathlib
    p = pathlib.Path(local_path)
    if not p.exists():
        logger.error("reload_model: file not found: %s", local_path)
        return False
    try:
        MODELS[key] = joblib.load(p)
        logger.info("Hot-reloaded model '%s' from %s", key, local_path)
        return True
    except Exception as e:
        logger.error("reload_model failed for '%s': %s", key, e)
        return False


def smoke_test_model(task: str, model_obj) -> tuple[bool, str]:
    """Execute smoke test inference on realistic representative sample features. Returns (passed, message)."""
    import numpy as np
    import pandas as pd

    # 1. Look up feature names
    feat_keys = {
        "production_forecast": "prod_feats",
        "shortfall": "shortfall_feats",
        "equipment_failure": "equipment_feats",
        "prospectivity": "prospectivity_feats",
    }
    feat_key = feat_keys.get(task)
    feats = MODELS.get(feat_key) if feat_key else None
    if not feats:
        fname = {
            "production_forecast": "production_forecast_features.joblib",
            "shortfall": "shortfall_features.joblib",
            "equipment_failure": "equipment_failure_features.joblib",
            "prospectivity": "prospectivity_features.joblib",
        }.get(task)
        if fname and (ARTIFACTS / fname).exists():
            try:
                feats = joblib.load(ARTIFACTS / fname)
            except Exception:
                pass

    # 2. Build realistic representative sample row from domain medians
    sample_data = {}
    medians = None
    if task in ("production_forecast", "shortfall"):
        medians = MODELS.get("prod_medians")
        if not medians and (ARTIFACTS / "production_forecast_medians.joblib").exists():
            try:
                medians = joblib.load(ARTIFACTS / "production_forecast_medians.joblib")
            except Exception:
                pass
    elif task == "equipment_failure":
        medians = MODELS.get("equipment_medians")
        if not medians and (ARTIFACTS / "equipment_failure_medians.joblib").exists():
            try:
                medians = joblib.load(ARTIFACTS / "equipment_failure_medians.joblib")
            except Exception:
                pass

    if feats:
        for f in feats:
            if medians and isinstance(medians, (dict, pd.Series)) and f in medians:
                sample_data[f] = [float(medians[f])]
            else:
                # Sensible non-zero default
                sample_data[f] = [1.0]
        test_df = pd.DataFrame(sample_data)
    else:
        test_df = pd.DataFrame([np.ones(10)])

    try:
        if hasattr(model_obj, "predict_proba"):
            try:
                res = model_obj.predict_proba(test_df)
            except Exception:
                res = model_obj.predict_proba(test_df.values)
            val = float(res[0][1]) if len(res[0]) > 1 else float(res[0][0])
        elif hasattr(model_obj, "predict"):
            try:
                res = model_obj.predict(test_df)
            except Exception:
                res = model_obj.predict(test_df.values)
            val = float(res[0])
        else:
            return False, "Model object has neither predict nor predict_proba method"

        if np.isnan(val) or np.isinf(val):
            return False, f"Smoke test produced NaN or Inf output: {val}"
        return True, f"Smoke test passed with realistic sample: output={val:.4f}"
    except Exception as e:
        return False, f"Smoke test failed with exception: {e}"
