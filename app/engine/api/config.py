"""
api/config.py
-------------
Crucible AI API configuration — reads CRUCIBLE_* environment variables.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path


@dataclass
class Settings:
    checkpoint_root: Path = field(
        default_factory=lambda: Path(
            os.environ.get("CRUCIBLE_CHECKPOINT_ROOT", ".crucible_checkpoints")
        )
    )
    artifact_root: Path = field(
        default_factory=lambda: Path(
            os.environ.get("CRUCIBLE_ARTIFACT_ROOT", ".crucible_artifacts")
        )
    )
    upload_tmp_root: Path = field(
        default_factory=lambda: Path(
            os.environ.get("CRUCIBLE_UPLOAD_TMP", ".crucible_uploads")
        )
    )
    audit_log_path: Path = field(
        default_factory=lambda: Path(
            os.environ.get("CRUCIBLE_AUDIT_LOG", ".crucible_audit.jsonl")
        )
    )
    store_root: Path = field(
        default_factory=lambda: Path(
            os.environ.get("CRUCIBLE_STORE_ROOT", ".crucible_store")
        )
    )

    log_level: str = field(
        default_factory=lambda: os.environ.get("CRUCIBLE_LOG_LEVEL", "INFO")
    )
    api_host: str = field(
        default_factory=lambda: os.environ.get("CRUCIBLE_API_HOST", "0.0.0.0")
    )
    api_port: int = field(
        default_factory=lambda: int(os.environ.get("CRUCIBLE_API_PORT", "8000"))
    )
    # Defaults to no allowed origins. The engine is designed to sit on loopback
    # behind the Crucible AI gateway, which is a server-to-server caller and sends no
    # Origin header, so it needs no CORS grant. A browser-facing deployment must
    # name its origins explicitly; the previous "*" default combined with
    # allow_credentials=True was both unsafe and rejected by browsers anyway.
    cors_origins: list[str] = field(
        default_factory=lambda: [
            o.strip()
            for o in os.environ.get("CRUCIBLE_CORS_ORIGINS", "").split(",")
            if o.strip()
        ]
    )
    max_upload_mb: int = field(
        default_factory=lambda: int(os.environ.get("CRUCIBLE_MAX_UPLOAD_MB", "200"))
    )
    secret_key: str = field(
        default_factory=lambda: os.environ.get("CRUCIBLE_SECRET_KEY", "")
    )

    def ensure_dirs(self) -> None:
        for d in (
            self.checkpoint_root,
            self.artifact_root,
            self.upload_tmp_root,
            self.store_root,
        ):
            d.mkdir(parents=True, exist_ok=True)

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    s = Settings()
    s.ensure_dirs()
    return s
