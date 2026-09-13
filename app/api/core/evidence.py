"""app/api/core/evidence.py — how well-supported is this answer?

Replaces the confidence percentages Crucible AI used to emit. Those were constants
(`85.0 if baseline_backed else 60.0`) wearing the costume of a calibrated
probability, which is the most misleading thing a decision platform can do:
a manager reading "87% confident" reasonably assumes something measured it.

What is measured here is *support*, not correctness. Five factors, each scored
from something observable:

==========================  ==================================================
Factor                      Measured from
==========================  ==================================================
Data freshness              age of the newest source observation
Feature completeness        fraction of model features actually present
Model availability          whether a champion is serving, and in sync
Historical support          count of comparable past observations
Constraint completeness     fraction of relevant constraints truly evaluated
==========================  ==================================================

Support is not the same as accuracy, and this module does not pretend otherwise.
A HIGH grade means "the platform had what it needed to answer" — it is a claim
about inputs, which is checkable, rather than about outcomes, which is not.

The grade is capped, not averaged, by the factors that can independently ruin an
answer: no model means the estimate is heuristic no matter how fresh the data,
and expired data means the answer describes a mine that may no longer exist in
that state no matter how complete the features were.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .provenance import DataFreshness, EvidenceQuality


@dataclass(frozen=True)
class EvidenceFactor:
    """One measured contributor to the support grade."""

    key: str
    label: str
    #: 0..1. Never assumed — a factor that could not be measured scores 0 and
    #: says so in `detail`, which is different from scoring well by default.
    score: float
    #: Plain sentence a manager can read without knowing the model.
    detail: str
    weight: float = 1.0

    @property
    def contribution(self) -> float:
        return self.score * self.weight


@dataclass
class EvidenceAssessment:
    """The grade plus everything behind it."""

    quality: EvidenceQuality
    factors: list[EvidenceFactor] = field(default_factory=list)
    #: Factors that capped the grade below what the weighted score would give.
    limiters: list[str] = field(default_factory=list)

    @property
    def reasons(self) -> list[str]:
        return [f.detail for f in self.factors]

    @property
    def weighted_score(self) -> float:
        total_weight = sum(f.weight for f in self.factors)
        if total_weight <= 0:
            return 0.0
        return sum(f.contribution for f in self.factors) / total_weight

    def as_dict(self) -> dict:
        return {
            "quality": self.quality.value,
            "limiters": self.limiters,
            "factors": [
                {
                    "key": f.key,
                    "label": f.label,
                    "score": round(f.score, 3),
                    "detail": f.detail,
                }
                for f in self.factors
            ],
        }


# ---------------------------------------------------------------------------
# Individual factor assessors
# ---------------------------------------------------------------------------

#: Freshness bands score on how much the world can have moved since. A shift is
#: 10 hours, so 2-hour-old data still describes the current shift (RECENT), while
#: day-old data describes a shift that has since ended (EXPIRED).
_FRESHNESS_SCORE = {
    DataFreshness.LIVE: 1.0,
    DataFreshness.RECENT: 0.75,
    DataFreshness.STALE: 0.35,
    DataFreshness.EXPIRED: 0.0,
}

_FRESHNESS_DETAIL = {
    DataFreshness.LIVE: "Telemetry is live",
    DataFreshness.RECENT: "Telemetry is from this shift",
    DataFreshness.STALE: "Telemetry is several hours old",
    DataFreshness.EXPIRED: "No recent telemetry",
}


def freshness_factor(freshness: DataFreshness, age_seconds: float | None) -> EvidenceFactor:
    if age_seconds is None:
        detail = "Age of the underlying data is unknown"
    elif age_seconds < 90:
        detail = f"Telemetry is {age_seconds:.0f} seconds old"
    elif age_seconds < 5400:
        detail = f"Telemetry is {age_seconds / 60:.0f} minutes old"
    else:
        detail = f"Telemetry is {age_seconds / 3600:.1f} hours old"
        if freshness is DataFreshness.EXPIRED:
            detail += " — older than one working day"

    return EvidenceFactor(
        key="freshness",
        label="Data freshness",
        score=_FRESHNESS_SCORE[freshness],
        detail=detail,
        weight=1.4,
    )


def completeness_factor(present: int, required: int) -> EvidenceFactor:
    """Fraction of the model's required features actually available."""
    if required <= 0:
        return EvidenceFactor(
            key="completeness",
            label="Feature completeness",
            score=0.0,
            detail="Feature schema is unknown",
            weight=1.2,
        )

    ratio = max(0.0, min(1.0, present / required))
    missing = required - present
    if missing == 0:
        detail = f"All {required} required inputs available"
    else:
        detail = (
            f"{present} of {required} required inputs available "
            f"({missing} substituted from historical medians)"
        )

    return EvidenceFactor(
        key="completeness",
        label="Feature completeness",
        score=ratio,
        detail=detail,
        weight=1.2,
    )


