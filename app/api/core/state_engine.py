"""app/api/core/state_engine.py — is the mine in a state that needs attention?

Replaces the "Mine Pulse" score. A number out of 100 is the wrong output for a
manager opening the platform at shift start: 82 does not say whether to act, and
blending production, equipment, exploration, data quality and governance into
one figure mixes scopes so thoroughly that the result cannot mean anything. A
mine cannot be 82% operational.

Two separate answers instead, because they are different questions with
different audiences:

* :func:`mine_state` — **operational**. Is this mine running normally?
  NORMAL / WATCH / DISRUPTION / CRITICAL.
* :func:`platform_state` — **data and model health**. Can the platform be
  trusted right now? Kept apart so a stale feed never reads as a production
  problem, and a production problem never hides behind good data hygiene.

The state is the worst severity among its signals, and every signal names the
value, source, timestamp and threshold that produced it. A manager can therefore
always answer "why does it say WATCH?" without leaving the page, and the state
is reproducible from the signals shown.
"""

from __future__ import annotations

import datetime as _dt
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from .bottleneck import CONSTRAINED_UTILISATION, SATURATED_UTILISATION, analyse
from .clock import resolve_clock
from .db import query
from .memo import ttl_cache
from .provenance import CalculationMode, DataFreshness, Scope

logger = logging.getLogger("crucible.state")


class Severity(str, Enum):
    NONE = "NONE"
    WATCH = "WATCH"
    DISRUPTION = "DISRUPTION"
    CRITICAL = "CRITICAL"

    @property
    def rank(self) -> int:
        return {"NONE": 0, "WATCH": 1, "DISRUPTION": 2, "CRITICAL": 3}[self.value]


class OperationalState(str, Enum):
    NORMAL = "NORMAL"
    WATCH = "WATCH"
    DISRUPTION = "DISRUPTION"
    CRITICAL = "CRITICAL"
    #: Not a state of the mine but of our knowledge of it. Distinct from NORMAL,
    #: which would otherwise be reported for a mine nobody is measuring.
    UNKNOWN = "UNKNOWN"


#: Thresholds. Named and exported so they can be reviewed and tuned against a
#: site's own tolerances rather than being buried in comparisons.
PRODUCTION_GAP_WATCH_PCT = 5.0
PRODUCTION_GAP_DISRUPTION_PCT = 12.0
PRODUCTION_GAP_CRITICAL_PCT = 25.0

EQUIPMENT_RISK_WATCH = 0.35
EQUIPMENT_RISK_DISRUPTION = 0.55

MAINTENANCE_OVERDUE_WATCH_DAYS = 7
MAINTENANCE_OVERDUE_CRITICAL_DAYS = 21


@dataclass
class Signal:
    """One observation contributing to the state."""

    key: str
    label: str
    severity: Severity
    #: The measured quantity. None when the signal could not be evaluated.
    value: float | None
    unit: str
    #: Plain sentence: what was measured and why it matters.
    reason: str
    source: str
    scope: Scope
    observed_at: str | None = None
    #: The threshold this value was compared against.
    threshold: float | None = None
    calculation_mode: CalculationMode = CalculationMode.MODEL_BACKED
    #: Where a manager should go to act on this.
    deep_link: str | None = None
    evidence: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "severity": self.severity.value,
            "value": round(self.value, 2) if self.value is not None else None,
            "unit": self.unit,
            "reason": self.reason,
            "source": self.source,
            "scope": self.scope.value,
            "observed_at": self.observed_at,
            "threshold": self.threshold,
            "calculation_mode": self.calculation_mode.value,
            "deep_link": self.deep_link,
            "evidence": self.evidence,
        }


def _num(row: dict | None, key: str) -> float | None:
    if not row:
        return None
    value = row.get(key)
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Operational signals
# ---------------------------------------------------------------------------

