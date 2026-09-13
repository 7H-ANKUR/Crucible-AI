"""app/api/core/scenario/engine.py — the single place a scenario is evaluated.

Every scenario in Crucible AI runs through :func:`run_scenario`. The routers that used
to carry their own copies of this logic are now adapters over it.

How an intervention's effect is obtained, in order of preference:

1. **Model-backed.** Take the latest record's feature vector, move the feature
   the action actually controls by the chosen magnitude, and re-score with the
   serving production model. The delta is the difference between the two
   predictions. This is a counterfactual on the real model, not a rule.
2. **Heuristic.** When no model is serving, or the feature the action controls is
   absent from the schema, fall back to the catalogue's declared effect — and
   report `HEURISTIC`, so no consumer can mistake one for the other.
3. **Insufficient data.** When there is no baseline to move at all, say so.

Hard constraints are checked *before* any effect is computed. A blocked action
does not get a number, because producing "this would gain 48 t, but it is
forbidden" invites someone to ask for it anyway.
"""

from __future__ import annotations

import datetime as _dt
import logging
import uuid
from typing import Any

from .. import constraints as constraint_engine
from ..clock import resolve_clock
from ..evidence import (
    assess,
    completeness_factor,
    constraint_factor,
    freshness_factor,
    historical_factor,
    model_factor,
)
from ..features import build_production_features
from ..memo import ttl_cache
from ..ml_loader import ensure_active_model, get_model
from ..provenance import CalculationMode, DataFreshness, Provenance
from .catalogue import CATALOGUE, InterventionSpec
from .economics import mine_economics
from .types import (
    Flexibility,
    InterventionOutcome,
    RiskTolerance,
    ScenarioContext,
    ScenarioControls,
    ScenarioObjective,
    ScenarioResult,
)

logger = logging.getLogger("crucible.scenario.engine")

#: A model-backed delta larger than this fraction of baseline is not believed.
#: Re-scoring with one feature moved far outside its training range produces
#: extrapolation, not prediction; clamping is honest about the model's reach.
MAX_CREDIBLE_DELTA_FRACTION = 0.25


# ---------------------------------------------------------------------------
# Context
# ---------------------------------------------------------------------------

