"""app/api/core/decision_memory.py — what happened the last time?

Most platforms answer "what does the model predict?". This answers a question a
manager trusts more, because it is about their own mine: *we have been here
before — what did we do, and did it work?*

**Similarity is structural first, textual second.** New records carry the
intervention key and incident type, so matching is exact. Records written before
the decision-OS migration have only free text, so those are matched on token
overlap and are labelled as such — a weaker match presented as a weaker match.

**Small samples are reported as small samples.** Three past cases is an anecdote,
not a base rate. The response says how many cases it found and refuses to
summarise below a floor, because "median recovery 3.7%" reads as a statistic
regardless of whether it came from thirty cases or two.

Effectiveness here is `actual / predicted` as recorded in
`gov.decision_outcomes` — a measure of how well Crucible AI predicted, not of how good
the decision was. The distinction is kept in the wording throughout.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from statistics import median
from typing import Any

from .db import query
from .memo import ttl_cache

logger = logging.getLogger("crucible.decision_memory")

#: Below this many comparable cases, no aggregate is reported.
MIN_CASES_FOR_SUMMARY = 3

#: Words that carry no signal when matching problem descriptions.
_STOPWORDS = frozenset(
    """a an the and or of for to in on at is are was were be been with by from
    this that these those it its shift mine production""".split()
)

#: Rows written by test suites, excluded so they cannot masquerade as history.
_TEST_PATTERNS = re.compile(
    r"\b(test|guard|rollback|sm-test|dummy|sample|fixture)\b", re.IGNORECASE
)


@dataclass
class PastCase:
    decision_id: int
    problem: str
    recommendation: str
    mine_id: str | None
    decided_at: str | None
    lifecycle_state: str

    predicted_value: float | None = None
    actual_value: float | None = None
    delta: float | None = None
    effectiveness: float | None = None

    #: 0..1 structural or textual overlap with the situation being matched.
    similarity: float = 0.0
    #: "exact" when matched on intervention key, "textual" on token overlap.
    match_basis: str = "textual"
    #: True when the record predates mine scoping and cannot be attributed.
    mine_unscoped: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "decision_id": self.decision_id,
            "problem": self.problem,
            "recommendation": self.recommendation,
            "mine_id": self.mine_id,
            "decided_at": self.decided_at,
            "lifecycle_state": self.lifecycle_state,
            "predicted_value": self.predicted_value,
            "actual_value": self.actual_value,
            "delta": self.delta,
            "effectiveness": self.effectiveness,
            "similarity": round(self.similarity, 3),
            "match_basis": self.match_basis,
            "mine_unscoped": self.mine_unscoped,
        }


@dataclass
class MemoryResult:
    query_description: str
    cases: list[PastCase] = field(default_factory=list)
    #: None when there are too few cases to summarise responsibly.
    summary: dict[str, Any] | None = None
    note: str = ""
    same_mine_only: bool = True

    def as_dict(self) -> dict[str, Any]:
        return {
            "query": self.query_description,
            "case_count": len(self.cases),
            "cases": [c.as_dict() for c in self.cases],
            "summary": self.summary,
            "note": self.note,
            "same_mine_only": self.same_mine_only,
        }


def _tokens(text: str | None) -> set[str]:
    if not text:
        return set()
    words = re.findall(r"[a-z0-9]+", text.lower())
    return {w for w in words if w not in _STOPWORDS and len(w) > 2}


def _overlap(a: set[str], b: set[str]) -> float:
    """Jaccard overlap. Symmetric, and zero when either side is empty."""
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


@ttl_cache(ttl=60.0)
def _load_history(mine_id: str | None) -> list[dict[str, Any]]:
    """Completed decisions with a recorded outcome.

    Only decisions that reached an outcome are useful history: one that was
    approved and never measured says nothing about whether it worked.
    """
    where = ["d.lifecycle_state IN ('MEASURED','LEARNED','COMPLETED')"]
    params: list[Any] = []
    if mine_id:
        # Rows predating migration 003 have no mine recorded. They are included
        # for a mine-scoped search but tagged unscoped, because excluding the
        # platform's entire decision history would make every situation look
        # unprecedented, while claiming it belongs to this mine would be false.
        where.append("(d.mine_id = %s OR d.mine_id IS NULL)")
        params.append(mine_id)

    try:
        return query(
            f"""SELECT d.id, d.problem, d.recommendation, d.mine_id, d.decided_at,
                       d.lifecycle_state, d.objective,
                       o.predicted_value, o.actual_value, o.delta, o.effectiveness,
                       o.variance_reason
                FROM gov.decisions d
                LEFT JOIN gov.decision_outcomes o ON o.decision_id = d.id
                WHERE {' AND '.join(where)}
                ORDER BY d.decided_at DESC
                LIMIT 200""",
            tuple(params),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Decision history unavailable: %s", exc)
        return []


def _is_test_row(row: dict[str, Any]) -> bool:
    return bool(_TEST_PATTERNS.search(str(row.get("problem") or "")))


def _to_case(row: dict[str, Any], similarity: float, basis: str) -> PastCase:
    def num(key: str) -> float | None:
        value = row.get(key)
        return float(value) if value is not None else None

    return PastCase(
        decision_id=int(row["id"]),
        problem=str(row.get("problem") or ""),
        recommendation=str(row.get("recommendation") or ""),
        mine_id=row.get("mine_id"),
        decided_at=str(row["decided_at"]) if row.get("decided_at") else None,
        lifecycle_state=str(row.get("lifecycle_state") or ""),
        predicted_value=num("predicted_value"),
        actual_value=num("actual_value"),
        delta=num("delta"),
        effectiveness=num("effectiveness"),
        similarity=similarity,
        match_basis=basis,
        mine_unscoped=row.get("mine_id") is None,
    )


def _deduplicate(cases: list[PastCase]) -> tuple[list[PastCase], int]:
    """Collapse records that describe the same event.

    The seeded history contains the same decision written several times with
    identical problem, recommendation and outcome. Counted separately they
    present as independent corroboration, so "5 measured cases, median 48 t"
    would describe a single observation five times over — which is precisely how
    a base rate comes to mislead.

    Identity is the full outcome tuple rather than the row id: genuinely repeated
    situations differ in at least their predicted or actual value.
    """
    seen: set[tuple] = set()
    unique: list[PastCase] = []
    duplicates = 0

    for case in cases:
        identity = (
            case.problem.strip().lower(),
            case.recommendation.strip().lower(),
            case.predicted_value,
            case.actual_value,
        )
        if identity in seen:
            duplicates += 1
            continue
        seen.add(identity)
        unique.append(case)

    return unique, duplicates


def _summarise(cases: list[PastCase]) -> dict[str, Any] | None:
    """Aggregate outcomes, or None when the sample is too small to aggregate."""
    measured = [c for c in cases if c.actual_value is not None]

    if len(measured) < MIN_CASES_FOR_SUMMARY:
        return None

    actuals = [c.actual_value for c in measured if c.actual_value is not None]
    effectiveness = [c.effectiveness for c in measured if c.effectiveness is not None]

    result: dict[str, Any] = {
        "cases_measured": len(measured),
        "median_actual": round(median(actuals), 2),
        "best_actual": round(max(actuals), 2),
        "worst_actual": round(min(actuals), 2),
    }

    if effectiveness:
        result["median_effectiveness"] = round(median(effectiveness), 3)
        result["note"] = (
            "Effectiveness is actual divided by predicted, so it measures how well "
            "Crucible AI forecast the result — not how good the decision was."
        )

    return result


def similar(
    *,
    mine_id: str | None = None,
    intervention_key: str | None = None,
    problem: str | None = None,
    limit: int = 5,
    widen_to_other_mines: bool = True,
) -> MemoryResult:
    """Find comparable past decisions.

    Searches this mine first. If too few cases exist and `widen_to_other_mines`
    is set, it searches the rest of the platform and says clearly that it has —
    another mine's experience is worth something, but it is not the same claim.
    """
    description = problem or intervention_key or "recent decisions"
    target = _tokens(problem) | _tokens(intervention_key)

    def collect(rows: list[dict[str, Any]]) -> list[PastCase]:
        out: list[PastCase] = []
        for row in rows:
            if _is_test_row(row):
                continue

            text = f"{row.get('problem') or ''} {row.get('recommendation') or ''}"

            # Structural match: new records name the intervention directly.
            if intervention_key and intervention_key.lower() in text.lower():
                out.append(_to_case(row, 1.0, "exact"))
                continue

            if not target:
                out.append(_to_case(row, 0.0, "recency"))
                continue

            score = _overlap(target, _tokens(text))
            if score > 0.12:
                out.append(_to_case(row, score, "textual"))
        return out

    cases = collect(_load_history(mine_id))
    same_mine_only = True

    if len(cases) < MIN_CASES_FOR_SUMMARY and widen_to_other_mines and mine_id:
        wider = [r for r in _load_history(None) if r.get("mine_id") != mine_id]
        extra = collect(wider)
        if extra:
            cases.extend(extra)
            same_mine_only = False

    cases.sort(key=lambda c: (c.similarity, c.decided_at or ""), reverse=True)
    cases, duplicates = _deduplicate(cases)
    cases = cases[:limit]

    summary = _summarise(cases)

    duplicate_note = (
        f" {duplicates} duplicate record(s) of the same event were collapsed."
        if duplicates
        else ""
    )

    if not cases:
        note = (
            "No comparable past decision has been recorded and measured. This is "
            "the first time Crucible AI has seen this situation."
        )
    elif summary is None:
        note = (
            f"Only {len(cases)} distinct comparable case(s) found with a recorded "
            f"outcome — fewer than the {MIN_CASES_FOR_SUMMARY} needed before Crucible AI "
            f"will summarise them. They are listed individually instead.{duplicate_note}"
        )
    elif not same_mine_only:
        note = (
            "Too few cases at this mine, so comparable decisions from other mines "
            "are included. Conditions differ between sites."
        )
    else:
        unscoped = sum(1 for c in cases if c.mine_unscoped)
        note = f"Based on {summary['cases_measured']} distinct measured case(s).{duplicate_note}"
        if unscoped:
            note += (
                f" {unscoped} of them predate mine-level scoping and cannot be "
                "confirmed as belonging to this mine."
            )

    return MemoryResult(
        query_description=description,
        cases=cases,
        summary=summary,
        note=note,
        same_mine_only=same_mine_only,
    )


def for_recommendation(mine_id: str, recommendation: dict[str, Any]) -> dict[str, Any]:
    """Decision-memory context for one proposed action."""
    return similar(
        mine_id=mine_id,
        intervention_key=recommendation.get("key"),
        problem=recommendation.get("title"),
        limit=3,
    ).as_dict()


def clear_cache() -> None:
    _load_history.cache_clear()


__all__ = [
    "MIN_CASES_FOR_SUMMARY",
    "MemoryResult",
    "PastCase",
    "clear_cache",
    "for_recommendation",
    "similar",
]
