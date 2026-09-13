"""app/api/core/handover.py — what the next shift supervisor needs to know.

The brief is assembled from stored facts first, and only then optionally worded
by a language model. That order is the point: an LLM asked to "summarise the
shift" will produce fluent prose containing numbers nobody recorded, and a
handover document is precisely where an invented number does damage — it is read
by someone who was not there and cannot check it.

So :func:`facts` returns structured, individually sourced findings. Prose, when
it is generated at all, may only restate them; :func:`narrate` builds the
sentences deterministically from the same structures. If a language model is
introduced later, it must be given these facts and forbidden from adding to them.

Every finding carries `source` and, where it is a judgement, `calculation_mode`,
so the receiving supervisor can check any line against the system that produced it.
"""

from __future__ import annotations

import datetime as _dt
import logging
from dataclasses import dataclass, field
from typing import Any

from .attention import build as build_attention
from .clock import resolve_clock
from .db import query
from .provenance import CalculationMode

logger = logging.getLogger("crucible.handover")


@dataclass
class Finding:
    """One thing the next shift should know, with where it came from."""

    category: str
    headline: str
    detail: str
    source: str
    severity: str = "INFO"  # INFO | WATCH | ACTION
    calculation_mode: CalculationMode = CalculationMode.MODEL_BACKED
    value: float | None = None
    unit: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "category": self.category,
            "headline": self.headline,
            "detail": self.detail,
            "source": self.source,
            "severity": self.severity,
            "calculation_mode": self.calculation_mode.value,
            "value": round(self.value, 2) if self.value is not None else None,
            "unit": self.unit,
        }


@dataclass
class Handover:
    mine_id: str
    generated_at: str
    period_from: str | None
    period_to: str | None
    findings: list[Finding] = field(default_factory=list)
    open_items: list[dict[str, Any]] = field(default_factory=list)
    pending_decisions: list[dict[str, Any]] = field(default_factory=list)
    watchlist: list[dict[str, Any]] = field(default_factory=list)
    unresolved: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "mine_id": self.mine_id,
            "generated_at": self.generated_at,
            "period_from": self.period_from,
            "period_to": self.period_to,
            "findings": [f.as_dict() for f in self.findings],
            "open_items": self.open_items,
            "pending_decisions": self.pending_decisions,
            "watchlist": self.watchlist,
            "unresolved": self.unresolved,
            "narrative": narrate(self),
        }


def _num(row: dict, key: str) -> float | None:
    value = row.get(key)
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _production_findings(mine_id: str) -> tuple[list[Finding], dict[str, Any]]:
    rows = query(
        """SELECT date, shift, planned_production_t, actual_production_t, ore_grade_mn_pct
           FROM ops.production_records
           WHERE mine_id = %s AND actual_production_t IS NOT NULL
           ORDER BY date DESC
           LIMIT 2""",
        (mine_id,),
    )

    if not rows:
        return (
            [
                Finding(
                    category="Production",
                    headline="No production recorded",
                    detail="No production record exists for this mine.",
                    source="ops.production_records",
                    severity="WATCH",
                    calculation_mode=CalculationMode.INSUFFICIENT_DATA,
                )
            ],
            {},
        )

    latest = rows[0]
    planned = _num(latest, "planned_production_t")
    actual = _num(latest, "actual_production_t")
    findings: list[Finding] = []

    if planned and actual is not None:
        gap = planned - actual
        pct = 100.0 * gap / planned
        if gap > 0:
            findings.append(
                Finding(
                    category="Production",
                    headline=f"{actual:,.0f} t against {planned:,.0f} t planned",
                    detail=f"{gap:,.0f} t short of plan, {pct:.1f}% below.",
                    source="ops.production_records",
                    severity="ACTION" if pct >= 10 else "WATCH",
                    value=pct,
                    unit="%",
                )
            )
        else:
            findings.append(
                Finding(
                    category="Production",
                    headline=f"{actual:,.0f} t against {planned:,.0f} t planned",
                    detail=f"{abs(gap):,.0f} t ahead of plan.",
                    source="ops.production_records",
                    value=abs(pct),
                    unit="%",
                )
            )

    # Shift-on-shift movement, when there is a previous shift to compare with.
    if len(rows) > 1:
        previous = _num(rows[1], "actual_production_t")
        if previous and actual is not None:
            change = 100.0 * (actual - previous) / previous
            if abs(change) >= 5:
                findings.append(
                    Finding(
                        category="Production",
                        headline=f"{abs(change):.1f}% {'up' if change > 0 else 'down'} on the previous shift",
                        detail=(
                            f"{actual:,.0f} t this shift against {previous:,.0f} t "
                            f"on {rows[1].get('date')} shift {rows[1].get('shift')}."
                        ),
                        source="ops.production_records",
                        severity="WATCH" if change < 0 else "INFO",
                        value=change,
                        unit="%",
                    )
                )

    return findings, latest


