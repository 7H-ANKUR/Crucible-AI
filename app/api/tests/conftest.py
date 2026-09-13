"""app/api/tests/conftest.py — Global pytest fixtures and test setup."""
import os

import pytest

# Ensure demo bootstrap is enabled with test passwords before importing security
os.environ["DEMO_BOOTSTRAP_ENABLED"] = "true"
os.environ["DEMO_ADMIN_PASSWORD"] = "test-admin-secret"
os.environ["DEMO_USER_PASSWORD"] = "test-user-secret"

from app.api.core import security
from app.api.core.db import init_db
from app.api.core.ml_loader import load_all_models

# Populate demo users in security module
security._DEMO_ENABLED = True
security._ADMIN_PW = "test-admin-secret"
security._USER_PW = "test-user-secret"
security.DEMO_USERS = {
    "admin": {"password": "test-admin-secret", "role": "super_admin", "name": "Test Admin"},
    "platform_admin": {"password": "test-admin-secret", "role": "super_admin", "name": "Priya Admin"},
    "production_admin": {"password": "test-admin-secret", "role": "production_admin", "name": "Sunita Ops"},
    "mine_planner": {"password": "test-user-secret", "role": "mine_planner", "name": "Vikram Plan"},
}


@pytest.fixture(scope="session", autouse=True)
def setup_test_environment():
    """Initializes the database connection pool and loads ML models for tests."""
    init_db()
    load_all_models()
    yield
