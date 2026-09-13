"""Tests for the canonical scenario engine.

These are guard tests as much as unit tests: several assert that specific
defects found during the rebuild audit cannot come back.
"""

from __future__ import annotations

import pytest

from app.api.core.constraints import (
    ConstraintCheck,
    ConstraintKind,
    ConstraintOutcome,
    ConstraintReport,
)
from app.api.core.evidence import (
    assess,
    completeness_factor,
    constraint_factor,
    freshness_factor,
    historical_factor,
    model_factor,
)
from app.api.core.provenance import CalculationMode, DataFreshness, EvidenceQuality
from app.api.core.scenario import (
    CATALOGUE,
    Flexibility,
    ScenarioControls,
    ScenarioObjective,
)
from app.api.core.scenario.ranking import rank, winners
from app.api.core.scenario.types import InterventionOutcome


# ---------------------------------------------------------------------------
# Constraints
# ---------------------------------------------------------------------------

def _check(kind: ConstraintKind, outcome: ConstraintOutcome, penalty: float = 0.0) -> ConstraintCheck:
    return ConstraintCheck(
        key="k", label="l", kind=kind, outcome=outcome, reason="r", penalty=penalty
    )


def test_unevaluated_hard_constraint_blocks():
    """The core safety property: absence of evidence is not evidence of safety.

    The replaced `optimizer.check_operational_constraints` returned
    "No live data available; assuming typical availability" with a feasibility
    multiplier of 1.0, approving actions on data that did not exist.
    """
    report = ConstraintReport(
        action_type="equipment_redeploy",
        checks=[_check(ConstraintKind.HARD, ConstraintOutcome.NOT_EVALUATED)],
    )
    assert report.feasible is False
    assert report.blockers


def test_unevaluated_soft_constraint_does_not_block():
    report = ConstraintReport(
        action_type="x",
        checks=[_check(ConstraintKind.SOFT, ConstraintOutcome.NOT_EVALUATED, penalty=0.3)],
    )
    assert report.feasible is True
    assert report.soft_penalty == pytest.approx(0.3)


def test_passing_soft_constraint_incurs_no_penalty():
    """A preference that holds is a reason for confidence, not a deduction."""
    report = ConstraintReport(
        action_type="x",
        checks=[_check(ConstraintKind.SOFT, ConstraintOutcome.PASSED, penalty=0.4)],
    )
    assert report.soft_penalty == 0.0


def test_unknown_action_is_not_assumed_safe():
    from app.api.core import constraints

    report = constraints.evaluate("something_nobody_defined", "ANY-MINE", {})
    assert report.feasible is False


# ---------------------------------------------------------------------------
# Evidence
# ---------------------------------------------------------------------------

def test_evidence_can_return_low():
    """Guards the defect this replaced.

    `scenario_engine` computed `model_conf = 85.0 if baseline_backed else 60.0`
    and graded `HIGH if model_conf > 80 else MEDIUM`, so LOW was unreachable.
    """
    result = assess(
        [
            freshness_factor(DataFreshness.EXPIRED, 900_000),
            completeness_factor(2, 40),
            model_factor(model_available=False, serving_status=None),
            historical_factor(0),
            constraint_factor(0, 3),
        ]
    )
    assert result.quality in (EvidenceQuality.LOW, EvidenceQuality.UNAVAILABLE)


def test_perfect_inputs_grade_high():
    result = assess(
        [
            freshness_factor(DataFreshness.LIVE, 60),
            completeness_factor(40, 40),
            model_factor(model_available=True, serving_status="SYNCED"),
            historical_factor(50),
            constraint_factor(3, 3),
        ]
    )
    assert result.quality is EvidenceQuality.HIGH


def test_missing_model_caps_grade_regardless_of_other_factors():
    """No model means heuristic, however fresh and complete the data is."""
    result = assess(
        [
            freshness_factor(DataFreshness.LIVE, 10),
            completeness_factor(40, 40),
            model_factor(model_available=False, serving_status=None),
            historical_factor(100),
            constraint_factor(3, 3),
        ]
    )
    assert result.quality.rank <= EvidenceQuality.LOW.rank
    assert any("model" in limiter.lower() for limiter in result.limiters)


def test_every_evidence_factor_states_a_reason():
    for factor in (
        freshness_factor(DataFreshness.STALE, 30_000),
        completeness_factor(10, 20),
        model_factor(model_available=True, serving_status="SYNC_PENDING"),
        historical_factor(4),
        constraint_factor(1, 3),
    ):
        assert factor.detail.strip(), f"{factor.key} produced no reason"


