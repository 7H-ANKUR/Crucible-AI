"""app/api/core/projection.py — what happens if we do nothing?

The question that turns analytics into decision support. A manager shown "we are
6.8% below plan" has a fact; a manager shown "and by end of shift that becomes
118 t, after which the shift cannot be recovered" has a decision.

**Where the numbers come from.** The projection extrapolates the mine's own
observed shortfall rate. It is not a forecast model, and does not pretend to be:
`calculation_mode` is HEURISTIC throughout, and the assumption is stated in the
payload — *conditions persist unchanged*. That assumption is exactly what makes
it a "do nothing" projection, and it is the assumption a manager is implicitly
testing when they ask the question.

**Why not a model.** The production model forecasts a shift given its features;
it does not forecast how a shift decays hour by hour, and no hourly data exists
to fit that on. Reporting a model-backed hourly curve would be presenting
extrapolation as prediction. A linear persistence of a measured rate is a weaker
claim, and a true one.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from .clock import resolve_clock
from .db import query
from .provenance import CalculationMode

logger = logging.getLogger("crucible.projection")

#: Projection points. A shift is the decision horizon; a day is the consequence.
HORIZONS: tuple[tuple[str, str, float], ...] = (
    ("30_min", "In 30 minutes", 0.5),
    ("2_hours", "In 2 hours", 2.0),
    ("shift_end", "By end of shift", 8.0),
    ("day_end", "By end of day", 24.0),
)

#: Past this fraction of the shift, redirecting the fleet cannot pay back the
#: time it costs. Named so it can be reviewed against a site's own experience.
RECOVERY_WINDOW_FRACTION = 0.65


@dataclass
class ProjectionPoint:
    key: str
    label: str
    hours_ahead: float
    #: Cumulative shortfall by this point, tonnes.
    shortfall_t: float
    #: Whether intervening after this point can still recover the shift.
    recoverable: bool
    note: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "hours_ahead": self.hours_ahead,
            "shortfall_t": round(self.shortfall_t, 1),
            "recoverable": self.recoverable,
            "note": self.note,
        }


@dataclass
class Projection:
    mine_id: str
    available: bool
    shortfall_rate_tph: float | None
    points: list[ProjectionPoint] = field(default_factory=list)
    assumptions: list[str] = field(default_factory=list)
    calculation_mode: CalculationMode = CalculationMode.HEURISTIC
    unavailable_reason: str | None = None
    evidence: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "mine_id": self.mine_id,
            "available": self.available,
            "shortfall_rate_tph": (
                round(self.shortfall_rate_tph, 2) if self.shortfall_rate_tph is not None else None
            ),
            "points": [p.as_dict() for p in self.points],
            "assumptions": self.assumptions,
            "calculation_mode": self.calculation_mode.value,
            "unavailable_reason": self.unavailable_reason,
            "evidence": self.evidence,
        }


def _unavailable(mine_id: str, reason: str) -> Projection:
    return Projection(
        mine_id=mine_id,
        available=False,
        shortfall_rate_tph=None,
        calculation_mode=CalculationMode.INSUFFICIENT_DATA,
        unavailable_reason=reason,
    )


def do_nothing(mine_id: str, *, shifts: int = 5) -> Projection:
    """Project the current shortfall forward under unchanged conditions."""
    rows = query(
        """SELECT date, shift, planned_production_t, actual_production_t, working_hours
           FROM ops.production_records
           WHERE mine_id = %s AND actual_production_t IS NOT NULL
             AND planned_production_t IS NOT NULL
           ORDER BY date DESC
           LIMIT %s""",
        (mine_id, shifts),
    )

    if not rows:
        return _unavailable(
            mine_id,
            f"No production records exist for {mine_id}, so no rate can be established.",
        )

    planned = sum(float(r["planned_production_t"]) for r in rows)
    actual = sum(float(r["actual_production_t"]) for r in rows)
    hours = sum(float(r["working_hours"] or 8.0) for r in rows)

    if hours <= 0:
        return _unavailable(mine_id, "Recorded working hours are zero, so no rate can be derived.")

    shortfall = planned - actual

    if shortfall <= 0:
        return Projection(
            mine_id=mine_id,
            available=True,
            shortfall_rate_tph=0.0,
            points=[],
            calculation_mode=CalculationMode.HEURISTIC,
            assumptions=[
                f"Production is running {abs(shortfall):,.0f} t ahead of plan over the "
                f"last {len(rows)} shifts, so there is no shortfall to project."
            ],
            evidence={
                "shifts": len(rows),
                "planned_t": round(planned, 1),
                "actual_t": round(actual, 1),
                "surplus_t": round(abs(shortfall), 1),
            },
        )

    rate = shortfall / hours
    shift_hours = float(rows[0]["working_hours"] or 8.0)

    points: list[ProjectionPoint] = []
    for key, label, ahead in HORIZONS:
        cumulative = rate * ahead
        recoverable = ahead <= shift_hours * RECOVERY_WINDOW_FRACTION

        if recoverable:
            note = "A response started now can still recover this shift."
        elif ahead <= shift_hours:
            note = (
                "Past the point where redirecting the fleet pays back within the "
                "shift; recovery moves to the next shift."
            )
        else:
            note = "Beyond this shift — the gap carries into the following period."

        points.append(
            ProjectionPoint(
                key=key,
                label=label,
                hours_ahead=ahead,
                shortfall_t=cumulative,
                recoverable=recoverable,
                note=note,
            )
        )

    return Projection(
        mine_id=mine_id,
        available=True,
        shortfall_rate_tph=rate,
        points=points,
        calculation_mode=CalculationMode.HEURISTIC,
        assumptions=[
            f"Conditions persist unchanged. The rate is the mine's own measured "
            f"shortfall of {shortfall:,.0f} t over {hours:.0f} recorded working hours "
            f"across {len(rows)} shifts.",
            "This is a linear persistence of an observed rate, not a forecast model. "
            "It answers what continues if nothing changes.",
            f"The recovery window assumes a response is worth starting within the "
            f"first {RECOVERY_WINDOW_FRACTION * 100:.0f}% of a "
            f"{shift_hours:.0f}-hour shift.",
        ],
        evidence={
            "shifts": len(rows),
            "planned_t": round(planned, 1),
            "actual_t": round(actual, 1),
            "shortfall_t": round(shortfall, 1),
            "working_hours": round(hours, 1),
            "shift_hours": shift_hours,
        },
    )


def compare_options(
    mine_id: str,
    options: list[dict[str, Any]],
    *,
    horizon_key: str = "shift_end",
) -> dict[str, Any]:
    """Do-nothing against each response option at a shared horizon.

    Options are compared at the same point in time or the comparison is
    meaningless, so the horizon is explicit in the payload rather than implied.
    """
    projection = do_nothing(mine_id)
    clock = resolve_clock(mine_id)

    if not projection.available:
        return {
            "mine_id": mine_id,
            "available": False,
            "unavailable_reason": projection.unavailable_reason,
            "clock": clock.as_dict(),
        }

    point = next((p for p in projection.points if p.key == horizon_key), None)
    baseline_shortfall = point.shortfall_t if point else 0.0

    rows = [
        {
            "label": "Do nothing",
            "key": "do_nothing",
            "shortfall_t": round(baseline_shortfall, 1),
            "recovered_t": 0.0,
            "cost_inr": 0.0,
            "risk_delta": 0.0,
            "calculation_mode": projection.calculation_mode.value,
            "is_baseline": True,
        }
    ]

    for option in options:
        recovered = option.get("expected_delta_t") or 0.0
        rows.append(
            {
                "label": option.get("title") or option.get("key"),
                "key": option.get("key"),
                "shortfall_t": round(max(0.0, baseline_shortfall - recovered), 1),
                "recovered_t": round(recovered, 1),
                "cost_inr": option.get("cost_inr"),
                "risk_delta": option.get("risk_delta") or 0.0,
                "calculation_mode": option.get("calculation_mode"),
                "is_baseline": False,
            }
        )

    return {
        "mine_id": mine_id,
        "available": True,
        "horizon": horizon_key,
        "horizon_label": point.label if point else horizon_key,
        "recoverable_at_horizon": point.recoverable if point else None,
        "rows": rows,
        "assumptions": projection.assumptions,
        "clock": clock.as_dict(),
        "note": (
            "Every option is compared at the same horizon. Recovered tonnes are "
            "each option's own estimate; they are not additive across options "
            "unless the options are independent."
        ),
    }


__all__ = ["HORIZONS", "Projection", "ProjectionPoint", "compare_options", "do_nothing"]
