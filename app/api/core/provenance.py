"""app/api/core/provenance.py — how Crucible AI states what it knows and how well.

Every number a manager acts on must say three things about itself:

  * **how it was produced** — :class:`CalculationMode`
  * **what it describes** — :class:`Scope`
  * **what it rests on** — :class:`Provenance`

and, where a judgement is being offered rather than a measurement,

  * **how well-supported it is** — :class:`EvidenceQuality`

`EvidenceQuality` deliberately replaces the confidence percentages the platform
used to emit. A percentage implies a calibrated probability; the values it
replaced were two-branch constants. A four-level qualitative grade that lists
the factors behind it is both more honest and more useful, because a manager can
see *why* the support is thin and go fix that.

Calibrated model probabilities are a separate thing entirely and keep their
numeric form — see `contracts.ShortfallRiskInfo.probability`. The rule is:
a percentage is only ever shown when a model produced it.
"""

from __future__ import annotations

import datetime as _dt
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# How a value was produced
# ---------------------------------------------------------------------------

class CalculationMode(str, Enum):
    """Provenance of a computed value.

    ``INSUFFICIENT_DATA`` is a first-class outcome, not an error. It means the
    platform *could* have guessed and chose not to. Callers must render it as an
    absence, never substitute a default.
    """

    MODEL_BACKED = "MODEL_BACKED"
    HEURISTIC = "HEURISTIC"
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"


# ---------------------------------------------------------------------------
# What a value describes
# ---------------------------------------------------------------------------

class Scope(str, Enum):
    """The subject a metric refers to.

    Mixing scopes inside one aggregate is how a platform ends up with an
    "overall score" that blends mine-level production against regional
    prospectivity. Tagging every metric prevents that at the type level.
    """

    MINE = "MINE"            # one mine's operations
    ASSET = "ASSET"          # one machine or unit
    SHIFT = "SHIFT"          # one shift at one mine
    TARGET = "TARGET"        # one exploration target
    REGIONAL = "REGIONAL"    # a geography spanning mines
    PLATFORM = "PLATFORM"    # Crucible AI itself: data health, model health


# ---------------------------------------------------------------------------
# How well-supported a judgement is
# ---------------------------------------------------------------------------

class EvidenceQuality(str, Enum):
    """Qualitative support grade. Always accompanied by its reasons."""

    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    UNAVAILABLE = "UNAVAILABLE"

    @property
    def rank(self) -> int:
        return {"UNAVAILABLE": 0, "LOW": 1, "MEDIUM": 2, "HIGH": 3}[self.value]

    def __lt__(self, other: object) -> bool:
        if not isinstance(other, EvidenceQuality):
            return NotImplemented
        return self.rank < other.rank


class DataFreshness(str, Enum):
    """Age band of the underlying observation."""

    LIVE = "LIVE"          # under 15 minutes
    RECENT = "RECENT"      # under 2 hours
    STALE = "STALE"        # under 24 hours
    EXPIRED = "EXPIRED"    # older, or unknown

    @staticmethod
    def from_age(seconds: float | None) -> "DataFreshness":
        if seconds is None or seconds < 0:
            return DataFreshness.EXPIRED
        if seconds < 900:
            return DataFreshness.LIVE
        if seconds < 7200:
            return DataFreshness.RECENT
        if seconds < 86400:
            return DataFreshness.STALE
        return DataFreshness.EXPIRED


# ---------------------------------------------------------------------------
# What a value rests on
# ---------------------------------------------------------------------------

def _utcnow_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")


class Provenance(BaseModel):
    """The lineage of a computed value.

    Present on every prediction and every scenario result so that "why did Crucible AI
    say this?" is answerable from the response alone, without a log dive.
    """

    model_config = {"protected_namespaces": ()}

    generated_at: str = Field(default_factory=_utcnow_iso)
    #: Timestamp of the newest observation the value depends on.
    data_time: str | None = None
    #: Age of that observation when the value was produced.
    data_age_seconds: float | None = None
    freshness: DataFreshness = DataFreshness.EXPIRED

    model_version: str | None = None
    dataset_version: str | None = None
    feature_version: str | None = None
    #: SYNCED / SYNC_PENDING / SYNC_FAILED / UNAVAILABLE, from ml_loader.
    serving_status: str | None = None

    #: How many rows fed the computation. Zero is meaningful, not missing.
    source_records: int = 0
    data_origin: str = "SYNTHETIC"

    #: Stated plainly, in the manager's language, not the modeller's.
    assumptions: list[str] = Field(default_factory=list)
    #: Names of constraints that were actually evaluated.
    constraints_checked: list[str] = Field(default_factory=list)

    @classmethod
    def from_observation(
        cls,
        observed_at: _dt.datetime | str | None,
        **kwargs: Any,
    ) -> "Provenance":
        """Build provenance from the timestamp of the newest source row."""
        age: float | None = None
        iso: str | None = None

        if observed_at is not None:
            dt = observed_at
            if isinstance(dt, str):
                try:
                    dt = _dt.datetime.fromisoformat(dt.replace("Z", "+00:00"))
                except ValueError:
                    dt = None
            if isinstance(dt, _dt.datetime):
                # Rows written by a driver without tz info are UTC by convention
                # here; assuming local time would silently shift freshness bands.
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=_dt.timezone.utc)
                iso = dt.isoformat(timespec="seconds")
                age = (_dt.datetime.now(_dt.timezone.utc) - dt).total_seconds()

        return cls(
            data_time=iso,
            data_age_seconds=round(age, 1) if age is not None else None,
            freshness=DataFreshness.from_age(age),
            **kwargs,
        )


# ---------------------------------------------------------------------------
# The §33 output contract
# ---------------------------------------------------------------------------

class Measure(BaseModel):
    """A single number fit to put in front of a manager.

    Construct via :meth:`unavailable` when the inputs are not there — that path
    exists so callers never have to invent a zero to satisfy the type.
    """

    model_config = {"protected_namespaces": ()}

    value: float | None
    unit: str
    label: str
    scope: Scope
    calculation_mode: CalculationMode
    evidence_quality: EvidenceQuality = EvidenceQuality.UNAVAILABLE
    #: Why the evidence grade is what it is — one plain sentence per factor.
    evidence_reasons: list[str] = Field(default_factory=list)
    provenance: Provenance = Field(default_factory=Provenance)
    #: Shown instead of the value when it could not be computed.
    unavailable_reason: str | None = None

    @property
    def available(self) -> bool:
        return self.value is not None

    @classmethod
    def unavailable(
        cls,
        *,
        label: str,
        unit: str,
        scope: Scope,
        reason: str,
        provenance: Provenance | None = None,
    ) -> "Measure":
        """A measure that could not be computed, and says so."""
        return cls(
            value=None,
            unit=unit,
            label=label,
            scope=scope,
            calculation_mode=CalculationMode.INSUFFICIENT_DATA,
            evidence_quality=EvidenceQuality.UNAVAILABLE,
            unavailable_reason=reason,
            provenance=provenance or Provenance(),
        )

    def render(self, places: int = 0) -> str:
        """Display string. Never renders a placeholder number."""
        if self.value is None:
            return "Not available"
        return f"{self.value:,.{places}f} {self.unit}".strip()


__all__ = [
    "CalculationMode",
    "DataFreshness",
    "EvidenceQuality",
    "Measure",
    "Provenance",
    "Scope",
]
