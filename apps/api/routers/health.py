"""apps/api/routers/health.py — Health check endpoints.

Available at:
  GET /health          → root-level, no prefix (for Render/Railway uptime checks)
  GET /api/v1/health   → versioned API path

Security: Internal exception messages are never returned to clients.
All error details are logged server-side only.
"""
import datetime
import logging
import os
import time

from fastapi import APIRouter, Response

from ..core.config import settings
from ..core.db import query
from ..core.ml_loader import MODELS

logger = logging.getLogger("minex.health")
router = APIRouter(tags=["health"])

# Track startup time for uptime reporting
_START_TIME = time.time()


def _now_utc() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")


def _build_health_payload() -> dict:
    """Run all health checks and return a structured payload."""
    # ── Database ──────────────────────────────────────────────────
    try:
        query("SELECT 1")
        db_status = "ok"
        db_error = False
    except Exception as e:
        logger.error("Health check: database connectivity failed: %s", e)
        db_status = "error"
        db_error = True  # Never expose str(e) to clients

    # ── ML Models ─────────────────────────────────────────────
    loaded_models = list(MODELS.keys())

    # ── Storage (Drive) ───────────────────────────────────────
    gdrive_configured = bool(
        os.getenv("GDRIVE_FOLDER_ID") or os.getenv("GDRIVE_FOLDER_URL")
    )

    # ── Modal Training ────────────────────────────────────────
    modal_configured = bool(
        os.getenv("MODAL_TOKEN_ID") and os.getenv("MODAL_TOKEN_SECRET")
    )

    # ── Cache Tier (L1 + L2 Upstash Redis) ────────────────────
    from ..core.cache import cache_manager
    c_health = cache_manager.health()
    cache_status = "ok" if (not c_health["l2"]["configured"] or c_health["l2"]["reachable"]) else "degraded"

    # ── Overall status ────────────────────────────────────────
    overall = "ok" if db_status == "ok" else "degraded"

    uptime_seconds = round(time.time() - _START_TIME, 1)

    return {
        "status": overall,
        "timestamp": _now_utc(),
        "uptime_seconds": uptime_seconds,
        "version": "1.0.0",
        "environment": settings.ENVIRONMENT,
        "checks": {
            "database": {
                "status": db_status,
                # Only surface that there IS an error; details logged server-side
                **(  {"error": "Database connectivity check failed. See server logs."}  if db_error else {}),
            },
            "cache": {
                "status": cache_status,
                "l1_entries": c_health["l1"]["entries"],
                "l1_hit_rate": c_health["l1"]["hit_rate"],
                "l2_configured": c_health["l2"]["configured"],
                "l2_reachable": c_health["l2"]["reachable"],
                "l2_circuit": c_health["l2"]["circuit_state"],
            },
            "ml_models": {
                "status": "ok" if loaded_models else "warn",
                "loaded": loaded_models,
                "count": len(loaded_models),
            },
            "storage": {
                "status": "ok" if gdrive_configured else "warn",
                "provider": "google_drive",
                "configured": gdrive_configured,
            },
            "training": {
                "mode": settings.TRAINING_MODE,
                "modal_configured": modal_configured,
            },
        },
    }


@router.get("/health/live", summary="Liveness probe")
def health_live():
    """
    Fast liveness probe: zero DB or Redis dependency.
    Validates process responsiveness and basic routing.
    Always returns HTTP 200 while the process is alive.
    """
    return {
        "status": "alive",
        "uptime_seconds": round(time.time() - _START_TIME, 1),
        "timestamp": _now_utc(),
    }


@router.get("/health/ready", summary="Readiness probe")
def health_ready(response: Response):
    """
    Readiness probe: validates database connectivity.
    Returns HTTP 200 when ready to accept traffic, 503 if database is unreachable.
    """
    uptime_seconds = round(time.time() - _START_TIME, 1)
    now_ts = _now_utc()
    try:
        query("SELECT 1")
        return {
            "status": "ready",
            "database": "connected",
            "uptime_seconds": uptime_seconds,
            "timestamp": now_ts,
        }
    except Exception as e:
        logger.error("Readiness probe: database unreachable: %s", e)
        response.status_code = 503
        return {
            "status": "not_ready",
            "database": "error",
            # Do not expose str(e) — internal error logged above
            "error": "Database connectivity check failed. See server logs.",
            "uptime_seconds": uptime_seconds,
            "timestamp": now_ts,
        }


@router.get("/health", summary="Health check")
def health(response: Response):
    """
    Comprehensive health check.
    Returns HTTP 200 when healthy, 503 when degraded (e.g. DB unreachable).
    Used by Render/Railway/Vercel uptime monitors.
    """
    payload = _build_health_payload()
    if payload["status"] != "ok":
        response.status_code = 503
    return payload


@router.get("/health/cache", summary="Cache tier health and metrics")
def cache_health():
    """
    Observability health check exposing status, L1/L2 hit rates, latencies (P50/P95/P99),
    stampede prevention count, SWR metrics, and circuit breaker status.
    Available at /health/cache and /api/v1/health/cache.
    """
    from ..core.cache import cache_manager
    return cache_manager.health()
