"""apps/api/core/gdrive_artifacts.py — Google Drive artifact registry and downloader.

Each model artifact can be fetched via:
1. Shared Google Drive Folder (DRIVE_FOLDER_ID): Automatically scans folder for all .joblib files.
2. Direct File ID Registry (DRIVE_FILE_IDS): Specific file ID per artifact.

At startup, ml_loader calls `ensure_artifact(fname)` which:
  1. Returns immediately if the file exists locally.
  2. If missing, attempts to resolve file ID from DRIVE_FOLDER_ID or DRIVE_FILE_IDS.
  3. Downloads from Google Drive using gdown.
  4. Falls back gracefully if unavailable.
"""
import logging
import os
import pathlib
import re

logger = logging.getLogger("minex.gdrive")

def _extract_folder_id(val: str) -> str:
    if not val:
        return ""
    # Extract from folders/<id>
    match = re.search(r"folders/([a-zA-Z0-9_-]+)", val)
    if match:
        return match.group(1)
    # Extract from ?id=<id>
    match = re.search(r"[?&]id=([a-zA-Z0-9_-]+)", val)
    if match:
        return match.group(1)
    return val.strip()

# Default Google Drive folder URL and ID containing MINEx model artifacts
GDRIVE_FOLDER_URL: str = os.getenv(
    "GDRIVE_FOLDER_URL",
    "https://drive.google.com/drive/folders/1XykuJ8El-yQ_27FrdCzL7VHraoyGrBKy?usp=drive_link",
)
DRIVE_FOLDER_ID: str = (
    _extract_folder_id(os.getenv("GDRIVE_FOLDER_ID", ""))
    or _extract_folder_id(GDRIVE_FOLDER_URL)
    or "1XykuJ8El-yQ_27FrdCzL7VHraoyGrBKy"
)

# ---------------------------------------------------------------------------
# Registry — explicit Google Drive file IDs (optional override/fallback)
# ---------------------------------------------------------------------------
DRIVE_FILE_IDS: dict[str, str] = {
    # Production forecast models
    "production_forecast_champion.joblib":  "",
    "production_forecast_p10.joblib":       "",
    "production_forecast_p50.joblib":       "",
    "production_forecast_p90.joblib":       "",
    "production_forecast_features.joblib":  "",
    "production_forecast_medians.joblib":   "",
    "production_forecast_explainer.joblib": "",
    # Shortfall classifier
    "shortfall_champion.joblib":            "",
    "shortfall_features.joblib":            "",
    # Equipment failure models
    "equipment_failure_champion.joblib":    "",
    "equipment_failure_features.joblib":    "",
    "equipment_failure_catmap.joblib":      "",
    "equipment_failure_medians.joblib":     "",
    "equipment_failure_calibrator.joblib":  "",
    # Prospectivity model
    "prospectivity_champion.joblib":        "",
    "prospectivity_features.joblib":        "",
}

_DISCOVERED_CACHE: dict[str, str] = {}
_FOLDER_SCAN_DONE: bool = False


def scan_drive_folder(folder_id: str | None = None) -> dict[str, str]:
    """Scan public Drive folder to discover filename -> file_id mapping."""
    global _FOLDER_SCAN_DONE, _DISCOVERED_CACHE
    fid = folder_id or DRIVE_FOLDER_ID
    if not fid:
        return {}

    try:
        import gdown
        items = gdown.download_folder(id=fid, skip_download=True, quiet=True) or []
        discovered = {}
        for item in items:
            item_path = getattr(item, "path", str(item))
            item_id = getattr(item, "id", "")
            name = pathlib.Path(str(item_path)).name
            if name.endswith(".joblib") and item_id:
                discovered[name] = str(item_id)
        _DISCOVERED_CACHE.update(discovered)
        _FOLDER_SCAN_DONE = True
        if discovered:
            logger.info("Discovered %d artifacts in Drive folder %s", len(discovered), fid)
        return discovered
    except Exception as e:
        logger.warning("Could not scan Drive folder %s: %s", fid, e)
        _FOLDER_SCAN_DONE = True
        return {}


def ensure_artifact(artifacts_dir: pathlib.Path, filename: str) -> bool:
    """Ensure artifact exists locally. Download from Drive if missing.

    Returns True if the file is available (local or downloaded), False otherwise.
    """
    local_path = artifacts_dir / filename

    # Already on disk — nothing to do
    if local_path.exists():
        return True

    file_id = DRIVE_FILE_IDS.get(filename, "")

    # If no explicit file ID, try resolving from Drive folder scan
    if not file_id and not _FOLDER_SCAN_DONE:
        scan_drive_folder()
        file_id = _DISCOVERED_CACHE.get(filename, "")

    if not file_id:
        file_id = _DISCOVERED_CACHE.get(filename, "")

    if not file_id:
        logger.warning(
            "MISSING artifact '%s' — not found locally or in Drive folder '%s'.",
            filename, DRIVE_FOLDER_ID
        )
        return False

    logger.info("Downloading '%s' from Google Drive (ID: %s)...", filename, file_id)
    try:
        import gdown  # imported lazily so missing gdown doesn't break local dev
        artifacts_dir.mkdir(parents=True, exist_ok=True)
        url = f"https://drive.google.com/uc?id={file_id}"
        output = str(local_path)
        gdown.download(url, output, quiet=False)
        if local_path.exists():
            logger.info("Downloaded '%s' successfully (%.1f KB)", filename, local_path.stat().st_size / 1024)
            return True
        else:
            logger.error("gdown returned without error but '%s' is missing.", filename)
            return False
    except ImportError:
        logger.error(
            "gdown is not installed. Run: pip install gdown or add it to requirements.txt"
        )
        return False
    except Exception as e:
        logger.error("Failed to download '%s' from Drive: %s", filename, e)
        return False


def upload_artifact_to_drive(local_path: pathlib.Path, filename: str, task: str = "general") -> str:
    """Upload a newly trained artifact to Google Drive via authoritative StorageService."""
    from .storage import get_storage_service
    storage = get_storage_service()
    if not local_path.exists():
        logger.error("Local artifact not found: %s", local_path)
        return ""
    try:
        obj = storage.upload_file(
            file_bytes=local_path.read_bytes(),
            filename=filename,
            folder_path=f"models/{task}",
            content_type="application/octet-stream",
        )
        return obj.file_id
    except Exception as e:
        logger.error("Failed uploading '%s' via StorageService: %s", filename, e)
        return ""
