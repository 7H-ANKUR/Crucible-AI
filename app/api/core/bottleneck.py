"""app/api/core/bottleneck.py — what is actually limiting production right now?

Replaces `intelligence.get_material_flow`, which returned six hardcoded stages:

    {"id": "crusher", "capacity_tph": 280, "current_tph": 275,
     "utilization_pct": 98.2, "status": "BOTTLENECK"}

Those numbers were constants. The endpoint took no `mine_id`, so every mine in
the platform was shown the same "bottleneck", and a manager acting on it would
have been rebalancing a crusher on the strength of a literal in a Python file.

Every stage here is computed from `ops.production_records` and
`ops.equipment_telemetry` for the specific mine, and each carries its own
`calculation_mode`. Where a stage has no data — dispatch, which the schema does
not cover — it reports INSUFFICIENT_DATA rather than inventing a plausible
utilisation.

**How capacity is established.** Two methods, chosen per stage by what the data
supports:

* *Derived* — built from first principles out of measured quantities. Haulage
  capacity is trucks × payload × trips per shift, every term observed.
* *Best demonstrated rate* — the 95th percentile of what the stage has actually
  achieved historically, scaled by its current availability. Standard practice
  where a nameplate rating is not recorded, and honest about being an inference
  from history rather than an engineering specification.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

from .clock import resolve_clock
from .db import query
from .memo import ttl_cache
from .provenance import CalculationMode

logger = logging.getLogger("crucible.bottleneck")

#: Stages in material-flow order. A stage limits everything downstream of it.
STAGE_ORDER = ("face", "loading", "haulage", "processing", "stockpile", "dispatch")

STAGE_LABELS = {
    "face": "Face preparation",
    "loading": "Loading",
    "haulage": "Haulage",
    "processing": "Processing",
    "stockpile": "Stockpile",
    "dispatch": "Dispatch",
}

#: Utilisation above this is a constraint; above the second is saturation.
CONSTRAINED_UTILISATION = 0.85
SATURATED_UTILISATION = 0.95


@dataclass
class Stage:
    key: str
    label: str
    #: Tonnes that actually moved through this stage in the reference shift.
    throughput_t: float | None
    #: Tonnes this stage could have moved.
    capacity_t: float | None
    calculation_mode: CalculationMode
    #: How capacity was established, in a sentence.
    basis: str
    #: Supporting observations, for audit and for the UI's evidence panel.
    evidence: dict[str, Any] = field(default_factory=dict)
    unavailable_reason: str | None = None

    @property
    def utilisation(self) -> float | None:
        if self.throughput_t is None or not self.capacity_t:
            return None
        return self.throughput_t / self.capacity_t

    @property
    def headroom_t(self) -> float | None:
        if self.throughput_t is None or self.capacity_t is None:
            return None
        return self.capacity_t - self.throughput_t

    @property
    def status(self) -> str:
        u = self.utilisation
        if u is None:
            return "UNKNOWN"
        if u >= SATURATED_UTILISATION:
            return "SATURATED"
        if u >= CONSTRAINED_UTILISATION:
            return "CONSTRAINED"
        return "NOMINAL"

    def as_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "throughput_t": _r(self.throughput_t),
            "capacity_t": _r(self.capacity_t),
            "utilisation_pct": _r(self.utilisation * 100 if self.utilisation is not None else None, 1),
            "headroom_t": _r(self.headroom_t),
            "status": self.status,
            "calculation_mode": self.calculation_mode.value,
            "basis": self.basis,
            "evidence": self.evidence,
            "unavailable_reason": self.unavailable_reason,
        }


def _r(value: float | None, places: int = 1) -> float | None:
    return None if value is None else round(value, places)


def _num(row: dict, key: str) -> float | None:
    value = row.get(key)
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _unavailable(key: str, reason: str) -> Stage:
    return Stage(
        key=key,
        label=STAGE_LABELS[key],
        throughput_t=None,
        capacity_t=None,
        calculation_mode=CalculationMode.INSUFFICIENT_DATA,
        basis="Not established",
        unavailable_reason=reason,
    )


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------

@ttl_cache(ttl=20.0)
def _latest_shift(mine_id: str) -> dict | None:
    rows = query(
        """SELECT date, shift, actual_production_t, planned_production_t, ore_available_t,
                  waste_t, stockpile_t, processing_capacity_t, working_hours,
                  average_cycle_time_min, truck_queue_time_min, haul_distance_km,
                  truck_availability, loader_availability, excavator_availability,
                  drill_availability, active_equipment_count, available_equipment_count,
                  equipment_count, ore_routing_delay_hours, data_origin
           FROM ops.production_records
           WHERE mine_id = %s
           ORDER BY date DESC
           LIMIT 1""",
        (mine_id,),
    )
    return rows[0] if rows else None


@lru_cache(maxsize=32)
def _demonstrated_peaks(mine_id: str) -> dict[str, float | None]:
    """95th-percentile historical throughput, the best-demonstrated-rate basis.

    The 95th rather than the maximum: a single exceptional shift is not a
    sustainable capacity, and treating it as one understates utilisation
    everywhere.
    """
    rows = query(
        """SELECT
             PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY actual_production_t) AS production,
             PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ore_available_t)     AS ore,
             AVG(loader_availability)                                          AS loader_avg,
             AVG(excavator_availability)                                       AS excavator_avg,
             COUNT(*)                                                          AS shifts
           FROM ops.production_records
           WHERE mine_id = %s AND actual_production_t IS NOT NULL""",
        (mine_id,),
    )
    if not rows:
        return {}
    return {k: _num(rows[0], k) for k in ("production", "ore", "loader_avg", "excavator_avg")} | {
        "shifts": rows[0].get("shifts") or 0
    }


@lru_cache(maxsize=32)
def _fleet_profile(mine_id: str) -> dict[str, Any]:
    """Truck payload and the trucks' share of the machine fleet.

    The share matters because `production_records.active_equipment_count` counts
    *all* machine types — excavators, pumps, crushers, drills — and multiplying
    that whole count by a truck payload overstates haulage capacity by more than
    an order of magnitude.
    """
    rows = query(
        """SELECT
             COUNT(DISTINCT machine_id) AS machines,
             COUNT(DISTINCT CASE WHEN equipment_type = 'truck' THEN machine_id END) AS trucks,
             AVG(CASE WHEN equipment_type = 'truck' THEN payload_tons END) AS payload,
             COUNT(CASE WHEN equipment_type = 'truck' THEN payload_tons END) AS payload_n
           FROM ops.equipment_telemetry
           WHERE mine_id = %s""",
        (mine_id,),
    )
    if not rows or not rows[0].get("machines"):
        return {"payload": None, "payload_n": 0, "trucks": 0, "machines": 0, "truck_share": None}

    row = rows[0]
    machines = int(row["machines"])
    trucks = int(row.get("trucks") or 0)
    return {
        "payload": _num(row, "payload"),
        "payload_n": int(row.get("payload_n") or 0),
        "trucks": trucks,
        "machines": machines,
        "truck_share": (trucks / machines) if machines else None,
    }


# ---------------------------------------------------------------------------
# Stage builders
# ---------------------------------------------------------------------------

@lru_cache(maxsize=32)
def _stockpile_ceiling(mine_id: str) -> float | None:
    """Highest stockpile level ever recorded, standing in for a holding capacity."""
    rows = query(
        """SELECT MAX(stockpile_t) AS peak FROM ops.production_records
           WHERE mine_id = %s AND stockpile_t IS NOT NULL""",
        (mine_id,),
    )
    return _num(rows[0], "peak") if rows else None


def _face_stage(row: dict, peaks: dict) -> Stage:
    ore = _num(row, "ore_available_t")
    production = _num(row, "actual_production_t")
    drill = _num(row, "drill_availability")

    if ore is None:
        return _unavailable("face", "ore_available_t is not recorded for this shift")

    return Stage(
        key="face",
        label=STAGE_LABELS["face"],
        throughput_t=production,
        capacity_t=ore,
        calculation_mode=CalculationMode.MODEL_BACKED,
        basis=(
            "Broken ore available at the face this shift, as recorded. This is a "
            "measured quantity, not an inferred rate."
        ),
        evidence={
            "ore_available_t": _r(ore),
            "drill_availability": _r(drill, 3),
        },
    )


def _loading_stage(row: dict, peaks: dict) -> Stage:
    production = _num(row, "actual_production_t")
    loader = _num(row, "loader_availability")
    excavator = _num(row, "excavator_availability")
    peak = peaks.get("production")
    loader_avg = peaks.get("loader_avg")
    excavator_avg = peaks.get("excavator_avg")

    if peak is None or production is None:
        return _unavailable("loading", "no production history from which to establish a rate")

    # Availability now, relative to the average across the period the peak was
    # demonstrated in. Fleet in better shape than usual lifts capacity above the
    # demonstrated peak; worse shape lowers it.
    current = [v for v in (loader, excavator) if v is not None]
    baseline = [v for v in (loader_avg, excavator_avg) if v is not None]

    if not current or not baseline or not sum(baseline):
        factor, note = 1.0, "availability unadjusted — loader and excavator availability not recorded"
    else:
        factor = (sum(current) / len(current)) / (sum(baseline) / len(baseline))
        note = (
            f"scaled by current loader/excavator availability "
            f"({sum(current) / len(current) * 100:.0f}% against a {sum(baseline) / len(baseline) * 100:.0f}% average)"
        )

    return Stage(
        key="loading",
        label=STAGE_LABELS["loading"],
        throughput_t=production,
        capacity_t=peak * factor,
        calculation_mode=CalculationMode.HEURISTIC,
        basis=(
            f"Best demonstrated rate: the 95th-percentile shift over "
            f"{peaks.get('shifts', 0)} recorded shifts, {note}. No nameplate loading "
            "rating is recorded, so this is inferred from history."
        ),
        evidence={
            "demonstrated_peak_t": _r(peak),
            "availability_factor": _r(factor, 3),
            "loader_availability": _r(loader, 3),
            "excavator_availability": _r(excavator, 3),
        },
    )


def _haulage_stage(row: dict, fleet: dict[str, Any]) -> Stage:
    """Haulage capacity, derived at the same scope as the production figure.

    `ops.production_records` is one row per (mine, date, zone, shift), so its
    `actual_production_t` describes a single zone-shift. The truck fleet in
    `ops.equipment_telemetry` is mine-wide. Comparing the two directly is a scope
    error: it made haulage look 4% utilised at every mine, which would tell a
    manager haulage is never worth examining.

    The row's own `active_equipment_count` is at the production figure's scope,
    so trucks in scope are that count times the trucks' share of the fleet.
    """
    production = _num(row, "actual_production_t")
    cycle = _num(row, "average_cycle_time_min")
    queue = _num(row, "truck_queue_time_min") or 0.0
    hours = _num(row, "working_hours")
    active = _num(row, "active_equipment_count")

    payload = fleet.get("payload")
    truck_share = fleet.get("truck_share")

    missing = [
        name
        for name, value in (
            ("truck payload", payload),
            ("fleet composition", truck_share),
            ("cycle time", cycle),
            ("working hours", hours),
            ("active equipment count", active),
        )
        if value is None
    ]
    if missing:
        return _unavailable("haulage", f"missing {', '.join(missing)}")

    effective_cycle = cycle + queue
    if effective_cycle <= 0:
        return _unavailable("haulage", "recorded cycle time is zero or negative")

    trucks_in_scope = active * truck_share
    if trucks_in_scope <= 0:
        return _unavailable("haulage", "no trucks are in scope for this production record")

    trips_per_truck = (hours * 60.0) / effective_cycle
    capacity = trucks_in_scope * trips_per_truck * payload

    return Stage(
        key="haulage",
        label=STAGE_LABELS["haulage"],
        throughput_t=production,
        capacity_t=capacity,
        calculation_mode=CalculationMode.MODEL_BACKED,
        basis=(
            f"Derived: {trucks_in_scope:.1f} trucks in scope "
            f"({active:.0f} active machines × the {truck_share * 100:.0f}% truck share of "
            f"a {fleet['machines']}-machine fleet) × {trips_per_truck:.1f} trips × "
            f"{payload:.1f} t payload over a {hours:.0f}-hour shift. Cycle time "
            f"{cycle:.1f} min plus {queue:.1f} min queueing, all measured."
        ),
        evidence={
            "trucks_in_scope": _r(trucks_in_scope, 2),
            "fleet_trucks": fleet["trucks"],
            "fleet_machines": fleet["machines"],
            "truck_share_pct": _r(truck_share * 100, 1),
            "cycle_time_min": _r(cycle),
            "queue_time_min": _r(queue),
            "trips_per_truck": _r(trips_per_truck),
            "payload_t": _r(payload),
            "payload_observations": fleet["payload_n"],
            "haul_distance_km": _r(_num(row, "haul_distance_km"), 2),
            "scope_note": (
                "Production is recorded per zone-shift; the truck count is scaled "
                "to that scope rather than taken fleet-wide."
            ),
        },
    )


def _processing_stage(row: dict) -> Stage:
    production = _num(row, "actual_production_t")
    capacity = _num(row, "processing_capacity_t")
    delay = _num(row, "ore_routing_delay_hours")

    if capacity is None:
        return _unavailable("processing", "processing_capacity_t is not recorded for this shift")

    return Stage(
        key="processing",
        label=STAGE_LABELS["processing"],
        throughput_t=production,
        capacity_t=capacity,
        calculation_mode=CalculationMode.MODEL_BACKED,
        basis="Recorded processing capacity for the shift, as reported by the plant.",
        evidence={
            "processing_capacity_t": _r(capacity),
            "ore_routing_delay_hours": _r(delay, 2),
        },
    )


def _stockpile_stage(row: dict, peaks: dict) -> Stage:
    stock = _num(row, "stockpile_t")
    production = _num(row, "actual_production_t")

    if stock is None:
        return _unavailable("stockpile", "stockpile_t is not recorded for this shift")

    # A stockpile is a buffer, not a throughput stage: its constraint is holding
    # capacity. With no recorded maximum, the historical peak stands in for one.
    peak = _stockpile_ceiling(row["__mine_id"])

    return Stage(
        key="stockpile",
        label=STAGE_LABELS["stockpile"],
        throughput_t=stock,
        capacity_t=peak,
        calculation_mode=CalculationMode.HEURISTIC,
        basis=(
            "Stockpile is a buffer rather than a throughput stage. Utilisation is "
            "current stock against the highest level ever recorded at this mine, "
            "which stands in for an unrecorded holding capacity."
        ),
        evidence={
            "stockpile_t": _r(stock),
            "highest_recorded_t": _r(peak),
            "production_this_shift_t": _r(production),
        },
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

@ttl_cache(ttl=20.0)
def analyse(mine_id: str) -> dict[str, Any]:
    """Stage-by-stage flow analysis, and what is limiting it.

    Memoised briefly: the state engine, the attention queue and the Command
    Center summary each want this for the same mine within one page load, and it
    costs six round trips to a remote database.
    """
    row = _latest_shift(mine_id)
    clock = resolve_clock(mine_id)

    if row is None:
        return {
            "mine_id": mine_id,
            "stages": [],
            "bottleneck": None,
            "calculation_mode": CalculationMode.INSUFFICIENT_DATA.value,
            "unavailable_reason": (
                f"No production records exist for {mine_id}, so material flow "
                "cannot be analysed."
            ),
            "clock": clock.as_dict(),
        }

    row["__mine_id"] = mine_id
    peaks = _demonstrated_peaks(mine_id)
    fleet = _fleet_profile(mine_id)

    stages = [
        _face_stage(row, peaks),
        _loading_stage(row, peaks),
        _haulage_stage(row, fleet),
        _processing_stage(row),
        _stockpile_stage(row, peaks),
        _unavailable(
            "dispatch",
            "no dispatch throughput is recorded in the operational schema",
        ),
    ]

    # The bottleneck is the stage with the least headroom — the one that runs out
    # first as production rises. Stages without a capacity are excluded rather
    # than defaulted, so an unmeasured stage can never be named the constraint.
    # The stockpile is excluded too: it is a buffer, and a full buffer is a
    # symptom of a downstream constraint rather than a constraint itself.
    candidates = [
        s for s in stages
        if s.utilisation is not None and s.key != "stockpile"
    ]
    bottleneck = max(candidates, key=lambda s: s.utilisation) if candidates else None

    unmeasured = [s.key for s in stages if s.utilisation is None]

    return {
        "mine_id": mine_id,
        "as_of": str(row.get("date")),
        "shift": row.get("shift"),
        "production_t": _r(_num(row, "actual_production_t")),
        "planned_t": _r(_num(row, "planned_production_t")),
        "stages": [s.as_dict() for s in stages],
        "bottleneck": (
            {
                "stage": bottleneck.key,
                "label": bottleneck.label,
                "utilisation_pct": _r(bottleneck.utilisation * 100, 1),
                "headroom_t": _r(bottleneck.headroom_t),
                "status": bottleneck.status,
                "calculation_mode": bottleneck.calculation_mode.value,
                "basis": bottleneck.basis,
                "reason": _bottleneck_reason(bottleneck, stages),
            }
            if bottleneck
            else None
        ),
        "unmeasured_stages": unmeasured,
        "calculation_mode": (
            CalculationMode.MODEL_BACKED.value
            if bottleneck and bottleneck.calculation_mode is CalculationMode.MODEL_BACKED
            else CalculationMode.HEURISTIC.value
        ),
        "data_origin": row.get("data_origin") or "SYNTHETIC",
        "clock": clock.as_dict(),
    }


def _bottleneck_reason(bottleneck: Stage, stages: list[Stage]) -> str:
    """Why this stage and not another, stated against the alternatives."""
    others = [
        s for s in stages
        if s.key != bottleneck.key and s.utilisation is not None and s.key != "stockpile"
    ]
    parts = [
        f"{bottleneck.label} is running at "
        f"{bottleneck.utilisation * 100:.0f}% of its {bottleneck.capacity_t:,.0f} t capacity."
    ]

    if others:
        runner_up = max(others, key=lambda s: s.utilisation)
        parts.append(
            f"The next most loaded stage, {runner_up.label.lower()}, is at "
            f"{runner_up.utilisation * 100:.0f}%."
        )

    headroom = bottleneck.headroom_t
    if headroom is not None and headroom > 0:
        parts.append(f"It has {headroom:,.0f} t of headroom before it saturates.")
    elif headroom is not None:
        parts.append(
            f"It is {abs(headroom):,.0f} t beyond its established capacity, so that "
            "capacity figure may understate what the stage can do."
        )

    unmeasured = [s.label.lower() for s in stages if s.utilisation is None]
    if unmeasured:
        parts.append(
            "This compares only measured stages; "
            + ", ".join(unmeasured)
            + (" has" if len(unmeasured) == 1 else " have")
            + " no recorded throughput and could be tighter."
        )

    return " ".join(parts)


def clear_cache() -> None:
    """Drop cached aggregates — call when new production data is approved."""
    _demonstrated_peaks.cache_clear()
    _fleet_profile.cache_clear()
    _stockpile_ceiling.cache_clear()


__all__ = ["STAGE_ORDER", "Stage", "analyse", "clear_cache"]