def _equipment_findings(mine_id: str) -> tuple[list[Finding], list[dict[str, Any]]]:
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
        return [], []

    flagged = [r for r in rows if (_num(r, "failure_next_24h") or 0) > 0.5]
    overdue = sorted(
        (r for r in rows if (_num(r, "maintenance_overdue_days") or 0) > 7),
        key=lambda r: _num(r, "maintenance_overdue_days") or 0,
        reverse=True,
    )

    findings: list[Finding] = []

    if flagged:
        findings.append(
            Finding(
                category="Equipment",
                headline=f"{len(flagged)} unit(s) flagged for near-term failure",
                detail="Flagged: " + ", ".join(str(r["machine_id"]) for r in flagged[:5]),
                source="ops.equipment_telemetry",
                severity="ACTION",
                value=float(len(flagged)),
                unit="units",
            )
        )

    if overdue:
        worst = overdue[0]
        findings.append(
            Finding(
                category="Equipment",
                headline=f"{len(overdue)} unit(s) overdue for service",
                detail=(
                    f"Worst is {worst['machine_id']} at "
                    f"{_num(worst, 'maintenance_overdue_days'):.0f} days overdue."
                ),
                source="ops.equipment_telemetry",
                severity="WATCH",
                value=float(len(overdue)),
                unit="units",
            )
        )

    # The watchlist is the handover's most actionable artefact: specific units
    # the incoming supervisor should look at by name.
    watchlist = [
        {
            "machine_id": str(r["machine_id"]),
            "equipment_type": r.get("equipment_type"),
            "reason": (
                "Flagged for failure within 24 hours"
                if (_num(r, "failure_next_24h") or 0) > 0.5
                else f"{_num(r, 'maintenance_overdue_days'):.0f} days overdue for service"
            ),
        }
        for r in (flagged + [o for o in overdue if o not in flagged])[:6]
    ]

    return findings, watchlist


