"""app/api/core/security.py — JWT auth + demo bootstrap (no hardcoded passwords).

Demo mode is gated behind DEMO_BOOTSTRAP_ENABLED=true in the environment.
Credentials are read from DEMO_ADMIN_PASSWORD / DEMO_USER_PASSWORD env vars.
In production (Clerk-verified mode) authenticate_user() is never called —
Clerk tokens are verified instead (see Phase 1 rbac.py).

Security invariants:
  - Raw exception messages are never returned to callers (logged internally).
  - Tokens are never logged (even at DEBUG).
  - Failed verification events are logged at WARN with actor metadata only.
  - In ENVIRONMENT=production, demo mode is disallowed and raising RuntimeError
    is delegated to config.validate_production_settings() called at startup.
"""
import logging
import os
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext

from .config import settings

logger = logging.getLogger("crucible.security")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/token", auto_error=False)

# ---------------------------------------------------------------------------
# Demo bootstrap — only active when DEMO_BOOTSTRAP_ENABLED=true
# Passwords come from env vars — never hardcoded in source.
# ---------------------------------------------------------------------------

_DEMO_ENABLED = settings.DEMO_BOOTSTRAP_ENABLED
_ADMIN_PW = settings.DEMO_ADMIN_PASSWORD
_USER_PW  = settings.DEMO_USER_PASSWORD

if _DEMO_ENABLED and (not _ADMIN_PW or not _USER_PW):
    logger.warning(
        "DEMO_BOOTSTRAP_ENABLED=true but DEMO_ADMIN_PASSWORD or DEMO_USER_PASSWORD "
        "is not set. Demo login will be disabled until both vars are provided."
    )

DEMO_USERS: dict = {}
if _DEMO_ENABLED and _ADMIN_PW and _USER_PW:
    DEMO_USERS = {
        "admin":            {"password": _ADMIN_PW, "role": "super_admin",      "name": "Super Admin"},
        "platform_admin":   {"password": _ADMIN_PW, "role": "super_admin",      "name": "Priya Admin"},
        "exploration_admin":{"password": _ADMIN_PW, "role": "exploration_admin", "name": "Arjun Geo"},
        "equipment_admin":  {"password": _ADMIN_PW, "role": "equipment_admin",   "name": "Deepak Maint"},
        "production_admin": {"password": _ADMIN_PW, "role": "production_admin",  "name": "Sunita Ops"},
        "mine_planner":     {"password": _USER_PW,  "role": "mine_planner",      "name": "Vikram Plan"},
        "management":       {"password": _USER_PW,  "role": "management",        "name": "Kavita Director"},
    }
    logger.info("Demo bootstrap active — %d demo users loaded.", len(DEMO_USERS))

ROLE_DASHBOARD = {
    "platform_admin":    "/governance",
    "exploration_admin": "/exploration",
    "equipment_admin":   "/equipment",
    "production_admin":  "/production",
    "mine_planner":      "/scenario",
    "management":        "/production",
}

GUEST_USER = {"username": "guest", "role": "guest", "name": "Guest"}


# ---------------------------------------------------------------------------
# Token helpers
# ---------------------------------------------------------------------------

def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


create_access_token = create_token


def authenticate_user(username: str, password: str):
    """Only functional when DEMO_BOOTSTRAP_ENABLED=true with env-var passwords."""
    if not _DEMO_ENABLED or not DEMO_USERS:
        return None
    user = DEMO_USERS.get(username)
    if not user or password != user["password"]:
        return None
    return {"username": username, **user}


def _decode_demo_token(token: str) -> dict | None:
    """Decode a locally-issued demo JWT. Returns user dict or None."""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        username = payload.get("sub")
        if not username:
            return None
        user = DEMO_USERS.get(username, {})
        role = payload.get("role") or user.get("role")
        if role:
            return {"username": username, **user, "role": role, "name": user.get("name", username)}
        return None
    except JWTError:
        return None


import base64
import json
import time
import urllib.request

from jose import jwk

_JWKS_CACHE: dict = {"keys": {}, "fetched_at": 0}

def _get_clerk_jwks_url() -> str | None:
    if settings.CLERK_JWKS_URL:
        return settings.CLERK_JWKS_URL
    pub_key = settings.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY or ""
    if pub_key.startswith("pk_test_") or pub_key.startswith("pk_live_"):
        try:
            b64_part = pub_key.split("_")[2]
            # Add padding if needed
            padded = b64_part + "=" * (-len(b64_part) % 4)
            domain = base64.b64decode(padded).decode("utf-8").rstrip("$")
            return f"https://{domain}/.well-known/jwks.json"
        except Exception as e:
            logger.warning("Could not derive Clerk JWKS URL from publishable key: %s", e)
    return None


