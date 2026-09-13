"""app/api/core/mine_context.py — which mine is this request about?

The pattern being replaced looked harmless:

    def get_mine_pulse(mine_id: str = "mine-01", user=Depends(get_current_user)):

A caller that forgets to pass a mine does not get an error. It gets a confident,
fully-populated answer about a mine it did not ask for and the user may not be
authorised to see. In a decision platform that is the worst possible failure
mode, because nothing about the response looks wrong.

Every endpoint that is about a mine resolves its context here instead. The
resolution order is: what the caller asked for, then what the user is assigned
to, then — only when the user is scoped to exactly one mine — that one. There is
no fallback to an arbitrary identifier.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from fastapi import Depends

from .db import query
from .errors import MineContextRequired
from .rbac import check_mine_access
from .security import get_current_user

logger = logging.getLogger("crucible.mine_context")


@dataclass(frozen=True)
class MineContext:
    """An authorised mine scope for one request."""

    mine_id: str
    name: str | None
    state: str | None
    district: str | None
    latitude: float | None
    longitude: float | None
    active: bool
    #: "explicit" (caller supplied), "assigned" (user metadata), "sole" (only
    #: mine the user can reach). Recorded so audit can show how scope was chosen.
    resolved_from: str

    @property
    def location(self) -> tuple[float, float] | None:
        if self.latitude is None or self.longitude is None:
            return None
        return (self.latitude, self.longitude)

    def as_dict(self) -> dict:
        return {
            "mine_id": self.mine_id,
            "name": self.name,
            "state": self.state,
            "district": self.district,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "active": self.active,
            "resolved_from": self.resolved_from,
        }


def list_mines() -> list[dict]:
    """Every mine the platform knows about. Column list is explicit, not `*`."""
    try:
        return query(
            """SELECT mine_id, mine_name, state, district, latitude, longitude, active
               FROM ops.mines
               ORDER BY mine_id""",
            (),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Mine registry unavailable: %s", exc)
        return []


def _lookup(mine_id: str) -> dict | None:
    try:
        rows = query(
            """SELECT mine_id, mine_name, state, district, latitude, longitude, active
               FROM ops.mines WHERE mine_id = %s LIMIT 1""",
            (mine_id,),
        )
        return rows[0] if rows else None
    except Exception as exc:  # noqa: BLE001
        logger.warning("Mine lookup failed for %s: %s", mine_id, exc)
        return None


def resolve_mine_context(mine_id: str | None, user: dict) -> MineContext:
    """Resolve and authorise the mine for this request.

    Raises :class:`MineContextRequired` rather than guessing. The error carries
    the mines the user *can* reach, so the client can prompt a choice instead of
    showing a dead end.
    """
    candidates = list_mines()
    reachable = [m["mine_id"] for m in candidates if check_mine_access(user, m["mine_id"])]

    def build(row: dict, source: str) -> MineContext:
        return MineContext(
            mine_id=row["mine_id"],
            name=row.get("mine_name"),
            state=row.get("state"),
            district=row.get("district"),
            latitude=float(row["latitude"]) if row.get("latitude") is not None else None,
            longitude=float(row["longitude"]) if row.get("longitude") is not None else None,
            active=bool(row.get("active", True)),
            resolved_from=source,
        )

    # 1. The caller said which mine. Authorise it; never silently substitute.
    if mine_id:
        if not check_mine_access(user, mine_id):
            # Deliberately the same shape as "unknown mine": telling an
            # unauthorised caller that a mine exists is itself a disclosure.
            raise MineContextRequired(
                f"Mine '{mine_id}' is not available to this account.",
                available_mines=reachable,
            )
        row = _lookup(mine_id)
        if row is None:
            # Known to the caller but absent from the registry. Honour it with
            # nulls rather than 404 — operational tables may hold rows for a mine
            # the registry has not caught up with — but say where it came from.
            logger.info("Mine %s is not in ops.mines; proceeding without geometry", mine_id)
            return MineContext(
                mine_id=mine_id, name=None, state=None, district=None,
                latitude=None, longitude=None, active=True,
                resolved_from="explicit_unregistered",
            )
        return build(row, "explicit")

    # 2. The user is assigned to one.
    assigned = user.get("mine_id")
    if assigned and check_mine_access(user, assigned):
        row = _lookup(assigned)
        if row is not None:
            return build(row, "assigned")

    # 3. The user can reach exactly one. Choosing it is unambiguous.
    if len(reachable) == 1:
        row = next(m for m in candidates if m["mine_id"] == reachable[0])
        return build(row, "sole")

    # 4. Ambiguous. Ask; do not pick.
    raise MineContextRequired(
        "This request is about a specific mine, but none was given and your "
        "account has access to more than one.",
        available_mines=reachable,
    )


def mine_context(mine_id: str | None = None, user: dict = Depends(get_current_user)) -> MineContext:
    """FastAPI dependency form.

    Usage::

        @router.get("/state")
        def state(ctx: MineContext = Depends(mine_context)):
            ...
    """
    return resolve_mine_context(mine_id, user)


__all__ = ["MineContext", "list_mines", "mine_context", "resolve_mine_context"]
