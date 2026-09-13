"""Tests for the decision operating model.

Most of these are guard tests: each asserts a property the rebuild established,
so a later change that quietly reintroduces a fabricated number, a fail-open
default or a mixed scope fails here rather than in front of a mine manager.

Marked with what they guard so a failure explains itself.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api.core import playbooks as playbook_engine
from app.api.core.clock import ClockMode, resolve_clock
from app.api.core.intent import classify
from app.api.core.mine_context import list_mines, resolve_mine_context
from app.api.core.decision_store import (
    LifecycleState,
    TRANSITIONS,
    allowed_from,
    can_transition,
)
from app.api.core.errors import MineContextRequired
from app.api.core.provenance import CalculationMode, EvidenceQuality, Measure, Scope
from app.api.core.rbac import check_mine_access
from app.api.core.security import create_access_token
from app.api.main import app

client = TestClient(app)


def _headers(role: str = "super_admin"):
    return {"Authorization": f"Bearer {create_access_token({'sub': role, 'role': role})}"}


def _a_mine() -> str:
    mines = list_mines()
    assert mines, "ops.mines is empty; these tests need at least one mine"
    return mines[0]["mine_id"]


# ---------------------------------------------------------------------------
# Mine scoping (§31, §42)
# ---------------------------------------------------------------------------

def test_unscoped_request_is_refused_not_defaulted():
    """The `mine_id="mine-01"` default answered for an arbitrary mine."""
    res = client.get("/api/v1/command-center/summary", headers=_headers())
    assert res.status_code == 400
    assert res.json()["detail"]["code"] == "MINE_CONTEXT_REQUIRED"


def test_mine_access_fails_closed_in_production():
    """`check_mine_access` ended in a bare `return True`."""
    from app.api.core import rbac

    original = rbac.settings.ENVIRONMENT
    try:
        rbac.settings.ENVIRONMENT = "production"
        assert check_mine_access({"role": "mine_planner", "username": "u"}, "ANY") is False
        assert check_mine_access({"role": "mine_planner", "allowed_mines": ["A"]}, "A") is True
        assert check_mine_access({"role": "mine_planner", "allowed_mines": ["A"]}, "B") is False
    finally:
        rbac.settings.ENVIRONMENT = original


def test_unauthorised_mine_is_indistinguishable_from_unknown():
    """Confirming a mine exists is itself a disclosure."""
    scoped = {"role": "mine_planner", "allowed_mines": ["NOT-A-REAL-MINE"]}
    with pytest.raises(MineContextRequired):
        resolve_mine_context(_a_mine(), scoped)


# ---------------------------------------------------------------------------
# Provenance and evidence (§10, §25, §33)
# ---------------------------------------------------------------------------

def test_unavailable_measure_never_renders_a_number():
    """A fabricated zero reads as a measurement."""
    measure = Measure.unavailable(
        label="Production impact", unit="t", scope=Scope.MINE,
        reason="Haulage telemetry is unavailable.",
    )
    assert measure.value is None
    assert measure.available is False
    assert measure.render() == "Not available"
    assert "0" not in measure.render()
    assert measure.calculation_mode is CalculationMode.INSUFFICIENT_DATA


def test_evidence_quality_is_ordered():
    assert EvidenceQuality.HIGH.rank > EvidenceQuality.MEDIUM.rank
    assert EvidenceQuality.LOW.rank > EvidenceQuality.UNAVAILABLE.rank


def test_every_command_center_number_declares_its_mode():
    """§33: no ambiguous values."""
    mine = _a_mine()
    res = client.get(f"/api/v1/command-center/summary?mine_id={mine}", headers=_headers())
    assert res.status_code == 200
    data = res.json()

    for signal in data["state"]["signals"]:
        assert signal["calculation_mode"] in {m.value for m in CalculationMode}
        assert signal["reason"], f"{signal['key']} states no reason"

    for item in data["attention"]["items"]:
        assert item["calculation_mode"] in {m.value for m in CalculationMode}
        # An item with no impact estimate must say why, not show zero.
        if item["impact_t"] is None:
            assert item["impact_basis"]


# ---------------------------------------------------------------------------
# Scope separation (§31)
# ---------------------------------------------------------------------------

def test_platform_health_is_not_mine_state():
    """Stale data is a platform problem, not a mining one."""
    mine = _a_mine()
    res = client.get(f"/api/v1/command-center/summary?mine_id={mine}", headers=_headers())
    data = res.json()

    assert data["state"]["state"] in {"NORMAL", "WATCH", "DISRUPTION", "CRITICAL", "UNKNOWN"}
    assert "state" in data["platform"]
    # They are separate objects and may legitimately disagree.
    assert data["platform"] is not data["state"]

    for signal in data["platform"]["signals"]:
        assert signal["scope"] == "PLATFORM"
    for signal in data["state"]["signals"]:
        assert signal["scope"] in ("MINE", "ASSET", "SHIFT")


# ---------------------------------------------------------------------------
# Clock (benchmark honesty, §34)
# ---------------------------------------------------------------------------

def test_benchmark_clock_states_its_reference_point():
    clock = resolve_clock(_a_mine())
    if clock.mode is ClockMode.BENCHMARK:
        assert clock.caveat and "not against the current date" in clock.caveat
        assert clock.dataset_epoch is not None
        assert clock.wall_clock_lag_days > 0
    else:
        assert clock.caveat is None or clock.mode is ClockMode.UNKNOWN


# ---------------------------------------------------------------------------
# Decision lifecycle (§35)
# ---------------------------------------------------------------------------

def test_lifecycle_has_nine_states():
    assert len(LifecycleState) == 9
    assert set(TRANSITIONS) == set(LifecycleState)


def test_learned_is_terminal():
    """A superseding decision is a new decision; the record of what was believed
    at the time must stay intact."""
    assert allowed_from(LifecycleState.LEARNED) == []


def test_no_shortcut_from_simulated_to_completed():
    assert not can_transition(LifecycleState.SIMULATED, LifecycleState.COMPLETED)
    assert can_transition(LifecycleState.SIMULATED, LifecycleState.READY_FOR_REVIEW)


def test_execution_cannot_precede_approval():
    assert not can_transition(LifecycleState.READY_FOR_REVIEW, LifecycleState.EXECUTING)
    assert can_transition(LifecycleState.APPROVED, LifecycleState.EXECUTING)


# ---------------------------------------------------------------------------
# Intent classification (§30)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "question,expected",
    [
        ("Which exploration target should we drill next?", "exploration_target"),
        ("What is our production forecast for this shift?", "production_risk"),
        ("Are we going to hit target today?", "production_risk"),
        ("Which machine is most likely to fail?", "equipment_risk"),
        ("What is limiting production right now?", "material_flow"),
        ("What happened last time we saw this?", "decision_history"),
        ("Is the champion model drifting?", "model_health"),
    ],
)
def test_intent_classification(question, expected):
    assert classify(question).intent == expected


def test_ambiguous_word_does_not_decide_intent():
    """`target` appeared in both production and exploration vocabularies, and
    production was tested first."""
    from app.api.core.intent import _AMBIGUOUS

    assert "target" in _AMBIGUOUS
    assert classify("Which exploration target?").intent == "exploration_target"
    assert classify("Will we hit target?").intent == "production_risk"


# ---------------------------------------------------------------------------
# Bottleneck (§16)
# ---------------------------------------------------------------------------

def test_unmeasured_stage_is_never_the_bottleneck():
    mine = _a_mine()
    res = client.get(f"/api/v1/command-center/bottlenecks?mine_id={mine}", headers=_headers())
    assert res.status_code == 200
    data = res.json()

    unmeasured = {s["key"] for s in data["stages"] if s["utilisation_pct"] is None}
    if data.get("bottleneck"):
        assert data["bottleneck"]["stage"] not in unmeasured

    for stage in data["stages"]:
        if stage["utilisation_pct"] is None:
            assert stage["calculation_mode"] == "INSUFFICIENT_DATA"
            assert stage["unavailable_reason"]


def test_every_stage_declares_how_capacity_was_established():
    mine = _a_mine()
    data = client.get(
        f"/api/v1/command-center/bottlenecks?mine_id={mine}", headers=_headers()
    ).json()
    for stage in data["stages"]:
        assert stage["basis"], f"{stage['key']} does not say how its capacity was set"


# ---------------------------------------------------------------------------
# Do-nothing projection (§6)
# ---------------------------------------------------------------------------

def test_do_nothing_states_its_assumptions():
    mine = _a_mine()
    data = client.get(
        f"/api/v1/command-center/do-nothing?mine_id={mine}", headers=_headers()
    ).json()

    if data["available"]:
        # It is an extrapolation of a measured rate, and must not claim otherwise.
        assert data["calculation_mode"] == "HEURISTIC"
        assert data["assumptions"]
        assert any("unchanged" in a.lower() for a in data["assumptions"])
    else:
        assert data["unavailable_reason"]


# ---------------------------------------------------------------------------
# Playbooks (§23)
# ---------------------------------------------------------------------------

def test_playbook_does_not_fire_on_unmeasured_signal():
    """Absence of evidence must not trigger a response."""
    clause = playbook_engine.TriggerClause(signal="bottleneck", operator="gte", value=1.0)
    unmeasured = {
        "bottleneck": {
            "label": "Material flow constraint",
            "severity": "NONE",
            "value": None,
            "calculation_mode": "INSUFFICIENT_DATA",
            "evidence": {},
        }
    }
    fired, why = clause.evaluate(unmeasured)
    assert fired is False
    assert "could not be measured" in why


def test_playbook_scoped_to_a_stage_ignores_other_stages():
    """A haulage playbook must not fire on a face constraint."""
    clause = playbook_engine.TriggerClause(
        signal="bottleneck", evidence_field="stage", equals="haulage"
    )
    face = {
        "bottleneck": {
            "label": "Material flow constraint",
            "severity": "WATCH",
            "value": 92.0,
            "calculation_mode": "MODEL_BACKED",
            "evidence": {"stage": "face"},
        }
    }
    fired, why = clause.evaluate(face)
    assert fired is False
    assert "not haulage" in why


def test_playbook_evaluation_reports_dormant_playbooks():
    """Without them there is no way to tell "nothing is wrong" from "never ran"."""
    result = playbook_engine.evaluate(_a_mine())
    assert "triggered" in result and "dormant" in result
    for entry in result["dormant"]:
        assert entry.get("reason"), f"{entry['playbook_ref']} gives no reason"


# ---------------------------------------------------------------------------
# Decision package (§39)
# ---------------------------------------------------------------------------

def test_decision_package_carries_lineage():
    from app.api.core.decision_package import build

    package = build(_a_mine(), prepared_by="test")
    if not package.get("available"):
        pytest.skip("nothing currently requires a decision at this mine")

    lineage = package["lineage"]
    assert lineage["calculation_mode"] in {m.value for m in CalculationMode}
    assert lineage["evidence_quality"] in {q.value for q in EvidenceQuality}
    assert lineage["clock"]["mode"]
    assert "does not perform operational actions" in package["disclaimer"]


def test_decision_package_shows_refused_options():
    """Their absence would read as never having been considered."""
    from app.api.core.decision_package import build

    package = build(_a_mine(), prepared_by="test")
    if not package.get("available"):
        pytest.skip("nothing currently requires a decision at this mine")

    titles = [s["title"] for s in package["sections"]]
    assert "Why not the alternatives" in titles
    assert "Constraints checked" in titles
    assert "If no action is taken" in titles


# ---------------------------------------------------------------------------
# Pagination (§44)
# ---------------------------------------------------------------------------

def test_response_plan_listing_is_paginated():
    mine = _a_mine()
    res = client.get(
        f"/api/v1/response-plans?mine_id={mine}&limit=5", headers=_headers()
    )
    assert res.status_code == 200
    body = res.json()
    for key in ("items", "total", "limit", "offset", "has_more"):
        assert key in body
    assert body["limit"] <= 5
