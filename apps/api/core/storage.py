"""apps/api/core/storage.py — Durable Object Storage Abstraction for MINEx.

Manages dataset snapshots, canonical datasets, model artifacts, reports, and run logs.
Supports Google Drive as authoritative remote object storage with local filesystem caching.

Folder hierarchy:
  MINEx/
    datasets/{domain}/
    validated/{domain}/
    models/{task}/
    training/runs/
    reports/validation/
    logs/
"""
from __future__ import annotations

import hashlib
import io
import json
import logging
import mimetypes
import os
import pathlib
import re
from dataclasses import dataclass
from datetime import datetime, timezone

from .config import settings

logger = logging.getLogger("minex.storage")


def _extract_folder_id(val: str) -> str:
    if not val:
        return ""
    match = re.search(r"folders/([a-zA-Z0-9_-]+)", val)
    if match:
        return match.group(1)
    match = re.search(r"[?&]id=([a-zA-Z0-9_-]+)", val)
    if match:
        return match.group(1)
    return val.strip()


DEFAULT_DRIVE_FOLDER_ID = "1XykuJ8El-yQ_27FrdCzL7VHraoyGrBKy"
GDRIVE_FOLDER_ID = (
    _extract_folder_id(os.getenv("GDRIVE_FOLDER_ID", ""))
    or _extract_folder_id(os.getenv("GDRIVE_FOLDER_URL", ""))
    or DEFAULT_DRIVE_FOLDER_ID
)


@dataclass
class StorageMetadata:
    file_id: str
    filename: str
    folder_path: str
    sha256: str
    size_bytes: int
    content_type: str
    created_at: str
    storage_type: str        # "gdrive" | "local" | "upload_failed"
    storage_status: str      # "AVAILABLE" | "UPLOAD_FAILED" | "LOCAL_DEV"
    drive_folder_id: str | None = None


@dataclass
class StorageObject:
    file_id: str
    filename: str
    folder_path: str
    sha256: str
    size_bytes: int
    content_type: str
    metadata: StorageMetadata


def compute_sha256(content: bytes) -> str:
    """Compute standard SHA-256 hexadecimal digest for raw bytes."""
    return hashlib.sha256(content).hexdigest()


