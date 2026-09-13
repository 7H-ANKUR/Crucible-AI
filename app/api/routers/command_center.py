"""app/api/routers/command_center.py — the first screen after login.

Answers, in this order: does the mine need me, what first, what should I do, and
what happens if I do nothing. The information hierarchy of the page is the
hierarchy of this payload — state, then attention, then recommendations, then
the do-nothing projection — so the two cannot drift apart.

`/summary` is one request rather than five because the sections are read
together and a page that fills in piecemeal reads as unreliable. The individual
endpoints exist for refresh and for deep links.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Query

from ..core.attention import build as build_attention
from ..core.bottleneck import analyse as analyse_bottleneck
from ..core.handover import facts as handover_facts
from ..core.cache import build_cache_key, cache_manager
from ..core.mine_context import MineContext, list_mines, mine_context
from ..core.projection import do_nothing
from ..core.rbac import check_mine_access
from ..core.recommendations import build as build_recommendations
from ..core.response_plan import generate as generate_plan
from ..core.scenario import ScenarioObjective
from ..core.security import get_current_user
from ..core.state_engine import mine_state, platform_state

logger = logging.getLogger("crucible.command_center")
router = APIRouter(tags=["command-center"])

#: Short: this is the "is anything wrong right now" surface, and a manager
#: acting on a five-minute-old picture is the failure this guards against.
SUMMARY_TTL = 60
L1_TTL = 15


@router.get("/mines", summary="Mines this account may open")
def mines(user=Depends(get_current_user)):
    """Feeds the mine selector. Filtered by authorisation, not by the client."""
    rows = [m for m in list_mines() if check_mine_access(user, m["mine_id"])]
    return {
        "mines": [
            {
                "mine_id": m["mine_id"],
                "name": m.get("mine_name"),
                "state": m.get("state"),
                "district": m.get("district"),
                "active": m.get("active", True),
            }
            for m in rows
        ],
        "count": len(rows),
    }


@router.get("/state", summary="Operational state of the mine")
def state(ctx: MineContext = Depends(mine_context)):
    return mine_state(ctx.mine_id)


@router.get("/platform-state", summary="Data and model health")
def platform(ctx: MineContext = Depends(mine_context)):
    """Deliberately separate from operational state.

    Stale data is a platform problem, not a mining problem, and merging the two
    makes a mine with a broken feed look like a mine in trouble.
    """
    return platform_state(ctx.mine_id)


@router.get("/attention", summary="What needs attention, ranked")
def attention(
    ctx: MineContext = Depends(mine_context),
    limit: int = Query(6, ge=1, le=20),
):
    return build_attention(ctx.mine_id, limit=limit)


@router.get("/recommendations", summary="What to do about it")
def recommendations(
    ctx: MineContext = Depends(mine_context),
    objective: ScenarioObjective = ScenarioObjective.BALANCED,
    limit: int = Query(4, ge=1, le=10),
):
    queue = build_attention(ctx.mine_id)
    return build_recommendations(
        ctx.mine_id, queue, location=ctx.location, objective=objective, limit=limit
    )


@router.get("/do-nothing", summary="What happens without intervention")
def do_nothing_projection(ctx: MineContext = Depends(mine_context)):
    return do_nothing(ctx.mine_id).as_dict()


@router.get("/bottlenecks", summary="Stage-by-stage material flow")
def bottlenecks(ctx: MineContext = Depends(mine_context)):
    return analyse_bottleneck(ctx.mine_id)


@router.get("/response-plan", summary="Generate a response plan")
def response_plan(
    ctx: MineContext = Depends(mine_context),
    item_key: str | None = None,
    objective: ScenarioObjective = ScenarioObjective.BALANCED,
    persist: bool = False,
    user=Depends(get_current_user),
):
    """Build a plan for the top problem, or for `item_key` specifically.

    `persist` writes it so it can be approved and tracked. Left false by default:
    generating a plan is exploration, and filing one is a commitment.
    """
    return generate_plan(
        ctx.mine_id,
        item_key=item_key,
        location=ctx.location,
        objective=objective,
        created_by=_username(user),
        actor_role=user.get("role", "guest") if isinstance(user, dict) else "guest",
        persist=persist,
    )


@router.get("/handover", summary="Shift handover brief")
def handover(ctx: MineContext = Depends(mine_context)):
    """What the next shift supervisor needs to know.

    Assembled from stored facts. The narrative restates those findings and
    introduces nothing — a handover read by someone who was not there is the
    worst place for an invented number.
    """
    return handover_facts(ctx.mine_id).as_dict()


@router.get("/summary", summary="Everything the Command Center renders")
def summary(
    ctx: MineContext = Depends(mine_context),
    objective: ScenarioObjective = ScenarioObjective.BALANCED,
):
    """One payload, in the page's own priority order."""
    key = build_cache_key(
        domain="command_center",
        resource="summary",
        entity_id=ctx.mine_id,
        # The objective changes the ranking, so it must change the key — two
        # managers with different objectives must not share a cached answer.
        params={"objective": objective.value},
    )
    return cache_manager.get_or_set(
        key=key,
        ttl=SUMMARY_TTL,
        producer=lambda: _summary(ctx, objective),
        l1_ttl=L1_TTL,
        # Never served stale. Every other surface may show a slightly old number;
        # this one answers "is anything wrong right now", and a stale answer to
        # that question is worse than a slow one.
        allow_stale=False,
    )


