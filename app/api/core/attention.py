"""app/api/core/attention.py — what needs the manager, in what order.

The Command Center's first question is "does the mine need me right now?", and
its second is "what first?". This module answers both from the state engine's
signals, turning each one that matters into an item a manager can act on.

Ranking is `severity × impact × urgency × evidence`, as the spec requires, with
one rule about what *not* to show: an item whose evidence is UNAVAILABLE is
reported as a gap in knowledge rather than ranked among operational problems.
Sorting "we cannot see this" next to "production is 15% down" invites a manager
to treat them as comparable, and they are not.

Volume is deliberately capped. A queue of thirty items is a list, not a priority,
and the failure mode of alerting systems is that people stop reading them.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from .provenance import CalculationMode
from .state_engine import Severity, Signal, mine_state
from .db import query

logger = logging.getLogger("crucible.attention")

#: More than this and the queue stops being a priority order.
MAX_ITEMS = 6

#: Weight per severity in the ranking score.
_SEVERITY_WEIGHT = {
    Severity.CRITICAL: 4.0,
    Severity.DISRUPTION: 3.0,
    Severity.WATCH: 1.5,
    Severity.NONE: 0.0,
}

#: How soon a signal type needs a response. Multiplies the score.
_URGENCY = {
    "production_gap": 1.0,
    "equipment_risk": 1.2,      # a failure in progress compounds fastest
    "bottleneck": 0.9,
    "maintenance_overdue": 0.6,  # real, but rarely resolvable this shift
    "open_incidents": 1.1,
}

#: Evidence grade multiplier — a well-supported problem outranks a suspected one.
_EVIDENCE_WEIGHT = {"HIGH": 1.0, "MEDIUM": 0.85, "LOW": 0.6, "UNAVAILABLE": 0.3}

#: Signal key -> the incident type it would be escalated as.
INCIDENT_TYPE = {
    "production_gap": "PRODUCTION_SHORTFALL",
    "equipment_risk": "EQUIPMENT_RISK",
    "bottleneck": "HAULAGE_BOTTLENECK",
    "maintenance_overdue": "EQUIPMENT_RISK",
    "open_incidents": "OTHER",
}


@dataclass
class AttentionItem:
    key: str
    title: str
    severity: Severity
    #: One sentence a manager can act on, from measured values.
    summary: str
    #: Production at stake, tonnes. None when it cannot be estimated.
    impact_t: float | None
    impact_basis: str
    calculation_mode: CalculationMode
    evidence_quality: str
    score: float
    #: The signals supporting this item, for the evidence panel.
    drivers: list[dict[str, Any]] = field(default_factory=list)
    deep_link: str | None = None
    incident_type: str = "OTHER"
    #: Stable across evaluations so repeat detections dedupe into one incident.
    signature: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "title": self.title,
            "severity": self.severity.value,
            "summary": self.summary,
            "impact_t": round(self.impact_t, 1) if self.impact_t is not None else None,
            "impact_basis": self.impact_basis,
            "calculation_mode": self.calculation_mode.value,
            "evidence_quality": self.evidence_quality,
            "score": round(self.score, 3),
            "drivers": self.drivers,
            "deep_link": self.deep_link,
            "incident_type": self.incident_type,
            "signature": self.signature,
        }


# ---------------------------------------------------------------------------
# Impact
# ---------------------------------------------------------------------------

def _impact_for(signal: Signal, mine_id: str) -> tuple[float | None, str, CalculationMode]:
    """Production at stake for a signal, or an honest refusal.

    Only computed where the data genuinely supports it. The alternative — a
    plausible-looking tonnage on every card — is how a dashboard stops being
    believable.
    """
    if signal.key == "production_gap":
        gap = signal.evidence.get("gap_t")
        if gap is None:
            return None, "Gap could not be established.", CalculationMode.INSUFFICIENT_DATA
        shifts = signal.evidence.get("shifts_considered") or 1
        per_shift = gap / shifts
        return (
            per_shift,
            f"Mean shortfall per shift across the last {shifts} shifts "
            f"({gap:,.0f} t total).",
            CalculationMode.MODEL_BACKED,
        )

    if signal.key == "bottleneck":
        headroom = signal.evidence.get("headroom_t")
        if headroom is None:
            return None, "Stage headroom could not be established.", CalculationMode.INSUFFICIENT_DATA
        if headroom >= 0:
            return (
                headroom,
                f"Tonnes still available at the constraining stage before it saturates.",
                CalculationMode.MODEL_BACKED,
            )
        return (
            abs(headroom),
            "The stage is already running beyond its established capacity by this "
            "much, so the capacity figure may understate it.",
            CalculationMode.HEURISTIC,
        )

    if signal.key == "equipment_risk":
        return _equipment_exposure(mine_id, signal)

    # Maintenance backlog and open incidents have no defensible tonnage here.
    return (
        None,
        "Production impact cannot be reliably estimated from available data.",
        CalculationMode.INSUFFICIENT_DATA,
    )


def _equipment_exposure(mine_id: str, signal: Signal) -> tuple[float | None, str, CalculationMode]:
    """Production carried by the machines currently flagged.

    Uses `production_tons` recorded against those machines, which is a measured
    contribution rather than an allocation of mine output.
    """
    flagged = signal.evidence.get("flagged_ids") or []
    if not flagged:
        return None, "No machine is currently flagged.", CalculationMode.INSUFFICIENT_DATA

    try:
        rows = query(
            """SELECT AVG(production_tons) AS mean_tons, COUNT(*) AS n
               FROM ops.equipment_telemetry
               WHERE mine_id = %s AND machine_id = ANY(%s) AND production_tons IS NOT NULL""",
            (mine_id, list(flagged)),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Equipment exposure query failed for %s: %s", mine_id, exc)
        return None, "Equipment production history is unavailable.", CalculationMode.INSUFFICIENT_DATA

    if not rows or rows[0].get("mean_tons") is None:
        return (
            None,
            "The flagged machines have no recorded production contribution.",
            CalculationMode.INSUFFICIENT_DATA,
        )

    mean_tons = float(rows[0]["mean_tons"])
    exposure = mean_tons * len(flagged)
    return (
        exposure,
        f"Mean recorded output of the {len(flagged)} flagged machine(s) "
        f"({mean_tons:,.1f} t each per observation).",
        CalculationMode.HEURISTIC,
    )


def _evidence_grade(signal: Signal, mode: CalculationMode) -> str:
    """Support grade for an attention item.

    Derived from what the signal itself could establish, so an item built on an
    unevaluable measurement cannot present as well-supported.
    """
    if signal.calculation_mode is CalculationMode.INSUFFICIENT_DATA:
        return "UNAVAILABLE"
    if mode is CalculationMode.INSUFFICIENT_DATA:
        return "LOW"
    if mode is CalculationMode.HEURISTIC:
        return "MEDIUM"
    return "HIGH"


_TITLES = {
    "production_gap": "Production shortfall",
    "equipment_risk": "Equipment failure risk",
    "bottleneck": "Material flow constraint",
    "maintenance_overdue": "Maintenance backlog",
    "open_incidents": "Open incidents",
}


def _signature(mine_id: str, signal: Signal) -> str:
    """Stable identity so the same condition does not open a second incident."""
    detail = ""
    if signal.key == "bottleneck":
        detail = f":{signal.evidence.get('stage', '')}"
    elif signal.key == "maintenance_overdue":
        detail = f":{signal.evidence.get('worst_machine', '')}"
    return f"{mine_id}:{signal.key}{detail}"


def build(
    mine_id: str,
    *,
    limit: int = MAX_ITEMS,
    state: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """The ranked attention queue for one mine.

    `state` may be supplied by a caller that has already evaluated it, so a page
    rendering both does not pay for the signals twice.
    """
    state = state or mine_state(mine_id)

    items: list[AttentionItem] = []
    knowledge_gaps: list[dict[str, Any]] = []

    # Rebuild from the raw signal dicts the state engine produced, so attention
    # and state can never disagree about what was observed.
    for raw in state["signals"]:
        severity = Severity(raw["severity"])
        signal = _signal_from_dict(raw)

        if signal.calculation_mode is CalculationMode.INSUFFICIENT_DATA:
            knowledge_gaps.append(
                {
                    "key": signal.key,
                    "label": signal.label,
                    "reason": signal.reason,
                    "deep_link": signal.deep_link,
                }
            )
            continue

        if severity is Severity.NONE:
            continue

        impact, basis, mode = _impact_for(signal, mine_id)
        grade = _evidence_grade(signal, mode)

        score = (
            _SEVERITY_WEIGHT[severity]
            * _URGENCY.get(signal.key, 1.0)
            * _EVIDENCE_WEIGHT.get(grade, 0.5)
        )
        # Impact breaks ties between equally severe items without allowing a
        # large tonnage to promote a low-severity item above a critical one.
        if impact:
            score *= 1.0 + min(0.5, abs(impact) / 1000.0)

        items.append(
            AttentionItem(
                key=signal.key,
                title=_TITLES.get(signal.key, signal.label),
                severity=severity,
                summary=signal.reason,
                impact_t=impact,
                impact_basis=basis,
                calculation_mode=mode,
                evidence_quality=grade,
                score=score,
                drivers=[
                    {
                        "label": signal.label,
                        "value": signal.value,
                        "unit": signal.unit,
                        "threshold": signal.threshold,
                        "source": signal.source,
                        "observed_at": signal.observed_at,
                        **signal.evidence,
                    }
                ],
                deep_link=signal.deep_link,
                incident_type=INCIDENT_TYPE.get(signal.key, "OTHER"),
                signature=_signature(mine_id, signal),
            )
        )

    items.sort(key=lambda i: i.score, reverse=True)

    return {
        "mine_id": mine_id,
        "state": state["state"],
        "headline": state["headline"],
        "items": [i.as_dict() for i in items[:limit]],
        "item_count": len(items),
        "suppressed": max(0, len(items) - limit),
        # Not ranked alongside operational problems: "we cannot see this" is a
        # different kind of thing from "this is going wrong".
        "knowledge_gaps": knowledge_gaps,
        "clock": state["clock"],
        "evaluated_at": state["evaluated_at"],
    }


def _signal_from_dict(raw: dict[str, Any]) -> Signal:
    from .provenance import Scope

    return Signal(
        key=raw["key"],
        label=raw["label"],
        severity=Severity(raw["severity"]),
        value=raw["value"],
        unit=raw["unit"],
        reason=raw["reason"],
        source=raw["source"],
        scope=Scope(raw["scope"]),
        observed_at=raw.get("observed_at"),
        threshold=raw.get("threshold"),
        calculation_mode=CalculationMode(raw["calculation_mode"]),
        deep_link=raw.get("deep_link"),
        evidence=raw.get("evidence") or {},
    )


__all__ = ["AttentionItem", "MAX_ITEMS", "build"]
