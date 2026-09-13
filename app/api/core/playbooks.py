"""app/api/core/playbooks.py — encoding a mine's own response knowledge.

A playbook is the standing answer to a recurring situation: when *this* happens,
these are the steps we take, in this order, and this is who signs them off.

Why it matters more than a better model: what to do when the crusher backs up is
knowledge a site already has, held by the people who have done it. A platform
that cannot capture it will keep proposing generically reasonable actions while
the supervisor does the thing that actually works. Playbooks put that knowledge
where the platform can offer it.

**Boundaries this module holds:**

* A playbook *proposes*. Triggering one creates a draft response plan for a human
  to consider; it never approves or starts anything.
* Where a site has an approved emergency procedure, the playbook points to it
  (`site_procedure_ref`) rather than restating it. Crucible AI does not author safety
  procedure and must not appear to.
* Trigger conditions are evaluated against measured signals only. A playbook that
  fires on an unmeasured condition would be an alarm with no evidence behind it.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

from .db import query, transaction
from .errors import InsufficientData
from .provenance import CalculationMode
from .state_engine import Severity, mine_state

logger = logging.getLogger("crucible.playbooks")

#: Comparison operators a trigger may use. Deliberately small — a trigger
#: language rich enough to need a parser is one nobody will audit.
OPERATORS = {
    "gt": lambda a, b: a > b,
    "gte": lambda a, b: a >= b,
    "lt": lambda a, b: a < b,
    "lte": lambda a, b: a <= b,
    "eq": lambda a, b: a == b,
}

#: Severities that can satisfy a `severity_at_least` clause.
_SEVERITY_ORDER = {"NONE": 0, "WATCH": 1, "DISRUPTION": 2, "CRITICAL": 3}


@dataclass
class TriggerClause:
    """One condition. All clauses in a playbook must hold for it to fire."""

    signal: str
    operator: str | None = None
    value: float | None = None
    severity_at_least: str | None = None
    #: Narrows the clause to a field inside the signal's evidence. Without this,
    #: a haulage playbook triggers on any stage being constrained — including the
    #: face, which haulage actions cannot relieve.
    evidence_field: str | None = None
    equals: str | None = None

    def evaluate(self, signals: dict[str, dict[str, Any]]) -> tuple[bool, str]:
        """Returns (satisfied, why). An unmeasured signal never satisfies."""
        signal = signals.get(self.signal)

        if signal is None:
            return False, f"signal '{self.signal}' is not produced for this mine"

        # Narrowing clauses are checked first: a playbook scoped to one stage
        # must not fire on a different stage's constraint.
        narrowed = False
        if self.evidence_field is not None:
            observed = (signal.get("evidence") or {}).get(self.evidence_field)
            if observed is None:
                return False, (
                    f"{signal['label'].lower()} does not report "
                    f"'{self.evidence_field}'"
                )
            if self.equals is not None and str(observed) != str(self.equals):
                return False, (
                    f"the constrained stage is {observed}, not {self.equals}"
                )
            narrowed = True

        if signal.get("calculation_mode") == CalculationMode.INSUFFICIENT_DATA.value:
            # The important case: a trigger must not fire on absence. "We cannot
            # measure haulage" is not evidence that haulage is fine, but neither
            # is it grounds to open an incident.
            return False, f"{signal['label'].lower()} could not be measured"

        if self.severity_at_least:
            actual = _SEVERITY_ORDER.get(signal.get("severity", "NONE"), 0)
            needed = _SEVERITY_ORDER.get(self.severity_at_least, 99)
            ok = actual >= needed
            return ok, (
                f"{signal['label'].lower()} is {signal.get('severity', 'NONE').lower()}"
                + ("" if ok else f", below the required {self.severity_at_least.lower()}")
            )

        if self.operator and self.value is not None:
            observed = signal.get("value")
            if observed is None:
                return False, f"{signal['label'].lower()} has no measured value"
            compare = OPERATORS.get(self.operator)
            if compare is None:
                return False, f"unknown operator '{self.operator}'"
            ok = compare(float(observed), float(self.value))
            return ok, (
                f"{signal['label'].lower()} is {float(observed):.1f} "
                f"{'' if ok else 'not '}{self.operator} {self.value}"
            )

        # A clause that only narrows is satisfied by the narrowing itself: it
        # exists to scope a playbook to one stage, not to assert a threshold.
        if narrowed:
            return True, (
                f"{signal['label'].lower()} concerns "
                f"{(signal.get('evidence') or {}).get(self.evidence_field)}"
            )

        return False, "the clause specifies no condition"

    def as_dict(self) -> dict[str, Any]:
        return {
            "signal": self.signal,
            "operator": self.operator,
            "value": self.value,
            "severity_at_least": self.severity_at_least,
            "evidence_field": self.evidence_field,
            "equals": self.equals,
        }


@dataclass
class PlaybookStep:
    order: int
    action: str
    #: A catalogue intervention key, when the step is something Crucible AI can model.
    intervention_key: str | None = None
    owner: str | None = None
    #: True when a person must confirm before the next step is offered.
    requires_confirmation: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "order": self.order,
            "action": self.action,
            "intervention_key": self.intervention_key,
            "owner": self.owner,
            "requires_confirmation": self.requires_confirmation,
        }


@dataclass
class Playbook:
    playbook_ref: str
    name: str
    incident_type: str
    description: str | None
    mine_id: str | None
    trigger: list[TriggerClause] = field(default_factory=list)
    steps: list[PlaybookStep] = field(default_factory=list)
    site_procedure_ref: str | None = None
    active: bool = True
    created_by: str = "system"

    def as_dict(self) -> dict[str, Any]:
        return {
            "playbook_ref": self.playbook_ref,
            "name": self.name,
            "incident_type": self.incident_type,
            "description": self.description,
            "mine_id": self.mine_id,
            "scope": "this mine" if self.mine_id else "all mines",
            "trigger": [c.as_dict() for c in self.trigger],
            "steps": [s.as_dict() for s in self.steps],
            "site_procedure_ref": self.site_procedure_ref,
            "active": self.active,
            "created_by": self.created_by,
        }


# ---------------------------------------------------------------------------
# Built-in starting set
# ---------------------------------------------------------------------------

#: Shipped as a starting point, not as authority. These encode ordinary mining
#: practice; a site is expected to edit them to match its own procedures, which
#: is the entire purpose of the feature.
BUILT_IN: tuple[Playbook, ...] = (
    Playbook(
        playbook_ref="PB-PRODUCTION-GAP",
        name="Production falling behind plan",
        incident_type="PRODUCTION_SHORTFALL",
        description=(
            "Production has been below plan across recent shifts. Establish which "
            "stage is binding before moving any equipment."
        ),
        mine_id=None,
        trigger=[TriggerClause(signal="production_gap", severity_at_least="DISRUPTION")],
        steps=[
            PlaybookStep(1, "Confirm the shortfall against the shift plan with the control room.",
                         owner="Shift Supervisor", requires_confirmation=True),
            PlaybookStep(2, "Identify the binding stage from the material flow analysis.",
                         owner="Production Engineer"),
            PlaybookStep(3, "Recover lost operating time before committing equipment moves.",
                         intervention_key="extend_operating_hours", owner="Shift Supervisor"),
            PlaybookStep(4, "Reallocate haulage to the constrained stage.",
                         intervention_key="equipment_redeploy", owner="Fleet Coordinator"),
            PlaybookStep(5, "Record the outcome against the prediction at end of shift.",
                         owner="Shift Supervisor", requires_confirmation=True),
        ],
    ),
    Playbook(
        playbook_ref="PB-HAULAGE-BOTTLENECK",
        name="Haulage is the binding constraint",
        incident_type="HAULAGE_BOTTLENECK",
        description="Cycle time or queueing has made haulage the limiting stage.",
        mine_id=None,
        trigger=[
            TriggerClause(signal="bottleneck", evidence_field="stage", equals="haulage"),
            TriggerClause(signal="bottleneck", operator="gte", value=85.0),
        ],
        steps=[
            PlaybookStep(1, "Confirm the queue at the loading face and at the tip.",
                         owner="Dispatch", requires_confirmation=True),
            PlaybookStep(2, "Check the haul road condition on the active corridor.",
                         owner="Dispatch"),
            PlaybookStep(3, "Evaluate an alternative haul route.",
                         intervention_key="fleet_reroute", owner="Dispatch"),
            PlaybookStep(4, "Stagger departures to break up the queue.",
                         owner="Dispatch"),
        ],
    ),
    Playbook(
        playbook_ref="PB-FACE-CONSTRAINT",
        name="Face preparation is the binding constraint",
        incident_type="PRODUCTION_SHORTFALL",
        description=(
            "Broken ore at the face is limiting production. Moving haulage will "
            "not help: the trucks have nothing more to carry."
        ),
        mine_id=None,
        trigger=[
            TriggerClause(signal="bottleneck", evidence_field="stage", equals="face"),
            TriggerClause(signal="bottleneck", operator="gte", value=85.0),
        ],
        steps=[
            PlaybookStep(1, "Confirm how much broken ore remains available at the face.",
                         owner="Production Engineer", requires_confirmation=True),
            PlaybookStep(2, "Check drill availability and the blast schedule.",
                         owner="Drill & Blast Engineer"),
            PlaybookStep(3, "Bring the next blast forward if the shift window allows it.",
                         intervention_key="blast_reschedule", owner="Drill & Blast Engineer"),
            PlaybookStep(4, "Recover lost face time before committing equipment moves.",
                         intervention_key="extend_operating_hours", owner="Shift Supervisor"),
        ],
    ),
    Playbook(
        playbook_ref="PB-EQUIPMENT-RISK",
        name="Fleet failure exposure is elevated",
        incident_type="EQUIPMENT_RISK",
        description=(
            "Several units are flagged for near-term failure. Inspect before "
            "redeploying, so a failing unit is not moved onto the critical path."
        ),
        mine_id=None,
        trigger=[TriggerClause(signal="equipment_risk", severity_at_least="WATCH")],
        steps=[
            PlaybookStep(1, "Inspect the flagged units before any reallocation.",
                         owner="Maintenance Manager", requires_confirmation=True),
            PlaybookStep(2, "Confirm which units are genuinely available.",
                         owner="Maintenance Manager"),
            PlaybookStep(3, "Reallocate only low-risk units to the constrained stage.",
                         intervention_key="equipment_redeploy", owner="Fleet Coordinator"),
            PlaybookStep(4, "Schedule servicing for the flagged units in the next low-production window.",
                         owner="Maintenance Manager"),
        ],
    ),
)


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

def _row_to_playbook(row: dict[str, Any]) -> Playbook:
    trigger_spec = json.loads(row.get("trigger_spec") or "[]")
    steps_spec = json.loads(row.get("steps") or "[]")
    return Playbook(
        playbook_ref=row["playbook_ref"],
        name=row["name"],
        incident_type=row["incident_type"],
        description=row.get("description"),
        mine_id=row.get("mine_id"),
        trigger=[TriggerClause(**c) for c in trigger_spec],
        steps=[PlaybookStep(**s) for s in steps_spec],
        site_procedure_ref=row.get("site_procedure_ref"),
        active=bool(row.get("active", True)),
        created_by=row.get("created_by") or "system",
    )


def list_playbooks(mine_id: str | None = None, *, include_inactive: bool = False) -> list[Playbook]:
    """Playbooks applying to a mine: its own, plus platform-wide ones."""
    where = ["(mine_id = %s OR mine_id IS NULL)"] if mine_id else ["TRUE"]
    params: list[Any] = [mine_id] if mine_id else []
    if not include_inactive:
        where.append("active = TRUE")

    try:
        rows = query(
            f"""SELECT playbook_ref, mine_id, name, incident_type, description,
                       trigger_spec, steps, site_procedure_ref, active, created_by
                FROM gov.playbooks
                WHERE {' AND '.join(where)}
                ORDER BY mine_id NULLS LAST, playbook_ref""",
            tuple(params),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Playbook store unavailable: %s", exc)
        return list(BUILT_IN)

    stored = [_row_to_playbook(r) for r in rows]

    # Built-ins fill in only where a site has not defined its own for that
    # incident type. A site's own procedure always wins.
    covered = {p.incident_type for p in stored}
    return stored + [p for p in BUILT_IN if p.incident_type not in covered]


def save_playbook(playbook: Playbook, *, actor_id: str, actor_role: str) -> dict[str, Any]:
    """Create or replace a playbook, with an audit entry in the same transaction."""
    with transaction() as tx:
        tx.execute(
            """INSERT INTO gov.playbooks
                 (playbook_ref, mine_id, name, incident_type, description,
                  trigger_spec, steps, site_procedure_ref, active, created_by)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (playbook_ref) DO UPDATE SET
                 mine_id = EXCLUDED.mine_id,
                 name = EXCLUDED.name,
                 incident_type = EXCLUDED.incident_type,
                 description = EXCLUDED.description,
                 trigger_spec = EXCLUDED.trigger_spec,
                 steps = EXCLUDED.steps,
                 site_procedure_ref = EXCLUDED.site_procedure_ref,
                 active = EXCLUDED.active,
                 updated_at = NOW()""",
            (
                playbook.playbook_ref, playbook.mine_id, playbook.name,
                playbook.incident_type, playbook.description,
                json.dumps([c.as_dict() for c in playbook.trigger]),
                json.dumps([s.as_dict() for s in playbook.steps]),
                playbook.site_procedure_ref, playbook.active, actor_id,
            ),
        )
        tx.execute(
            """INSERT INTO gov.audit_log
                 (event_type, actor_id, actor_role, entity_type, entity_id, payload)
               VALUES ('playbook.saved', %s, %s, 'playbook', %s, %s)""",
            (
                actor_id, actor_role, playbook.playbook_ref,
                json.dumps({"name": playbook.name, "incident_type": playbook.incident_type}),
            ),
        )
    return {"playbook_ref": playbook.playbook_ref, "saved": True}


def seed_built_ins(actor_id: str = "system") -> int:
    """Write the built-in playbooks so a site can edit them."""
    saved = 0
    for playbook in BUILT_IN:
        try:
            save_playbook(playbook, actor_id=actor_id, actor_role="system")
            saved += 1
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not seed %s: %s", playbook.playbook_ref, exc)
    return saved


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------

def evaluate(mine_id: str) -> dict[str, Any]:
    """Which playbooks apply to the mine's current state, and why.

    Playbooks that did *not* fire are returned with their reason. A response
    system that only shows what triggered gives no way to tell "nothing is wrong"
    from "the check never ran".
    """
    state = mine_state(mine_id)
    signals = {s["key"]: s for s in state["signals"]}

    triggered: list[dict[str, Any]] = []
    dormant: list[dict[str, Any]] = []

    for playbook in list_playbooks(mine_id):
        if not playbook.trigger:
            dormant.append(
                {
                    "playbook_ref": playbook.playbook_ref,
                    "name": playbook.name,
                    "reason": "no trigger condition is defined",
                }
            )
            continue

        results = [clause.evaluate(signals) for clause in playbook.trigger]
        fired = all(ok for ok, _ in results)
        because = "; ".join(why for _, why in results)

        entry = {
            "playbook_ref": playbook.playbook_ref,
            "name": playbook.name,
            "incident_type": playbook.incident_type,
            "description": playbook.description,
            "because": because,
            "site_procedure_ref": playbook.site_procedure_ref,
        }

        if fired:
            entry["steps"] = [s.as_dict() for s in playbook.steps]
            triggered.append(entry)
        else:
            entry["reason"] = because
            dormant.append(entry)

    return {
        "mine_id": mine_id,
        "state": state["state"],
        "triggered": triggered,
        "dormant": dormant,
        "note": (
            "A triggered playbook proposes steps for authorised personnel. Crucible AI "
            "does not start any of them, and where a site emergency procedure "
            "applies, that procedure takes precedence over these steps."
        ),
    }


def get(playbook_ref: str) -> Playbook:
    for playbook in list_playbooks(None, include_inactive=True):
        if playbook.playbook_ref == playbook_ref:
            return playbook
    raise InsufficientData(
        f"No playbook '{playbook_ref}' exists.", required_for="playbook lookup"
    )


__all__ = [
    "BUILT_IN",
    "Playbook",
    "PlaybookStep",
    "TriggerClause",
    "evaluate",
    "get",
    "list_playbooks",
    "save_playbook",
    "seed_built_ins",
]
