"""apps/api/tests/test_scenarios_and_optimizer.py — Constraint-aware scenario optimizer tests."""
from apps.api.core.optimizer import (
    check_operational_constraints,
    optimize_interventions,
)


def test_constraint_checking_blast_night_shift():
    """Verify DGMS safety lockout on night shift blasting (S3)."""
    res = check_operational_constraints("mine-01", "blast_reschedule", {"shift": "S3"})
    assert res["feasible"] is False
    assert "night shift" in res["reason"].lower()


def test_constraint_checking_blast_day_shift():
    """Verify daylight shift blast permits proceeding."""
    res = check_operational_constraints("mine-01", "blast_reschedule", {"shift": "S1"})
    assert res["feasible"] is True


def test_optimize_interventions_ranking():
    """Verify optimizer returns ranked list with efficiency scores."""
    ranked = optimize_interventions("mine-01", 180.0, 200.0)
    assert len(ranked) > 0
    # Rank 1 should have highest efficiency score
    assert ranked[0]["rank"] == 1
    for item in ranked:
        assert "expected_gain_t" in item
        assert "cost_inr" in item
        assert "feasibility" in item
        assert "constraints_checked" in item
        assert "assumption" in item
