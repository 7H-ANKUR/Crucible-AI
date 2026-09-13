"""apps/api/tests/test_rbac.py — RBAC permissions and role hierarchy tests."""
from fastapi.testclient import TestClient

from apps.api.core.rbac import ROLE_DEPARTMENT, VALID_ROLES
from apps.api.core.security import create_access_token
from apps.api.main import app

client = TestClient(app)


def test_valid_roles_coverage():
    """Verify all expected domain and admin roles exist."""
    assert "super_admin" in VALID_ROLES
    assert "management" in VALID_ROLES
    assert "production_admin" in VALID_ROLES
    assert "exploration_admin" in VALID_ROLES
    assert "equipment_admin" in VALID_ROLES
    assert "mine_planner" in VALID_ROLES


def test_role_department_mapping():
    """Verify department assignments for cross-domain checks."""
    assert ROLE_DEPARTMENT["super_admin"] == "all"
    assert ROLE_DEPARTMENT["production_admin"] == "production"
    assert ROLE_DEPARTMENT["exploration_admin"] == "exploration"
    assert ROLE_DEPARTMENT["equipment_admin"] == "equipment"
    assert ROLE_DEPARTMENT["mine_planner"] == "planning"


def test_unauthenticated_request_defaults_to_guest():
    """Unauthenticated requests default to guest role with read-only access."""
    res = client.get("/api/v1/auth/me")
    assert res.status_code == 200
    assert res.json()["role"] == "guest"


def test_authenticated_request_accepted():
    """Endpoints succeed with valid demo token and resolve authenticated user identity."""
    token = create_access_token({"sub": "admin", "role": "super_admin"})
    res = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["username"] == "admin"
    assert data["role"] == "super_admin"
