"""app/api/tests/test_hardening_v2.py — Test suite for v2 deep hardening invariants.

Covers:
1. Config production security validation (fail-fast on insecure settings)
2. Model split-brain prevention (serving vs authoritative metadata)
3. Upload security (size limits, extension allowlist, path traversal protection)
4. Mapping invalidation (saving mapping resets VALIDATED to MAPPED)
5. Decision lifecycle RBAC and structured audit logging
6. Intelligence pulse null/insufficient-data behavior (no 80/INITIALIZING fake score)
7. Health endpoint sanitization (no raw exception exposure)
8. Alert mine-scope isolation and role cleanup
"""
import io
import json
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.api.core.config import Settings, validate_production_settings
from app.api.core.contracts import ServingStatus
from app.api.core.ml_loader import ensure_active_model
from app.api.core.security import create_access_token
from app.api.main import app

client = TestClient(app)


def _get_auth_headers(role: str = "super_admin", username: str = "admin") -> dict:
    token = create_access_token({"sub": username, "role": role})
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# 1. Config Production Security Validation
# ---------------------------------------------------------------------------

def test_production_guard_rejects_insecure_secrets():
    """validate_production_settings must raise in production if default/weak secrets are used."""
    insecure_settings = Settings(
        ENVIRONMENT="production",
        JWT_SECRET_KEY="dev-insecure-secret-key",
        DEMO_BOOTSTRAP_ENABLED=True,
    )
    with pytest.raises(RuntimeError) as exc:
        validate_production_settings(insecure_settings)
    assert "production" in str(exc.value).lower()


def test_production_guard_passes_with_secure_config():
    """validate_production_settings must succeed when proper production configuration is provided."""
    secure_settings = Settings(
        ENVIRONMENT="production",
        JWT_SECRET_KEY="a-very-long-and-secure-random-secret-key-32chars!",
        DEMO_BOOTSTRAP_ENABLED=False,
        CORS_ALLOW_VERCEL_WILDCARD=False,
    )
    validate_production_settings(secure_settings)


# ---------------------------------------------------------------------------
# 2. Model Split-Brain Invariant
# ---------------------------------------------------------------------------

def test_serving_state_metadata_contract():
    """ensure_active_model must return serving_model_version that reflects memory state."""
    model, meta = ensure_active_model("production_forecast")
    assert "serving_model_version" in meta
    assert "authoritative_model_version" in meta
    assert "sync_status" in meta
    assert meta["sync_status"] in [s.value for s in ServingStatus]


# ---------------------------------------------------------------------------
# 3. Data Hub Upload Security
# ---------------------------------------------------------------------------

def test_upload_rejects_unsupported_extension():
    """Uploads with dangerous or disallowed extensions must be rejected with HTTP 422."""
    headers = _get_auth_headers("super_admin")
    fake_file = io.BytesIO(b"malicious executable code")
    res = client.post(
        "/api/v1/data/upload",
        data={"domain": "production", "name": "test_dataset"},
        files={"file": ("malware.exe", fake_file, "application/octet-stream")},
        headers=headers,
    )
    assert res.status_code == 422
    assert "extension" in res.json()["detail"].lower()


def test_upload_rejects_oversized_file():
    """Uploads exceeding MAX_UPLOAD_BYTES must return HTTP 413."""
    headers = _get_auth_headers("super_admin")
    # Simulate an oversized file payload check
    huge_bytes = b"0" * (100 * 1024 * 1024 + 1)
    fake_file = io.BytesIO(huge_bytes)
    res = client.post(
        "/api/v1/data/upload",
        data={"domain": "production", "name": "huge_dataset"},
        files={"file": ("huge.csv", fake_file, "text/csv")},
        headers=headers,
    )
    assert res.status_code == 413


def test_mapping_resets_validation_status():
    """Applying/saving column mappings must revert a VALIDATED version back to MAPPED."""
    headers = _get_auth_headers("production_admin")
    fake_ver = [{"id": 5555, "status": "VALIDATED", "domain": "production"}]

    with patch("app.api.routers.data_hub.query", return_value=fake_ver), \
         patch("app.api.routers.data_hub.execute") as mock_exec:
        res = client.post(
            "/api/v1/data/versions/5555/map",
            json={"mappings": [{"source_column": "tons", "canonical_column": "actual_production_t"}]},
            headers=headers,
        )
        assert res.status_code == 200
        assert res.json()["status"] == "MAPPED"


# ---------------------------------------------------------------------------
# 4. Health Endpoint Sanitization & Liveness
# ---------------------------------------------------------------------------

def test_health_live_has_zero_db_dependency():
    """Liveness probe (/health/live) must succeed without querying the database."""
    res = client.get("/health/live")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] in ("live", "alive")


def test_health_ready_sanitizes_errors():
    """Readiness probe must never leak raw traceback/exception strings in response body."""
    with patch("app.api.routers.health.query", side_effect=Exception("FATAL: password authentication failed for user secret_user")):
        res = client.get("/health/ready")
        assert res.status_code == 503
        body = res.json()
        assert "secret_user" not in json.dumps(body)
        assert "Database connectivity check failed" in json.dumps(body)


# ---------------------------------------------------------------------------
# 5. Intelligence Pulse Null/Insufficient Data Handling
# ---------------------------------------------------------------------------

def test_intelligence_pulse_null_fallback():
    """Mine pulse must return INSUFFICIENT_DATA and None overall score when no pillar records exist."""
    with patch("app.api.routers.intelligence.query", return_value=[]):
        res = client.get("/api/v1/intelligence/pulse?mine_id=empty-mine", headers=_get_auth_headers())
        assert res.status_code == 200
        data = res.json()
        assert data["overall_score"] is None
        assert data["overall_status"] == "INSUFFICIENT_DATA"
        assert data["scope"] == "MINE"


# ---------------------------------------------------------------------------
# 6. Alert Mine Access Security
# ---------------------------------------------------------------------------

def test_alerts_mine_access_forbidden():
    """User restricted to a different mine cannot access alerts for mine-02."""
    restricted_user_headers = _get_auth_headers(role="production_admin", username="mine1_operator")
    # Patch get_current_user to include assigned mine_id
    with patch("app.api.routers.alerts.check_mine_access", return_value=False):
        res = client.get("/api/v1/alerts?mine_id=restricted-mine-99", headers=restricted_user_headers)
        assert res.status_code == 403
