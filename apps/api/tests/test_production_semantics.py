"""apps/api/tests/test_production_semantics.py — Forecast vs shortfall semantic distinction tests."""
from fastapi.testclient import TestClient

from apps.api.core.security import create_access_token
from apps.api.main import app

client = TestClient(app)


def test_forecast_distinct_semantics():
    """Verify /forecast returns distinct gap and shortfall classifier fields."""
    token = create_access_token({"sub": "admin", "role": "super_admin"})
    res = client.get("/api/v1/production/mine-01/forecast", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()

    # Verify both distinct semantics exist
    assert "forecast" in data
    assert "p10" in data["forecast"]
    assert "p50" in data["forecast"]
    assert "p90" in data["forecast"]

    assert "gap" in data
    assert "tonnes" in data["gap"]
    assert "percentage" in data["gap"]
    assert "status" in data["gap"]

    assert "shortfall" in data
    assert "probability" in data["shortfall"]
    assert "threshold" in data["shortfall"]
    assert "alert" in data["shortfall"]
    assert data["shortfall"]["source"] == "classifier"

    # Verify backward compatibility
    assert "shortfall_probability" in data
    assert "planned_production_t" in data
