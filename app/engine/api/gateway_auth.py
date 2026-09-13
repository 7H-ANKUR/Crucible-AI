"""
api/gateway_auth.py
-------------------
Verifies that a request came from the Crucible AI gateway.

The engine has no user model, no sessions, and no RBAC. It is not meant to have
them: it sits on loopback behind the gateway, which authenticates the user with
Clerk and applies the role checks. This module exists so that arrangement does
not depend on the network topology alone — if the port is ever exposed by a
misconfigured deployment, an unsigned request still fails.

The signature construction is shared with the gateway
(`crucible/app/api/core/crucible_client.py::build_signature`). Changing it here is a
change to both sides.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import time

from fastapi import HTTPException, Request, status

logger = logging.getLogger("crucible.gateway_auth")

SIG_TIMESTAMP = "X-Crucible-Timestamp"
SIG_NONCE = "X-Crucible-Nonce"
SIG_SIGNATURE = "X-Crucible-Signature"

#: Requests older than this are refused, bounding how long a captured signature
#: stays usable.
MAX_SKEW_SECONDS = 300

#: Nonces seen inside the skew window, so a captured request cannot be replayed
#: even within it. Process-local, which matches the single-process deployment;
#: a multi-worker engine would need shared storage here.
_seen_nonces: dict[str, float] = {}


def _shared_secret() -> str | None:
    secret = os.environ.get("CRUCIBLE_SHARED_SECRET", "").strip()
    return secret or None


def _prune(now: float) -> None:
    if len(_seen_nonces) < 4096:
        return
    for nonce, seen_at in list(_seen_nonces.items()):
        if now - seen_at > MAX_SKEW_SECONDS:
            del _seen_nonces[nonce]


def build_signature(
    secret: str,
    method: str,
    path: str,
    timestamp: str,
    nonce: str,
    body: bytes,
) -> str:
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


def _reject(detail: str) -> HTTPException:
    # Deliberately uniform: a caller probing this endpoint learns only that the
    # request was not signed correctly, not which part was wrong.
    logger.warning("Rejected unsigned or invalid gateway request: %s", detail)
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Request is not a valid Crucible AI gateway call.",
    )


async def require_gateway_signature(request: Request) -> None:
    """Router-level dependency. No-op when no shared secret is configured.

    Leaving the secret unset is the development default: the engine is on
    loopback and the gateway calls it unsigned. Production sets the secret on
    both sides, and the gateway's own `validate_production_settings()` refuses to
    start without it.
    """
    secret = _shared_secret()
    if secret is None:
        return

    timestamp = request.headers.get(SIG_TIMESTAMP)
    nonce = request.headers.get(SIG_NONCE)
    signature = request.headers.get(SIG_SIGNATURE)

    if not (timestamp and nonce and signature):
        raise _reject("missing signature headers")

    try:
        sent_at = int(timestamp)
    except ValueError:
        raise _reject("malformed timestamp") from None

    now = time.time()
    if abs(now - sent_at) > MAX_SKEW_SECONDS:
        raise _reject(f"timestamp outside {MAX_SKEW_SECONDS}s window")

    _prune(now)
    if nonce in _seen_nonces:
        raise _reject("nonce replayed")

    body = await request.body()
    expected = build_signature(
        secret, request.method, request.url.path, timestamp, nonce, body
    )

    # Constant-time comparison: a byte-by-byte compare leaks the correct prefix
    # to anyone who can time the response.
    if not hmac.compare_digest(expected, signature):
        raise _reject("signature mismatch")

    _seen_nonces[nonce] = now
