"""app/api/core/crucible_client.py — the gateway's bridge to the Crucible AI engine.

The engine is an internal service: bound to loopback, no authentication of its
own, reached only through this module. Everything that talks to it goes through
``CrucibleClient`` so that four properties hold in one place rather than at every
call site.

1. **An engine outage never 500s a Crucible AI page.** Every call returns an
   ``EngineResponse``. Callers check ``ok`` and render a degraded state, the same
   honesty discipline the platform already applies with ``model_backed``.
2. **A failing engine fails fast.** The circuit breaker from ``core.cache`` is
   reused so a hung engine cannot tie up gateway workers.
3. **Requests are signed.** HMAC-SHA256 over method, path, timestamp, nonce and
   body. Loopback already limits reach; the signature means a future
   misconfiguration that exposes the port is not immediately exploitable.
4. **Replays are bounded.** Signed requests carry a timestamp the engine rejects
   outside a short window.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import secrets
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal

import requests

from .cache import CircuitBreaker
from .config import settings

logger = logging.getLogger("crucible.crucible")

#: Header names carrying the gateway signature. Mirrored in the engine's verifier.
SIG_TIMESTAMP = "X-Crucible-Timestamp"
SIG_NONCE = "X-Crucible-Nonce"
SIG_SIGNATURE = "X-Crucible-Signature"

#: How far a signed request's timestamp may drift before the engine rejects it.
SIGNATURE_MAX_SKEW_SECONDS = 300


def build_signature(
    secret: str,
    method: str,
    path: str,
    timestamp: str,
    nonce: str,
    body: bytes,
) -> str:
    """Compute the hex HMAC for one request.

    Shared with the engine verbatim — the engine imports the same construction —
    so any change here is a change to both sides of the contract.
    """
    payload = b"\n".join(
        [
            method.upper().encode(),
            path.encode(),
            timestamp.encode(),
            nonce.encode(),
            hashlib.sha256(body).hexdigest().encode(),
        ]
    )
    return hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()


@dataclass
class EngineResponse:
    """The result of one engine call. Never raises for an unreachable engine."""

    ok: bool
    status_code: int | None = None
    data: Any = None
    reason: str | None = None
    #: Set when the gateway short-circuited without attempting a call.
    degraded: Literal["circuit_open", "disabled", "unreachable", "timeout", "error"] | None = None
    elapsed_ms: float | None = None

    def to_payload(self) -> dict[str, Any]:
        """Shape handed to the frontend, which renders an explicit degraded state.

        A 4xx is reported with ``engine_available: true``. The engine answered —
        it declined this particular request — and conflating the two hid a real
        bug: the lab proxied to `/v1/models/...` when the engine mounts those
        routes under `/v1/pipelines/...`, and every resulting 404 rendered as
        "engine unavailable" instead of "wrong URL".
        """
        if self.ok:
            return {"engine_available": True, "data": self.data}

        reachable = self.status_code is not None and 400 <= self.status_code < 500
        return {
            "engine_available": reachable,
            "reason": self.reason or "The Crucible AI engine is unavailable.",
            "degraded": self.degraded,
            "status_code": self.status_code,
            "error": reachable or None,
        }


@dataclass
class EngineMetrics:
    calls: int = 0
    failures: int = 0
    short_circuits: int = 0
    last_error: str | None = None
    last_success_epoch: float | None = None


class CrucibleClient:
    """HTTP client for the Crucible AI engine. One instance per process."""

    def __init__(self) -> None:
        self._session = requests.Session()
        self._breaker = CircuitBreaker(
            failure_threshold=settings.CRUCIBLE_CIRCUIT_FAILURE_THRESHOLD,
            cooldown_seconds=settings.CRUCIBLE_CIRCUIT_COOLDOWN_SECONDS,
            name="Crucible AI engine",
        )
        self.metrics = EngineMetrics()

    # -- introspection ----------------------------------------------------

    @property
    def base_url(self) -> str:
        return settings.CRUCIBLE_BASE_URL.rstrip("/")

    def status(self) -> dict[str, Any]:
        """Telemetry for /api/v1/health and the admin page."""
        return {
            "enabled": settings.CRUCIBLE_ENABLED,
            "base_url": self.base_url,
            "signed": bool(settings.CRUCIBLE_SHARED_SECRET),
            "circuit_state": self._breaker.state.value,
            "calls": self.metrics.calls,
            "failures": self.metrics.failures,
            "short_circuits": self.metrics.short_circuits,
            "last_error": self.metrics.last_error,
            "last_success_epoch": self.metrics.last_success_epoch,
        }

    # -- request path -----------------------------------------------------

    def _headers(self, method: str, path: str, body: bytes) -> dict[str, str]:
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        secret = settings.CRUCIBLE_SHARED_SECRET
        if not secret:
            return headers

        timestamp = str(int(time.time()))
        nonce = secrets.token_hex(16)
        headers[SIG_TIMESTAMP] = timestamp
        headers[SIG_NONCE] = nonce
        headers[SIG_SIGNATURE] = build_signature(
            secret, method, path, timestamp, nonce, body
        )
        return headers

    def request(
        self,
        method: str,
        path: str,
        *,
        json_body: Any | None = None,
        params: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> EngineResponse:
        """Call the engine. Returns an EngineResponse; does not raise on failure."""
        if not settings.CRUCIBLE_ENABLED:
            return EngineResponse(
                ok=False,
                reason="The Crucible AI engine is disabled in this environment.",
                degraded="disabled",
            )

        if not self._breaker.can_attempt():
            self.metrics.short_circuits += 1
            return EngineResponse(
                ok=False,
                reason=(
                    "The Crucible AI engine is not responding and calls are paused "
                    "while it recovers."
                ),
                degraded="circuit_open",
            )

        body = b"" if json_body is None else json.dumps(json_body).encode()
        if timeout is None:
            timeout = (
                settings.CRUCIBLE_READ_TIMEOUT
                if method.upper() in ("POST", "PUT", "PATCH")
                else settings.CRUCIBLE_STATUS_TIMEOUT
            )

        url = f"{self.base_url}{path}"
        started = time.monotonic()
        self.metrics.calls += 1

        try:
            response = self._session.request(
                method.upper(),
                url,
                data=body or None,
                params=params,
                headers=self._headers(method, path, body),
                timeout=(settings.CRUCIBLE_CONNECT_TIMEOUT, timeout),
            )
        except requests.Timeout as exc:
            return self._fail("timeout", f"The Crucible AI engine timed out after {timeout}s.", exc, started)
        except requests.ConnectionError as exc:
            return self._fail("unreachable", "The Crucible AI engine is not reachable.", exc, started)
        except requests.RequestException as exc:
            return self._fail("error", "The Crucible AI engine call failed.", exc, started)

        elapsed_ms = (time.monotonic() - started) * 1000

        # A 4xx is the engine working correctly and rejecting the request. It is
        # not evidence the engine is unhealthy, so it must not trip the breaker —
        # otherwise a run of bad user input takes the whole integration offline.
        if response.status_code >= 500:
            return self._fail(
                "error",
                f"The Crucible AI engine returned {response.status_code}.",
                RuntimeError(response.text[:200]),
                started,
            )

        self._breaker.record_success()
        self.metrics.last_success_epoch = time.time()

        try:
            payload = response.json()
        except ValueError:
            payload = None

        if response.status_code >= 400:
            detail = None
            if isinstance(payload, dict):
                detail = payload.get("detail") or payload.get("message")
            return EngineResponse(
                ok=False,
                status_code=response.status_code,
                data=payload,
                reason=detail or f"The Crucible AI engine rejected the request ({response.status_code}).",
                degraded=None,
                elapsed_ms=elapsed_ms,
            )

        # The engine wraps successes as {"status": "success", "data": ...}.
        # Unwrap so callers see the payload, not the envelope.
        data = payload
        if isinstance(payload, dict) and "data" in payload and payload.get("status") == "success":
            data = payload["data"]

        return EngineResponse(
            ok=True, status_code=response.status_code, data=data, elapsed_ms=elapsed_ms
        )

    def _fail(
        self,
        degraded: str,
        reason: str,
        exc: Exception,
        started: float,
    ) -> EngineResponse:
        self._breaker.record_failure(exc)
        self.metrics.failures += 1
        self.metrics.last_error = f"{type(exc).__name__}: {exc}"[:300]
        logger.warning("Crucible AI engine call failed (%s): %s", degraded, exc)
        return EngineResponse(
            ok=False,
            reason=reason,
            degraded=degraded,  # type: ignore[arg-type]
            elapsed_ms=(time.monotonic() - started) * 1000,
        )

    # -- convenience ------------------------------------------------------

    def get(self, path: str, **kw: Any) -> EngineResponse:
        return self.request("GET", path, **kw)

    def post(self, path: str, **kw: Any) -> EngineResponse:
        return self.request("POST", path, **kw)

    def health(self) -> EngineResponse:
        return self.request("GET", "/health", timeout=settings.CRUCIBLE_CONNECT_TIMEOUT)


#: Process-wide client. The gateway is threaded, and requests.Session is
#: thread-safe for this usage pattern.
_client: CrucibleClient | None = None


def get_client() -> CrucibleClient:
    global _client
    if _client is None:
        _client = CrucibleClient()
    return _client
