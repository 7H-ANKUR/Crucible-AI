"""app/api/core/recommendations.py — what to actually do about it.

Bridges detection to action: an attention item describes a problem, a
recommendation is a specific thing a named person can do about it in a stated
window, with its expected effect, cost, feasibility and approver attached.

Nothing here invents advice. Each recommendation is a catalogue intervention
evaluated by the scenario engine against the mine's live state, so its expected
effect is either a model counterfactual or a declared estimate that says so, and
its feasibility comes from the constraint engine rather than from a guess.

Some problems have no available action, and that is a legitimate — and
important — output. "Maintenance is 32 days overdue and deferral is refused"
tells a manager something true. Manufacturing a recommendation to fill the space
would not.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from .provenance import CalculationMode
from .scenario import ScenarioObjective, build_context, evaluate_intervention
from .scenario.catalogue import CATALOGUE, InterventionSpec
from .scenario.ranking import score as rank_score
from .scenario.types import InterventionOutcome

logger = logging.getLogger("crucible.recommendations")

#: Which catalogue actions address which detected problem. An action absent from
#: a problem's list is not offered for it, however attractive its numbers —
#: relevance is a judgement about the mine, not a ranking artefact.
RESPONSE_MAP: dict[str, tuple[str, ...]] = {
    "production_gap": (
        "equipment_redeploy",
        "fleet_reroute",
        "crusher_speed_trim",
        "blast_reschedule",
        "extend_operating_hours",
    ),
    "bottleneck": (
        "crusher_speed_trim",
        "equipment_redeploy",
        "fleet_reroute",
        "blast_reschedule",
    ),
    "equipment_risk": (
        "equipment_redeploy",
        "maintenance_defer",
    ),
    "maintenance_overdue": (
        "equipment_redeploy",
    ),
    "open_incidents": (),
}

#: Stage-specific narrowing. A constraint at the face is not relieved by moving
#: trucks, and offering that would waste a shift.
BOTTLENECK_STAGE_ACTIONS: dict[str, tuple[str, ...]] = {
    "face": ("blast_reschedule", "extend_operating_hours"),
    "loading": ("equipment_redeploy", "extend_operating_hours"),
    "haulage": ("fleet_reroute", "equipment_redeploy"),
    "processing": ("crusher_speed_trim",),
    "stockpile": ("fleet_reroute",),
}


@dataclass
class Recommendation:
    key: str
    title: str
    #: The attention item this responds to.
    addresses: str
    action: str
    reason: str

    expected_delta_t: float | None
    calculation_mode: CalculationMode
    method: str

    cost_inr: float | None
    cost_basis: str
    risk_delta: float
    evidence_quality: str

    feasible: bool
    constraint_summary: str
    tradeoffs: list[str] = field(default_factory=list)

    horizon: str = "NEXT"
    owner: str = "Shift Supervisor"
    approval_roles: list[str] = field(default_factory=list)
    #: Share of the problem this would close, where both are known.
    closes_pct: float | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "title": self.title,
            "addresses": self.addresses,
            "action": self.action,
            "reason": self.reason,
            "expected_delta_t": (
                round(self.expected_delta_t, 1) if self.expected_delta_t is not None else None
            ),
            "calculation_mode": self.calculation_mode.value,
            "method": self.method,
            "cost_inr": round(self.cost_inr, 0) if self.cost_inr is not None else None,
            "cost_basis": self.cost_basis,
            "risk_delta": round(self.risk_delta, 3),
            "evidence_quality": self.evidence_quality,
            "feasible": self.feasible,
            "constraint_summary": self.constraint_summary,
            "tradeoffs": self.tradeoffs,
            "horizon": self.horizon,
            "owner": self.owner,
            "approval_roles": self.approval_roles,
            "closes_pct": round(self.closes_pct, 1) if self.closes_pct is not None else None,
            "requires_approval": True,
        }


def _relevant_specs(item: dict[str, Any]) -> list[InterventionSpec]:
    keys = RESPONSE_MAP.get(item["key"], ())

    if item["key"] == "bottleneck":
        stage = None
        for driver in item.get("drivers") or []:
            stage = driver.get("stage") or stage
        if stage and stage in BOTTLENECK_STAGE_ACTIONS:
            keys = BOTTLENECK_STAGE_ACTIONS[stage]

    return [CATALOGUE[k] for k in keys if k in CATALOGUE]


def _from_outcome(
    outcome: InterventionOutcome,
    spec: InterventionSpec,
    item: dict[str, Any],
) -> Recommendation:
    impact = item.get("impact_t")
    closes = None
    if impact and outcome.delta_t:
        closes = min(100.0, 100.0 * outcome.delta_t / abs(impact))

    if outcome.delta_t is None:
        reason = f"Effect on {item['title'].lower()} could not be estimated: {outcome.method}."
    elif closes is not None:
        reason = (
            f"Expected to recover {outcome.delta_t:+,.1f} t, closing about "
            f"{closes:.0f}% of the {abs(impact):,.1f} t at stake."
        )
    else:
        reason = f"Expected to change production by {outcome.delta_t:+,.1f} t."

    return Recommendation(
        key=outcome.key,
        title=spec.title,
        addresses=item["key"],
        action=spec.description,
        reason=reason,
        expected_delta_t=outcome.delta_t,
        calculation_mode=outcome.calculation_mode,
        method=outcome.method,
        cost_inr=outcome.cost_inr,
        cost_basis=outcome.cost_basis,
        risk_delta=outcome.risk_delta,
        evidence_quality=outcome.evidence.quality.value,
        feasible=outcome.feasible,
        constraint_summary=outcome.constraints.reason,
        tradeoffs=list(outcome.tradeoffs),
        horizon=spec.horizon,
        owner=spec.owner,
        approval_roles=list(spec.approval_roles),
        closes_pct=closes,
    )


def build(
    mine_id: str,
    attention: dict[str, Any],
    *,
    location: tuple[float, float] | None = None,
    objective: ScenarioObjective = ScenarioObjective.BALANCED,
    limit: int = 4,
) -> dict[str, Any]:
    """Recommendations for the mine's current attention queue.

    One scenario context is built and shared, so every recommendation is scored
    against identical conditions and their numbers are comparable.
    """
    items = attention.get("items") or []
    if not items:
        return {
            "mine_id": mine_id,
            "recommendations": [],
            "blocked": [],
            "note": "Nothing currently requires attention at this mine.",
        }

    ctx = build_context(mine_id, location=location)

    if ctx.baseline_production_t is None:
        return {
            "mine_id": mine_id,
            "recommendations": [],
            "blocked": [],
            "note": (
                f"No production baseline exists for {mine_id}, so the effect of any "
                "action cannot be estimated."
            ),
        }

    offered: dict[str, Recommendation] = {}
    blocked: dict[str, Recommendation] = {}

    for item in items:
        for spec in _relevant_specs(item):
            # Each action is evaluated once even when several problems would use
            # it; the first (highest-ranked) problem claims it, so a manager does
            # not see the same instruction twice under different headings.
            if spec.key in offered or spec.key in blocked:
                continue

            extra = {"shift": "S1"} if "shift" in spec.constraint_inputs else {}
            outcome = evaluate_intervention(spec, ctx, 0.10, extra_constraint_inputs=extra)
            recommendation = _from_outcome(outcome, spec, item)

            if outcome.available and (outcome.delta_t or 0) > 0:
                offered[spec.key] = recommendation
            else:
                blocked[spec.key] = recommendation

    ranked = sorted(
        offered.values(),
        key=lambda r: rank_score(
            _outcome_stub(r), objective
        ),
        reverse=True,
    )

    return {
        "mine_id": mine_id,
        "objective": objective.value,
        "recommendations": [r.as_dict() for r in ranked[:limit]],
        # Refused actions are shown, not hidden: "we considered moving the fleet
        # and the constraint engine refused it" is information a manager needs,
        # and its absence reads as the option never having been considered.
        "blocked": [r.as_dict() for r in blocked.values()],
        "baseline_production_t": round(ctx.baseline_production_t, 1),
        "planned_production_t": (
            round(ctx.planned_production_t, 1) if ctx.planned_production_t else None
        ),
        "note": (
            None
            if ranked
            else "No permitted action is currently available for the detected problems."
        ),
    }


def _outcome_stub(recommendation: Recommendation):
    """Adapt a Recommendation back to the shape the ranker scores.

    The ranker is the single definition of how objectives order options;
    re-implementing its arithmetic here would let the Command Center and the
    scenario page disagree about which action leads.
    """
    from .constraints import ConstraintReport
    from .evidence import EvidenceAssessment
    from .provenance import EvidenceQuality

    return InterventionOutcome(
        key=recommendation.key,
        title=recommendation.title,
        description=recommendation.action,
        magnitude=0.10,
        delta_t=recommendation.expected_delta_t,
        calculation_mode=recommendation.calculation_mode,
        method=recommendation.method,
        constraints=ConstraintReport(action_type=recommendation.key),
        evidence=EvidenceAssessment(quality=EvidenceQuality(recommendation.evidence_quality)),
        cost_inr=recommendation.cost_inr,
        cost_basis=recommendation.cost_basis,
        risk_delta=recommendation.risk_delta,
    )


__all__ = ["RESPONSE_MAP", "Recommendation", "build"]
