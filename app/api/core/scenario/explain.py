"""app/api/core/scenario/explain.py — why this, and why not the others.

A recommendation a manager cannot interrogate is one they have to take on faith,
and operational staff are right not to. Every scenario therefore answers two
questions, not one:

* **Why this?** — what the chosen action is expected to do, how that was worked
  out, and what it costs.
* **Why not the alternatives?** — for each option not chosen, the specific reason:
  forbidden by a constraint, smaller effect, worse cost, thinner evidence, or
  excluded by the manager's own settings.

Every sentence is assembled from a computed value. Nothing here states a number
that was not measured, and where a value is a declared estimate rather than a
model output, the sentence says so.
"""

from __future__ import annotations

from typing import Any

from ..provenance import CalculationMode
from .ranking import objectives_agree, score, winners
from .types import InterventionOutcome, ScenarioObjective, ScenarioResult

_OBJECTIVE_PHRASE = {
    ScenarioObjective.MAXIMIZE_PRODUCTION: "recovering the most production",
    ScenarioObjective.MINIMIZE_COST: "keeping cost down",
    ScenarioObjective.MINIMIZE_RISK: "adding the least equipment risk",
    ScenarioObjective.BALANCED: "balancing production recovery against cost and risk",
}

_MODE_PHRASE = {
    CalculationMode.MODEL_BACKED: "from the production model",
    CalculationMode.HEURISTIC: "from a declared operational estimate, not the model",
    CalculationMode.INSUFFICIENT_DATA: "not estimated",
}


def _tonnes(value: float | None) -> str:
    if value is None:
        return "an amount that could not be estimated"
    return f"{value:+,.0f} t"


def _rupees(value: float | None) -> str:
    if value is None:
        return "an unpriced amount"
    if abs(value) >= 100_000:
        return f"₹{value / 100_000:,.2f} lakh"
    return f"₹{value:,.0f}"


def why_this(outcome: InterventionOutcome, objective: ScenarioObjective) -> str:
    """One paragraph on the chosen action, built from its measured values."""
    parts = [
        f"{outcome.title} is expected to change production by "
        f"{_tonnes(outcome.delta_t)} ({_MODE_PHRASE[outcome.calculation_mode]}: {outcome.method})."
    ]

    if outcome.cost_inr is not None:
        parts.append(f"Estimated incremental cost is {_rupees(outcome.cost_inr)} — {outcome.cost_basis}.")
    else:
        parts.append(f"Cost could not be estimated: {outcome.cost_basis}.")

    if outcome.risk_delta > 0.01:
        parts.append(
            f"It raises equipment risk exposure by {outcome.risk_delta * 100:.0f}%."
        )

    parts.append(
        f"It leads on {_OBJECTIVE_PHRASE[objective]}, which is the objective set for this scenario."
    )

    if outcome.evidence.limiters:
        parts.append(
            "Evidence is graded "
            f"{outcome.evidence.quality.value.lower()} because {outcome.evidence.limiters[0].lower()}."
        )

    return " ".join(parts)


def why_not(
    outcome: InterventionOutcome,
    chosen: InterventionOutcome | None,
    objective: ScenarioObjective,
) -> str:
    """The specific reason this option was not selected."""
    if outcome.rejected_reason:
        return outcome.rejected_reason

    if not outcome.constraints.feasible:
        return outcome.constraints.reason

    if outcome.delta_t is None:
        return f"Effect could not be estimated: {outcome.method}."

    if chosen is None:
        return "No action was selected for this scenario."

    if outcome.key == chosen.key:
        return ""

    # Name the dimension it actually lost on, rather than saying "scored lower".
    if objective is ScenarioObjective.MAXIMIZE_PRODUCTION:
        return (
            f"Recovers {_tonnes(outcome.delta_t)} against {_tonnes(chosen.delta_t)} "
            f"for {chosen.title.lower()}."
        )

    if objective is ScenarioObjective.MINIMIZE_COST:
        if outcome.cost_inr is None:
            return "Cost could not be estimated, so it cannot be ranked on cost."
        return f"Costs {_rupees(outcome.cost_inr)} against {_rupees(chosen.cost_inr)}."

    if objective is ScenarioObjective.MINIMIZE_RISK:
        return (
            f"Adds {outcome.risk_delta * 100:.0f}% equipment risk exposure against "
            f"{chosen.risk_delta * 100:.0f}% for {chosen.title.lower()}."
        )

    # Balanced: state the trade-off in its own terms.
    bits = [f"Recovers {_tonnes(outcome.delta_t)} at {_rupees(outcome.cost_inr)}"]
    if chosen.delta_t is not None:
        bits.append(
            f"against {_tonnes(chosen.delta_t)} at {_rupees(chosen.cost_inr)} "
            f"for {chosen.title.lower()}"
        )
    tail = ", ".join(bits)
    if outcome.risk_delta > chosen.risk_delta + 0.01:
        tail += f", and carries more added equipment risk"
    return tail + "."


def explain(result: ScenarioResult) -> dict[str, Any]:
    """Full explanation for a scenario result."""
    chosen = result.selected[0] if result.selected else None

    if chosen is None:
        return {
            "summary": result.unavailable_reason
            or "No permitted action is available under the current settings.",
            "recommended": None,
            "why_this": None,
            "why_not": [
                {"key": o.key, "title": o.title, "reason": why_not(o, None, result.objective)}
                for o in result.considered
            ],
            "objective_winners": winners(result.considered),
            "objectives_agree": True,
            "calculation_mode": result.calculation_mode.value,
        }

    alternatives = [
        {
            "key": o.key,
            "title": o.title,
            "reason": why_not(o, chosen, result.objective),
            "feasible": o.feasible,
            "expected_delta_t": round(o.delta_t, 1) if o.delta_t is not None else None,
            "cost_inr": round(o.cost_inr, 0) if o.cost_inr is not None else None,
        }
        for o in result.considered
        if o.key != chosen.key
    ]

    agree = objectives_agree(result.considered)
    win = winners(result.considered)

    summary_bits = [
        f"Recommended: {chosen.title.lower()}, expected to change production by "
        f"{_tonnes(chosen.delta_t)}."
    ]
    if result.residual_gap_t is not None and result.residual_gap_t > 0:
        summary_bits.append(
            f"A gap of {result.residual_gap_t:,.0f} t against plan would remain."
        )
    elif result.residual_gap_t is not None:
        summary_bits.append("This would bring production back to plan.")

    if not agree:
        others = {
            objective: key
            for objective, key in win.items()
            if key and key != chosen.key
        }
        if others:
            summary_bits.append(
                "The objectives disagree: a different action leads on "
                + ", ".join(o.replace("_", " ").lower() for o in others)
                + "."
            )

    return {
        "summary": " ".join(summary_bits),
        "recommended": chosen.key,
        "why_this": why_this(chosen, result.objective),
        "why_not": alternatives,
        "objective_winners": win,
        "objectives_agree": agree,
        "calculation_mode": result.calculation_mode.value,
        "evidence": result.evidence.as_dict() if result.evidence else None,
    }


__all__ = ["explain", "why_not", "why_this"]