# ---------------------------------------------------------------------------
# Catalogue
# ---------------------------------------------------------------------------

def test_catalogue_is_the_only_definition():
    """Guards against the triplication being reintroduced.

    Matches the assignment, not the bare word — prose mentioning the old tables
    (this file included) must not trip the guard, or it becomes noise and gets
    deleted rather than fixed.
    """
    import pathlib
    import re

    pattern = re.compile(r"^_(?:HEURISTIC|ADJUSTABLE)\s*[:=]", re.MULTILINE)
    root = pathlib.Path(__file__).resolve().parents[1]
    hits = [
        path.name
        for path in root.rglob("*.py")
        if "__pycache__" not in str(path) and pattern.search(path.read_text(encoding="utf-8"))
    ]
    assert hits == [], f"duplicated intervention table reappeared in {hits}"


def test_intervention_effects_live_only_in_the_catalogue():
    """No router or core module may carry its own effect constants."""
    import pathlib
    import re

    root = pathlib.Path(__file__).resolve().parents[1]
    allowed = {"catalogue.py"}
    pattern = re.compile(r"heuristic_effect\s*=")
    hits = [
        path.name
        for path in root.rglob("*.py")
        if "__pycache__" not in str(path)
        and path.name not in allowed
        and pattern.search(path.read_text(encoding="utf-8"))
    ]
    assert hits == [], f"intervention effects defined outside the catalogue: {hits}"


def test_every_intervention_declares_tradeoffs():
    """A recommendation with no stated downside is a sales pitch."""
    for key, spec in CATALOGUE.items():
        assert spec.tradeoffs, f"{key} declares no trade-offs"
        assert spec.approval_roles, f"{key} declares no approver"
        assert spec.horizon in ("NOW", "NEXT", "NEXT_SHIFT"), key


# ---------------------------------------------------------------------------
# Ranking
# ---------------------------------------------------------------------------

def _outcome(key: str, delta: float, cost: float | None, risk: float) -> InterventionOutcome:
    return InterventionOutcome(
        key=key,
        title=key,
        description=key,
        magnitude=0.1,
        delta_t=delta,
        calculation_mode=CalculationMode.MODEL_BACKED,
        method="test",
        constraints=ConstraintReport(
            action_type=key,
            checks=[_check(ConstraintKind.HARD, ConstraintOutcome.PASSED)],
        ),
        evidence=assess([model_factor(model_available=True, serving_status="SYNCED")]),
        cost_inr=cost,
        risk_delta=risk,
    )


def test_objectives_can_disagree():
    """Nothing is best in the abstract — that is the point of the objective."""
    outcomes = [
        _outcome("big_expensive", delta=40.0, cost=900_000, risk=0.30),
        _outcome("small_cheap", delta=6.0, cost=8_000, risk=0.01),
    ]
    win = winners(outcomes)
    assert win["MAXIMIZE_PRODUCTION"] == "big_expensive"
    assert win["MINIMIZE_COST"] == "small_cheap"
    assert win["MINIMIZE_RISK"] == "small_cheap"


def test_unpriced_action_does_not_win_on_cost():
    """An action with no cost estimate is not free."""
    outcomes = [
        _outcome("priced", delta=10.0, cost=5_000, risk=0.0),
        _outcome("unpriced", delta=10.0, cost=None, risk=0.0),
    ]
    assert winners(outcomes)["MINIMIZE_COST"] == "priced"


def test_ranking_excludes_production_losing_actions():
    controls = ScenarioControls(mine_id="M", objective=ScenarioObjective.MAXIMIZE_PRODUCTION)
    outcomes = [
        _outcome("gain", delta=5.0, cost=1_000, risk=0.0),
        _outcome("loss", delta=-5.0, cost=1_000, risk=0.0),
    ]
    assert [o.key for o in rank(outcomes, controls)] == ["gain"]


def test_infeasible_action_is_never_ranked():
    controls = ScenarioControls(mine_id="M", objective=ScenarioObjective.BALANCED)
    blocked = _outcome("blocked", delta=100.0, cost=1.0, risk=0.0)
    blocked.constraints = ConstraintReport(
        action_type="blocked",
        checks=[_check(ConstraintKind.HARD, ConstraintOutcome.FAILED)],
    )
    assert rank([blocked], controls) == []


# ---------------------------------------------------------------------------
# Flexibility
# ---------------------------------------------------------------------------

def test_no_flexibility_means_no_magnitude():
    assert Flexibility.NONE.magnitude == 0.0
    assert Flexibility.HIGH.magnitude > Flexibility.LOW.magnitude