def _decision_findings(mine_id: str) -> tuple[list[Finding], list[dict], list[dict]]:
    try:
        plans = query(
            """SELECT plan_ref, objective, lifecycle_state, expected_delta_t,
                      owner, created_by, created_at, situation
               FROM gov.response_plans
               WHERE mine_id = %s
                 AND lifecycle_state NOT IN ('REJECTED','LEARNED')
               ORDER BY created_at DESC
               LIMIT 20""",
            (mine_id,),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Response plans unavailable for handover: %s", exc)
        return [], [], []

    pending = [p for p in plans if p["lifecycle_state"] in ("SIMULATED", "READY_FOR_REVIEW")]
    active = [p for p in plans if p["lifecycle_state"] in ("APPROVED", "EXECUTING")]
    awaiting_measure = [p for p in plans if p["lifecycle_state"] == "COMPLETED"]

    findings: list[Finding] = []

    if pending:
        findings.append(
            Finding(
                category="Decisions",
                headline=f"{len(pending)} plan(s) awaiting a decision",
                detail=", ".join(p["plan_ref"] for p in pending[:5]),
                source="gov.response_plans",
                severity="ACTION",
                value=float(len(pending)),
                unit="plans",
            )
        )

    if active:
        findings.append(
            Finding(
                category="Decisions",
                headline=f"{len(active)} plan(s) approved or under way",
                detail=", ".join(f"{p['plan_ref']} ({p['lifecycle_state'].lower()})" for p in active[:5]),
                source="gov.response_plans",
                severity="WATCH",
                value=float(len(active)),
                unit="plans",
            )
        )

    if awaiting_measure:
        findings.append(
            Finding(
                category="Decisions",
                headline=f"{len(awaiting_measure)} completed plan(s) with no outcome recorded",
                detail=(
                    "Recording what actually happened is what lets Crucible AI improve: "
                    + ", ".join(p["plan_ref"] for p in awaiting_measure[:5])
                ),
                source="gov.response_plans",
                severity="ACTION",
                value=float(len(awaiting_measure)),
                unit="plans",
            )
        )

    open_items = [
        {
            "plan_ref": p["plan_ref"],
            "state": p["lifecycle_state"],
            "owner": p.get("owner"),
            "expected_delta_t": (
                round(float(p["expected_delta_t"]), 1) if p.get("expected_delta_t") else None
            ),
            "situation": (p.get("situation") or "")[:180],
        }
        for p in active + awaiting_measure
    ]

    pending_decisions = [
        {
            "plan_ref": p["plan_ref"],
            "state": p["lifecycle_state"],
            "objective": p.get("objective"),
            "created_by": p.get("created_by"),
            "situation": (p.get("situation") or "")[:180],
        }
        for p in pending
    ]

    return findings, open_items, pending_decisions


def facts(mine_id: str) -> Handover:
    """Assemble the handover from stored facts. No prose is invented here."""
    clock = resolve_clock(mine_id)

    production, latest = _production_findings(mine_id)
    equipment, watchlist = _equipment_findings(mine_id)
    decisions, open_items, pending = _decision_findings(mine_id)

    attention = build_attention(mine_id)
    unresolved = [
        f"{item['title']}: {item['summary']}"
        for item in attention.get("items", [])
        if item["severity"] in ("CRITICAL", "DISRUPTION")
    ]

    findings = production + equipment + decisions

    if clock.caveat:
        findings.append(
            Finding(
                category="Data",
                headline="Figures are from a benchmark dataset",
                detail=clock.caveat,
                source="core.clock",
                severity="WATCH",
                calculation_mode=CalculationMode.MODEL_BACKED,
            )
        )

    for gap in attention.get("knowledge_gaps", []):
        findings.append(
            Finding(
                category="Data",
                headline=f"{gap['label']} could not be measured",
                detail=gap["reason"],
                source="core.state_engine",
                severity="WATCH",
                calculation_mode=CalculationMode.INSUFFICIENT_DATA,
            )
        )

    return Handover(
        mine_id=mine_id,
        generated_at=_dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        period_from=str(latest.get("date")) if latest else None,
        period_to=str(latest.get("date")) if latest else None,
        findings=findings,
        open_items=open_items,
        pending_decisions=pending,
        watchlist=watchlist,
        unresolved=unresolved,
    )


def narrate(handover: Handover) -> str:
    """Prose assembled from the findings, and from nothing else.

    Every sentence restates a `Finding` that is also present in the structured
    payload, so a reader can check any claim against its source. This is why the
    narrative is built here rather than requested from a language model: the
    constraint is not that the wording be good, it is that the wording introduce
    nothing.
    """
    if not handover.findings:
        return "No findings were recorded for this period."

    by_category: dict[str, list[Finding]] = {}
    for finding in handover.findings:
        by_category.setdefault(finding.category, []).append(finding)

    def sentence(finding: Finding) -> str:
        # Details built from joined lists do not end in punctuation, and running
        # two findings together reads as one claim.
        detail = finding.detail.strip()
        if detail and detail[-1] not in ".!?":
            detail += "."
        return f"{finding.headline}. {detail}"

    sentences: list[str] = []
    for category in ("Production", "Equipment", "Decisions", "Data"):
        for finding in by_category.get(category, []):
            sentences.append(sentence(finding))

    if handover.unresolved:
        sentences.append(
            f"{len(handover.unresolved)} issue(s) remain unresolved going into the "
            f"next shift: {handover.unresolved[0]}"
        )

    if handover.watchlist:
        names = ", ".join(w["machine_id"] for w in handover.watchlist[:4])
        sentences.append(f"Units to watch: {names}.")

    return " ".join(sentences)


__all__ = ["Finding", "Handover", "facts", "narrate"]
