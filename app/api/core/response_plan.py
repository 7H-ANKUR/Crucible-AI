"""app/api/core/response_plan.py — turn a detected problem into an executable plan.

The deliverable a manager actually needs: situation, evidence, root cause, what
to do NOW / NEXT / NEXT SHIFT, expected effect, constraints, risks, who approves
it and who owns it.

Two properties it maintains:

**Every claim traces to something measured.** The situation paragraph, the root
cause and each action's expected effect are assembled from values produced by
the state engine, the bottleneck analysis and the scenario engine. No sentence
here introduces a number of its own.

**The plan is a proposal.** It is generated in SIMULATED state and cannot execute
itself. Actions carry the roles that must approve them, and the language
throughout describes what a person should do — Crucible AI supports the decision and
never takes it.
"""

from __future__ import annotations

import logging
from typing import Any

from .attention import build as build_attention
from .bottleneck import analyse as analyse_bottleneck
from .decision_store import create_plan
from .projection import compare_options, do_nothing
from .provenance import CalculationMode
from .recommendations import build as build_recommendations
from .scenario import ScenarioObjective

logger = logging.getLogger("crucible.response_plan")

#: Order actions are presented in. A plan a shift can follow reads in time order.
HORIZON_ORDER = ("NOW", "NEXT", "NEXT_SHIFT")

HORIZON_LABELS = {
    "NOW": "Now — next 30 minutes",
    "NEXT": "Next — 30 minutes to 2 hours",
    "NEXT_SHIFT": "Next shift",
}


def _situation(item: dict[str, Any], projection, state_headline: str) -> str:
    """What is happening, in the manager's terms, from measured values."""
    parts = [item["summary"]]

    if item.get("impact_t") is not None:
        parts.append(
            f"Production at stake is {abs(item['impact_t']):,.1f} t "
            f"({item['impact_basis'].rstrip('.')})."
        )
    else:
        parts.append(item["impact_basis"])

    if projection.available and projection.points:
        shift_end = next((p for p in projection.points if p.key == "shift_end"), None)
        if shift_end and shift_end.shortfall_t > 0:
            parts.append(
                f"If nothing changes, the gap reaches {shift_end.shortfall_t:,.0f} t "
                f"by end of shift."
            )

    return " ".join(parts)


def _root_cause(item: dict[str, Any], bottleneck: dict[str, Any]) -> tuple[str, str]:
    """The most likely cause, and how confident that attribution is.

    For a production shortfall the binding stage is the cause worth naming —
    every other stage has headroom by definition, so relieving them changes
    nothing.
    """
    constraint = bottleneck.get("bottleneck")

    # `analyse` returns the *most loaded* stage, which is not automatically a
    # constraint. Calling a stage at 63% utilisation "the binding stage" would
    # send a manager to relieve something that has ample headroom, so the claim
    # is only made when the stage is genuinely constrained or saturated.
    constrained = bool(constraint) and constraint["status"] in ("CONSTRAINED", "SATURATED")

    if item["key"] == "bottleneck" and constraint:
        return constraint["reason"], constraint["calculation_mode"]

    if item["key"] == "production_gap":
        if constrained:
            return (
                f"{constraint['label']} is the binding stage at "
                f"{constraint['utilisation_pct']:.0f}% utilisation. "
                f"{constraint['reason']}",
                constraint["calculation_mode"],
            )
        if constraint:
            return (
                f"No stage of the material flow is constrained — the most loaded, "
                f"{constraint['label'].lower()}, is only at "
                f"{constraint['utilisation_pct']:.0f}% of capacity. The shortfall is "
                "therefore not explained by flow capacity: the likely causes are "
                "insufficient ore made available to the flow, lost operating time, "
                "or a plan set above what this mine has been achieving.",
                constraint["calculation_mode"],
            )
        return (
            "No stage could be measured, so the shortfall cannot be attributed to a "
            "specific part of the flow.",
            CalculationMode.INSUFFICIENT_DATA.value,
        )

    if item["key"] in ("equipment_risk", "maintenance_overdue"):
        drivers = item.get("drivers") or [{}]
        driver = drivers[0]
        worst = driver.get("worst_machine") or ", ".join(driver.get("flagged_ids", [])[:3])
        if worst:
            return (
                f"Equipment condition is the driver: {worst} "
                f"{'is the most overdue' if driver.get('worst_machine') else 'are flagged'}.",
                CalculationMode.MODEL_BACKED.value,
            )

    return item["summary"], item["calculation_mode"]


