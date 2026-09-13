"""app/api/core/constraints.py — what the mine will and will not permit.

Replaces `optimizer.check_operational_constraints`, which had three problems
this module exists to fix:

1. **Missing telemetry read as permission.** The old code, finding no equipment
   rows, set ``reason = "No live data available; assuming typical availability."``
   and left the feasibility multiplier at 1.0 — so a redeploy was approved on the
   strength of data that did not exist. Here, an unevaluated *hard* constraint
   blocks. Absence of evidence is not evidence of safety.

2. **Hard and soft mixed.** A DGMS-informed night-blast prohibition and a fuel
   preference were both "constraints" reducing the same scalar. They are
   different in kind: one is a rule, the other a trade-off. Hard constraints are
   never traded away; soft preferences only ever shape ranking.

3. **Silent evaluation.** Nothing distinguished "checked and passed" from "not
   checked". :class:`ConstraintOutcome` makes ``NOT_EVALUATED`` explicit and
   propagates it into evidence quality, so a manager sees the gap.

The evaluators below read live telemetry. Where a rule encodes regulation, the
citation is named in the reason text so it can be reviewed against the site's
actual approved procedures — Crucible AI asserts no regulatory authority of its own.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from functools import lru_cache
from typing import Any, Callable

from .db import query
from .memo import ttl_cache


class ConstraintKind(str, Enum):
    HARD = "HARD"    # never violated by a recommendation
    SOFT = "SOFT"    # shapes ranking, never blocks


class ConstraintOutcome(str, Enum):
    PASSED = "PASSED"
    FAILED = "FAILED"
    #: The check could not run — data missing, source unreachable. For a HARD
    #: constraint this is treated as blocking.
    NOT_EVALUATED = "NOT_EVALUATED"


@dataclass(frozen=True)
class ConstraintCheck:
    key: str
    label: str
    kind: ConstraintKind
    outcome: ConstraintOutcome
    #: Plain sentence: what was checked and what was found.
    reason: str
    #: The observation behind the verdict, quoted for audit.
    evidence: str | None = None
    #: Ranking penalty in 0..1 for SOFT constraints. Ignored for HARD.
    penalty: float = 0.0

    @property
    def blocking(self) -> bool:
        """Hard constraints block when failed *or* when they could not be run."""
        return self.kind is ConstraintKind.HARD and self.outcome is not ConstraintOutcome.PASSED

    def as_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "kind": self.kind.value,
            "outcome": self.outcome.value,
            "reason": self.reason,
            "evidence": self.evidence,
        }


@dataclass
class ConstraintReport:
    action_type: str
    checks: list[ConstraintCheck] = field(default_factory=list)

    @property
    def feasible(self) -> bool:
        return not any(c.blocking for c in self.checks)

    @property
    def blockers(self) -> list[ConstraintCheck]:
        return [c for c in self.checks if c.blocking]

    @property
    def evaluated_count(self) -> int:
        return sum(1 for c in self.checks if c.outcome is not ConstraintOutcome.NOT_EVALUATED)

    @property
    def relevant_count(self) -> int:
        return len(self.checks)

    @property
    def soft_penalty(self) -> float:
        """Ranking penalty from soft preferences that did NOT hold, capped at 1.

        Only unsatisfied checks contribute. A soft preference that passed is a
        reason for confidence, not a deduction from it.
        """
        return min(
            1.0,
            sum(
                c.penalty
                for c in self.checks
                if c.kind is ConstraintKind.SOFT and c.outcome is not ConstraintOutcome.PASSED
            ),
        )

    @property
    def reason(self) -> str:
        """One sentence a manager can act on."""
        blockers = self.blockers
        if not blockers:
            unevaluated = [c for c in self.checks if c.outcome is ConstraintOutcome.NOT_EVALUATED]
            if unevaluated:
                return (
                    f"Permitted. {len(unevaluated)} advisory check(s) could not be evaluated: "
                    + "; ".join(c.label for c in unevaluated)
                )
            return "All applicable operational constraints satisfied."

        unrunnable = [c for c in blockers if c.outcome is ConstraintOutcome.NOT_EVALUATED]
        failed = [c for c in blockers if c.outcome is ConstraintOutcome.FAILED]
        parts: list[str] = []
        if failed:
            parts.append(failed[0].reason)
        if unrunnable:
            parts.append(
                f"Cannot confirm {unrunnable[0].label.lower()} — {unrunnable[0].reason}"
            )
        return " ".join(parts)

    def as_dict(self) -> dict[str, Any]:
        return {
            "action_type": self.action_type,
            "feasible": self.feasible,
            "reason": self.reason,
            "checks": [c.as_dict() for c in self.checks],
            "constraints_checked": [c.key for c in self.checks],
            "evaluated": self.evaluated_count,
            "relevant": self.relevant_count,
        }


# ---------------------------------------------------------------------------
# Thresholds — named so they can be reviewed against site rules
# ---------------------------------------------------------------------------

#: Above this 24-hour failure probability a unit is not a redeploy candidate.
MAX_REDEPLOY_FAILURE_RISK = 0.60
#: Maintenance overdue beyond this is a lockout, not a deferral decision.
MAINTENANCE_LOCKOUT_DAYS = 14
#: Crusher speed increase beyond this exceeds motor vibration tolerance.
MAX_CRUSHER_TRIM = 0.20
#: Telemetry older than this cannot support a safety-relevant verdict.
MAX_TELEMETRY_AGE_HOURS = 12


@ttl_cache(ttl=20.0)
def _safe_query(sql: str, params: tuple) -> list[dict] | None:
    """Run a query, returning None (not []) when the source is unreachable.

    The distinction matters: ``[]`` means "checked, nothing there", ``None``
    means "could not check". Collapsing them is precisely the bug being fixed.

    Memoised for 20 seconds. Evaluating six candidate actions issues the same
    per-mine reads six times, and each costs a full round trip to a remote
    database. The window is deliberately short: a constraint verdict must reflect
    what a person would see if they looked now.
    """
    try:
        return query(sql, params)
    except Exception:  # noqa: BLE001 — any DB failure is "could not evaluate"
        return None


# ---------------------------------------------------------------------------
# Evaluators
# ---------------------------------------------------------------------------

def _equipment_redeploy(mine_id: str, details: dict[str, Any]) -> list[ConstraintCheck]:
    rows = _safe_query(
        """SELECT machine_id, equipment_type, failure_next_24h, maintenance_overdue_days
           FROM ops.equipment_telemetry
           WHERE mine_id = %s
           ORDER BY failure_next_24h ASC
           LIMIT 5""",
        (mine_id,),
    )

    if rows is None:
        return [
            ConstraintCheck(
                key="equipment_availability",
                label="A healthy unit is available to redeploy",
                kind=ConstraintKind.HARD,
                outcome=ConstraintOutcome.NOT_EVALUATED,
                reason="equipment telemetry is unavailable",
            )
        ]

    if not rows:
        return [
            ConstraintCheck(
                key="equipment_availability",
                label="A healthy unit is available to redeploy",
                kind=ConstraintKind.HARD,
                outcome=ConstraintOutcome.NOT_EVALUATED,
                reason=f"no equipment is registered against {mine_id}",
            )
        ]

    best = rows[0]
    risk = float(best.get("failure_next_24h") or 0.0)
    machine = best.get("machine_id")

    if risk > MAX_REDEPLOY_FAILURE_RISK:
        return [
            ConstraintCheck(
                key="equipment_availability",
                label="A healthy unit is available to redeploy",
                kind=ConstraintKind.HARD,
                outcome=ConstraintOutcome.FAILED,
                reason=(
                    f"No healthy machine available. The lowest-risk unit {machine} "
                    f"carries a {risk * 100:.0f}% 24-hour failure risk, above the "
                    f"{MAX_REDEPLOY_FAILURE_RISK * 100:.0f}% redeploy limit."
                ),
                evidence=f"{machine}: failure_next_24h={risk:.3f}",
            )
        ]

    return [
        ConstraintCheck(
            key="equipment_availability",
            label="A healthy unit is available to redeploy",
            kind=ConstraintKind.HARD,
            outcome=ConstraintOutcome.PASSED,
            reason=(
                f"{best.get('equipment_type') or 'Unit'} {machine} is available at "
                f"{risk * 100:.0f}% 24-hour failure risk."
            ),
            evidence=f"{machine}: failure_next_24h={risk:.3f}",
        )
    ]


def _blast_reschedule(mine_id: str, details: dict[str, Any]) -> list[ConstraintCheck]:
    shift = (details.get("shift") or "").upper()

    if not shift:
        return [
            ConstraintCheck(
                key="shift_safety_window",
                label="Blast falls inside a permitted shift window",
                kind=ConstraintKind.HARD,
                outcome=ConstraintOutcome.NOT_EVALUATED,
                reason="no shift was specified for the proposed blast",
            )
        ]

    # Night-shift blasting is prohibited under DGMS-informed site rules. Crucible AI
    # surfaces the rule; the site's approved procedure remains authoritative.
    if shift == "S3":
        outcome, reason = (
            ConstraintOutcome.FAILED,
            "Blasting is prohibited during the night shift (S3) under the "
            "DGMS-informed site rule configured for this mine.",
        )
    else:
        outcome, reason = (
            ConstraintOutcome.PASSED,
            f"Shift {shift} is a permitted blasting window.",
        )

    return [
        ConstraintCheck(
            key="shift_safety_window",
            label="Blast falls inside a permitted shift window",
            kind=ConstraintKind.HARD,
            outcome=outcome,
            reason=reason,
            evidence=f"shift={shift}",
        )
    ]


def _maintenance_defer(mine_id: str, details: dict[str, Any]) -> list[ConstraintCheck]:
    rows = _safe_query(
        """SELECT machine_id, maintenance_overdue_days
           FROM ops.equipment_telemetry
           WHERE mine_id = %s AND maintenance_overdue_days > %s
           ORDER BY maintenance_overdue_days DESC
           LIMIT 1""",
        (mine_id, MAINTENANCE_LOCKOUT_DAYS),
    )

    if rows is None:
        return [
            ConstraintCheck(
                key="maintenance_lockout",
                label="No unit is past its maintenance lockout",
                kind=ConstraintKind.HARD,
                outcome=ConstraintOutcome.NOT_EVALUATED,
                reason="maintenance records are unavailable",
            )
        ]

    if rows:
        unit = rows[0]
        days = unit.get("maintenance_overdue_days")
        return [
            ConstraintCheck(
                key="maintenance_lockout",
                label="No unit is past its maintenance lockout",
                kind=ConstraintKind.HARD,
                outcome=ConstraintOutcome.FAILED,
                reason=(
                    f"Unit {unit.get('machine_id')} is already {days} days overdue for "
                    f"service, past the {MAINTENANCE_LOCKOUT_DAYS}-day lockout. "
                    "Further deferral is refused."
                ),
                evidence=f"{unit.get('machine_id')}: maintenance_overdue_days={days}",
            )
        ]

    return [
        ConstraintCheck(
            key="maintenance_lockout",
            label="No unit is past its maintenance lockout",
            kind=ConstraintKind.HARD,
            outcome=ConstraintOutcome.PASSED,
            reason=(
                f"No unit at {mine_id} is more than {MAINTENANCE_LOCKOUT_DAYS} days "
                "overdue for service."
            ),
        ),
    ]


def _crusher_speed_trim(mine_id: str, details: dict[str, Any]) -> list[ConstraintCheck]:
    magnitude = details.get("magnitude")

    if magnitude is None:
        return [
            ConstraintCheck(
                key="crusher_vibration_limit",
                label="Speed increase is within motor vibration tolerance",
                kind=ConstraintKind.HARD,
                outcome=ConstraintOutcome.NOT_EVALUATED,
                reason="no throughput increase was specified",
            )
        ]

    magnitude = float(magnitude)
    if magnitude > MAX_CRUSHER_TRIM:
        outcome, reason = (
            ConstraintOutcome.FAILED,
            f"A {magnitude * 100:.0f}% throughput increase exceeds the "
            f"{MAX_CRUSHER_TRIM * 100:.0f}% motor vibration threshold.",
        )
    else:
        outcome, reason = (
            ConstraintOutcome.PASSED,
            f"A {magnitude * 100:.0f}% throughput increase is within the "
            f"{MAX_CRUSHER_TRIM * 100:.0f}% vibration threshold.",
        )

    return [
        ConstraintCheck(
            key="crusher_vibration_limit",
            label="Speed increase is within motor vibration tolerance",
            kind=ConstraintKind.HARD,
            outcome=outcome,
            reason=reason,
            evidence=f"magnitude={magnitude:.3f}",
        )
    ]


@lru_cache(maxsize=16)
def _route_exists(mine_id: str, lat: float, lon: float, vehicle_type: str) -> tuple[bool, str]:
    """Actually search for a compliant haul route, rather than assuming one.

    Cached because building the terrain surface and running A* is expensive and
    the answer only changes when conditions do. Returns (feasible, evidence).
    """
    from .routing import (
        NoRouteError,
        astar,
        build_cost_surface,
        get_vehicle,
        get_grid,
        load_config,
        Conditions,
    )

    cfg = load_config()
    grid = get_grid(mine_id, lat, lon, cfg.grid)
    surface = build_cost_surface(
        grid, cfg.weights, cfg.constraints, get_vehicle(vehicle_type), Conditions.from_payload(None)
    )

    open_cells = ~surface.blocked
    open_fraction = float(open_cells.mean())
    if open_fraction < 0.05:
        return False, f"only {open_fraction * 100:.1f}% of the haul network is traversable"

    # Pit centre to the most distant open cell: if that route exists, the network
    # is connected enough for a reallocation to have somewhere to go.
    centre = (grid.n // 2, grid.n // 2)
    if surface.blocked[centre]:
        import numpy as _np

        rows, cols = _np.nonzero(open_cells)
        if len(rows) == 0:
            return False, "no traversable cell exists in the haul network"
        idx = int(_np.argmin((rows - centre[0]) ** 2 + (cols - centre[1]) ** 2))
        centre = (int(rows[idx]), int(cols[idx]))

    import numpy as _np

    rows, cols = _np.nonzero(open_cells)
    far = int(_np.argmax((rows - centre[0]) ** 2 + (cols - centre[1]) ** 2))
    goal = (int(rows[far]), int(cols[far]))

    try:
        route = astar(surface, centre, goal, label="feasibility_probe")
    except NoRouteError as exc:
        return False, f"no traversable route across the haul network ({exc})"

    return True, f"probe route of {route.distance_km:.1f} km found across the haul network"


def _fleet_reroute(mine_id: str, details: dict[str, Any]) -> list[ConstraintCheck]:
    """Reroute feasibility is answered by the routing engine, not assumed.

    The engine already excludes blocked cells and enforces vehicle grade limits
    during the search, so asking it is both cheaper than reimplementing the rules
    and impossible to disagree with.
    """
    location = details.get("location")
    vehicle = details.get("vehicle_type") or "haul_truck"

    if not location:
        checks = [
            ConstraintCheck(
                key="route_feasibility",
                label="A compliant haul route exists",
                kind=ConstraintKind.HARD,
                outcome=ConstraintOutcome.NOT_EVALUATED,
                reason="mine coordinates are unavailable, so no route could be searched",
            )
        ]
    else:
        try:
            feasible, evidence = _route_exists(mine_id, float(location[0]), float(location[1]), vehicle)
        except Exception as exc:  # noqa: BLE001 — routing failure is "could not evaluate"
            checks = [
                ConstraintCheck(
                    key="route_feasibility",
                    label="A compliant haul route exists",
                    kind=ConstraintKind.HARD,
                    outcome=ConstraintOutcome.NOT_EVALUATED,
                    reason=f"the routing engine could not be consulted ({exc})",
                )
            ]
        else:
            checks = [
                ConstraintCheck(
                    key="route_feasibility",
                    label="A compliant haul route exists",
                    kind=ConstraintKind.HARD,
                    outcome=ConstraintOutcome.PASSED if feasible else ConstraintOutcome.FAILED,
                    reason=(
                        f"The routing engine confirms a compliant haul route for a "
                        f"{vehicle.replace('_', ' ')}: {evidence}."
                        if feasible
                        else f"No compliant haul route is available: {evidence}."
                    ),
                    evidence=evidence,
                )
            ]

    return checks


#: Statutory ceiling on continuous operating hours per shift. Named so it can be
#: reconciled against the site's own approved working-time rules.
MAX_SHIFT_OPERATING_HOURS = 12.0


def _extend_operating_hours(mine_id: str, details: dict[str, Any]) -> list[ConstraintCheck]:
    """Recovering operating time is bounded by working-time rules and by crew."""
    rows = _safe_query(
        """SELECT working_hours, operator_availability_pct
           FROM ops.production_records
           WHERE mine_id = %s
           ORDER BY date DESC
           LIMIT 1""",
        (mine_id,),
    )

    if rows is None or not rows:
        return [
            ConstraintCheck(
                key="working_time_limit",
                label="Extended running stays inside working-time limits",
                kind=ConstraintKind.HARD,
                outcome=ConstraintOutcome.NOT_EVALUATED,
                reason="no production record is available to establish current operating hours",
            )
        ]

    row = rows[0]
    magnitude = float(details.get("magnitude") or 0.0)
    current = row.get("working_hours")
    checks: list[ConstraintCheck] = []

    if current is None:
        checks.append(
            ConstraintCheck(
                key="working_time_limit",
                label="Extended running stays inside working-time limits",
                kind=ConstraintKind.HARD,
                outcome=ConstraintOutcome.NOT_EVALUATED,
                reason="current operating hours are not recorded for this mine",
            )
        )
    else:
        projected = float(current) * (1.0 + magnitude)
        if projected > MAX_SHIFT_OPERATING_HOURS:
            checks.append(
                ConstraintCheck(
                    key="working_time_limit",
                    label="Extended running stays inside working-time limits",
                    kind=ConstraintKind.HARD,
                    outcome=ConstraintOutcome.FAILED,
                    reason=(
                        f"Extending by {magnitude * 100:.0f}% would take operating time to "
                        f"{projected:.1f} h, past the {MAX_SHIFT_OPERATING_HOURS:.0f}-hour "
                        "shift limit."
                    ),
                    evidence=f"working_hours={float(current):.1f}",
                )
            )
        else:
            checks.append(
                ConstraintCheck(
                    key="working_time_limit",
                    label="Extended running stays inside working-time limits",
                    kind=ConstraintKind.HARD,
                    outcome=ConstraintOutcome.PASSED,
                    reason=(
                        f"Extending by {magnitude * 100:.0f}% takes operating time to "
                        f"{projected:.1f} h, inside the {MAX_SHIFT_OPERATING_HOURS:.0f}-hour limit."
                    ),
                    evidence=f"working_hours={float(current):.1f}",
                )
            )

    availability = row.get("operator_availability_pct")
    if availability is None:
        checks.append(
            ConstraintCheck(
                key="operator_availability",
                label="Enough operators are available to crew the extension",
                kind=ConstraintKind.SOFT,
                outcome=ConstraintOutcome.NOT_EVALUATED,
                reason="operator availability is not recorded for this mine",
                penalty=0.25,
            )
        )
    elif float(availability) < 80.0:
        checks.append(
            ConstraintCheck(
                key="operator_availability",
                label="Enough operators are available to crew the extension",
                kind=ConstraintKind.SOFT,
                outcome=ConstraintOutcome.FAILED,
                reason=(
                    f"Operator availability is {float(availability):.0f}%, which will "
                    "limit how much of the extension can actually be crewed."
                ),
                evidence=f"operator_availability_pct={float(availability):.1f}",
                penalty=0.2,
            )
        )
    else:
        checks.append(
            ConstraintCheck(
                key="operator_availability",
                label="Enough operators are available to crew the extension",
                kind=ConstraintKind.SOFT,
                outcome=ConstraintOutcome.PASSED,
                reason=f"Operator availability is {float(availability):.0f}%.",
                evidence=f"operator_availability_pct={float(availability):.1f}",
            )
        )

    return checks


_EVALUATORS: dict[str, Callable[[str, dict[str, Any]], list[ConstraintCheck]]] = {
    "equipment_redeploy": _equipment_redeploy,
    "blast_reschedule": _blast_reschedule,
    "maintenance_defer": _maintenance_defer,
    "crusher_speed_trim": _crusher_speed_trim,
    "fleet_reroute": _fleet_reroute,
    "extend_operating_hours": _extend_operating_hours,
}


def evaluate(action_type: str, mine_id: str, details: dict[str, Any] | None = None) -> ConstraintReport:
    """Evaluate every constraint relevant to a proposed action.

    An action with no registered evaluator returns a report containing one
    NOT_EVALUATED hard check, which blocks it. Unknown actions are not assumed
    safe — adding an action type requires deciding what governs it.
    """
    details = details or {}
    evaluator = _EVALUATORS.get(action_type)

    if evaluator is None:
        return ConstraintReport(
            action_type=action_type,
            checks=[
                ConstraintCheck(
                    key="known_action",
                    label="Action has defined operational constraints",
                    kind=ConstraintKind.HARD,
                    outcome=ConstraintOutcome.NOT_EVALUATED,
                    reason=f"no constraint rules are defined for action '{action_type}'",
                )
            ],
        )

    checks = evaluator(mine_id, details)
    checks.extend(_telemetry_freshness(mine_id))
    return ConstraintReport(action_type=action_type, checks=checks)


def _telemetry_freshness(mine_id: str) -> list[ConstraintCheck]:
    """Stale telemetry undermines every other verdict, so it is checked once.

    Age is measured against :mod:`core.clock`, not the wall clock. The benchmark
    dataset this platform is developed against ends in 2024, so a wall-clock
    comparison would mark every observation stale forever and render the check
    meaningless. The clock's caveat is carried into the reason text so the
    reference point is never implicit.
    """
    from .clock import ClockMode, resolve_clock

    clock = resolve_clock(mine_id)

    if clock.mode is ClockMode.UNKNOWN:
        return [
            ConstraintCheck(
                key="telemetry_freshness",
                label="Telemetry is recent enough to act on",
                kind=ConstraintKind.SOFT,
                outcome=ConstraintOutcome.NOT_EVALUATED,
                reason="no dated observations are available for this mine",
                penalty=0.3,
            )
        ]

    rows = _safe_query(
        "SELECT MAX(datetime) AS newest FROM ops.equipment_telemetry WHERE mine_id = %s",
        (mine_id,),
    )
    newest = rows[0].get("newest") if rows else None

    if newest is None:
        return [
            ConstraintCheck(
                key="telemetry_freshness",
                label="Telemetry is recent enough to act on",
                kind=ConstraintKind.SOFT,
                outcome=ConstraintOutcome.NOT_EVALUATED,
                reason="no equipment telemetry timestamp is available for this mine",
                penalty=0.3,
            )
        ]

    age_s = clock.age_seconds(newest)
    age_h = (age_s or 0.0) / 3600.0
    suffix = f" ({clock.caveat})" if clock.caveat else ""

    if age_h > MAX_TELEMETRY_AGE_HOURS:
        return [
            ConstraintCheck(
                key="telemetry_freshness",
                label="Telemetry is recent enough to act on",
                kind=ConstraintKind.SOFT,
                outcome=ConstraintOutcome.FAILED,
                reason=(
                    f"Newest telemetry is {age_h:.1f} hours old, beyond the "
                    f"{MAX_TELEMETRY_AGE_HOURS}-hour acting window.{suffix}"
                ),
                evidence=f"newest={newest.isoformat(timespec='seconds')}",
                penalty=0.4,
            )
        ]

    return [
        ConstraintCheck(
            key="telemetry_freshness",
            label="Telemetry is recent enough to act on",
            kind=ConstraintKind.SOFT,
            outcome=ConstraintOutcome.PASSED,
            reason=f"Newest telemetry is {age_h:.1f} hours old.{suffix}",
            evidence=f"newest={newest.isoformat(timespec='seconds')}",
        )
    ]


__all__ = [
    "ConstraintCheck",
    "ConstraintKind",
    "ConstraintOutcome",
    "ConstraintReport",
    "evaluate",
]