def _summary(ctx: MineContext, objective: ScenarioObjective) -> dict:
    """Assemble the page.

    Sections that do not depend on one another are evaluated concurrently: each
    is dominated by database round-trip latency, so in sequence the page costs
    the sum of their waits instead of the longest.

    The dependency chain that remains is real — attention is derived from the
    state's signals, and recommendations respond to the attention queue — so
    those stay ordered.
    """
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=3) as pool:
        state_future = pool.submit(mine_state, ctx.mine_id)
        platform_future = pool.submit(platform_state, ctx.mine_id)
        projection_future = pool.submit(do_nothing, ctx.mine_id)

        state_report = state_future.result()
        # `analyse` is memoised and the state evaluation has already warmed it,
        # so this is a cache read rather than a second pass over the database.
        flow = analyse_bottleneck(ctx.mine_id)
        queue = build_attention(ctx.mine_id, state=state_report)

        try:
            recs = build_recommendations(
                ctx.mine_id, queue, location=ctx.location, objective=objective
            )
        except Exception as exc:  # noqa: BLE001
            # The page still renders. State and attention are the parts a manager
            # cannot do without, and losing them because the scenario engine
            # failed would be the worse outcome — but the failure is reported,
            # never presented as "no recommendations".
            logger.exception("Recommendations failed for %s", ctx.mine_id)
            recs = {
                "recommendations": [],
                "blocked": [],
                "note": f"Recommendations could not be generated ({type(exc).__name__}).",
                "failed": True,
            }

        platform = platform_future.result()
        projection = projection_future.result()

    return {
        "mine": ctx.as_dict(),
        # 1. Does the mine need me?
        "state": {
            "state": state_report["state"],
            "headline": state_report["headline"],
            "signals": state_report["signals"],
            "unmeasured": state_report["unmeasured"],
        },
        "platform": platform,
        # 2. What first?
        "attention": {
            "items": queue["items"],
            "item_count": queue["item_count"],
            "suppressed": queue["suppressed"],
            "knowledge_gaps": queue["knowledge_gaps"],
        },
        # 3. What do I do?
        "recommendations": recs,
        # 4. What if I do nothing?
        "do_nothing": projection.as_dict(),
        # 5. Supporting detail.
        "bottleneck": flow.get("bottleneck"),
        "stages": flow.get("stages", []),
        "clock": queue["clock"],
        "evaluated_at": queue["evaluated_at"],
    }


def _username(user) -> str:
    if isinstance(user, dict):
        return user.get("username") or user.get("email") or "user"
    return getattr(user, "username", "user")
