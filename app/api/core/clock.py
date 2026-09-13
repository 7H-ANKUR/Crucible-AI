"""app/api/core/clock.py — what "now" means for a given mine.

Crucible AI is developed against a historical operational benchmark: equipment
telemetry ends 2024-10-31 and production records end 2025-06-30. Measuring
freshness against the wall clock would therefore mark every observation EXPIRED
in perpetuity, which has two bad consequences — every evidence grade pinned to
LOW regardless of the actual data, and a Command Center that reports "no recent
telemetry" on a mine whose records are complete.

The wrong fixes are worse than the problem. Ignoring freshness entirely throws
away a real signal. Pretending the newest row arrived moments ago is a lie of
exactly the kind this rebuild exists to remove.

So the reference point is made explicit instead. Freshness is measured against
:attr:`OperationalClock.reference_time`, which is:

* **LIVE mode** — the wall clock, when the newest observation is recent enough
  that the feed is plausibly connected to a running mine.
* **BENCHMARK mode** — the newest observation in the dataset, when it is not.

In BENCHMARK mode the clock reports `wall_clock_lag_days`, and every surface
that shows a freshness value is expected to show the dataset epoch alongside it.
A row is then "live" relative to a stated point in time, which is a true
statement, rather than relative to an unstated one, which is not.
"""

from __future__ import annotations

import datetime as _dt
import logging
from dataclasses import dataclass
from enum import Enum

from .db import query

logger = logging.getLogger("crucible.clock")

#: Beyond this, a feed is not plausibly attached to a running operation and the
#: clock switches to BENCHMARK. One working day plus margin.
LIVE_THRESHOLD_HOURS = 36


class ClockMode(str, Enum):
    LIVE = "LIVE"
    BENCHMARK = "BENCHMARK"
    #: No observations at all — freshness is not merely stale, it is unknowable.
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True)
class OperationalClock:
    mode: ClockMode
    #: The point in time freshness is measured against.
    reference_time: _dt.datetime
    #: Newest observation found, across the sources consulted.
    dataset_epoch: _dt.datetime | None
    #: How far the dataset trails real time. Zero in LIVE mode.
    wall_clock_lag_days: float

    @property
    def is_benchmark(self) -> bool:
        return self.mode is ClockMode.BENCHMARK

    def age_seconds(self, observed_at: _dt.datetime | None) -> float | None:
        """Age of an observation relative to this clock's reference point."""
        if observed_at is None:
            return None
        if observed_at.tzinfo is None:
            observed_at = observed_at.replace(tzinfo=_dt.timezone.utc)
        return (self.reference_time - observed_at).total_seconds()

    @property
    def caveat(self) -> str | None:
        """The sentence a surface must show next to any freshness value."""
        if self.mode is ClockMode.LIVE:
            return None
        if self.mode is ClockMode.UNKNOWN:
            return "No dated observations are available for this mine."
        epoch = self.dataset_epoch.strftime("%d %b %Y") if self.dataset_epoch else "an unknown date"
        return (
            f"Benchmark dataset. Freshness is measured against the most recent "
            f"observation ({epoch}), not against the current date."
        )

    def as_dict(self) -> dict:
        return {
            "mode": self.mode.value,
            "reference_time": self.reference_time.isoformat(timespec="seconds"),
            "dataset_epoch": (
                self.dataset_epoch.isoformat(timespec="seconds") if self.dataset_epoch else None
            ),
            "wall_clock_lag_days": round(self.wall_clock_lag_days, 1),
            "caveat": self.caveat,
        }


def _newest_observation(mine_id: str | None) -> _dt.datetime | None:
    """Newest dated observation across the operational sources.

    Uses ``ops.equipment_telemetry.datetime`` — the canonical TIMESTAMPTZ column.
    The sibling ``timestamp`` column is legacy TEXT holding values like
    ``'2024-10-31-S3'``; ordering by it is a lexical sort that only coincidentally
    matches chronology, so it is not used here.
    """
    candidates: list[_dt.datetime] = []

    equip_sql = "SELECT MAX(datetime) AS newest FROM ops.equipment_telemetry"
    prod_sql = "SELECT MAX(date) AS newest FROM ops.production_records"
    params: tuple = ()
    if mine_id:
        equip_sql += " WHERE mine_id = %s"
        prod_sql += " WHERE mine_id = %s"
        params = (mine_id,)

    for sql in (equip_sql, prod_sql):
        try:
            rows = query(sql, params)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Clock source unavailable (%s): %s", sql.split()[3], exc)
            continue
        if not rows:
            continue
        value = rows[0].get("newest")
        if value is None:
            continue
        if isinstance(value, _dt.datetime):
            candidates.append(value if value.tzinfo else value.replace(tzinfo=_dt.timezone.utc))
        elif isinstance(value, _dt.date):
            # A production row is dated, not timestamped. Treating it as the end
            # of that day is the least generous reading that is still fair —
            # midnight would make same-day records look a shift older than they are.
            candidates.append(
                _dt.datetime.combine(value, _dt.time(23, 59), tzinfo=_dt.timezone.utc)
            )

    return max(candidates) if candidates else None


#: Cached resolutions, keyed by mine. The clock costs two round trips and is
#: consulted on nearly every code path; against a remote database that is the
#: single largest source of latency in the platform.
_CACHE: dict[str | None, tuple[float, "OperationalClock"]] = {}

#: Short enough that connecting a live feed flips the mode within a minute,
#: long enough that one page load does not pay for it a dozen times.
CLOCK_TTL_SECONDS = 60.0


def clear_cache() -> None:
    """Drop cached clocks — call when new operational data lands."""
    _CACHE.clear()


def resolve_clock(mine_id: str | None = None, *, refresh: bool = False) -> OperationalClock:
    """Determine the reference "now" for a mine.

    Cached for :data:`CLOCK_TTL_SECONDS`. The underlying pair of MAX() reads is
    indexed and cheap server-side, but each costs a full round trip, and this is
    called from the state engine, every constraint evaluation and every scenario
    context.
    """
    import time as _time

    if not refresh:
        cached = _CACHE.get(mine_id)
        if cached is not None and (_time.monotonic() - cached[0]) < CLOCK_TTL_SECONDS:
            return cached[1]

    clock = _resolve_uncached(mine_id)
    _CACHE[mine_id] = (_time.monotonic(), clock)
    return clock


def _resolve_uncached(mine_id: str | None) -> OperationalClock:
    now = _dt.datetime.now(_dt.timezone.utc)
    epoch = _newest_observation(mine_id)

    if epoch is None:
        return OperationalClock(
            mode=ClockMode.UNKNOWN,
            reference_time=now,
            dataset_epoch=None,
            wall_clock_lag_days=0.0,
        )

    lag_hours = (now - epoch).total_seconds() / 3600.0

    if lag_hours <= LIVE_THRESHOLD_HOURS:
        return OperationalClock(
            mode=ClockMode.LIVE,
            reference_time=now,
            dataset_epoch=epoch,
            wall_clock_lag_days=0.0,
        )

    return OperationalClock(
        mode=ClockMode.BENCHMARK,
        reference_time=epoch,
        dataset_epoch=epoch,
        wall_clock_lag_days=lag_hours / 24.0,
    )


__all__ = [
    "CLOCK_TTL_SECONDS", "ClockMode", "LIVE_THRESHOLD_HOURS",
    "OperationalClock", "clear_cache", "resolve_clock",
]
