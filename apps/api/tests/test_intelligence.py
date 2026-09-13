"""apps/api/tests/test_intelligence.py — Intelligence Center API tests."""
from fastapi.testclient import TestClient

from apps.api.core.security import create_access_token
from apps.api.main import app

client = TestClient(app)


def test_mine_pulse_endpoint():
    """Verify /pulse computes multi-pillar scores."""
    token = create_access_token({"sub": "admin", "role": "super_admin"})
    res = client.get("/api/v1/intelligence/pulse", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert "overall_score" in data
    assert data["overall_score"] is None or (0 <= data["overall_score"] <= 100)
    assert "pillars" in data
    assert "production" in data["pillars"]
    assert "equipment" in data["pillars"]
    assert "exploration" in data["pillars"]


def test_top_issues_endpoint():
    """Verify /top-issues returns ranked issues with deep links."""
    token = create_access_token({"sub": "admin", "role": "super_admin"})
    res = client.get("/api/v1/intelligence/top-issues", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert "issues" in data
    assert isinstance(data["issues"], list)


def test_nl_query_production_intent():
    """Verify NL query identifies production risk intent."""
    token = create_access_token({"sub": "admin", "role": "super_admin"})
    res = client.post(
        "/api/v1/intelligence/query",
        json={"query": "What is our production shortfall forecast for this shift?"},
        headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 200
    data = res.json()
    assert data["intent"] == "production_risk"
    assert "evidence" in data
    assert len(data["evidence"]) > 0
    assert "recommendation" in data


def test_material_flow_endpoint():
    """Verify /material-flow returns value chain stages and bottleneck."""
    token = create_access_token({"sub": "admin", "role": "super_admin"})
    res = client.get("/api/v1/intelligence/material-flow", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert "stages" in data
    assert len(data["stages"]) == 6
    assert "primary_bottleneck" in data