def _group_actions(recommendations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Actions grouped into the windows a shift actually plans around."""
    groups = []
    for horizon in HORIZON_ORDER:
        actions = [r for r in recommendations if r.get("horizon") == horizon]
        if actions:
            groups.append(
                {
                    "horizon": horizon,
                    "label": HORIZON_LABELS[horizon],
                    "actions": actions,
                }
            )
    return groups


def generate(
    mine_id: str,
    *,
    item_key: str | None = None,
    location: tuple[float, float] | None = None,
    objective: ScenarioObjective = ScenarioObjective.BALANCED,
    created_by: str = "system",
    actor_role: str = "system",
    persist: bool = False,
    incident_id: int | None = None,
) -> dict[str, Any]:
    """Build a response plan for a mine's highest-priority problem.

    `item_key` targets a specific attention item; without it the top-ranked one
    is used.
    """
    attention = build_attention(mine_id)
    items = attention.get("items") or []

    if not items:
        return {
            "mine_id": mine_id,
            "available": False,
            "reason": "Nothing currently requires attention at this mine.",
            "state": attention.get("state"),
        }

    item = next((i for i in items if i["key"] == item_key), items[0]) if item_key else items[0]

    projection = do_nothing(mine_id)
    bottleneck = analyse_bottleneck(mine_id)
    recommendations = build_recommendations(
        mine_id, {"items": [item]}, location=location, objective=objective, limit=5
    )

    offered = recommendations.get("recommendations") or []
    blocked = recommendations.get("blocked") or []

    root_cause, root_cause_mode = _root_cause(item, bottleneck)
    situation = _situation(item, projection, attention.get("headline", ""))

    expected_delta = sum(
        r["expected_delta_t"] for r in offered if r.get("expected_delta_t") is not None
    )
    residual = (
        abs(item["impact_t"]) - expected_delta if item.get("impact_t") is not None else None
    )

    comparison = compare_options(mine_id, offered)

    # A plan is only as well-supported as its weakest included action.
    grades = [r.get("evidence_quality", "UNAVAILABLE") for r in offered]
    order = {"HIGH": 3, "MEDIUM": 2, "LOW": 1, "UNAVAILABLE": 0}
    evidence_quality = min(grades, key=lambda g: order.get(g, 0)) if grades else "UNAVAILABLE"

    modes = {r.get("calculation_mode") for r in offered}
    if modes == {CalculationMode.MODEL_BACKED.value}:
        calculation_mode = CalculationMode.MODEL_BACKED.value
    elif offered:
        calculation_mode = CalculationMode.HEURISTIC.value
    else:
        calculation_mode = CalculationMode.INSUFFICIENT_DATA.value

    approvals = sorted({role for r in offered for role in r.get("approval_roles", [])})
    owners = sorted({r["owner"] for r in offered if r.get("owner")})

    plan: dict[str, Any] = {
        "mine_id": mine_id,
        "available": True,
        "addresses": item["key"],
        "title": f"{item['title']} response plan",
        "objective": objective.value,
        "severity": item["severity"],
        "state": attention.get("state"),

        "situation": situation,
        "evidence": {
            "drivers": item.get("drivers", []),
            "impact_t": item.get("impact_t"),
            "impact_basis": item.get("impact_basis"),
            "bottleneck": bottleneck.get("bottleneck"),
            "clock": attention.get("clock"),
        },
        "root_cause": root_cause,
        "root_cause_calculation_mode": root_cause_mode,

        "action_groups": _group_actions(offered),
        "actions": offered,
        # Shown, not hidden: an option refused by a constraint is part of the
        # reasoning, and its absence would read as never having been considered.
        "not_available": blocked,

        "expected": {
            "delta_t": round(expected_delta, 1) if offered else None,
            "residual_gap_t": round(residual, 1) if residual is not None else None,
            "calculation_mode": calculation_mode,
            "note": (
                "Action effects are individual estimates against the same baseline. "
                "They are summed here as an indication; actions that touch the same "
                "constraint will not stack fully."
            ),
        },
        "do_nothing": projection.as_dict(),
        "comparison": comparison,

        "constraints_checked": [
            {
                "action": r["key"],
                "summary": r["constraint_summary"],
                "feasible": r["feasible"],
            }
            for r in offered + blocked
        ],
        "risks": sorted({t for r in offered for t in r.get("tradeoffs", [])}),

        "evidence_quality": evidence_quality,
        "calculation_mode": calculation_mode,
        "approval_required": approvals,
        "owners": owners,
        "lifecycle_state": "SIMULATED",
        "disclaimer": (
            "This plan is a proposal for authorised mine personnel. Crucible AI does not "
            "execute operational actions and does not supersede the site's approved "
            "procedures."
        ),
    }

    if persist and offered:
        try:
            record = create_plan(
                mine_id=mine_id,
                objective=objective.value,
                situation=situation,
                root_cause=root_cause,
                expected_delta_t=expected_delta or None,
                residual_gap_t=residual,
                calculation_mode=calculation_mode,
                evidence_quality=evidence_quality,
                evidence_detail=plan["evidence"],
                constraints_checked=plan["constraints_checked"],
                created_by=created_by,
                actor_role=actor_role,
                incident_id=incident_id,
                owner=owners[0] if owners else None,
                actions=[
                    {
                        "key": r["key"],
                        "title": r["title"],
                        "description": r["action"],
                        "horizon": r["horizon"],
                        "magnitude": 0.10,
                        "expected_delta_t": r["expected_delta_t"],
                        "cost_inr": r["cost_inr"],
                        "cost_basis": r["cost_basis"],
                        "risk_delta": r["risk_delta"],
                        "calculation_mode": r["calculation_mode"],
                        "method": r["method"],
                        "tradeoffs": r["tradeoffs"],
                        "owner": r["owner"],
                    }
                    for r in offered
                ],
            )
            plan["plan_id"] = record["id"]
            plan["plan_ref"] = record["plan_ref"]
            plan["lifecycle_state"] = record["lifecycle_state"]
        except Exception as exc:  # noqa: BLE001
            # The plan is still returned — losing the analysis because it could
            # not be filed would be the worse failure — but the caller is told
            # plainly that it was not saved, rather than assuming it was.
            logger.exception("Failed to persist response plan for %s", mine_id)
            plan["persisted"] = False
            plan["persist_error"] = (
                f"The plan was generated but could not be saved ({type(exc).__name__}). "
                "It cannot be approved or tracked until it is saved."
            )
        else:
            plan["persisted"] = True

    return plan


__all__ = ["HORIZON_LABELS", "HORIZON_ORDER", "generate"]
