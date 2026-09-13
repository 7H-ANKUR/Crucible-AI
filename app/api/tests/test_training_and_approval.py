"""app/api/tests/test_training_and_approval.py — Training runs and model governance tests."""
from fastapi.testclient import TestClient

from app.api.core.security import create_access_token
from app.api.main import app

client = TestClient(app)


def test_models_list_and_pending_endpoints():
    """Verify listing all models and pending challengers."""
    token = create_access_token({"sub": "admin", "role": "super_admin"})
    headers = {"Authorization": f"Bearer {token}"}

    res_all = client.get("/api/v1/models/all", headers=headers)
    assert res_all.status_code == 200
    assert "models" in res_all.json()

    res_pend = client.get("/api/v1/models/pending", headers=headers)
    assert res_pend.status_code == 200
    assert "challengers" in res_pend.json()


def test_training_runs_list():
    """Verify listing training runs."""
    token = create_access_token({"sub": "admin", "role": "super_admin"})
    headers = {"Authorization": f"Bearer {token}"}

    res = client.get("/api/v1/training/runs", headers=headers)
    assert res.status_code == 200
    assert "runs" in res.json()
