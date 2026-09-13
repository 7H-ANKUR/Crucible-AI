"""app/api/core/routing/production.py — haulage-constrained production model.

Answers the manager's second question: given how long the safe route actually
takes, will the month make target, and if not, what is costing the tonnes?

The model is a deterministic cycle-time simulation rather than a regression,
which matters for a decision-support tool: every number can be traced back to an
input, and a what-if change moves the output for a reason you can state.

    cycle_time      = load + haul + dump + return + queue
    trips_per_truck = effective_shift_minutes / cycle_time
    daily_tonnes    = min(haulage_capacity, extraction_capacity, processing_capacity)

The binding constraint is reported explicitly, because "we are short" and "we
are short *because the plant cannot take it*" call for opposite responses:
adding trucks to a plant-limited operation just builds a queue.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

# Fixed elements of a haulage cycle, in minutes. Site-typical for a
# 50-60 t rigid truck on a manganese operation.
LOAD_MINUTES = 4.2
DUMP_MINUTES = 1.8
SPOT_MINUTES = 1.1          # positioning under the shovel

WORKING_DAYS_PER_MONTH = 26.0
SHIFTS_PER_DAY = 2
SHIFT_MINUTES = 600.0       # 10-hour shift


@dataclass
class ProductionInputs:
    """Everything the model needs. Defaults are site-typical, not zeros, so a
    partial payload still produces a defensible answer rather than nonsense."""

    target_monthly_t: float = 150_000.0
    extraction_rate_tph: float = 420.0        # tonnes per hour at the face
    trucks_available: int = 14
    truck_capacity_t: float = 55.0
    equipment_availability: float = 0.78      # 0..1 mechanical availability
    processing_capacity_tpd: float = 6_500.0
    stockpile_capacity_t: float = 45_000.0
    stockpile_current_t: float = 12_000.0
    ore_grade_pct: float = 38.0               # Mn %
    target_grade_pct: float = 42.0
    predicted_downtime_hours_per_day: float = 1.6
    queue_factor: float = 0.12                # share of cycle lost to queueing

    @classmethod
    def from_payload(cls, payload: dict[str, Any] | None) -> "ProductionInputs":
        p = payload or {}
        d = cls()

        def num(key: str, default: float, lo: float, hi: float) -> float:
            try:
                return max(lo, min(hi, float(p[key])))
            except (KeyError, TypeError, ValueError):
                return default

        return cls(
            target_monthly_t=num("target_monthly_t", d.target_monthly_t, 0.0, 5e6),
            extraction_rate_tph=num("extraction_rate_tph", d.extraction_rate_tph, 0.0, 1e5),
            trucks_available=int(num("trucks_available", d.trucks_available, 0, 500)),
            truck_capacity_t=num("truck_capacity_t", d.truck_capacity_t, 1.0, 500.0),
            equipment_availability=num("equipment_availability", d.equipment_availability, 0.0, 1.0),
            processing_capacity_tpd=num("processing_capacity_tpd", d.processing_capacity_tpd, 0.0, 1e6),
            stockpile_capacity_t=num("stockpile_capacity_t", d.stockpile_capacity_t, 0.0, 1e7),
            stockpile_current_t=num("stockpile_current_t", d.stockpile_current_t, 0.0, 1e7),
            ore_grade_pct=num("ore_grade_pct", d.ore_grade_pct, 0.0, 100.0),
            target_grade_pct=num("target_grade_pct", d.target_grade_pct, 0.1, 100.0),
            predicted_downtime_hours_per_day=num(
                "predicted_downtime_hours_per_day", d.predicted_downtime_hours_per_day, 0.0, 24.0
            ),
            queue_factor=num("queue_factor", d.queue_factor, 0.0, 0.9),
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "target_monthly_t": self.target_monthly_t,
            "extraction_rate_tph": self.extraction_rate_tph,
            "trucks_available": self.trucks_available,
            "truck_capacity_t": self.truck_capacity_t,
            "equipment_availability": self.equipment_availability,
            "processing_capacity_tpd": self.processing_capacity_tpd,
            "stockpile_capacity_t": self.stockpile_capacity_t,
            "stockpile_current_t": self.stockpile_current_t,
            "ore_grade_pct": self.ore_grade_pct,
            "target_grade_pct": self.target_grade_pct,
            "predicted_downtime_hours_per_day": self.predicted_downtime_hours_per_day,
            "queue_factor": self.queue_factor,
        }


@dataclass
class HaulageContext:
    """What the chosen route implies for haulage."""

    round_trip_minutes: float
    distance_km: float
    risk_score: float
    #: Extra cycle minutes attributable to route risk (weather, flooding, etc.).
    risk_delay_minutes: float


def haulage_from_route(
    one_way_minutes: float,
    distance_km: float,
    risk_score: float,
) -> HaulageContext:
    """Convert a one-way route time into a haulage cycle contribution.

    The return leg is faster because the truck is empty — grade resistance and
    rolling resistance both fall with the load off.
    """
    laden = one_way_minutes
    unladen = one_way_minutes * 0.78

    # Risk costs time beyond the modelled speed reduction: slowing for water,
    # waiting out a blast, picking through a degraded section.
    risk_delay = (risk_score / 100.0) ** 1.5 * 0.22 * (laden + unladen)

    return HaulageContext(
        round_trip_minutes=laden + unladen + risk_delay,
        distance_km=distance_km,
        risk_score=risk_score,
        risk_delay_minutes=risk_delay,
    )


@dataclass
class ProductionForecast:
    daily_t: float
    weekly_t: float
    monthly_t: float
    target_monthly_t: float
    variance_t: float          # positive = surplus
    variance_pct: float
    status: str                # "surplus" | "deficit" | "on_target"
    binding_constraint: str
    capacities: dict[str, float]
    cycle: dict[str, float]
    grade_factor: float

    def as_dict(self) -> dict[str, Any]:
        return {
            "daily_t": round(self.daily_t, 1),
            "weekly_t": round(self.weekly_t, 1),
            "monthly_t": round(self.monthly_t, 1),
            "target_monthly_t": round(self.target_monthly_t, 1),
            "variance_t": round(self.variance_t, 1),
            "variance_pct": round(self.variance_pct, 2),
            "status": self.status,
            "binding_constraint": self.binding_constraint,
            "capacities_tpd": {k: round(v, 1) for k, v in self.capacities.items()},
            "cycle": {k: round(v, 2) for k, v in self.cycle.items()},
            "grade_factor": round(self.grade_factor, 4),
        }


def forecast_production(
    inputs: ProductionInputs,
    haulage: HaulageContext,
) -> ProductionForecast:
    """Predict production under the given fleet, plant and route."""
    cycle_fixed = LOAD_MINUTES + DUMP_MINUTES + SPOT_MINUTES
    cycle_raw = cycle_fixed + haulage.round_trip_minutes
    cycle = cycle_raw / max(0.1, 1.0 - inputs.queue_factor)

    # Shift minutes actually available, after mechanical downtime.
    downtime_per_shift = (inputs.predicted_downtime_hours_per_day * 60.0) / SHIFTS_PER_DAY
    effective_shift = max(0.0, SHIFT_MINUTES - downtime_per_shift) * inputs.equipment_availability
    effective_daily_minutes = effective_shift * SHIFTS_PER_DAY

    trips_per_truck = effective_daily_minutes / cycle if cycle > 0 else 0.0
    haulage_tpd = trips_per_truck * inputs.trucks_available * inputs.truck_capacity_t

    # Extraction is limited by the same availability — a shovel down is a shovel
    # not loading. `effective_daily_minutes` already spans every shift in the
    # day, so it converts straight to operating hours; dividing by the shift
    # count again would halve the face's output.
    extraction_tpd = inputs.extraction_rate_tph * (effective_daily_minutes / 60.0)

    processing_tpd = inputs.processing_capacity_tpd

    capacities = {
        "haulage": haulage_tpd,
        "extraction": extraction_tpd,
        "processing": processing_tpd,
    }
    binding = min(capacities, key=capacities.get)
    daily = capacities[binding]

    # Below-spec ore means more tonnes hauled per saleable tonne. Capped so a
    # very low grade degrades output rather than zeroing it.
    grade_factor = max(0.55, min(1.0, inputs.ore_grade_pct / inputs.target_grade_pct))
    daily_effective = daily * grade_factor

    monthly = daily_effective * WORKING_DAYS_PER_MONTH
    variance = monthly - inputs.target_monthly_t
    variance_pct = (variance / inputs.target_monthly_t * 100.0) if inputs.target_monthly_t > 0 else 0.0

    if abs(variance_pct) < 1.0:
        status = "on_target"
    else:
        status = "surplus" if variance > 0 else "deficit"

    return ProductionForecast(
        daily_t=daily_effective,
        weekly_t=daily_effective * 6.0,
        monthly_t=monthly,
        target_monthly_t=inputs.target_monthly_t,
        variance_t=variance,
        variance_pct=variance_pct,
        status=status,
        binding_constraint=binding,
        capacities=capacities,
        cycle={
            "total_minutes": cycle,
            "fixed_minutes": cycle_fixed,
            "haul_round_trip_minutes": haulage.round_trip_minutes,
            "risk_delay_minutes": haulage.risk_delay_minutes,
            "queue_loss_minutes": cycle - cycle_raw,
            "trips_per_truck_per_day": trips_per_truck,
            "effective_daily_minutes": effective_daily_minutes,
        },
        grade_factor=grade_factor,
    )


# ---------------------------------------------------------------------------
# Root cause
# ---------------------------------------------------------------------------

def _counterfactual_monthly(
    inputs: ProductionInputs,
    haulage: HaulageContext,
    **overrides: Any,
) -> float:
    """Monthly tonnes with one constraint relaxed to its ideal value."""
    from dataclasses import replace

    ideal_inputs = replace(inputs, **{k: v for k, v in overrides.items() if hasattr(inputs, k)})
    ideal_haulage = haulage
    if "round_trip_minutes" in overrides:
        ideal_haulage = HaulageContext(
            round_trip_minutes=overrides["round_trip_minutes"],
            distance_km=haulage.distance_km,
            risk_score=haulage.risk_score,
            risk_delay_minutes=0.0,
        )
    return forecast_production(ideal_inputs, ideal_haulage).monthly_t


def root_cause_analysis(
    inputs: ProductionInputs,
    haulage: HaulageContext,
    forecast: ProductionForecast,
) -> dict[str, Any]:
    """Attribute a shortfall to its causes by counterfactual.

    Each cause is measured by how many tonnes return when that one constraint is
    relaxed to a realistic best case and everything else is held fixed. This is
    an honest attribution method: it answers "what would fixing this be worth",
    which is the question behind the question.

    Because constraints interact, the recovered tonnes do not sum to the
    shortfall. They are normalised to percentages of the *attributable* total
    and the raw tonnage is reported alongside, so the interaction is visible
    rather than hidden by the normalisation.
    """
    if forecast.variance_t >= 0:
        return {
            "shortfall_t": 0.0,
            "contributors": [],
            "note": "Production is forecast to meet or exceed target; no shortfall to attribute.",
        }

    shortfall = abs(forecast.variance_t)
    baseline = forecast.monthly_t

    # Best cases are deliberately achievable, not perfect: attributing tonnes to
    # "zero downtime" would overstate every maintenance case.
    probes: list[tuple[str, str, dict[str, Any]]] = [
        ("equipment_downtime", "Equipment downtime",
         {"predicted_downtime_hours_per_day": max(0.4, inputs.predicted_downtime_hours_per_day * 0.35),
          "equipment_availability": min(0.94, inputs.equipment_availability + 0.12)}),
        ("route_delays", "Route delays",
         {"round_trip_minutes": haulage.round_trip_minutes - haulage.risk_delay_minutes}),
        ("fleet_capacity", "Fleet capacity",
         {"trucks_available": inputs.trucks_available + max(2, int(inputs.trucks_available * 0.2))}),
        ("ore_grade", "Low-grade ore",
         {"ore_grade_pct": inputs.target_grade_pct}),
        ("processing_bottleneck", "Processing bottleneck",
         {"processing_capacity_tpd": inputs.processing_capacity_tpd * 1.25}),
        ("queueing", "Queueing and congestion",
         {"queue_factor": max(0.02, inputs.queue_factor * 0.3)}),
    ]

    gains: list[dict[str, Any]] = []
    for key, label, overrides in probes:
        recovered = max(0.0, _counterfactual_monthly(inputs, haulage, **overrides) - baseline)
        if recovered > 1.0:
            gains.append({"cause": key, "label": label, "recoverable_t": recovered})

    total_gain = sum(g["recoverable_t"] for g in gains)
    for g in gains:
        g["contribution_pct"] = round(100.0 * g["recoverable_t"] / total_gain, 1) if total_gain > 0 else 0.0
        g["recoverable_t"] = round(g["recoverable_t"], 1)
        g["closes_shortfall_pct"] = round(min(100.0, 100.0 * g["recoverable_t"] / shortfall), 1)

    gains.sort(key=lambda g: g["recoverable_t"], reverse=True)

    return {
        "shortfall_t": round(shortfall, 1),
        "shortfall_pct": round(abs(forecast.variance_pct), 2),
        "binding_constraint": forecast.binding_constraint,
        "contributors": gains,
        "attributable_t": round(total_gain, 1),
        "method": (
            "Counterfactual: each cause is relaxed to a realistic best case in "
            "isolation and the recovered tonnage measured. Causes interact, so "
            "recovered tonnes do not sum to the shortfall."
        ),
    }


def recommend_actions(
    inputs: ProductionInputs,
    haulage: HaulageContext,
    forecast: ProductionForecast,
    root_cause: dict[str, Any],
    route_risk_band: str,
) -> list[dict[str, Any]]:
    """Concrete actions, ordered by the tonnes each is worth."""
    actions: list[dict[str, Any]] = []
    contributors = {c["cause"]: c for c in root_cause.get("contributors", [])}

    if forecast.status != "deficit":
        return [
            {
                "action": "Hold current plan",
                "detail": (
                    f"Forecast production of {forecast.monthly_t:,.0f} t meets the "
                    f"{inputs.target_monthly_t:,.0f} t target. The binding constraint is "
                    f"{forecast.binding_constraint}."
                ),
                "impact_t": 0.0,
                "priority": "low",
            }
        ]

    c = contributors.get("equipment_downtime")
    if c:
        target_avail = min(0.94, inputs.equipment_availability + 0.12)
        actions.append({
            "action": f"Raise equipment availability from {inputs.equipment_availability:.0%} to {target_avail:.0%}",
            "detail": (
                f"Downtime is currently {inputs.predicted_downtime_hours_per_day:.1f} h/day. "
                f"Cutting it recovers about {c['recoverable_t']:,.0f} t/month — "
                f"{c['closes_shortfall_pct']:.0f}% of the shortfall."
            ),
            "impact_t": c["recoverable_t"],
            "priority": "high",
        })

    c = contributors.get("route_delays")
    if c:
        actions.append({
            "action": "Move haulage to the lower-risk route",
            "detail": (
                f"Route risk is adding {haulage.risk_delay_minutes:.1f} min to every cycle "
                f"({route_risk_band.lower()} risk). Removing that delay is worth about "
                f"{c['recoverable_t']:,.0f} t/month."
            ),
            "impact_t": c["recoverable_t"],
            "priority": "high" if c["contribution_pct"] > 20 else "medium",
        })

    c = contributors.get("fleet_capacity")
    if c:
        extra = max(2, int(inputs.trucks_available * 0.2))
        actions.append({
            "action": f"Add {extra} trucks to the haulage fleet",
            "detail": (
                f"At the current {forecast.cycle['total_minutes']:.0f}-minute cycle, "
                f"{extra} more trucks add roughly {c['recoverable_t']:,.0f} t/month."
            ),
            "impact_t": c["recoverable_t"],
            "priority": "medium",
        })

    c = contributors.get("ore_grade")
    if c and inputs.ore_grade_pct < inputs.target_grade_pct:
        actions.append({
            "action": f"Prioritise higher-grade faces (currently {inputs.ore_grade_pct:.1f}% vs {inputs.target_grade_pct:.1f}% target)",
            "detail": (
                f"Blending to target grade recovers about {c['recoverable_t']:,.0f} t/month of "
                "saleable product without moving more material."
            ),
            "impact_t": c["recoverable_t"],
            "priority": "medium",
        })

    c = contributors.get("processing_bottleneck")
    if c and forecast.binding_constraint == "processing":
        actions.append({
            "action": "Processing plant is the binding constraint — adding trucks will not help",
            "detail": (
                f"Haulage can deliver {forecast.capacities['haulage']:,.0f} t/day but the plant "
                f"accepts {inputs.processing_capacity_tpd:,.0f} t/day. Raising throughput 25% is "
                f"worth {c['recoverable_t']:,.0f} t/month."
            ),
            "impact_t": c["recoverable_t"],
            "priority": "high",
        })

    # Stockpile is a buffer, not production — say so rather than counting it twice.
    usable_stock = max(0.0, inputs.stockpile_current_t)
    if usable_stock > 0 and forecast.status == "deficit":
        covers = min(100.0, 100.0 * usable_stock / abs(forecast.variance_t))
        actions.append({
            "action": f"Draw {min(usable_stock, abs(forecast.variance_t)):,.0f} t from stockpile to cover the gap",
            "detail": (
                f"Current stock of {usable_stock:,.0f} t covers {covers:.0f}% of the shortfall. "
                "This defers the problem rather than fixing it — stock must be rebuilt."
            ),
            "impact_t": min(usable_stock, abs(forecast.variance_t)),
            "priority": "low",
        })

    actions.sort(key=lambda a: a["impact_t"], reverse=True)
    return actions


def simulate(
    base_inputs: ProductionInputs,
    haulage: HaulageContext,
    changes: dict[str, Any],
) -> dict[str, Any]:
    """What-if: apply changes, report the delta against the unchanged baseline."""
    baseline = forecast_production(base_inputs, haulage)

    valid = {k: v for k, v in (changes or {}).items() if hasattr(base_inputs, k)}
    scenario_inputs = ProductionInputs.from_payload({**base_inputs.as_dict(), **valid})

    scenario_haulage = haulage
    if "round_trip_minutes" in (changes or {}):
        try:
            scenario_haulage = HaulageContext(
                round_trip_minutes=float(changes["round_trip_minutes"]),
                distance_km=haulage.distance_km,
                risk_score=haulage.risk_score,
                risk_delay_minutes=haulage.risk_delay_minutes,
            )
        except (TypeError, ValueError):
            pass

    scenario = forecast_production(scenario_inputs, scenario_haulage)

    delta_t = scenario.monthly_t - baseline.monthly_t
    return {
        "baseline": baseline.as_dict(),
        "scenario": scenario.as_dict(),
        "applied_changes": valid,
        "ignored_changes": sorted(set((changes or {}).keys()) - set(valid) - {"round_trip_minutes"}),
        "delta": {
            "monthly_t": round(delta_t, 1),
            "monthly_pct": round(100.0 * delta_t / baseline.monthly_t, 2) if baseline.monthly_t > 0 else None,
            "daily_t": round(scenario.daily_t - baseline.daily_t, 1),
            "closes_shortfall": (
                baseline.status == "deficit" and scenario.status != "deficit"
            ),
            "binding_constraint_changed": baseline.binding_constraint != scenario.binding_constraint,
        },
    }