def _get_clerk_jwks() -> dict:
    global _JWKS_CACHE
    now = time.time()
    if _JWKS_CACHE["keys"] and (now - _JWKS_CACHE["fetched_at"]) < 3600:
        return _JWKS_CACHE["keys"]

    url = _get_clerk_jwks_url()
    if not url:
        return {}

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Crucible AI-FastAPI-JWKS"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            keys_by_kid = {k["kid"]: k for k in data.get("keys", []) if "kid" in k}
            _JWKS_CACHE = {"keys": keys_by_kid, "fetched_at": now}
            logger.info("Loaded %d Clerk JWKS public keys from %s", len(keys_by_kid), url)
            return keys_by_kid
    except Exception as e:
        logger.warning("Failed to fetch Clerk JWKS from %s: %s", url, e)
        return _JWKS_CACHE.get("keys", {})


def _verify_clerk_token(token: str) -> dict | None:
    """Verify a Clerk RS256 JWT using Clerk's JWKS.

    Validates:
    - Algorithm is RS256 (reject HS256 / none)
    - Signature via JWKS public key
    - Expiry (jose handles this by default)
    - Issuer if CLERK_ISSUER env var is configured
    """
    try:
        header = jwt.get_unverified_header(token)
        kid = header.get("kid")
        alg = header.get("alg", "RS256")
        if alg != "RS256":
            logger.warning("Clerk token rejected: unexpected algorithm '%s'", alg)
            return None

        keys = _get_clerk_jwks()
        if not keys or kid not in keys:
            # Force re-fetch once if key not found (handles key rotation).
            # We only do ONE re-fetch to prevent infinite loops.
            _JWKS_CACHE["fetched_at"] = 0
            keys = _get_clerk_jwks()
            if not keys or kid not in keys:
                logger.warning("Clerk token rejected: unknown kid='%s'", kid)
                return None

        jwk_dict = keys[kid]
        key_obj = jwk.construct(jwk_dict)

        payload = jwt.decode(
            token,
            key_obj,
            algorithms=["RS256"],
            options={"verify_aud": False, "verify_sub": True, "leeway": 60},
        )

        sub = payload.get("sub")
        if not sub:
            logger.warning("Clerk token rejected: missing 'sub' claim")
            return None

        # Issuer validation: enforce if CLERK_ISSUER is configured
        if settings.CLERK_ISSUER:
            token_iss = payload.get("iss", "")
            if token_iss != settings.CLERK_ISSUER:
                logger.warning(
                    "Clerk token rejected: issuer mismatch "
                    "(expected='%s' got='%s') sub='%s'",
                    settings.CLERK_ISSUER, token_iss, sub
                )
                return None

        # Extract role from Clerk public metadata; default to 'unassigned' (no privilege)
        metadata = payload.get("public_metadata") or payload.get("publicMetadata") or {}
        role = metadata.get("role", "unassigned")
        name = payload.get("name") or payload.get("first_name") or sub
        email = payload.get("email") or ""

        # Mine scoping, when the workspace publishes it. Absent metadata leaves
        # `allowed_mines` as None, which rbac.check_mine_access treats as an
        # UNSCOPED user — permitted outside production, refused inside it.
        allowed_mines = metadata.get("allowed_mines") or metadata.get("allowedMines")
        if isinstance(allowed_mines, str):
            allowed_mines = [m.strip() for m in allowed_mines.split(",") if m.strip()]

        return {
            "username": sub,
            "role": role,
            "name": name,
            "email": email,
            "clerk_id": sub,
            "allowed_mines": allowed_mines,
            "mine_id": metadata.get("mine_id") or metadata.get("mineId"),
        }
    except Exception as e:
        logger.warning("Clerk token verification failed (%s): %s", type(e).__name__, str(e))
        return None


# ---------------------------------------------------------------------------
# FastAPI dependency helpers
# ---------------------------------------------------------------------------

async def get_current_user(token: str | None = Depends(oauth2_scheme)):
    """
    Flexible auth: returns GUEST_USER if no token provided (read-only endpoints).
    Raises HTTP 401 Unauthorized if a token is provided but fails verification.
    """
    if token is None:
        return GUEST_USER

    # 1. Demo JWT (if enabled)
    if _DEMO_ENABLED and DEMO_USERS:
        demo_user = _decode_demo_token(token)
        if demo_user:
            return demo_user

    # 2. Cryptographic Clerk verification
    clerk_user = _verify_clerk_token(token)
    if clerk_user:
        return clerk_user

    # A token was provided but failed both checks — NEVER silently fallback to guest!
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired authentication credentials.",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def require_auth(token: str | None = Depends(oauth2_scheme)):
    """Strict auth — requires a valid token. Used on write/sensitive endpoints."""
    cred_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication credentials required.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if token is None:
        raise cred_exc

    if _DEMO_ENABLED and DEMO_USERS:
        demo_user = _decode_demo_token(token)
        if demo_user:
            return demo_user

    clerk_user = _verify_clerk_token(token)
    if clerk_user:
        return clerk_user

    raise cred_exc
