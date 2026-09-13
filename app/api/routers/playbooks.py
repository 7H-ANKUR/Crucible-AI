"""app/api/routers/playbooks.py — response playbooks and decision packages.

Two surfaces that both turn analysis into something a person can act on:

* **Playbooks** — a site's own standing answer to a recurring situation.
* **Decision packages** — one situation rendered as an approvable document.

Neither performs an operational action. A triggered playbook proposes steps; a
package proposes a decision. Both state, in the payload, that a human approves.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field

from ..core import playbooks as playbook_engine
from ..core.decision_package import as_markdown, build as build_package
from ..core.mine_context import MineContext, mine_context
from ..core.rbac import require_any_role, require_authenticated
from ..core.scenario import ScenarioObjective
from ..core.security import get_current_user

logger = logging.getLogger("crucible.playbooks.router")
router = APIRouter(tags=["playbooks"])


class TriggerClauseIn(BaseModel):
    signal: str
    operator: str | None = None
    value: float | None = None
    severity_at_least: str | None = None
    evidence_field: str | None = None
    equals: str | None = None


class PlaybookStepIn(BaseModel):
    order: int
    action: str
    intervention_key: str | None = None
    owner: str | None = None
    requires_confirmation: bool = False


class PlaybookIn(BaseModel):
    playbook_ref: str = Field(..., min_length=3, max_length=64)
    name: str
    incident_type: str
    description: str | None = None
    mine_id: str | None = Field(
        default=None, description="Null makes the playbook apply to every mine."
    )
    trigger: list[TriggerClauseIn] = Field(default_factory=list)
    steps: list[PlaybookStepIn] = Field(default_factory=list)
    site_procedure_ref: str | None = Field(
        default=None,
        description=(
            "Reference to the site's own approved procedure, where one governs "
            "this situation. Crucible AI surfaces it; it does not supersede it."
        ),
    )
    active: bool = True


def _identity(user) -> tuple[str, str]:
    if isinstance(user, dict):
        return user.get("username") or user.get("email") or "user", user.get("role", "guest")
    return getattr(user, "username", "user"), getattr(user, "role", "guest")


@router.get("", summary="Playbooks that apply to a mine")
def list_for_mine(
    ctx: MineContext = Depends(mine_context),
    include_inactive: bool = False,
):
    books = playbook_engine.list_playbooks(ctx.mine_id, include_inactive=include_inactive)
    return {
        "mine_id": ctx.mine_id,
        "playbooks": [p.as_dict() for p in books],
        "count": len(books),
        "note": (
            "Playbooks scoped to this mine take precedence over the platform-wide "
            "starting set, which is provided to be edited rather than relied on."
        ),
    }


@router.get("/evaluate", summary="Which playbooks the current state triggers")
def evaluate(ctx: MineContext = Depends(mine_context)):
    """Triggered and dormant playbooks, each with its reason.

    Dormant ones are returned deliberately: without them there is no way to tell
    "nothing is wrong" from "the check never ran".
    """
    return playbook_engine.evaluate(ctx.mine_id)


@router.put("/{playbook_ref}", summary="Create or replace a playbook")
def save(
    playbook_ref: str,
    body: PlaybookIn,
    user=Depends(require_any_role(["super_admin", "production_admin", "mine_planner"])),
):
    """Encoding site knowledge changes what Crucible AI proposes, so it is role-gated
    and audited in the same transaction as the write."""
    actor, role = _identity(user)
    book = playbook_engine.Playbook(
        playbook_ref=playbook_ref,
        name=body.name,
        incident_type=body.incident_type,
        description=body.description,
        mine_id=body.mine_id,
        trigger=[playbook_engine.TriggerClause(**c.model_dump()) for c in body.trigger],
        steps=[playbook_engine.PlaybookStep(**s.model_dump()) for s in body.steps],
        site_procedure_ref=body.site_procedure_ref,
        active=body.active,
    )
    return playbook_engine.save_playbook(book, actor_id=actor, actor_role=role)


@router.post("/seed", summary="Write the built-in playbooks so they can be edited")
def seed(user=Depends(require_any_role(["super_admin"]))):
    actor, _ = _identity(user)
    return {"seeded": playbook_engine.seed_built_ins(actor)}


# ---------------------------------------------------------------------------
# Decision packages
# ---------------------------------------------------------------------------

package_router = APIRouter(tags=["decision-packages"])


@package_router.get("", summary="Build a decision package")
def decision_package(
    ctx: MineContext = Depends(mine_context),
    item_key: str | None = None,
    objective: ScenarioObjective = ScenarioObjective.BALANCED,
    prepared_for: str | None = None,
    user=Depends(get_current_user),
):
    actor, _ = _identity(user)
    return build_package(
        ctx.mine_id,
        item_key=item_key,
        location=ctx.location,
        objective=objective,
        prepared_by=actor,
        prepared_for=prepared_for,
    )


@package_router.get("/markdown", summary="The same package, printable")
def decision_package_markdown(
    ctx: MineContext = Depends(mine_context),
    item_key: str | None = None,
    objective: ScenarioObjective = ScenarioObjective.BALANCED,
    user=Depends(get_current_user),
):
    """Markdown, for attaching to a shift report or tabling at a meeting."""
    actor, _ = _identity(user)
    package = build_package(
        ctx.mine_id,
        item_key=item_key,
        location=ctx.location,
        objective=objective,
        prepared_by=actor,
    )
    return Response(content=as_markdown(package), media_type="text/markdown")
