"""app/api/tests/test_decisions.py — Decision Memory and Outcome Feedback tests."""
from fastapi.testclient import TestClient

from app.api.core.security import create_access_token
from app.api.main import app

client = TestClient(app)


def test_record_decision_and_outcome_lifecycle():
    """Verify recording a decision and logging realized shift outcome."""
    token = create_access_token({"sub": "admin", "role": "super_admin"})
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Record Decision
    dec_res = client.post(
        "/api/v1/decisions",
        json={
            "problem": "Shift S2 Loader Deficit",
            "recommendation": "Redeploy auxiliary Loader LD-02 to South face",
            "status": "approved",
        },
        headers=headers,
    )
    assert dec_res.status_code == 200
    dec_data = dec_res.json()
    assert "decision_id" in dec_data
    decision_id = dec_data["decision_id"]

    # 2. Record Realized Outcome
    out_res = client.post(
        f"/api/v1/decisions/{decision_id}/outcome",
        json={
            "predicted_value": 50.0,
            "actual_value": 48.0,
            "note": "Shift completed with nominal cycle time",
        },
        headers=headers,
    )
    assert out_res.status_code == 200, f"Failed with {out_res.status_code}: {out_res.text}"
    out_data = out_res.json()
    assert out_data["decision_id"] == decision_id
    assert out_data["delta"] == -2.0
    assert out_data["effectiveness"] == 0.96
    # `status` is derived from lifecycle_state since migration 002;
    # recording an outcome advances the decision to MEASURED.
    assert out_data["status"] == "measured"

    # 3. List Decisions and verify joined outcome
    list_res = client.get("/api/v1/decisions", headers=headers)
    assert list_res.status_code == 200
    decisions = list_res.json()["decisions"]
    matched = next((d for d in decisions if d["id"] == decision_id), None)
    assert matched is not None
    assert matched["status"] == "measured"
    assert matched["delta"] == -2.0
