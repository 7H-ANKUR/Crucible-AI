"""app/api/core/decision_package.py — analytics rendered as an approvable decision.

The bridge between what the platform computed and how a mine actually decides.
A manager does not approve a dashboard; they approve a document that states the
situation, the evidence, the options, the recommendation, what happens without
it, the constraints checked, who owns it and who must sign it — and that can be
printed, attached to a shift report, or tabled at a meeting.

**It is a rendering, not a new computation.** Every field is drawn from the
response plan, the projection, the scenario comparison and decision memory. This
module introduces no numbers of its own, which is what lets the package be
audited against the systems that produced it.

**It records its own lineage.** Model version, dataset version, calculation mode,
evidence quality and the clock reference travel with the document, so a package
read in three months can still be reconstructed — rather than being interpreted
against whatever the registry says by then.
"""

from __future__ import annotations

import datetime as _dt
import logging
from typing import Any

from .clock import resolve_clock
from .decision_memory import similar
from .provenance import CalculationMode
from .response_plan import generate as generate_plan
from .scenario import ScenarioObjective

logger = logging.getLogger("crucible.decision_package")

DISCLAIMER = (
    "This package supports a decision by authorised mine personnel. Crucible AI does "
    "not perform operational actions, does not approve them, and does not "
    "supersede the site's approved operating or emergency procedures."
)


def _section(title: str, body: Any, *, note: str | None = None) -> dict[str, Any]:
    return {"title": title, "body": body, "note": note}


def build(
    mine_id: str,
    *,
    item_key: str | None = None,
    location: tuple[float, float] | None = None,
    objective: ScenarioObjective = ScenarioObjective.BALANCED,
    prepared_by: str = "system",
    prepared_for: str | None = None,
) -> dict[str, Any]:
    """Assemble a decision package for a mine's highest-priority problem."""
    plan = generate_plan(
        mine_id,
        item_key=item_key,
        location=location,
        objective=objective,
        created_by=prepared_by,
        persist=False,
    )

    if not plan.get("available"):
        return {
            "available": False,
            "mine_id": mine_id,
            "reason": plan.get("reason") or "No decision is currently required.",
        }

    clock = resolve_clock(mine_id)
    generated_at = _dt.datetime.now(_dt.timezone.utc)

    # Precedent for the leading action. "We have done this before and it
    # recovered X" is evidence a manager weighs differently from a prediction.
    lead = plan["actions"][0] if plan.get("actions") else None
    precedent = (
        similar(
            mine_id=mine_id,
            intervention_key=lead["key"],
            problem=lead["title"],
            limit=3,
        ).as_dict()
        if lead
        else None
    )

    sections = [
        _section("Situation", plan["situation"]),
        _section(
            "Root cause",
            plan["root_cause"],
            note=f"Established {_mode_phrase(plan['root_cause_calculation_mode'])}.",
        ),
        _section(
            "Evidence",
            {
                "production_at_stake_t": plan["evidence"].get("impact_t"),
                "basis": plan["evidence"].get("impact_basis"),
                "constraining_stage": (plan["evidence"].get("bottleneck") or {}).get("label"),
                "drivers": plan["evidence"].get("drivers", []),
            },
        ),
        _section(
            "If no action is taken",
            {
                "available": plan["do_nothing"]["available"],
                "rate_tph": plan["do_nothing"].get("shortfall_rate_tph"),
                "points": plan["do_nothing"].get("points", []),
                "assumptions": plan["do_nothing"].get("assumptions", []),
            },
            note=(
                "A linear persistence of the mine's own measured shortfall rate "
                "under unchanged conditions. Not a forecast model."
            ),
        ),
        _section(
            "Options considered",
            plan.get("comparison", {}).get("rows", []),
            note=plan.get("comparison", {}).get("note"),
        ),
        _section(
            "Recommendation",
            {
                "actions": [
                    {
                        "title": a["title"],
                        "horizon": a["horizon"],
                        "owner": a["owner"],
                        "expected_delta_t": a["expected_delta_t"],
                        "calculation_mode": a["calculation_mode"],
                        "method": a["method"],
                        "cost_inr": a["cost_inr"],
                        "cost_basis": a["cost_basis"],
                        "why": a["reason"],
                    }
                    for a in plan.get("actions", [])
                ],
                "expected_delta_t": plan["expected"]["delta_t"],
                "residual_gap_t": plan["expected"]["residual_gap_t"],
            },
            note=plan["expected"]["note"],
        ),
        _section(
            "Why not the alternatives",
            [
                {"title": b["title"], "reason": b["constraint_summary"]}
                for b in plan.get("not_available", [])
            ],
            note=(
                "Actions Crucible AI evaluated and did not offer. Their absence from the "
                "recommendation is a finding, not an oversight."
            ),
        ),
        _section(
            "Constraints checked",
            plan.get("constraints_checked", []),
            note=(
                "A constraint recorded as not evaluated is treated as blocking for "
                "safety-relevant actions. Missing evidence is never read as permission."
            ),
        ),
        _section("Risks and trade-offs", plan.get("risks", [])),
    ]

    if precedent:
        sections.append(
            _section(
                "What happened last time",
                precedent,
                note=precedent.get("note"),
            )
        )

    sections.append(
        _section(
            "Approval",
            {
                "roles_required": plan.get("approval_required", []),
                "owners": plan.get("owners", []),
                "lifecycle_state": plan.get("lifecycle_state"),
            },
            note="No action may begin before a person with one of these roles approves it.",
        )
    )

    return {
        "available": True,
        "package_ref": f"DP-{mine_id[:6]}-{generated_at.strftime('%Y%m%d-%H%M%S')}",
        "mine_id": mine_id,
        "title": plan["title"],
        "severity": plan["severity"],
        "objective": objective.value,
        "prepared_by": prepared_by,
        "prepared_for": prepared_for,
        "generated_at": generated_at.isoformat(timespec="seconds"),
        "sections": sections,
        "summary": _summary(plan),
        "lineage": {
            "calculation_mode": plan["calculation_mode"],
            "evidence_quality": plan["evidence_quality"],
            "clock": clock.as_dict(),
            "data_caveat": clock.caveat,
        },
        "disclaimer": DISCLAIMER,
    }