def _production_signal(mine_id: str, clock) -> Signal:
    rows = query(
        """SELECT date, shift, planned_production_t, actual_production_t
           FROM ops.production_records
           WHERE mine_id = %s AND actual_production_t IS NOT NULL
           ORDER BY date DESC
           LIMIT 5""",
        (mine_id,),
    )

    if not rows:
        return Signal(
            key="production_gap",
            label="Production against plan",
            severity=Severity.NONE,
            value=None,
            unit="%",
            reason="No production records exist for this mine.",
            source="ops.production_records",
            scope=Scope.MINE,
            calculation_mode=CalculationMode.INSUFFICIENT_DATA,
            deep_link="/operations/production",
        )

    # Five shifts rather than one: a single bad shift is noise, a run is a trend.
    planned = sum(_num(r, "planned_production_t") or 0.0 for r in rows)
    actual = sum(_num(r, "actual_production_t") or 0.0 for r in rows)

    if planned <= 0:
        return Signal(
            key="production_gap",
            label="Production against plan",
            severity=Severity.NONE,
            value=None,
            unit="%",
            reason="No production plan is recorded for the recent shifts.",
            source="ops.production_records",
            scope=Scope.MINE,
            calculation_mode=CalculationMode.INSUFFICIENT_DATA,
            deep_link="/operations/production",
        )

    gap_t = planned - actual
    gap_pct = 100.0 * gap_t / planned

    if gap_pct >= PRODUCTION_GAP_CRITICAL_PCT:
        severity, threshold = Severity.CRITICAL, PRODUCTION_GAP_CRITICAL_PCT
    elif gap_pct >= PRODUCTION_GAP_DISRUPTION_PCT:
        severity, threshold = Severity.DISRUPTION, PRODUCTION_GAP_DISRUPTION_PCT
    elif gap_pct >= PRODUCTION_GAP_WATCH_PCT:
        severity, threshold = Severity.WATCH, PRODUCTION_GAP_WATCH_PCT
    else:
        severity, threshold = Severity.NONE, PRODUCTION_GAP_WATCH_PCT

    if gap_pct < 0:
        reason = (
            f"Production is {abs(gap_pct):.1f}% ahead of plan over the last "
            f"{len(rows)} shifts ({actual:,.0f} t against {planned:,.0f} t planned)."
        )
    else:
        reason = (
            f"Production is {gap_pct:.1f}% below plan over the last {len(rows)} "
            f"shifts — {gap_t:,.0f} t short of {planned:,.0f} t planned."
        )

    return Signal(
        key="production_gap",
        label="Production against plan",
        severity=severity,
        value=gap_pct,
        unit="%",
        reason=reason,
        source="ops.production_records",
        scope=Scope.MINE,
        observed_at=str(rows[0].get("date")),
        threshold=threshold,
        deep_link="/operations/production",
        evidence={
            "shifts_considered": len(rows),
            "planned_t": round(planned, 1),
            "actual_t": round(actual, 1),
            "gap_t": round(gap_t, 1),
        },
    )


def _equipment_signal(mine_id: str, clock) -> Signal:
    """Failure exposure across the fleet.

    Reads `failure_next_24h` per machine at its most recent observation. The
    column is an INTEGER 0/1 label in this schema, so the mean across machines is
    the share of the fleet flagged, not a calibrated probability — the reason
    text says which.
    """
    rows = query(
        """SELECT DISTINCT ON (machine_id)
                  machine_id, equipment_type, failure_next_24h,
                  maintenance_overdue_days, datetime
           FROM ops.equipment_telemetry
           WHERE mine_id = %s
           ORDER BY machine_id, datetime DESC""",
        (mine_id,),
    )

    if not rows:
        return Signal(
            key="equipment_risk",
            label="Equipment failure exposure",
            severity=Severity.NONE,
            value=None,
            unit="share",
            reason="No equipment telemetry exists for this mine.",
            source="ops.equipment_telemetry",
            scope=Scope.MINE,
            calculation_mode=CalculationMode.INSUFFICIENT_DATA,
            deep_link="/equipment",
        )

    flagged = [r for r in rows if (_num(r, "failure_next_24h") or 0.0) > 0.5]
    share = len(flagged) / len(rows)

    if share >= EQUIPMENT_RISK_DISRUPTION:
        severity, threshold = Severity.DISRUPTION, EQUIPMENT_RISK_DISRUPTION
    elif share >= EQUIPMENT_RISK_WATCH:
        severity, threshold = Severity.WATCH, EQUIPMENT_RISK_WATCH
    else:
        severity, threshold = Severity.NONE, EQUIPMENT_RISK_WATCH

    if flagged:
        names = ", ".join(str(r["machine_id"]) for r in flagged[:3])
        more = f" and {len(flagged) - 3} more" if len(flagged) > 3 else ""
        reason = (
            f"{len(flagged)} of {len(rows)} machines are flagged for failure within "
            f"24 hours ({names}{more})."
        )
    else:
        reason = f"None of the {len(rows)} machines are flagged for near-term failure."

    return Signal(
        key="equipment_risk",
        label="Equipment failure exposure",
        severity=severity,
        value=share,
        unit="share",
        reason=reason,
        source="ops.equipment_telemetry",
        scope=Scope.MINE,
        observed_at=str(rows[0].get("datetime")),
        threshold=threshold,
        deep_link="/equipment",
        evidence={
            "machines": len(rows),
            "flagged": len(flagged),
            "flagged_ids": [str(r["machine_id"]) for r in flagged[:10]],
            "note": (
                "failure_next_24h is a 0/1 label in this schema, so this is the "
                "share of the fleet flagged rather than a calibrated probability."
            ),
        },
    )


