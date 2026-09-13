"""apps/api/tests/test_governance_lifecycle.py — Strict governance approval gate & safe promotion tests."""
from fastapi.testclient import TestClient

from apps.api.core.db import execute, query
from apps.api.core.security import create_access_token
from apps.api.main import app

client = TestClient(app)


def test_cannot_promote_without_prior_approval():
    """Verify that attempting to promote a challenger without prior approval raises HTTP 422."""
    token = create_access_token({"sub": "admin", "role": "super_admin"})
    headers = {"Authorization": f"Bearer {token}"}

    # Insert test unapproved challenger into registry
    rows = query(
        """INSERT INTO gov.model_registry
           (task, model, version, status, leakage_status, artifact_path)
           VALUES ('production_forecast', 'lightgbm', 'test-unapproved-v1', 'challenger', 'PASS', 'apps/ml/artifacts/production_forecast_champion.joblib')
           RETURNING id"""
    )
    model_id = rows[0]["id"]

    try:
        # Attempt to promote immediately without approve step
        res = client.post(f"/api/v1/models/{model_id}/promote", headers=headers)
        assert res.status_code == 422
        assert "must be in 'approved' status" in res.json()["detail"]

        # Now approve it
        app_res = client.post(f"/api/v1/models/{model_id}/approve", headers=headers)
        assert app_res.status_code == 200
        assert app_res.json()["status"] == "approved"

        # Now promotion should succeed
        prom_res = client.post(f"/api/v1/models/{model_id}/promote", headers=headers)
        assert prom_res.status_code == 200
        assert prom_res.json()["status"] == "champion"
        assert "PASSED" in prom_res.json()["smoke_test_status"]

    finally:
        # Cleanup test model
        execute("DELETE FROM gov.model_approvals WHERE model_id = %s", (model_id,))
        execute("DELETE FROM gov.model_registry WHERE id = %s", (model_id,))