def model_factor(
    *,
    model_available: bool,
    serving_status: str | None,
) -> EvidenceFactor:
    """Whether a champion model is genuinely serving this prediction."""
    if not model_available:
        return EvidenceFactor(
            key="model",
            label="Model availability",
            score=0.0,
            detail="No model is serving this task — estimate is heuristic",
            weight=1.5,
        )

    status = (serving_status or "").upper()
    if status == "SYNCED":
        return EvidenceFactor(
            key="model",
            label="Model availability",
            score=1.0,
            detail="Champion model is serving and in sync with the registry",
            weight=1.5,
        )
    if status in ("SYNC_PENDING", "SYNC_FAILED"):
        # A stale-but-working model is genuinely usable; it is just not the one
        # governance approved most recently, and the manager should know that.
        return EvidenceFactor(
            key="model",
            label="Model availability",
            score=0.55,
            detail=(
                "A model is serving, but it is not the current approved champion "
                f"({status.replace('_', ' ').lower()})"
            ),
            weight=1.5,
        )

    return EvidenceFactor(
        key="model",
        label="Model availability",
        score=0.7,
        detail="A model is serving; registry sync state is unreported",
        weight=1.5,
    )


#: Below this many comparable cases, past outcomes are an anecdote rather than
#: a base rate, and the platform should not lean on them.
MIN_HISTORICAL_CASES = 3
STRONG_HISTORICAL_CASES = 12


def historical_factor(case_count: int) -> EvidenceFactor:
    if case_count <= 0:
        detail = "No comparable past situations on record"
        score = 0.0
    elif case_count < MIN_HISTORICAL_CASES:
        detail = f"Only {case_count} comparable past situation(s) on record"
        score = 0.3
    elif case_count < STRONG_HISTORICAL_CASES:
        detail = f"{case_count} comparable past situations on record"
        score = 0.7
    else:
        detail = f"{case_count} comparable past situations on record"
        score = 1.0

    return EvidenceFactor(
        key="history",
        label="Historical support",
        score=score,
        detail=detail,
        weight=0.8,
    )


def constraint_factor(evaluated: int, relevant: int) -> EvidenceFactor:
    """Fraction of relevant operational constraints actually checked.

    A constraint that could not be evaluated is the dangerous case: it is the
    one that might have blocked the recommendation.
    """
    if relevant <= 0:
        return EvidenceFactor(
            key="constraints",
            label="Constraint coverage",
            score=1.0,
            detail="No operational constraints apply",
            weight=1.3,
        )

    ratio = max(0.0, min(1.0, evaluated / relevant))
    unchecked = relevant - evaluated
    if unchecked == 0:
        detail = f"All {relevant} applicable constraints evaluated"
    else:
        detail = (
            f"{evaluated} of {relevant} applicable constraints evaluated — "
            f"{unchecked} could not be checked"
        )

    return EvidenceFactor(
        key="constraints",
        label="Constraint coverage",
        score=ratio,
        detail=detail,
        weight=1.3,
    )


# ---------------------------------------------------------------------------
# Grading
# ---------------------------------------------------------------------------

#: Weighted-score thresholds. Deliberately demanding: MEDIUM is the honest
#: default for an operational estimate, and HIGH should be uncommon.
_HIGH_THRESHOLD = 0.82
_MEDIUM_THRESHOLD = 0.55
_LOW_THRESHOLD = 0.25


def assess(factors: list[EvidenceFactor]) -> EvidenceAssessment:
    """Grade a set of measured factors, applying hard caps.

    Caps exist because these factors are not substitutes for one another. A
    perfectly fresh, perfectly complete feature vector scored by no model is
    still a heuristic answer, and averaging cannot be allowed to hide that.
    """
    if not factors:
        return EvidenceAssessment(
            quality=EvidenceQuality.UNAVAILABLE,
            limiters=["Nothing was measured"],
        )

    assessment = EvidenceAssessment(quality=EvidenceQuality.UNAVAILABLE, factors=list(factors))
    score = assessment.weighted_score
    by_key = {f.key: f for f in factors}

    if score >= _HIGH_THRESHOLD:
        grade = EvidenceQuality.HIGH
    elif score >= _MEDIUM_THRESHOLD:
        grade = EvidenceQuality.MEDIUM
    elif score >= _LOW_THRESHOLD:
        grade = EvidenceQuality.LOW
    else:
        grade = EvidenceQuality.UNAVAILABLE

    limiters: list[str] = []

    def cap(at: EvidenceQuality, why: str) -> None:
        nonlocal grade
        if grade.rank > at.rank:
            grade = at
            limiters.append(why)

    model = by_key.get("model")
    if model is not None and model.score <= 0.0:
        cap(EvidenceQuality.LOW, "No model is serving this task")
    elif model is not None and model.score < 0.6:
        cap(EvidenceQuality.MEDIUM, "The serving model is not the approved champion")

    fresh = by_key.get("freshness")
    if fresh is not None and fresh.score <= 0.0:
        cap(EvidenceQuality.LOW, "The underlying data is older than one working day")
    elif fresh is not None and fresh.score < 0.5:
        cap(EvidenceQuality.MEDIUM, "The underlying data is several hours old")

    constraints = by_key.get("constraints")
    if constraints is not None and constraints.score < 1.0:
        cap(EvidenceQuality.MEDIUM, "Not every applicable constraint could be evaluated")

    completeness = by_key.get("completeness")
    if completeness is not None and completeness.score < 0.75:
        cap(EvidenceQuality.MEDIUM, "A quarter or more of the model inputs were substituted")

    assessment.quality = grade
    assessment.limiters = limiters
    return assessment


__all__ = [
    "EvidenceAssessment",
    "EvidenceFactor",
    "assess",
    "completeness_factor",
    "constraint_factor",
    "freshness_factor",
    "historical_factor",
    "model_factor",
]