def _mode_phrase(mode: str) -> str:
    return {
        CalculationMode.MODEL_BACKED.value: "from the production model",
        CalculationMode.HEURISTIC.value: "from a declared operational estimate, not the model",
        CalculationMode.INSUFFICIENT_DATA.value: "with insufficient data to attribute confidently",
    }.get(mode, "by an unreported method")


def _summary(plan: dict[str, Any]) -> str:
    """The paragraph an approver reads first. Assembled from plan values only."""
    parts: list[str] = [plan["situation"]]

    actions = plan.get("actions") or []
    if actions:
        lead = actions[0]
        delta = lead.get("expected_delta_t")
        parts.append(
            f"The recommended first action is to {lead['title'][0].lower()}{lead['title'][1:]}"
            + (
                f", expected to recover {delta:+,.1f} t "
                f"({_mode_phrase(lead['calculation_mode'])})."
                if delta is not None
                else ", whose effect could not be estimated."
            )
        )

        residual = plan["expected"].get("residual_gap_t")
        if residual is not None and residual > 0:
            parts.append(f"A gap of {residual:,.0f} t would remain against plan.")
        elif residual is not None:
            parts.append("Together the actions would bring production back to plan.")
    else:
        parts.append("No permitted action is currently available.")

    approvals = plan.get("approval_required") or []
    if approvals:
        parts.append(
            "Approval is required from "
            + " or ".join(r.replace("_", " ") for r in approvals)
            + " before any of it begins."
        )

    return " ".join(parts)


def as_markdown(package: dict[str, Any]) -> str:
    """A printable rendering, for attaching to a shift report or tabling."""
    if not package.get("available"):
        return f"# No decision required\n\n{package.get('reason', '')}\n"

    lines = [
        f"# {package['title']}",
        "",
        f"**{package['package_ref']}** · {package['mine_id']} · "
        f"severity {package['severity'].lower()} · objective "
        f"{package['objective'].replace('_', ' ').lower()}",
        "",
        f"Prepared by {package['prepared_by']} at {package['generated_at']}.",
        "",
        "## Summary",
        "",
        package["summary"],
        "",
    ]

    for section in package["sections"]:
        lines += [f"## {section['title']}", ""]
        lines += _render(section["body"])
        if section.get("note"):
            lines += ["", f"*{section['note']}*"]
        lines.append("")

    lineage = package["lineage"]
    lines += [
        "## Lineage",
        "",
        f"- Calculation: {lineage['calculation_mode']}",
        f"- Evidence quality: {lineage['evidence_quality']}",
        f"- Data reference: {lineage['clock']['mode']}"
        + (f" — {lineage['data_caveat']}" if lineage.get("data_caveat") else ""),
        "",
        "---",
        "",
        f"*{package['disclaimer']}*",
        "",
    ]
    return "\n".join(lines)


def _render(body: Any, depth: int = 0) -> list[str]:
    """Render a section body as Markdown, whatever shape it is."""
    indent = "  " * depth

    if body is None:
        return [f"{indent}_Not available._"]

    if isinstance(body, str):
        return [f"{indent}{body}"]

    if isinstance(body, (int, float)):
        return [f"{indent}{body:,}"]

    if isinstance(body, list):
        if not body:
            return [f"{indent}_None._"]
        out: list[str] = []
        for entry in body:
            if isinstance(entry, dict):
                label = (
                    entry.get("title")
                    or entry.get("label")
                    or entry.get("action")
                    or entry.get("plan_ref")
                    or ""
                )
                detail = entry.get("reason") or entry.get("summary") or entry.get("note") or ""
                out.append(f"{indent}- **{label}**" + (f" — {detail}" if detail else ""))
                extras = {
                    k: v
                    for k, v in entry.items()
                    if k not in {"title", "label", "action", "reason", "summary", "note", "plan_ref"}
                    and v is not None
                    and not isinstance(v, (dict, list))
                }
                for key, value in extras.items():
                    out.append(f"{indent}  - {key.replace('_', ' ')}: {value}")
            else:
                out.append(f"{indent}- {entry}")
        return out

    if isinstance(body, dict):
        out = []
        for key, value in body.items():
            pretty = key.replace("_", " ").capitalize()
            if isinstance(value, (dict, list)):
                out.append(f"{indent}- **{pretty}**")
                out += _render(value, depth + 1)
            else:
                out.append(
                    f"{indent}- **{pretty}**: "
                    + ("_not available_" if value is None else str(value))
                )
        return out

    return [f"{indent}{body}"]


__all__ = ["DISCLAIMER", "as_markdown", "build"]
