"""app/api/tests/test_intelligence.py — Intelligence Center API tests.

These previously called mine-scoped endpoints with no mine and asserted 200.
That passed only because the endpoints defaulted to ``mine_id="mine-01"`` —
answering confidently about an arbitrary mine the caller had not asked for and
might not be authorised to see. The tests were encoding the vulnerability.

They now assert the opposite: an unscoped request is refused, and a scoped one
succeeds.
"""

from fastapi.testclient import TestClient

from app.api.core.mine_context import list_mines
from app.api.core.security import create_access_token
from app.api.main import app

client = TestClient(app)


def _headers():
    token = create_access_token({"sub": "admin", "role": "super_admin"})
    return {"Authorization": f"Bearer {token}"}


def _a_real_mine() -> str:
    mines = list_mines()
    assert mines, "ops.mines is empty; intelligence tests need at least one mine"
    return mines[0]["mine_id"]


# ---------------------------------------------------------------------------
# Mine scope is mandatory
# ---------------------------------------------------------------------------

def test_pulse_without_mine_is_refused():
    """No silent substitution of an arbitrary mine."""
    res = client.get("/api/v1/intelligence/pulse", headers=_headers())
    assert res.status_code == 400
    detail = res.json()["detail"]
    assert detail["code"] == "MINE_CONTEXT_REQUIRED"
    # The refusal must tell the caller what they *can* ask for.
    assert isinstance(detail.get("available_mines"), list)


def test_top_issues_without_mine_is_refused():
    res = client.get("/api/v1/intelligence/top-issues", headers=_headers())
    assert res.status_code == 400
    assert res.json()["detail"]["code"] == "MINE_CONTEXT_REQUIRED"


# ---------------------------------------------------------------------------
# Scoped requests still work
# ---------------------------------------------------------------------------

def test_mine_pulse_endpoint():
    """Verify /pulse computes multi-pillar scores for an explicit mine."""
    res = client.get(
        f"/api/v1/intelligence/pulse?mine_id={_a_real_mine()}", headers=_headers()
    )
    assert res.status_code == 200
    data = res.json()
    assert "overall_score" in data
    assert data["overall_score"] is None or (0 <= data["overall_score"] <= 100)
    assert "pillars" in data
    for pillar in ("production", "equipment", "exploration"):
        assert pillar in data["pillars"]


def test_top_issues_endpoint():
    """Verify /top-issues returns ranked issues with deep links."""
    res = client.get(
        f"/api/v1/intelligence/top-issues?mine_id={_a_real_mine()}", headers=_headers()
    )
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data.get("issues"), list)


def test_nl_query_production_intent():
    """Verify NL query identifies production risk intent."""
    res = client.post(
        "/api/v1/intelligence/query",
        json={
            "query": "What is our production shortfall forecast for this shift?",
            "mine_id": _a_real_mine(),
        },
        headers=_headers(),
    )
    assert res.status_code == 200
    data = res.json()
    assert data["intent"] == "production_risk"
    assert data["evidence"]
    assert "recommendation" in data


def test_material_flow_endpoint():
    """Verify /material-flow returns value chain stages and bottleneck."""
    res = client.get("/api/v1/intelligence/material-flow", headers=_headers())
    assert res.status_code == 200
    data = res.json()
    assert len(data["stages"]) == 6
    assert "primary_bottleneck" in data