def _maintenance_signal(mine_id: str, clock) -> Signal:
    rows = query(
        """SELECT DISTINCT ON (machine_id)
                  machine_id, maintenance_overdue_days, datetime
           FROM ops.equipment_telemetry
           WHERE mine_id = %s AND maintenance_overdue_days IS NOT NULL
           ORDER BY machine_id, datetime DESC""",
        (mine_id,),
    )

    if not rows:
        return Signal(
            key="maintenance_overdue",
            label="Maintenance backlog",
            severity=Severity.NONE,
            value=None,
            unit="days",
            reason="No maintenance records exist for this mine.",
            source="ops.equipment_telemetry",
            scope=Scope.MINE,
            calculation_mode=CalculationMode.INSUFFICIENT_DATA,
            deep_link="/equipment",
        )

    worst = max(rows, key=lambda r: _num(r, "maintenance_overdue_days") or 0.0)
    days = _num(worst, "maintenance_overdue_days") or 0.0
    overdue = [r for r in rows if (_num(r, "maintenance_overdue_days") or 0.0) > 0]

    if days >= MAINTENANCE_OVERDUE_CRITICAL_DAYS:
        severity, threshold = Severity.DISRUPTION, MAINTENANCE_OVERDUE_CRITICAL_DAYS
    elif days >= MAINTENANCE_OVERDUE_WATCH_DAYS:
        severity, threshold = Severity.WATCH, MAINTENANCE_OVERDUE_WATCH_DAYS
    else:
        severity, threshold = Severity.NONE, MAINTENANCE_OVERDUE_WATCH_DAYS

    return Signal(
        key="maintenance_overdue",
        label="Maintenance backlog",
        severity=severity,
        value=days,
        unit="days",
        reason=(
            f"{len(overdue)} of {len(rows)} machines are overdue for service; the "
            f"worst is {worst['machine_id']} at {days:.0f} days."
            if overdue
            else f"No machine at this mine is overdue for service."
        ),
        source="ops.equipment_telemetry",
        scope=Scope.MINE,
        observed_at=str(worst.get("datetime")),
        threshold=threshold,
        deep_link="/equipment",
        evidence={
            "machines": len(rows),
            "overdue": len(overdue),
            "worst_machine": str(worst["machine_id"]),
            "worst_days": round(days, 1),
        },
    )


def _bottleneck_signal(mine_id: str, clock) -> Signal:
    report = analyse(mine_id)
    bottleneck = report.get("bottleneck")

    if not bottleneck:
        return Signal(
            key="bottleneck",
            label="Material flow constraint",
            severity=Severity.NONE,
            value=None,
            unit="%",
            reason=report.get("unavailable_reason") or "No stage could be measured.",
            source="core.bottleneck",
            scope=Scope.MINE,
            calculation_mode=CalculationMode.INSUFFICIENT_DATA,
            deep_link="/operations/bottlenecks",
        )

    utilisation = (bottleneck["utilisation_pct"] or 0.0) / 100.0

    if utilisation >= SATURATED_UTILISATION:
        severity, threshold = Severity.DISRUPTION, SATURATED_UTILISATION * 100
    elif utilisation >= CONSTRAINED_UTILISATION:
        severity, threshold = Severity.WATCH, CONSTRAINED_UTILISATION * 100
    else:
        severity, threshold = Severity.NONE, CONSTRAINED_UTILISATION * 100

    return Signal(
        key="bottleneck",
        label="Material flow constraint",
        severity=severity,
        value=bottleneck["utilisation_pct"],
        unit="%",
        reason=bottleneck["reason"],
        source="core.bottleneck",
        scope=Scope.MINE,
        observed_at=report.get("as_of"),
        threshold=threshold,
        calculation_mode=CalculationMode(bottleneck["calculation_mode"]),
        deep_link="/operations/bottlenecks",
        evidence={"stage": bottleneck["stage"], "headroom_t": bottleneck["headroom_t"]},
    )


