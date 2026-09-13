"""app/api/core/scenario/catalogue.py — the one list of things a mine can do.

This replaces three overlapping definitions that had drifted apart:

* ``scenario_engine._HEURISTIC`` / ``_ADJUSTABLE`` — controls-driven candidates
* ``scenarios._HEURISTIC`` / ``_ADJUSTABLE`` — byte-identical copies
* ``optimizer.candidate_actions`` — five hardcoded actions carrying constant
  ``base_gain`` values (48.0, 36.0, 24.0, 30.0, 12.0 tonnes) surfaced to the UI
  as ``expected_gain_t``

Adding an intervention now means adding one :class:`InterventionSpec`. Its
effect, the model features it moves, the constraints that govern it, the cost
line it draws on and the trade-offs it carries are declared together, so they
cannot fall out of step.

On the heuristic fallbacks: each spec carries a `heuristic_effect`, used only
when the model cannot score the change. They are *stated as* estimates rather
than dressed up as predictions, and the resulting `calculation_mode` is
HEURISTIC so every consumer can see which is which.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class InterventionSpec:
    key: str
    title: str
    #: Plain description. No jargon — this is read by a shift supervisor.
    description: str

    #: Model feature columns this action moves, best candidate first. The first
    #: one present in the feature frame is scaled to obtain a model-backed delta.
    adjustable_features: tuple[str, ...]
    #: Whether scaling the feature *up* represents doing more of this action.
    #: Deferring maintenance reduces maintenance hours, so it scales down.
    scales_up: bool = True

    #: Production change as a fraction of baseline, per unit magnitude of 0.10.
    #: Used only when no model-backed delta is obtainable.
    heuristic_effect: float = 0.05

    #: Cost line in ops.production_records this action draws on.
    cost_driver: str | None = None

    #: Change in equipment risk exposure per unit magnitude. Positive is worse.
    risk_effect: float = 0.0

    #: Additional fuel burn as a fraction of the magnitude applied.
    fuel_effect: float = 0.0

    #: Extra detail the constraint engine needs (e.g. the shift for a blast).
    constraint_inputs: tuple[str, ...] = ()

    #: Honest downsides, always shown — including for the recommended option.
    tradeoffs: tuple[str, ...] = ()

    #: Roles that must sign this off before it can be executed.
    approval_roles: tuple[str, ...] = ("production_admin",)

    #: Where in the response window this action belongs.
    horizon: str = "NEXT"  # NOW | NEXT | NEXT_SHIFT

    #: Who carries it out.
    owner: str = "Shift Supervisor"


CATALOGUE: dict[str, InterventionSpec] = {
    "equipment_redeploy": InterventionSpec(
        key="equipment_redeploy",
        title="Reallocate haulage to the constrained route",
        description=(
            "Move available low-risk haulage capacity onto the stage that is "
            "currently limiting production."
        ),
        adjustable_features=(
            "equipment_availability_pct",
            "available_equipment_count",
            "equipment_utilization_pct",
            "utilization_pct",
            "operating_hours",
        ),
        heuristic_effect=0.10,
        cost_driver="equipment_operating_cost_inr",
        risk_effect=0.02,
        fuel_effect=0.6,
        tradeoffs=(
            "Units moved onto the constrained route leave their current face short-handed.",
            "Relocation consumes part of the shift before any extra tonnes are produced.",
        ),
        approval_roles=("production_admin",),
        horizon="NEXT",
        owner="Fleet Coordinator",
    ),
    "fleet_reroute": InterventionSpec(
        key="fleet_reroute",
        title="Reroute haulage away from the congested corridor",
        description=(
            "Send loaded trucks via an alternative haul route to cut queueing and "
            "cycle time."
        ),
        adjustable_features=(
            "average_cycle_time_min",
            "truck_queue_time_min",
            "haul_distance_km",
        ),
        scales_up=False,  # shorter cycle time is the improvement
        heuristic_effect=0.09,
        cost_driver="haul_cost_inr",
        risk_effect=0.01,
        fuel_effect=1.0,
        tradeoffs=(
            "An alternative route is usually longer, raising fuel burn per tonne.",
            "Route risk must be re-checked against current ground and weather conditions.",
        ),
        approval_roles=("production_admin",),
        horizon="NEXT",
        owner="Dispatch",
    ),
    "crusher_speed_trim": InterventionSpec(
        key="crusher_speed_trim",
        title="Raise primary crusher throughput",
        description=(
            "Increase crusher feed rate to clear a processing-side restriction."
        ),
        adjustable_features=("processing_capacity_t",),
        heuristic_effect=0.05,
        cost_driver="processing_cost_inr",
        risk_effect=0.04,
        fuel_effect=0.2,
        constraint_inputs=("magnitude",),
        tradeoffs=(
            "Sustained higher feed rates accelerate liner and motor wear.",
            "Gains stop at the next downstream limit, which may be stockpile capacity.",
        ),
        approval_roles=("production_admin",),
        horizon="NEXT",
        owner="Processing Supervisor",
    ),
    "blast_reschedule": InterventionSpec(
        key="blast_reschedule",
        title="Advance the next blast",
        description=(
            "Bring the scheduled blast forward so broken ore is available earlier "
            "in the shift."
        ),
        adjustable_features=("ore_available_t", "blast_delay_hours"),
        heuristic_effect=0.07,
        cost_driver="blast_cost_inr",
        risk_effect=0.05,
        constraint_inputs=("shift",),
        tradeoffs=(
            "Advancing a blast compresses the clearance and re-entry window.",
            "Fragmentation quality may suffer if preparation is shortened.",
        ),
        approval_roles=("production_admin", "super_admin"),
        horizon="NEXT_SHIFT",
        owner="Drill & Blast Engineer",
    ),
    "maintenance_defer": InterventionSpec(
        key="maintenance_defer",
        title="Defer non-critical maintenance",
        description=(
            "Hold a non-critical service until the lowest-production window to "
            "keep units available now."
        ),
        adjustable_features=("planned_maintenance_hours", "total_downtime_hours"),
        scales_up=False,
        heuristic_effect=0.04,
        cost_driver="maintenance_cost_inr",
        # The only catalogue entry whose risk effect is large and negative-sense:
        # it buys production now by increasing the chance of an unplanned stop.
        risk_effect=0.18,
        tradeoffs=(
            "Deferral raises unplanned-failure exposure for the whole deferred period.",
            "An unplanned stop costs more production than the deferral recovers.",
        ),
        approval_roles=("equipment_admin", "super_admin"),
        horizon="NEXT_SHIFT",
        owner="Maintenance Manager",
    ),
    "extend_operating_hours": InterventionSpec(
        key="extend_operating_hours",
        title="Extend productive operating time",
        description=(
            "Recover lost operating time by tightening shift changeover and "
            "reducing idle periods."
        ),
        adjustable_features=("working_hours", "operating_hours", "shift_efficiency"),
        heuristic_effect=0.06,
        cost_driver="equipment_operating_cost_inr",
        risk_effect=0.03,
        fuel_effect=0.8,
        tradeoffs=(
            "Extended running reduces the window available for routine servicing.",
            "Operator fatigue rises toward the end of an extended period.",
        ),
        approval_roles=("production_admin",),
        horizon="NOW",
        owner="Shift Supervisor",
    ),
}


def spec(key: str) -> InterventionSpec | None:
    return CATALOGUE.get(key)


def all_specs() -> list[InterventionSpec]:
    return list(CATALOGUE.values())


__all__ = ["CATALOGUE", "InterventionSpec", "all_specs", "spec"]
