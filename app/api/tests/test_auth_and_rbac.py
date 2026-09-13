"""app/api/tests/test_auth_and_rbac.py — Authentication enforcement and domain-isolated RBAC tests."""
from fastapi.testclient import TestClient

from app.api.core.rbac import check_domain_access
from app.api.main import app

client = TestClient(app)


def test_invalid_token_returns_401_never_guest():
    """Verify that an invalid or malformed bearer token returns 401 Unauthorized, not guest."""
    headers = {"Authorization": "Bearer invalid.token.garbage12345"}
    res = client.get("/api/v1/auth/me", headers=headers)
    assert res.status_code == 401
    assert "Invalid or expired" in res.json()["detail"]


def test_unauthenticated_request_allowed_on_read_endpoint():
    """Unauthenticated request without token returns guest user on designated read endpoint."""
    res = client.get("/api/v1/auth/me")
    assert res.status_code == 200
    assert res.json()["role"] == "guest"


def test_unauthenticated_request_rejected_on_write_endpoint():
    """Write endpoints requiring authentication reject unauthenticated requests with 401."""
    res = client.post("/api/v1/decisions", json={"problem": "test", "recommendation": "test"})
    assert res.status_code == 401


def test_check_domain_access_rules():
    """Verify domain isolation rules across roles."""
    super_admin = {"role": "super_admin"}
    prod_admin = {"role": "production_admin"}
    equip_admin = {"role": "equipment_admin"}
    expl_admin = {"role": "exploration_admin"}
    planner = {"role": "mine_planner"}
    guest = {"role": "guest"}

    # Super admin has all domain access
    assert check_domain_access(super_admin, "production") is True
    assert check_domain_access(super_admin, "equipment") is True
    assert check_domain_access(super_admin, "exploration") is True

    # Domain admins restricted to their domains
    assert check_domain_access(prod_admin, "production") is True
    assert check_domain_access(prod_admin, "equipment") is False
    assert check_domain_access(prod_admin, "exploration") is False

    assert check_domain_access(equip_admin, "equipment") is True
    assert check_domain_access(equip_admin, "maintenance") is True
    assert check_domain_access(equip_admin, "production") is False

    assert check_domain_access(expl_admin, "exploration") is True
    assert check_domain_access(expl_admin, "production") is False

    assert check_domain_access(planner, "planning") is True
    assert check_domain_access(planner, "exploration") is False

    assert check_domain_access(guest, "production") is False
