"""app/api/core/scenario/economics.py — what an action costs, from the mine's own books.

The previous cost model was one line:

    cost_est = abs(delta) * COST_PER_TONNE_INR   # ₹1,200/t

That has a structural flaw beyond the invented rate: cost is proportional to
benefit, so every intervention has identical return on investment and the cost
term cannot influence ranking at all. A manager choosing "minimise cost" was
being ranked by production in disguise.

`ops.production_records` already carries per-shift cost lines — equipment
operating, maintenance, blast, haul, processing — and `ore_value_inr`. Rates are
derived from those for the specific mine, so an action that leans on haulage is
costed against that mine's haulage spend rather than a platform-wide constant.

Everything here remains a **modelled estimate**, and says so: these are unit
rates applied to a proportional change, not quoted prices. What has changed is
that the rates are observed instead of asserted.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache

from ..db import query

logger = logging.getLogger("crucible.scenario.economics")

#: Cost lines that scale with each intervention's dominant driver.
COST_DRIVERS = {
    "equipment_redeploy": "equipment_operating_cost_inr",
    "fleet_reroute": "haul_cost_inr",
    "crusher_speed_trim": "processing_cost_inr",
    "blast_reschedule": "blast_cost_inr",
    "maintenance_defer": "maintenance_cost_inr",
    "extend_operating_hours": "equipment_operating_cost_inr",
}


@dataclass(frozen=True)
class MineEconomics:
    """Observed per-shift cost structure for one mine."""

    mine_id: str
    shifts_observed: int
    mean_production_t: float | None
    #: Cost line name -> mean rupees per shift.
    cost_lines: dict[str, float]
    ore_value_per_shift_inr: float | None

    @property
    def available(self) -> bool:
        return self.shifts_observed > 0 and bool(self.cost_lines)

    @property
    def ore_value_per_tonne_inr(self) -> float | None:
        if not self.ore_value_per_shift_inr or not self.mean_production_t:
            return None
        return self.ore_value_per_shift_inr / self.mean_production_t

    @property
    def total_cost_per_shift_inr(self) -> float:
        return sum(self.cost_lines.values())

    def incremental_cost(self, driver: str, magnitude: float) -> tuple[float | None, str]:
        """Cost of changing one driver by a proportion, with its basis stated.

        Returns ``(rupees, basis)``; rupees is None when the mine has no
        observation for that cost line, which is reported rather than defaulted.
        """
        base = self.cost_lines.get(driver)
        if base is None:
            return None, f"No {driver.replace('_', ' ')} recorded for {self.mine_id}"

        cost = base * magnitude
        return cost, (
            f"{magnitude * 100:.0f}% of the mine's mean {driver.replace('_inr', '').replace('_', ' ')} "
            f"(₹{base:,.0f} per shift over {self.shifts_observed} shifts)"
        )

    def value_of(self, tonnes: float) -> tuple[float | None, str]:
        """Revenue value of additional tonnes, at the mine's observed ore value."""
        rate = self.ore_value_per_tonne_inr
        if rate is None:
            return None, "Ore value per tonne is not recorded for this mine"
        return tonnes * rate, f"at the mine's mean ore value of ₹{rate:,.0f}/t"


_EMPTY = MineEconomics(
    mine_id="", shifts_observed=0, mean_production_t=None,
    cost_lines={}, ore_value_per_shift_inr=None,
)


@lru_cache(maxsize=32)
def mine_economics(mine_id: str) -> MineEconomics:
    """Derive a mine's cost structure from its production records.

    Cached: these are long-run means over the full record, and they move only
    when new operational data lands.
    """
    try:
        rows = query(
            """SELECT
                 COUNT(*)                            AS shifts,
                 AVG(actual_production_t)            AS production_t,
                 AVG(equipment_operating_cost_inr)   AS equipment_operating_cost_inr,
                 AVG(maintenance_cost_inr)           AS maintenance_cost_inr,
                 AVG(blast_cost_inr)                 AS blast_cost_inr,
                 AVG(haul_cost_inr)                  AS haul_cost_inr,
                 AVG(processing_cost_inr)            AS processing_cost_inr,
                 AVG(ore_value_inr)                  AS ore_value_inr
               FROM ops.production_records
               WHERE mine_id = %s AND actual_production_t IS NOT NULL""",
            (mine_id,),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Economics unavailable for %s: %s", mine_id, exc)
        return _EMPTY

    if not rows or not rows[0].get("shifts"):
        return _EMPTY

    row = rows[0]

    def num(key: str) -> float | None:
        value = row.get(key)
        return float(value) if value is not None else None

    cost_lines = {
        key: value
        for key in (
            "equipment_operating_cost_inr",
            "maintenance_cost_inr",
            "blast_cost_inr",
            "haul_cost_inr",
            "processing_cost_inr",
        )
        if (value := num(key)) is not None
    }

    return MineEconomics(
        mine_id=mine_id,
        shifts_observed=int(row["shifts"]),
        mean_production_t=num("production_t"),
        cost_lines=cost_lines,
        ore_value_per_shift_inr=num("ore_value_inr"),
    )


def clear_cache() -> None:
    """Drop cached economics — call after new production data is approved."""
    mine_economics.cache_clear()


__all__ = ["COST_DRIVERS", "MineEconomics", "clear_cache", "mine_economics"]
