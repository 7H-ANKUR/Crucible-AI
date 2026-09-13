"""app/api/core/scenario/ranking.py — ordering options against a stated objective.

The rule this module enforces: **nothing is best in the abstract.** The old
engine set `score = delta` for MAXIMIZE_PRODUCTION, `-cost` for MINIMIZE_COST and
`(delta * feasibility) / cost` otherwise, then labelled the top row the
recommendation without naming what it was best at. A manager reading
"recommended" had no way to know which trade-off had been made on their behalf.

Here every objective produces its own ordering, and :func:`winners` reports the
leader under *each* objective so the manager can see when they disagree — which
is exactly the moment the choice is theirs rather than the platform's.

Scores are internal ordering values with no unit. They are never surfaced as a
quality or confidence measure.
"""

from __future__ import annotations

from .types import InterventionOutcome, ScenarioControls, ScenarioObjective

#: Evidence grade multipliers. A thinly-supported option is not forbidden, but it
#: should not outrank a well-supported one of similar magnitude.
_EVIDENCE_WEIGHT = {"HIGH": 1.0, "MEDIUM": 0.85, "LOW": 0.6, "UNAVAILABLE": 0.4}


def _evidence_weight(outcome: InterventionOutcome) -> float:
    return _EVIDENCE_WEIGHT.get(outcome.evidence.quality.value, 0.5)


def _production_score(o: InterventionOutcome) -> float:
    return (o.delta_t or 0.0) * _evidence_weight(o)


def _cost_score(o: InterventionOutcome) -> float:
    """Higher is better, so cost is negated.

    An action with no cost estimate is not treated as free — that would make
    every unpriced option win on cost. It sorts below anything priced.
    """
    if o.cost_inr is None:
        return float("-inf")
    return -o.cost_inr


def _risk_score(o: InterventionOutcome) -> float:
    """Lower added exposure is better."""
    return -o.risk_delta * _evidence_weight(o)


def _balanced_score(o: InterventionOutcome) -> float:
    """Tonnes recovered per rupee spent, discounted by added risk.

    Cost is expressed in lakhs so the ratio lands in a readable range; the scale
    is arbitrary and affects nothing but presentation of the internal score.
    """
    delta = (o.delta_t or 0.0) * _evidence_weight(o)
    if delta <= 0:
        return delta

    cost_lakh = (o.cost_inr or 0.0) / 100_000.0
    # A small floor keeps a genuinely cheap action from producing an unbounded
    # ratio that swamps every alternative.
    efficiency = delta / max(cost_lakh, 0.05)
    return efficiency * (1.0 - min(0.5, o.risk_delta))


_SCORERS = {
    ScenarioObjective.MAXIMIZE_PRODUCTION: _production_score,
    ScenarioObjective.MINIMIZE_COST: _cost_score,
    ScenarioObjective.MINIMIZE_RISK: _risk_score,
    ScenarioObjective.BALANCED: _balanced_score,
}


def score(outcome: InterventionOutcome, objective: ScenarioObjective) -> float:
    return _SCORERS[objective](outcome)


def rank(
    outcomes: list[InterventionOutcome],
    controls: ScenarioControls,
) -> list[InterventionOutcome]:
    """Order the actions that are actually available, best first for the objective.

    Refused and unestimable actions are excluded from the ordering but remain in
    the scenario's `considered` list, which is what makes "why not?" answerable.
    """
    available = [o for o in outcomes if o.available]

    # Under every objective except explicit cost minimisation, an action that
    # loses production is not a response to a shortfall.
    if controls.objective is not ScenarioObjective.MINIMIZE_COST:
        available = [o for o in available if (o.delta_t or 0.0) > 0]

    return sorted(available, key=lambda o: score(o, controls.objective), reverse=True)


def winners(outcomes: list[InterventionOutcome]) -> dict[str, str | None]:
    """The leading action under each objective.

    When these agree the choice is easy and the platform can say so. When they
    disagree, that disagreement is the useful output — it is the trade-off the
    manager is actually being asked to make.
    """
    available = [o for o in outcomes if o.available]
    if not available:
        return {obj.value: None for obj in ScenarioObjective}

    result: dict[str, str | None] = {}
    for objective in ScenarioObjective:
        pool = available
        if objective is not ScenarioObjective.MINIMIZE_COST:
            pool = [o for o in available if (o.delta_t or 0.0) > 0] or available
        best = max(pool, key=lambda o: score(o, objective))
        result[objective.value] = best.key
    return result


def objectives_agree(outcomes: list[InterventionOutcome]) -> bool:
    picks = {v for v in winners(outcomes).values() if v is not None}
    return len(picks) <= 1


__all__ = ["objectives_agree", "rank", "score", "winners"]