def _open_incident_signal(mine_id: str, clock) -> Signal:
    rows = query(
        """SELECT severity, COUNT(*) AS n
           FROM ops.incidents
           WHERE mine_id = %s AND status IN ('OPEN','ACKNOWLEDGED','RESPONDING')
           GROUP BY severity""",
        (mine_id,),
    )
    counts = {r["severity"]: int(r["n"]) for r in rows}
    total = sum(counts.values())

    if counts.get("CRITICAL"):
        severity = Severity.CRITICAL
    elif counts.get("HIGH"):
        severity = Severity.DISRUPTION
    elif total:
        severity = Severity.WATCH
    else:
        severity = Severity.NONE

    return Signal(
        key="open_incidents",
        label="Open incidents",
        severity=severity,
        value=float(total),
        unit="incidents",
        reason=(
            "No incidents are currently open."
            if not total
            else f"{total} open incident(s): "
            + ", ".join(f"{n} {sev.lower()}" for sev, n in sorted(counts.items()))
        ),
        source="ops.incidents",
        scope=Scope.MINE,
        threshold=1,
        deep_link="/incidents",
        evidence=counts,
    )


# ---------------------------------------------------------------------------
# Platform signals — deliberately a separate scope
# ---------------------------------------------------------------------------

def _freshness_signal(mine_id: str, clock) -> Signal:
    """Data age. PLATFORM scope: stale data is our problem, not the mine's."""
    epoch = clock.dataset_epoch

    if epoch is None:
        return Signal(
            key="data_freshness",
            label="Data freshness",
            severity=Severity.DISRUPTION,
            value=None,
            unit="hours",
            reason="No dated observations are available for this mine.",
            source="core.clock",
            scope=Scope.PLATFORM,
            calculation_mode=CalculationMode.INSUFFICIENT_DATA,
            deep_link="/data",
        )

    if clock.is_benchmark:
        return Signal(
            key="data_freshness",
            label="Data freshness",
            severity=Severity.WATCH,
            value=clock.wall_clock_lag_days,
            unit="days",
            reason=(
                f"This mine is running on a benchmark dataset whose most recent "
                f"observation is {epoch.strftime('%d %b %Y')}, "
                f"{clock.wall_clock_lag_days:.0f} days ago. Operational readings "
                "describe that period, not the present."
            ),
            source="core.clock",
            scope=Scope.PLATFORM,
            observed_at=epoch.isoformat(timespec="seconds"),
            calculation_mode=CalculationMode.MODEL_BACKED,
            deep_link="/data",
            evidence={"mode": clock.mode.value, "lag_days": round(clock.wall_clock_lag_days, 1)},
        )

    age_h = (
        _dt.datetime.now(_dt.timezone.utc) - epoch
    ).total_seconds() / 3600.0
    freshness = DataFreshness.from_age(age_h * 3600)
    severity = {
        DataFreshness.LIVE: Severity.NONE,
        DataFreshness.RECENT: Severity.NONE,
        DataFreshness.STALE: Severity.WATCH,
        DataFreshness.EXPIRED: Severity.DISRUPTION,
    }[freshness]

    return Signal(
        key="data_freshness",
        label="Data freshness",
        severity=severity,
        value=age_h,
        unit="hours",
        reason=f"Newest observation is {age_h:.1f} hours old ({freshness.value.lower()}).",
        source="core.clock",
        scope=Scope.PLATFORM,
        observed_at=epoch.isoformat(timespec="seconds"),
        deep_link="/data",
    )


@ttl_cache(ttl=60.0)
def _model_signal_cached() -> Signal:
    """Whether the approved champions are the ones actually serving."""
    from .ml_loader import ensure_active_model

    tasks = ("production_forecast", "shortfall", "equipment_failure", "prospectivity")
    statuses: dict[str, str] = {}
    missing: list[str] = []

    for task in tasks:
        try:
            model, meta = ensure_active_model(task)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Serving check failed for %s: %s", task, exc)
            statuses[task] = "ERROR"
            missing.append(task)
            continue
        status = str((meta or {}).get("serving_status") or "UNKNOWN")
        statuses[task] = status
        if model is None or status not in ("SYNCED",):
            missing.append(task)

    if not missing:
        severity = Severity.NONE
        reason = f"All {len(tasks)} models are serving and in sync with the registry."
    elif len(missing) == len(tasks):
        severity = Severity.DISRUPTION
        reason = "No model is serving; every prediction would be heuristic."
    else:
        severity = Severity.WATCH
        reason = (
            f"{len(missing)} of {len(tasks)} models are not serving the approved "
            f"champion: {', '.join(missing)}."
        )

    return Signal(
        key="model_serving",
        label="Model serving integrity",
        severity=severity,
        value=float(len(tasks) - len(missing)),
        unit="models",
        reason=reason,
        source="core.ml_loader",
        scope=Scope.PLATFORM,
        threshold=float(len(tasks)),
        deep_link="/models",
        evidence=statuses,
    )