class StorageService:
    """Authoritative Enterprise Storage Service handling Google Drive and local cache."""

    def __init__(self, root_folder_id: str | None = None, local_storage_dir: pathlib.Path | None = None):
        self.root_folder_id = root_folder_id or GDRIVE_FOLDER_ID
        self.local_storage_dir = local_storage_dir or (pathlib.Path(settings.DATA_DIR) / "storage")
        self.local_storage_dir.mkdir(parents=True, exist_ok=True)
        self._gdrive_service = None
        self._folder_cache: dict[str, str] = {}
        self._init_service_account()

    def _init_service_account(self):
        """
        Initialize Google Drive API client.
        Supports both filesystem path to .json credential file and raw JSON string.
        """
        sa_val = (
            os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
            or os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
        )
        if not sa_val:
            logger.info("Google Drive service account not configured; running in local-cache mode.")
            return

        try:
            from google.oauth2 import service_account
            from googleapiclient.discovery import build
            scopes = ["https://www.googleapis.com/auth/drive"]

            # Case 1: Raw JSON string
            if sa_val.startswith("{") and sa_val.endswith("}"):
                sa_info = json.loads(sa_val)
                creds = service_account.Credentials.from_service_account_info(sa_info, scopes=scopes)
                self._gdrive_service = build("drive", "v3", credentials=creds, cache_discovery=False)
                logger.info("Initialized authenticated Google Drive service from JSON secret.")
            # Case 2: Filesystem path
            elif os.path.exists(sa_val):
                creds = service_account.Credentials.from_service_account_file(sa_val, scopes=scopes)
                self._gdrive_service = build("drive", "v3", credentials=creds, cache_discovery=False)
                logger.info("Initialized authenticated Google Drive service from file: %s", sa_val)
            else:
                logger.warning("GOOGLE_SERVICE_ACCOUNT_JSON value is neither an existing path nor valid JSON.")
        except Exception as e:
            logger.warning("Could not initialize Google Drive service account: %s", e)
            self._gdrive_service = None

    def _resolve_or_create_drive_folder(self, folder_path: str) -> str:
        """
        Walks the requested subfolder path (e.g. 'datasets/production') under self.root_folder_id.
        Searches for existing Drive folders or creates them recursively, caching results.
        """
        if not self._gdrive_service:
            return self.root_folder_id

        parts = [p for p in folder_path.strip("/\\").split("/") if p]
        if not parts:
            return self.root_folder_id

        current_parent = self.root_folder_id
        for part in parts:
            cache_key = f"{current_parent}/{part}"
            if cache_key in self._folder_cache:
                current_parent = self._folder_cache[cache_key]
                continue

            try:
                # Query Drive for existing folder with name under current_parent
                q = (
                    f"mimeType = 'application/vnd.google-apps.folder' "
                    f"and name = '{part}' "
                    f"and '{current_parent}' in parents "
                    f"and trashed = false"
                )
                res = self._gdrive_service.files().list(
                    q=q,
                    fields="files(id, name)",
                    spaces="drive",
                ).execute()
                files = res.get("files", [])

                if files:
                    folder_id = files[0]["id"]
                else:
                    # Create the subfolder
                    meta = {
                        "name": part,
                        "mimeType": "application/vnd.google-apps.folder",
                        "parents": [current_parent],
                    }
                    created = self._gdrive_service.files().create(body=meta, fields="id").execute()
                    folder_id = created.get("id")
                    logger.info("Created Google Drive folder '%s' (ID: %s) under %s", part, folder_id, current_parent)

                self._folder_cache[cache_key] = folder_id
                current_parent = folder_id
            except Exception as e:
                logger.error("Error resolving/creating Drive folder segment '%s': %s", part, e)
                return current_parent

        return current_parent

    def upload_file(
        self,
        file_bytes: bytes,
        filename: str,
        folder_path: str,
        content_type: str | None = None,
        require_drive: bool = False,
    ) -> StorageObject:
        """
        Upload file bytes to durable storage.
        Computes SHA-256, stores in local read cache, and uploads to Google Drive under real folder ID.
        If Drive upload fails, marks storage_status='UPLOAD_FAILED' and raises error if require_drive=True.
        """
        if not content_type:
            content_type, _ = mimetypes.guess_type(filename)
            content_type = content_type or "application/octet-stream"

        sha256 = compute_sha256(file_bytes)
        size_bytes = len(file_bytes)
        now_iso = datetime.now(timezone.utc).isoformat()

        # 1. Deterministic local cache path (local cache, NOT authoritative replacement)
        dest_dir = self.local_storage_dir / folder_path
        dest_dir.mkdir(parents=True, exist_ok=True)
        cache_file = dest_dir / filename
        cache_file.write_bytes(file_bytes)

        file_id = f"local-{sha256[:16]}"
        storage_type = "local"
        storage_status = "LOCAL_DEV"
        resolved_folder_id = None

        # 2. Upload to Google Drive if authenticated client is active
        if self._gdrive_service is not None:
            try:
                from googleapiclient.http import MediaIoBaseUpload

                # Resolve true subfolder hierarchy
                resolved_folder_id = self._resolve_or_create_drive_folder(folder_path)

                media = MediaIoBaseUpload(io.BytesIO(file_bytes), mimetype=content_type, resumable=True)
                file_metadata = {
                    "name": filename,
                    "parents": [resolved_folder_id],
                    "description": f"folder:{folder_path}|sha256:{sha256}|size:{size_bytes}",
                }
                res = self._gdrive_service.files().create(
                    body=file_metadata,
                    media_body=media,
                    fields="id",
                ).execute()

                file_id = res.get("id")
                storage_type = "gdrive"
                storage_status = "AVAILABLE"
                logger.info(
                    "Authoritative upload: '%s' uploaded to Drive folder '%s' (File ID: %s, %d bytes)",
                    filename, folder_path, file_id, size_bytes
                )
            except Exception as e:
                logger.error("Authoritative Drive upload FAILED for '%s': %s", filename, e)
                storage_type = "upload_failed"
                storage_status = "UPLOAD_FAILED"
                file_id = f"failed-{sha256[:16]}"
                if require_drive:
                    raise RuntimeError(f"Authoritative Google Drive upload failed: {e}") from e
        else:
            if require_drive:
                raise RuntimeError("Authoritative Google Drive storage requested but credentials are not configured.")
            logger.info("Drive credentials absent; stored in local dev cache: %s", cache_file)

        meta = StorageMetadata(
            file_id=file_id,
            filename=filename,
            folder_path=folder_path,
            sha256=sha256,
            size_bytes=size_bytes,
            content_type=content_type,
            created_at=now_iso,
            storage_type=storage_type,
            storage_status=storage_status,
            drive_folder_id=resolved_folder_id,
        )
        return StorageObject(
            file_id=file_id,
            filename=filename,
            folder_path=folder_path,
            sha256=sha256,
            size_bytes=size_bytes,
            content_type=content_type,
            metadata=meta,
        )

    def download_file(self, file_id: str, dest_path: pathlib.Path | None = None) -> bytes:
        """Download raw bytes by file ID."""
        # 1. Check local storage cache first
        for p in self.local_storage_dir.rglob("*"):
            if p.is_file() and (file_id in p.name or (file_id.startswith("local-") and file_id[6:] in compute_sha256(p.read_bytes()))):
                data = p.read_bytes()
                if dest_path:
                    dest_path.parent.mkdir(parents=True, exist_ok=True)
                    dest_path.write_bytes(data)
                return data

        # 2. Authenticated Google Drive download
        if self._gdrive_service is not None and not file_id.startswith("local-") and not file_id.startswith("failed-"):
            try:
                from googleapiclient.http import MediaIoBaseDownload
                req = self._gdrive_service.files().get_media(fileId=file_id)
                fh = io.BytesIO()
                downloader = MediaIoBaseDownload(fh, req)
                done = False
                while not done:
                    _, done = downloader.next_chunk()
                data = fh.getvalue()
                if dest_path:
                    dest_path.parent.mkdir(parents=True, exist_ok=True)
                    dest_path.write_bytes(data)
                return data
            except Exception as e:
                logger.warning("Drive API download failed for %s: %s", file_id, e)

        # 3. Public download via gdown (fallback for publicly shared artifacts)
        if not file_id.startswith("local-") and not file_id.startswith("failed-"):
            try:
                import gdown
                target = dest_path or (self.local_storage_dir / f"tmp_{file_id}")
                target.parent.mkdir(parents=True, exist_ok=True)
                url = f"https://drive.google.com/uc?id={file_id}"
                gdown.download(url, str(target), quiet=True)
                if target.exists():
                    data = target.read_bytes()
                    return data
            except Exception as e:
                logger.error("gdown download failed for file ID %s: %s", file_id, e)

        raise FileNotFoundError(f"Artifact {file_id} not found in authoritative storage or cache.")

    def ensure_local_cache(
        self,
        file_id: str,
        local_path: pathlib.Path,
        expected_sha256: str | None = None,
    ) -> bool:
        """
        Ensures a file exists at local_path and matches expected_sha256.
        Downloads if missing or corrupted. Returns True on success.
        """
        local_path = pathlib.Path(local_path)
        if local_path.exists():
            if expected_sha256:
                actual_hash = compute_sha256(local_path.read_bytes())
                if actual_hash == expected_sha256:
                    return True
                logger.warning("Local cache checksum mismatch for %s. Re-downloading.", local_path)
                try:
                    local_path.unlink()
                except Exception:
                    pass
            else:
                return True

        try:
            self.download_file(file_id, dest_path=local_path)
            if local_path.exists():
                if expected_sha256:
                    actual_hash = compute_sha256(local_path.read_bytes())
                    if actual_hash != expected_sha256:
                        logger.error("Downloaded file %s checksum mismatch (%s != %s)", local_path, actual_hash, expected_sha256)
                        local_path.unlink()
                        return False
                return True
        except Exception as e:
            logger.error("Could not ensure local cache for %s (%s): %s", file_id, local_path, e)
            return False

        return False

    def file_exists(self, file_id: str) -> bool:
        """
        Authoritatively check if file exists in storage.
        Never returns True on unverified files.
        """
        if not file_id or file_id.startswith("failed-"):
            return False

        if file_id.startswith("local-"):
            sha_prefix = file_id[6:]
            for p in self.local_storage_dir.rglob("*"):
                if p.is_file() and (file_id in p.name or compute_sha256(p.read_bytes()).startswith(sha_prefix)):
                    return True
            return False

        if self._gdrive_service is not None:
            try:
                res = self._gdrive_service.files().get(fileId=file_id, fields="id,trashed").execute()
                return bool(res and not res.get("trashed", False))
            except Exception:
                return False

        # No authenticated Drive service and not a local file -> cannot verify existence!
        return False


# Default singleton instance
storage = StorageService()


def get_storage_service() -> StorageService:
    """Return the application storage service singleton."""
    return storage
