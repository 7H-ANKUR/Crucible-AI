"""apps/api/tests/test_data_hub_lifecycle.py — End-to-end Data Hub lifecycle tests."""
import io

import pandas as pd
from fastapi.testclient import TestClient

from apps.api.core.db import execute
from apps.api.core.security import create_access_token
from apps.api.main import app

client = TestClient(app)


def test_data_hub_full_lifecycle():
    """Verify upload -> multi-version -> validate -> canonicalize -> approve workflow."""
    admin_token = create_access_token({"sub": "admin", "role": "super_admin"})
    headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Create compliant test CSV
    df = pd.DataFrame({
        "date": [f"2026-08-{i:02d}" for i in range(1, 15)],
        "mine_id": ["mine-01"] * 14,
        "planned_production_t": [150.0 + i for i in range(14)],
        "actual_production_t": [148.0 + i for i in range(14)],
        "ore_grade_mn_pct": [32.5] * 14,
        "working_hours": [8.0] * 14,
    })
    csv_bytes = df.to_csv(index=False).encode("utf-8")

    ds_name = "test_lifecycle_dataset"

    try:
        # 2. Upload v1
        res_v1 = client.post(
            "/api/v1/data/upload",
            data={"domain": "production", "name": ds_name, "description": "Test dataset for lifecycle"},
            files={"file": ("test_prod_v1.csv", io.BytesIO(csv_bytes), "text/csv")},
            headers=headers,
        )
        assert res_v1.status_code == 200
        data_v1 = res_v1.json()
        assert data_v1["version_tag"] == "v1"
        assert data_v1["parent_version_id"] is None
        assert data_v1["checksum_sha256"] is not None
        v1_id = data_v1["version_id"]

        # 3. Upload v2 with same dataset name -> auto-increments version and sets parent
        res_v2 = client.post(
            "/api/v1/data/upload",
            data={"domain": "production", "name": ds_name, "description": "Version 2 update"},
            files={"file": ("test_prod_v2.csv", io.BytesIO(csv_bytes), "text/csv")},
            headers=headers,
        )
        assert res_v2.status_code == 200
        data_v2 = res_v2.json()
        assert data_v2["version_tag"] == "v2"
        assert data_v2["parent_version_id"] == v1_id
        v2_id = data_v2["version_id"]

        # 4. Run validation on v2
        val_res = client.post(f"/api/v1/data/versions/{v2_id}/validate", headers=headers)
        assert val_res.status_code == 200
        val_data = val_res.json()
        assert val_data["status"] == "VALIDATED"
        assert val_data["quality_score"] >= 80.0
        assert val_data["canonical_checksum_sha256"] is not None
        assert val_data["canonical_row_count"] == 14
        assert len(val_data["checks"]) == 25

        # 5. Approve v2 for training
        app_res = client.post(
            f"/api/v1/data/versions/{v2_id}/approve",
            json={"note": "Approved for test training run"},
            headers=headers,
        )
        assert app_res.status_code == 200
        assert app_res.json()["status"] == "APPROVED_FOR_TRAINING"

    finally:
        # Cleanup
        execute("DELETE FROM hub.datasets WHERE name = %s", (ds_name,))


def test_domain_isolated_rbac_upload_rejection():
    """Verify that an exploration admin cannot upload production datasets."""
    token = create_access_token({"sub": "arjun", "role": "exploration_admin"})
    headers = {"Authorization": f"Bearer {token}"}

    csv_bytes = b"date,mine_id\n2026-08-01,mine-01"
    res = client.post(
        "/api/v1/data/upload",
        data={"domain": "production", "name": "unauthorized_upload"},
        files={"file": ("test.csv", io.BytesIO(csv_bytes), "text/csv")},
        headers=headers,
    )
    assert res.status_code == 403
    assert "not authorized" in res.json()["detail"]
