"""
app/api/main.py — Crucible AI FastAPI Backend
"""
import logging
import os
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from .core.config import settings, validate_production_settings
from .core.db import init_db
from .core.ml_loader import load_all_models
from .routers import (
    alerts,
    command_center,
    playbooks,
    response_plans,
    auth,
    data_hub,
    decisions,
    equipment,
    exploration,
    governance,
    health,
    intelligence,
    lab,
    ledger,
    mines,
    model_approval,
    production,
    routing,
    scenarios,
    training,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("crucible")


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Attach a unique X-Request-ID to every request and response.

    If the caller provides X-Request-ID we propagate it; otherwise we generate one.
    This makes every request traceable in logs and error responses.
    """

    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        # Attach to request state so routers can log it
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Crucible AI API (environment=%s)...", settings.ENVIRONMENT)
    # Fail fast on production misconfigurations before accepting any traffic
    validate_production_settings()
    init_db()
    load_all_models()
    logger.info("Models loaded. API ready.")
    yield
    logger.info("Shutting down Crucible AI API.")


app = FastAPI(
    title="Crucible AI API",
    description="Mining Intelligence Operating Platform — MANGANESIS Backend",
    version="1.0.0",
    lifespan=lifespan,
)

# ── Request ID middleware ─────────────────────────────────────────────────────
app.add_middleware(RequestIDMiddleware)

# ── CORS configuration ────────────────────────────────────────────────────────
# Always allow localhost dev ports.
_base_origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
]

# Additional origins from CORS_ORIGIN env var (comma-separated explicit list).
_extra_env = os.getenv("CORS_ORIGIN", "")
_extra_origins = [o.strip() for o in _extra_env.split(",") if o.strip()]

# CORS_ALLOWED_ORIGINS from settings (also comma-separated).
_settings_origins = [
    o.strip()
    for o in (settings.CORS_ALLOWED_ORIGINS or "").split(",")
    if o.strip()
]

_allowed_origins = list(dict.fromkeys(_base_origins + _extra_origins + _settings_origins))

# Vercel wildcard regex: only enabled when CORS_ALLOW_VERCEL_WILDCARD=true.
# In production the Vercel project should be added to CORS_ALLOWED_ORIGINS explicitly.
_origin_regex = None
if settings.CORS_ALLOW_VERCEL_WILDCARD:
    _origin_regex = r"https://.*\.vercel\.app"
    if settings.ENVIRONMENT.lower() == "production":
        logger.warning(
            "PRODUCTION: CORS_ALLOW_VERCEL_WILDCARD=true is enabled. "
            "Consider adding your Vercel domain to CORS_ALLOWED_ORIGINS instead."
        )

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_origin_regex=_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(health.router)                   # → /health  (Render / uptime)
app.include_router(health.router,      prefix="/api/v1")  # → /api/v1/health

app.include_router(auth.router,        prefix="/api/v1/auth")
app.include_router(mines.router,       prefix="/api/v1")
app.include_router(production.router,  prefix="/api/v1/production")
app.include_router(equipment.router,   prefix="/api/v1/equipment")
app.include_router(exploration.router, prefix="/api/v1/exploration")
app.include_router(scenarios.router,   prefix="/api/v1/scenarios")
app.include_router(alerts.router,      prefix="/api/v1/alerts")
app.include_router(ledger.router,      prefix="/api/v1/ledger")
app.include_router(governance.router,      prefix="/api/v1/governance")
app.include_router(data_hub.router,        prefix="/api/v1/data")
app.include_router(training.router,        prefix="/api/v1/training")
app.include_router(model_approval.router,  prefix="/api/v1/models")
app.include_router(decisions.router,       prefix="/api/v1/decisions")
app.include_router(intelligence.router,    prefix="/api/v1/intelligence")
app.include_router(lab.router,             prefix="/api/v1/lab")
app.include_router(routing.router,         prefix="/api/v1/routing")
app.include_router(command_center.router, prefix="/api/v1/command-center")
app.include_router(response_plans.router, prefix="/api/v1/response-plans")
app.include_router(playbooks.router,      prefix="/api/v1/playbooks")
app.include_router(playbooks.package_router, prefix="/api/v1/decision-package")
