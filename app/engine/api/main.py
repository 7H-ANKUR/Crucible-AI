"""
api/main.py
-----------
Crucible AI FastAPI application.

Creates the FastAPI app with:
  - CORS from CRUCIBLE_CORS_ORIGINS
  - All 28 business endpoints + /health + /ready
  - Consistent error handling (no tracebacks exposed)
  - Structured startup logging
"""

from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.config import get_settings
from api.exceptions import (
    NotFoundError,
    UploadTooLargeError,
    UnsupportedFileTypeError,
    ValidationError,
    generic_handler,
    not_found_handler,
    upload_too_large_handler,
    unsupported_file_handler,
    validation_error_handler,
)
from api.gateway_auth import require_gateway_signature
from api.routers import audit, datasets, health, inference, integrity, models, observability, pipelines, recovery, system


def _configure_logging(level: str) -> None:
    logging.basicConfig(
        stream=sys.stdout,
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )


def create_app() -> FastAPI:
    settings = get_settings()
    _configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Schema creation is idempotent for the supported SQLAlchemy models and
        # makes a fresh local deployment usable without a manual bootstrap
        # command. Migration tooling can later replace this for schema changes.
        from core.database.connection import init_db

        init_db()
        logging.getLogger("crucible.api").info(
            "Crucible AI API starting. checkpoint_root=%s artifact_root=%s cors=%s",
            settings.checkpoint_root,
            settings.artifact_root,
            settings.cors_origins,
        )
        yield

    app = FastAPI(
        title="Crucible AI API",
        description=(
            "Research-grade autonomous ML platform API. "
            "Dataset-adaptive pipeline with self-healing, fault detection, "
            "root-cause analysis, and security audit."
        ),
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )

    # -----------------------------------------------------------------
    # CORS
    # -----------------------------------------------------------------
    origins = settings.cors_origins

    # A wildcard origin and credentialed requests are mutually exclusive: the
    # CORS spec forbids the pair and browsers reject the response, so a config
    # that asks for both is always a mistake. Honour the wildcard for reads and
    # drop credentials rather than shipping a combination that cannot work.
    allow_credentials = "*" not in origins
    if origins and not allow_credentials:
        logging.getLogger("crucible.api").warning(
            "CRUCIBLE_CORS_ORIGINS is '*'; credentialed CORS is disabled. "
            "Name the browser origins explicitly to allow credentials."
        )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=allow_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # -----------------------------------------------------------------
    # Exception handlers
    # -----------------------------------------------------------------
    app.add_exception_handler(NotFoundError, not_found_handler)
    app.add_exception_handler(ValidationError, validation_error_handler)
    app.add_exception_handler(UploadTooLargeError, upload_too_large_handler)
    app.add_exception_handler(UnsupportedFileTypeError, unsupported_file_handler)

    from datetime import datetime, timezone

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "status": "error",
                "data": None,
                "errors": [str(exc.detail)],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )

    @app.exception_handler(RequestValidationError)
    async def request_validation_handler(request: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "status": "error",
                "data": None,
                "errors": [str(e) for e in exc.errors()],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )

    app.add_exception_handler(Exception, generic_handler)

    # -----------------------------------------------------------------
    # Routers
    # -----------------------------------------------------------------
    # /health and /ready stay open so a process supervisor can probe the engine
    # without holding the shared secret.
    app.include_router(health.router)

    # Everything else must come from the Crucible AI gateway. The check is a no-op
    # until CRUCIBLE_SHARED_SECRET is set, which keeps loopback development
    # frictionless while making an exposed port fail closed in production.
    gated = [Depends(require_gateway_signature)]
    for module in (
        datasets,
        pipelines,
        models,
        inference,
        recovery,
        audit,
        system,
        observability,
        integrity,
    ):
        app.include_router(module.router, dependencies=gated)

    # Routers registered above; lifespan handles startup
    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn
    s = get_settings()
    uvicorn.run(
        "api.main:app",
        host=s.api_host,
        port=s.api_port,
        reload=False,
        log_level=s.log_level.lower(),
    )
