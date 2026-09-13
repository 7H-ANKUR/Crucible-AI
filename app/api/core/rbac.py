"""app/api/core/rbac.py — Role-Based Access Control for Crucible AI FastAPI.

Provides FastAPI dependency factories that enforce role-level authorization.
All functions raise HTTP 403 (Forbidden) on access denial so that callers know
they are authenticated but not authorized — distinguishing from HTTP 401.

Usage example in a router:
    from ..core.rbac import require_role, require_any_role

    @router.post("/approve")
    def approve_model(user=Depends(require_role("super_admin"))):
        ...

    @router.post("/upload")
    def upload_data(user=Depends(require_any_role(["super_admin", "production_admin"]))):
        ...
"""
import logging

from fastapi import Depends, HTTPException, status

from .config import settings
from .security import get_current_user

logger = logging.getLogger("crucible.rbac")

# ---------------------------------------------------------------------------
# Role hierarchy
# ---------------------------------------------------------------------------

# All valid roles (matches Clerk publicMetadata.role values)
VALID_ROLES = {
    "super_admin",
    "management",
    "production_admin",
    "exploration_admin",
    "equipment_admin",
    "mine_planner",
}

# Department each role belongs to (used for require_department)
ROLE_DEPARTMENT: dict[str, str] = {
    "super_admin":      "all",
    "management":       "all",
    "production_admin": "production",
    "exploration_admin":"exploration",
    "equipment_admin":  "equipment",
    "mine_planner":     "planning",
}

# super_admin implicitly has all permissions
SUPER_ADMIN = "super_admin"


def _forbidden(role: str, required: str) -> HTTPException:
    logger.warning("RBAC denied: role=%s required=%s", role, required)
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"Role '{role}' is not authorized for this action. Required: {required}",
    )


# ---------------------------------------------------------------------------
# Dependency factories
# ---------------------------------------------------------------------------

def require_role(role: str):
    """Returns a FastAPI dependency that enforces exactly one role.

    super_admin always passes regardless of the target role.
    """
    async def _dep(user: dict = Depends(get_current_user)):
        user_role = user.get("role", "guest")
        if user_role == SUPER_ADMIN:
            return user
        if user_role == role:
            return user
        raise _forbidden(user_role, role)
    return _dep


def require_any_role(roles: list[str]):
    """Returns a FastAPI dependency that passes if the user has any of the given roles.

    super_admin always passes.
    """
    role_set = set(roles)
    async def _dep(user: dict = Depends(get_current_user)):
        user_role = user.get("role", "guest")
        if user_role == SUPER_ADMIN:
            return user
        if user_role in role_set:
            return user
        raise _forbidden(user_role, f"one of {sorted(roles)}")
    return _dep


def require_department(department: str):
    """Returns a FastAPI dependency that passes if the user's department matches.

    super_admin and management (read-all) always pass.
    department: 'production' | 'exploration' | 'equipment' | 'planning'
    """
    async def _dep(user: dict = Depends(get_current_user)):
        user_role = user.get("role", "guest")
        if user_role in (SUPER_ADMIN, "management"):
            return user
        user_dept = ROLE_DEPARTMENT.get(user_role, "")
        if user_dept == department:
            return user
        raise _forbidden(user_role, f"department:{department}")
    return _dep


def require_authenticated():
    """Returns a FastAPI dependency that requires any authenticated role (no guest)."""
    async def _dep(user: dict = Depends(get_current_user)):
        if user.get("role") in (None, "guest"):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return user
    return _dep


def check_domain_access(user: dict, domain: str) -> bool:
    """Check if user has administrative or write rights to a specific domain."""
    user_role = user.get("role", "guest")
    if user_role == SUPER_ADMIN:
        return True
    domain_role_map = {
        "production": {"production_admin"},
        "equipment": {"equipment_admin"},
        "exploration": {"exploration_admin"},
        "maintenance": {"equipment_admin"},
        "planning": {"mine_planner"},
    }
    allowed = domain_role_map.get(domain.lower(), set())
    return user_role in allowed


def require_domain_permission(domain: str):
    """FastAPI dependency requiring permissions for a specific domain."""
    async def _dep(user: dict = Depends(require_authenticated())):
        if not check_domain_access(user, domain):
            raise _forbidden(user.get("role", "guest"), f"domain:{domain}_admin")
        return user
    return _dep


def check_mine_access(user: dict, mine_id: str) -> bool:
    """Is this user authorised for this mine?

    The previous implementation ended in a bare ``return True``, so a user whose
    token carried neither ``allowed_mines`` nor ``mine_id`` — which is every
    Clerk user, since the workspace does not publish that metadata — reached
    every mine in the platform. That is the whole of mine-level isolation
    failing open.

    An unscoped user is now resolved by environment rather than by accident:

    * **production** — refused. An unscoped account in production is a
      misconfiguration, and the safe reading of a misconfiguration is "no
      access", not "all access".
    * **anywhere else** — permitted, and logged at WARNING once per user so the
      gap is visible in development rather than silently relied upon.

    Grant access properly by setting ``allowed_mines`` (a list, or ``"*"``) in
    the user's Clerk ``publicMetadata``.
    """
    if not user:
        return False

    user_role = user.get("role", "guest")
    if user_role == SUPER_ADMIN:
        return True

    allowed_mines = user.get("allowed_mines")
    if allowed_mines:
        if "*" in allowed_mines or "all" in allowed_mines:
            return True
        return mine_id in allowed_mines

    assigned_mine = user.get("mine_id")
    if assigned_mine:
        return assigned_mine == mine_id

    # Unscoped from here down.
    if settings.ENVIRONMENT.lower() == "production":
        logger.warning(
            "Mine access refused: user=%s has no mine scope and ENVIRONMENT=production",
            user.get("sub") or user.get("username") or user.get("email"),
        )
        return False

    _warn_unscoped(user)
    return True


#: Users already warned about, so the log records the gap without flooding.
_UNSCOPED_WARNED: set[str] = set()


def _warn_unscoped(user: dict) -> None:
    identity = str(user.get("sub") or user.get("username") or user.get("email") or "unknown")
    if identity in _UNSCOPED_WARNED:
        return
    _UNSCOPED_WARNED.add(identity)
    logger.warning(
        "User %s (role=%s) has no allowed_mines and no mine_id; granting all-mine access "
        "because ENVIRONMENT=%s. This would be refused in production — set allowed_mines "
        "in Clerk publicMetadata.",
        identity,
        user.get("role", "guest"),
        settings.ENVIRONMENT,
    )


def accessible_mines(user: dict, candidates: list[str]) -> list[str]:
    """Filter a list of mine ids down to those the user may see."""
    return [m for m in candidates if check_mine_access(user, m)]


def require_mine_access(mine_id: str, user: dict = Depends(get_current_user)):
    """FastAPI dependency ensuring caller has permission for the specified mine_id."""
    if not check_mine_access(user, mine_id):
        logger.warning("Mine access denied: user=%s mine_id=%s", user.get("sub") or user.get("email"), mine_id)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"User is not authorized for mine '{mine_id}'",
        )
    return user