def _model_signal(mine_id: str, clock) -> Signal:
    """Serving integrity is platform-wide, so it does not vary by mine."""
    return _model_signal_cached()


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------

_OPERATIONAL = (
    _production_signal,
    _equipment_signal,
    _maintenance_signal,
    _bottleneck_signal,
    _open_incident_signal,
)

_PLATFORM = (_freshness_signal, _model_signal)


def _failed_signal(build, exc: Exception) -> Signal:
    """A check that could not run is reported, never dropped.

    Dropping it would quietly *raise* the state, because state is the worst
    severity among the signals that remain — so a broken equipment check would
    make a mine look healthier than it is.
    """
    name = build.__name__.strip("_")
    return Signal(
        key=name,
        label=name.replace("_signal", "").replace("_", " ").title(),
        severity=Severity.WATCH,
        value=None,
        unit="",
        reason=f"This check could not be evaluated: {type(exc).__name__}.",
        source="core.state_engine",
        scope=Scope.PLATFORM,
        calculation_mode=CalculationMode.INSUFFICIENT_DATA,
    )


def _collect(builders, mine_id: str, clock) -> list[Signal]:
    """Evaluate every signal, concurrently.

    The signals are independent and each is dominated by database round-trip
    latency rather than by computation, so running them in sequence costs the sum
    of their waits. Evaluated together they cost roughly the slowest one.

    Order is preserved regardless of completion order: the page's signal list
    should not reshuffle between refreshes.
    """
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=len(builders)) as pool:
        futures = [(build, pool.submit(build, mine_id, clock)) for build in builders]

        signals: list[Signal] = []
        for build, future in futures:
            try:
                signals.append(future.result())
            except Exception as exc:  # noqa: BLE001
                logger.exception("State signal %s failed for %s", build.__name__, mine_id)
                signals.append(_failed_signal(build, exc))

    return signals


def _state_from(signals: list[Signal]) -> OperationalState:
    """State is the worst severity present.

    Not an average. Averaging lets four healthy signals bury one critical one,
    which is the failure mode of a composite score.
    """
    evaluated = [s for s in signals if s.calculation_mode is not CalculationMode.INSUFFICIENT_DATA]
    if not evaluated:
        return OperationalState.UNKNOWN

    worst = max(evaluated, key=lambda s: s.severity.rank).severity
    return {
        Severity.NONE: OperationalState.NORMAL,
        Severity.WATCH: OperationalState.WATCH,
        Severity.DISRUPTION: OperationalState.DISRUPTION,
        Severity.CRITICAL: OperationalState.CRITICAL,
    }[worst]


def _headline(state: OperationalState, signals: list[Signal]) -> str:
    if state is OperationalState.UNKNOWN:
        return "The platform has no measurable signals for this mine."
    if state is OperationalState.NORMAL:
        return "All measured signals are within their normal range."

    driving = sorted(
        [s for s in signals if s.severity.rank > 0],
        key=lambda s: s.severity.rank,
        reverse=True,
    )
    if not driving:
        return "State could not be attributed to a specific signal."

    lead = driving[0]
    text = lead.reason
    if len(driving) > 1:
        text += f" Also contributing: {driving[1].label.lower()}."
    return text


def mine_state(mine_id: str) -> dict[str, Any]:
    """Operational state of one mine, with every signal behind it."""
    clock = resolve_clock(mine_id)
    signals = _collect(_OPERATIONAL, mine_id, clock)
    state = _state_from(signals)

    return {
        "mine_id": mine_id,
        "scope": Scope.MINE.value,
        "state": state.value,
        "headline": _headline(state, signals),
        "signals": [s.as_dict() for s in signals],
        "unmeasured": [
            s.key for s in signals if s.calculation_mode is CalculationMode.INSUFFICIENT_DATA
        ],
        "clock": clock.as_dict(),
        "evaluated_at": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
    }


def platform_state(mine_id: str | None = None) -> dict[str, Any]:
    """Data and model health. Deliberately not merged into the mine's state."""
    # Same key as every other caller, so the clock cache actually hits. Resolving
    # under `None` here made this the only path paying for a fresh resolution.
    clock = resolve_clock(mine_id)
    signals = _collect(_PLATFORM, mine_id or "", clock)
    state = _state_from(signals)

    return {
        "scope": Scope.PLATFORM.value,
        "state": state.value,
        "headline": _headline(state, signals),
        "signals": [s.as_dict() for s in signals],
        "clock": clock.as_dict(),
        "evaluated_at": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
    }


__all__ = [
    "OperationalState",
    "Severity",
    "Signal",
    "mine_state",
    "platform_state",
]