@ttl_cache(ttl=20.0)
def _latest_production_row(mine_id: str) -> dict[str, Any] | None:
    """Newest production record. Explicit columns; `SELECT *` is not needed here
    because the feature builder reads by name from whatever it is given."""
    from ..db import query

    try:
        rows = query(
            """SELECT * FROM ops.production_records
               WHERE mine_id = %s
               ORDER BY date DESC
               LIMIT 1""",
            (mine_id,),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Production history unavailable for %s: %s", mine_id, exc)
        return None
    return rows[0] if rows else None


def _feature_completeness(row: dict[str, Any], feat_names: list[str]) -> tuple[int, int]:
    """How many required features the row genuinely supplies.

    `build_production_features` silently substitutes training medians for missing
    columns, which is the right behaviour for scoring and the wrong behaviour for
    reporting — the caller cannot otherwise tell a complete vector from a mostly
    imputed one. Counted here so evidence quality reflects it.
    """
    derived = {"year", "month", "day_of_week"}
    present = 0
    for col in feat_names:
        if col in derived:
            present += 1
            continue
        value = row.get(col)
        if value is None:
            continue
        try:
            float(value)
        except (TypeError, ValueError):
            continue
        present += 1
    return present, len(feat_names)


def build_context(mine_id: str, location: tuple[float, float] | None = None) -> ScenarioContext:
    """Assemble current state once, so every candidate is scored identically."""
    model, meta = ensure_active_model("production_forecast")
    row = _latest_production_row(mine_id)

    clock = resolve_clock(mine_id)

    if row is None:
        return ScenarioContext(
            mine_id=mine_id,
            location=location,
            baseline_production_t=None,
            planned_production_t=None,
            model=model,
            model_meta=meta or {},
            provenance=Provenance(
                model_version=str((meta or {}).get("version") or ""),
                dataset_version=str((meta or {}).get("dataset_version") or ""),
                serving_status=str((meta or {}).get("serving_status") or ""),
                source_records=0,
                assumptions=["No production history is recorded for this mine."],
            ),
        )

    feat_names = get_model("prod_feats") or []
    medians = get_model("prod_medians") or {}
    features = None
    present, required = 0, 0

    if feat_names:
        present, required = _feature_completeness(row, feat_names)
        try:
            features, _ = build_production_features(row, feat_names, medians)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Feature build failed for %s: %s", mine_id, exc)
            features = None

    planned = row.get("planned_production_t")
    recorded = row.get("actual_production_t")

    baseline: float | None = None
    baseline_model_backed = False
    if features is not None and model is not None:
        try:
            baseline = float(model.predict(features)[0])
            baseline_model_backed = True
        except Exception as exc:  # noqa: BLE001
            logger.warning("Baseline prediction failed for %s: %s", mine_id, exc)

    if baseline is None:
        candidate = recorded if recorded is not None else planned
        baseline = float(candidate) if candidate is not None else None

    observed_at = row.get("date")
    provenance = Provenance.from_observation(
        _dt.datetime.combine(observed_at, _dt.time(23, 59)) if isinstance(observed_at, _dt.date) and not isinstance(observed_at, _dt.datetime) else observed_at,
        model_version=str((meta or {}).get("version") or ""),
        dataset_version=str((meta or {}).get("dataset_version") or ""),
        feature_version=str(len(feat_names)) if feat_names else None,
        serving_status=str((meta or {}).get("serving_status") or ""),
        source_records=1,
        data_origin=str(row.get("data_origin") or "SYNTHETIC"),
        assumptions=(
            []
            if baseline_model_backed
            else ["Baseline is the most recent recorded production, not a model forecast."]
        ),
    )
    # Freshness is judged against the operational clock, not the wall clock —
    # the benchmark dataset ends in 2025 and would otherwise read EXPIRED always.
    age = clock.age_seconds(
        _dt.datetime.combine(observed_at, _dt.time(23, 59), tzinfo=_dt.timezone.utc)
        if isinstance(observed_at, _dt.date) and not isinstance(observed_at, _dt.datetime)
        else observed_at
    )
    provenance = provenance.model_copy(
        update={
            "data_age_seconds": round(age, 1) if age is not None else None,
            "freshness": DataFreshness.from_age(age),
        }
    )
    if clock.caveat:
        provenance.assumptions.append(clock.caveat)

    ctx = ScenarioContext(
        mine_id=mine_id,
        location=location,
        baseline_production_t=baseline,
        planned_production_t=float(planned) if planned is not None else None,
        features=features,
        model=model,
        model_meta=meta or {},
        latest_row=row,
        provenance=provenance,
        baseline_model_backed=baseline_model_backed,
    )
    # Stashed for evidence assembly; not part of the public contract.
    ctx.latest_row.setdefault("_feature_present", present)
    ctx.latest_row.setdefault("_feature_required", required)
    return ctx


# ---------------------------------------------------------------------------
# Single intervention
# ---------------------------------------------------------------------------

#: A model-backed delta below this fraction of baseline is treated as no
#: response at all. Tree ensembles return exactly 0.0 when a feature move does
#: not cross a split threshold, which is an artefact of the model's structure
#: rather than a finding that the action is useless.
FLAT_RESPONSE_FRACTION = 0.001


def _model_delta(
    spec: InterventionSpec, ctx: ScenarioContext, magnitude: float
) -> tuple[float | None, str]:
    """Counterfactual on the serving model, or (None, reason) if not possible.

    Every feature the action genuinely controls is moved together, not just the
    first one found. A haulage reallocation raises availability, utilisation and
    operating hours at once; moving one and holding the others fixed is not the
    intervention the manager is being offered, and against a tree ensemble it
    frequently fails to cross any split boundary and returns exactly zero.
    """
    if ctx.model is None:
        return None, "no production model is serving"
    if ctx.features is None or ctx.features.empty:
        return None, "the feature vector could not be built"

    columns = [c for c in spec.adjustable_features if c in ctx.features.columns]
    if not columns:
        return None, (
            f"none of this action's inputs ({', '.join(spec.adjustable_features[:3])}) "
            "exist in the current feature schema"
        )

    # Actions that improve a metric by lowering it (cycle time, downtime) scale
    # the feature down. Scaling everything up would make them look harmful.
    factor = (1.0 + magnitude) if spec.scales_up else max(0.05, 1.0 - magnitude)

    adjusted = ctx.features.copy()
    for column in columns:
        adjusted[column] = adjusted[column] * factor

    try:
        before = float(ctx.model.predict(ctx.features)[0])
        after = float(ctx.model.predict(adjusted)[0])
    except Exception as exc:  # noqa: BLE001
        logger.warning("Counterfactual scoring failed for %s: %s", spec.key, exc)
        return None, f"the model could not score the adjusted inputs ({type(exc).__name__})"

    delta = after - before
    moved = ", ".join(columns[:3]) + ("…" if len(columns) > 3 else "")

    # A flat response is information about the model, not about the mine. Saying
    # "this action achieves nothing" would be an overclaim; the honest reading is
    # that the model cannot distinguish the change at this magnitude.
    if abs(delta) < abs(before) * FLAT_RESPONSE_FRACTION:
        return None, (
            f"the model's output is flat to a {(factor - 1) * 100:+.0f}% move in "
            f"{moved} — at this magnitude the change does not register in the model"
        )

    ceiling = abs(before) * MAX_CREDIBLE_DELTA_FRACTION
    if abs(delta) > ceiling:
        delta = ceiling if delta > 0 else -ceiling
        return delta, (
            f"model re-scored with {moved} moved {(factor - 1) * 100:+.0f}%, "
            f"clamped to ±{MAX_CREDIBLE_DELTA_FRACTION * 100:.0f}% of baseline"
        )

    return delta, f"model re-scored with {moved} moved {(factor - 1) * 100:+.0f}%"


def evaluate_intervention(
    spec: InterventionSpec,
    ctx: ScenarioContext,
    magnitude: float,
    *,
    extra_constraint_inputs: dict[str, Any] | None = None,
) -> InterventionOutcome:
    """Evaluate one candidate action fully: permitted, effect, cost, evidence."""
    details: dict[str, Any] = {"magnitude": magnitude}
    if ctx.location:
        details["location"] = ctx.location
    if extra_constraint_inputs:
        details.update(extra_constraint_inputs)

    report = constraint_engine.evaluate(spec.key, ctx.mine_id, details)

    econ = mine_economics(ctx.mine_id)
    cost_inr, cost_basis = (None, "Not estimated")
    if spec.cost_driver and econ.available:
        cost_inr, cost_basis = econ.incremental_cost(spec.cost_driver, magnitude)

    present = int(ctx.latest_row.get("_feature_required", 0) and ctx.latest_row.get("_feature_present", 0))
    required = int(ctx.latest_row.get("_feature_required", 0))

    base_factors = [
        freshness_factor(ctx.provenance.freshness, ctx.provenance.data_age_seconds),
        completeness_factor(present, required),
        constraint_factor(report.evaluated_count, report.relevant_count),
        historical_factor(econ.shifts_observed),
    ]

    # Refused actions stop here. No number is produced for something that cannot
    # be done — quoting a forgone gain invites pressure to override the rule.
    if not report.feasible:
        return InterventionOutcome(
            key=spec.key,
            title=spec.title,
            description=spec.description,
            magnitude=magnitude,
            delta_t=None,
            calculation_mode=CalculationMode.INSUFFICIENT_DATA,
            method="not evaluated — the action is not currently permitted",
            constraints=report,
            evidence=assess(base_factors + [model_factor(model_available=ctx.model is not None,
                                                         serving_status=ctx.provenance.serving_status)]),
            cost_inr=cost_inr,
            cost_basis=cost_basis,
            tradeoffs=list(spec.tradeoffs),
            rejected_reason=report.reason,
        )

    if ctx.baseline_production_t is None:
        return InterventionOutcome(
            key=spec.key,
            title=spec.title,
            description=spec.description,
            magnitude=magnitude,
            delta_t=None,
            calculation_mode=CalculationMode.INSUFFICIENT_DATA,
            method="no production baseline exists for this mine",
            constraints=report,
            evidence=assess(base_factors + [model_factor(model_available=False, serving_status=None)]),
            cost_inr=cost_inr,
            cost_basis=cost_basis,
            tradeoffs=list(spec.tradeoffs),
        )

    delta, method = _model_delta(spec, ctx, magnitude)
    if delta is not None:
        mode = CalculationMode.MODEL_BACKED
        model_ok = True
    else:
        # Declared effect scales linearly with magnitude against a 0.10 reference.
        delta = ctx.baseline_production_t * spec.heuristic_effect * (magnitude / 0.10)
        mode = CalculationMode.HEURISTIC
        method = f"declared operational estimate — {method}"
        model_ok = False

    evidence = assess(
        base_factors
        + [
            model_factor(
                model_available=model_ok and ctx.model is not None,
                serving_status=ctx.provenance.serving_status,
            )
        ]
    )

    return InterventionOutcome(
        key=spec.key,
        title=spec.title,
        description=spec.description,
        magnitude=magnitude,
        delta_t=delta,
        calculation_mode=mode,
        method=method,
        constraints=report,
        evidence=evidence,
        cost_inr=cost_inr,
        cost_basis=cost_basis,
        fuel_delta_pct=(spec.fuel_effect * magnitude * 100.0) if spec.fuel_effect else None,
        risk_delta=spec.risk_effect * (magnitude / 0.10),
        tradeoffs=list(spec.tradeoffs),
    )


# ---------------------------------------------------------------------------
# Full scenario
# ---------------------------------------------------------------------------

def _magnitude_for(spec: InterventionSpec, controls: ScenarioControls) -> float | None:
    """Translate manager-facing latitude into a magnitude, or None to skip.

    This is the layer the spec asks for: a manager sets "how much flexibility can
    we use", and the technical parameters stay underneath.
    """
    mapping = {
        "equipment_redeploy": controls.fleet_reallocation,
        "fleet_reroute": controls.route_flexibility,
        "maintenance_defer": controls.maintenance_flexibility,
        "extend_operating_hours": controls.operating_time_flexibility,
    }
    flex = mapping.get(spec.key)
    if flex is not None:
        return flex.magnitude or None

    # Crusher and blast are not gated by a dedicated control; they scale with the
    # fuel latitude the manager has allowed, which is the platform-wide dial.
    allowance = min(0.15, max(0.0, controls.max_additional_fuel_pct / 100.0))
    return allowance or None


def run_scenario(
    controls: ScenarioControls,
    ctx: ScenarioContext,
    *,
    created_by: str = "system",
) -> ScenarioResult:
    """Evaluate every catalogue action under these controls and select a response."""
    from .ranking import rank

    result = ScenarioResult(
        scenario_id=f"SC-{uuid.uuid4().hex[:6].upper()}",
        mine_id=ctx.mine_id,
        objective=controls.objective,
        created_at=_dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        created_by=created_by,
        baseline_production_t=ctx.baseline_production_t,
        planned_production_t=ctx.planned_production_t,
        provenance=ctx.provenance,
    )

    if ctx.baseline_production_t is None:
        result.unavailable_reason = (
            f"No production history is recorded for {ctx.mine_id}, so there is no "
            "baseline to simulate against."
        )
        result.calculation_mode = CalculationMode.INSUFFICIENT_DATA
        return result

    considered: list[InterventionOutcome] = []
    for spec in CATALOGUE.values():
        magnitude = _magnitude_for(spec, controls)
        if magnitude is None:
            considered.append(
                InterventionOutcome(
                    key=spec.key,
                    title=spec.title,
                    description=spec.description,
                    magnitude=0.0,
                    delta_t=None,
                    calculation_mode=CalculationMode.INSUFFICIENT_DATA,
                    method="excluded by the flexibility settings for this scenario",
                    constraints=constraint_engine.ConstraintReport(action_type=spec.key),
                    evidence=assess([]),
                    tradeoffs=list(spec.tradeoffs),
                    rejected_reason="Excluded: the manager left no flexibility in this dimension.",
                )
            )
            continue

        extra: dict[str, Any] = {}
        if "shift" in spec.constraint_inputs:
            # Blasting is evaluated against the next non-night shift; S3 is refused
            # by the constraint engine, so proposing it would be theatre.
            extra["shift"] = "S1"

        outcome = evaluate_intervention(spec, ctx, magnitude, extra_constraint_inputs=extra)

        # A conservative manager declines options whose evidence is thin, even
        # when they are permitted.
        if (
            controls.risk_tolerance is RiskTolerance.CONSERVATIVE
            and outcome.available
            and outcome.risk_delta > 0.10
        ):
            outcome.rejected_reason = (
                "Excluded under a conservative risk setting: this action raises "
                "equipment exposure beyond the tolerance set for this scenario."
            )

        considered.append(outcome)

    selected = rank(considered, controls)[: controls.max_actions]

    result.considered = considered
    result.selected = selected

    net = sum(o.delta_t for o in selected if o.delta_t is not None)
    result.projected_production_t = ctx.baseline_production_t + net

    modes = {o.calculation_mode for o in selected}
    if CalculationMode.MODEL_BACKED in modes:
        result.calculation_mode = (
            CalculationMode.MODEL_BACKED
            if modes == {CalculationMode.MODEL_BACKED}
            else CalculationMode.HEURISTIC
        )
    elif selected:
        result.calculation_mode = CalculationMode.HEURISTIC
    else:
        result.calculation_mode = CalculationMode.INSUFFICIENT_DATA

    # The scenario is only as well-supported as its weakest selected action.
    if selected:
        result.evidence = min(
            (o.evidence for o in selected), key=lambda e: e.quality.rank
        )
    else:
        result.evidence = assess([])
        result.unavailable_reason = (
            "No permitted action is available under the current constraints and "
            "flexibility settings."
        )

    return result


__all__ = ["build_context", "evaluate_intervention", "run_scenario"]
