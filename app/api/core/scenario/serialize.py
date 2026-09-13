"""app/api/core/scenario/serialize.py — scenario results as API payloads.

Kept apart from the engine so wire-format concerns never leak into evaluation.

The field rename that matters: `baseline.shortfall_prob` and
`scenario.shortfall_prob` are gone. They held ``(plan - production) / plan`` — a
production gap ratio — and the UI rendered them as "Shortfall Risk 6.8%". They
are replaced by `production_gap_t` and `production_gap_pct`, named for what they
measure.

A genuine calibrated probability of missing target is a different signal from a
different model, and appears as `probability_of_shortfall` only when the
shortfall classifier actually produced one. The two are never merged.
"""

from __future__ import annotations

from typing import Any

from ..provenance import CalculationMode
from .explain import explain
from .types import InterventionOutcome, ScenarioResult

#: Shown wherever a scenario result is displayed.
DISCLAIMER = (
    "Scenario outputs are model-assisted estimates evaluated against "
    "DGMS-informed safety constraints. They support a human decision and do not "
    "authorise or perform any operational action."
)


def intervention_payload(outcome: InterventionOutcome) -> dict[str, Any]:
    """One action, with its provenance attached rather than implied."""
    payload = outcome.as_dict()
    payload.update(
        {
            # Retained for existing clients; both name the same catalogue entry.
            "type": outcome.key,
            "intervention": outcome.key,
            "detail": outcome.title,
            "urgency": _urgency(outcome),
            "evidence_quality": outcome.evidence.quality.value,
            "cost_source": "DERIVED_FROM_MINE_RECORDS" if outcome.cost_inr is not None else "NOT_ESTIMATED",
            "production_delta_source": outcome.calculation_mode.value,
        }
    )
    return payload


def _urgency(outcome: InterventionOutcome) -> str:
    """Urgency from the action's own horizon, not from the size of its effect.

    The previous rule was ``"HIGH" if delta > 50``, which conflated *how much it
    helps* with *how soon it must happen*. A small action that must occur inside
    the next thirty minutes is urgent; a large one scheduled for next shift is not.
    """
    return {"NOW": "HIGH", "NEXT": "MEDIUM", "NEXT_SHIFT": "LOW"}.get(
        _horizon(outcome), "MEDIUM"
    )


def _horizon(outcome: InterventionOutcome) -> str:
    from .catalogue import spec as get_spec

    spec = get_spec(outcome.key)
    return spec.horizon if spec else "NEXT"


def scenario_payload(result: ScenarioResult) -> dict[str, Any]:
    """Full API shape for a scenario result."""
    prov = result.provenance
    selected = [intervention_payload(o) for o in result.selected]
    considered = [intervention_payload(o) for o in result.considered]

    gap_t = result.production_gap_t
    gap_pct = (
        100.0 * gap_t / result.planned_production_t
        if gap_t is not None and result.planned_production_t
        else None
    )
    residual_t = result.residual_gap_t
    residual_pct = (
        100.0 * residual_t / result.planned_production_t
        if residual_t is not None and result.planned_production_t
        else None
    )

    return {
        "scenario_id": result.scenario_id,
        "mine_id": result.mine_id,
        "scope": result.scope.value,
        "objective": result.objective.value,
        "created_at": result.created_at,
        "created_by": result.created_by,
        "status": (
            "insufficient_data"
            if result.calculation_mode is CalculationMode.INSUFFICIENT_DATA
            else "simulated"
        ),
        "calculation_mode": result.calculation_mode.value,
        "unavailable_reason": result.unavailable_reason,

        "baseline": {
            "production_t": _round(result.baseline_production_t),
            "planned_production_t": _round(result.planned_production_t),
            # Named for what it is: planned minus expected, in tonnes and percent.
            # This is NOT a probability and must never be labelled as risk.
            "production_gap_t": _round(gap_t),
            "production_gap_pct": _round(gap_pct, 2),
        },
        "scenario": {
            "production_t": _round(result.projected_production_t),
            "net_delta_t": _round(result.net_delta_t),
            "net_cost_inr": _round(result.net_cost_inr, 0),
            "residual_gap_t": _round(residual_t),
            "residual_gap_pct": _round(residual_pct, 2),
        },

        "actions_applied": selected,
        "interventions": selected,
        "considered": considered,

        "explanation": explain(result),
        "evidence": result.evidence.as_dict() if result.evidence else None,
        "provenance": {
            "generated_at": prov.generated_at,
            "data_time": prov.data_time,
            "data_age_seconds": prov.data_age_seconds,
            "freshness": prov.freshness.value,
            "model_version": prov.model_version,
            "dataset_version": prov.dataset_version,
            "feature_version": prov.feature_version,
            "serving_status": prov.serving_status,
            "source_records": prov.source_records,
            "data_origin": prov.data_origin,
            "assumptions": prov.assumptions,
        },
        # Flattened for clients that read these at the top level.
        "model_version": prov.model_version,
        "dataset_version": prov.dataset_version,
        "serving_status": prov.serving_status,
        "data_origin": prov.data_origin,
        "disclaimer": DISCLAIMER,
    }


def _round(value: float | None, places: int = 1) -> float | None:
    return None if value is None else round(value, places)


__all__ = ["DISCLAIMER", "intervention_payload", "scenario_payload"]
