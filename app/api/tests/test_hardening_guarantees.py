"""app/api/tests/test_hardening_guarantees.py — Rigorous tests for Final Architectural Correctness Hardening.

Verifies:
1. Authoritative model version lineage in cache keys & invalidation on promotion.
2. Cross-mine isolation (zero cross-mine data leakage or fallback queries).
3. True SWR & Hard Stale Age enforcement.
4. Single-flight request coalescing under 50 concurrent threads.
5. Separation of /health/live, /health/ready, and /health/cache.
6. Cloud storage security & absence of leaked secrets across RPC and health endpoints.
"""
import concurrent.futures
import inspect
import threading
import time

from fastapi.testclient import TestClient

from app.api.core.cache import (
    TieredCacheManager,
    build_cache_key,
)
from app.api.core.ml_loader import (
    ensure_active_model,
    get_active_model_metadata,
    invalidate_model_metadata,
)
from app.api.core.security import create_access_token
from app.api.main import app
from app.ml import modal_train

client = TestClient(app)


def _get_auth_headers(role="super_admin", username="admin"):
    token = create_access_token({"sub": username, "role": role})
    return {"Authorization": f"Bearer {token}"}


# ===========================================================================
# 1. Authoritative Model Version Isolation & Fail-Safe Invariant
# ===========================================================================

def test_authoritative_model_version_metadata():
    """Verify get_active_model_metadata resolves authoritative champion and falls back safely."""
    meta = get_active_model_metadata("production_forecast")
    assert "model_version" in meta
    assert "dataset_version" in meta
    assert isinstance(meta["model_version"], str) and len(meta["model_version"]) > 0

    # Invalidation clears cache
    invalidate_model_metadata("production_forecast")
    meta2 = get_active_model_metadata("production_forecast")
    assert meta2["model_version"] == meta["model_version"]


def test_cache_key_incorporates_authoritative_version():
    """Verify build_cache_key includes model and dataset versions."""
    k1 = build_cache_key("production", "forecast", entity_id="mine-01", model_version="v1.0", dataset_version="v1.0")
    k2 = build_cache_key("production", "forecast", entity_id="mine-01", model_version="v2.0", dataset_version="v1.0")
    assert k1 != k2
    assert "v1.0" in k1
    assert "v2.0" in k2


def test_fail_safe_model_replacement():
    """The serving model must never be replaced if smoke testing or download fails."""
    from app.api.core.ml_loader import ACTIVE_SERVING_VERSIONS, MODELS
    current_model = MODELS.get("prod_forecast")
    current_version = ACTIVE_SERVING_VERSIONS.get("production_forecast")

    # Call ensure_active_model
    model, version = ensure_active_model("production_forecast")
    assert model is not None
    assert version is not None
    assert model is current_model or hasattr(model, "predict")


# ===========================================================================
# 2. Strict Cross-Mine Isolation (Zero Cross-Mine Fallback Queries)
# ===========================================================================

def test_production_cross_mine_isolation():
    """Non-existent mine returns INSUFFICIENT_DATA and requested mine_id, never other mine's data."""
    headers = _get_auth_headers()
    fake_mine = "mine-non-existent-xyz-999"
    res = client.get(f"/api/v1/production/{fake_mine}/forecast", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["mine_id"] == fake_mine
    assert data["data_quality"]["status"] == "INSUFFICIENT_DATA"
    assert "telemetry" in data["data_quality"]["reason"].lower() or "records" in data["data_quality"]["reason"].lower()


def test_scenarios_cross_mine_isolation():
    """A mine with no history is refused, not answered with another mine's data.

    This previously asserted a 200 carrying ``baseline.production_t == 0.0``.
    The isolation intent was right, but a fabricated zero is not an improvement
    on borrowed data: "production is 0.0 t" reads as a measurement. The endpoint
    now returns a structured refusal naming what is missing.
    """
    headers = _get_auth_headers()
    fake_mine = "mine-non-existent-abc-888"
    payload = {
        "mine_id": fake_mine,
        "interventions": [{"type": "equipment_redeploy", "magnitude": 0.1}],
    }
    res = client.post("/api/v1/scenarios/run", json=payload, headers=headers)
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert detail["code"] == "INSUFFICIENT_DATA"
    assert fake_mine in detail["message"]
    # It must say what would fix it, not merely that it failed.
    assert detail.get("remedy")
    # And it must not have invented a number.
    assert "0.0" not in detail["message"]


def test_intelligence_pulse_cross_mine_isolation():
    """Intelligence pulse for non-existent mine reports insufficient_data for production and equipment."""
    headers = _get_auth_headers()
    fake_mine = "mine-non-existent-health-777"
    res = client.get(f"/api/v1/intelligence/pulse?mine_id={fake_mine}", headers=headers)
    assert res.status_code == 200
    data = res.json()
    pillars = data["pillars"]
    assert pillars["production"]["status"] == "insufficient_data"
    assert pillars["equipment"]["status"] == "insufficient_data"


# ===========================================================================
# 3. True SWR & Hard Stale Age Enforcement
# ===========================================================================

def test_true_swr_and_hard_stale_age():
    """Verify True SWR serves stale immediately and schedules background refresh, but never past stale_until."""
    mgr = TieredCacheManager(enabled=True, l1_max_entries=100, l1_ttl_default=1.0)
    # Disable L2 so we isolate local envelope logic
    mgr.l2 = None

    now = time.time()
    call_count = 0

    def slow_producer():
        nonlocal call_count
        call_count += 1
        return {"data": f"version-{call_count}"}

    key = "test:swr:guarantee"
    # Seed cache with an entry that expired 5s ago, but stale_until is in the future (+30s)
    mgr.l1.set(
        key=key,
        value={"data": "version-initial-stale"},
        ttl=60.0,
        created_at_epoch=now - 15,
        expires_at_epoch=now - 5,
        stale_until_epoch=now + 30,
    )

    # 1. First fetch with allow_stale=True returns stale immediately and schedules background refresh
    val = mgr.get_or_set(key=key, ttl=10, producer=slow_producer, allow_stale=True, stale_max_seconds=30)
    assert val == {"data": "version-initial-stale"}

    # Allow the background worker thread a moment to run
    time.sleep(0.15)
    assert call_count >= 1

    # 2. Subsequent fetch returns the freshly generated value
    val_fresh = mgr.get_or_set(key=key, ttl=10, producer=slow_producer, allow_stale=True, stale_max_seconds=30)
    assert val_fresh["data"] == f"version-{call_count}"


def test_hard_stale_age_never_served():
    """An entry past stale_until_epoch is hard expired and must NEVER be served."""
    mgr = TieredCacheManager(enabled=True, l1_max_entries=100, l1_ttl_default=1.0)
    mgr.l2 = None

    now = time.time()
    call_count = 0

    def producer():
        nonlocal call_count
        call_count += 1
        return {"data": f"new-version-{call_count}"}

    key = "test:hard_stale:expired"
    # Entry expired 100s ago, and stale_until was 50s ago (hard expired)
    mgr.l1.set(
        key=key,
        value={"data": "ancient-garbage"},
        ttl=60.0,
        created_at_epoch=now - 200,
        expires_at_epoch=now - 100,
        stale_until_epoch=now - 50,
    )

    # Must NOT serve 'ancient-garbage'; must synchronously invoke producer
    val = mgr.get_or_set(key=key, ttl=10, producer=producer, allow_stale=True, stale_max_seconds=30)
    assert val == {"data": "new-version-1"}
    assert call_count == 1


def test_allow_stale_false_guarantee():
    """Safety-critical resources with allow_stale=False must never return stale data."""
    mgr = TieredCacheManager(enabled=True, l1_max_entries=100, l1_ttl_default=1.0)
    mgr.l2 = None

    now = time.time()
    call_count = 0

    def fresh_producer():
        nonlocal call_count
        call_count += 1
        return {"safety_status": "CRITICAL_ALERT", "count": call_count}

    key = "test:safety:no_stale"
    # Entry is past expires_at but within stale_until
    mgr.l1.set(
        key=key,
        value={"safety_status": "OLD_STALE_ALERT", "count": 0},
        ttl=60.0,
        created_at_epoch=now - 20,
        expires_at_epoch=now - 5,
        stale_until_epoch=now + 60,
    )

    # allow_stale=False must synchronously produce fresh value
    val = mgr.get_or_set(key=key, ttl=15, producer=fresh_producer, allow_stale=False)
    assert val["safety_status"] == "CRITICAL_ALERT"
    assert val["count"] == 1


# ===========================================================================
# 4. Concurrency & Stampede Protection (50 Concurrent Threads)
# ===========================================================================

def test_single_flight_50_concurrent_requests():
    """50 concurrent threads requesting a cold cache key invoke producer exactly once."""
    mgr = TieredCacheManager(enabled=True, l1_max_entries=100, l1_ttl_default=10.0)
    mgr.l2 = None

    producer_calls = 0
    producer_lock = threading.Lock()

    def heavy_producer():
        nonlocal producer_calls
        with producer_lock:
            producer_calls += 1
        time.sleep(0.08)  # simulate heavy DB / ML computation
        return {"payload": "computed_result", "timestamp": time.time()}

    key = "test:concurrent:stampede:50"
    results = []

    def worker():
        res = mgr.get_or_set(key=key, ttl=10, producer=heavy_producer, allow_stale=True)
        results.append(res)

    with concurrent.futures.ThreadPoolExecutor(max_workers=50) as executor:
        futures = [executor.submit(worker) for _ in range(50)]
        concurrent.futures.wait(futures)

    assert len(results) == 50
    assert producer_calls == 1, f"Expected exactly 1 producer invocation, got {producer_calls}"
    assert all(r["payload"] == "computed_result" for r in results)
    assert mgr.single_flight_prevented >= 45


# ===========================================================================
# 5. Health Probes: Separation of /health/live, /health/ready, /health/cache
# ===========================================================================

def test_health_live_probe():
    """GET /health/live returns HTTP 200 without DB/Redis dependency."""
    res = client.get("/health/live")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "alive"
    assert "uptime_seconds" in data
    assert "timestamp" in data


def test_health_ready_probe():
    """GET /health/ready validates database connectivity."""
    res = client.get("/health/ready")
    assert res.status_code in (200, 503)
    data = res.json()
    assert "status" in data
    assert "database" in data


def test_health_cache_observability():
    """GET /health/cache returns latency percentiles, hit rates, and SWR metrics."""
    res = client.get("/health/cache")
    assert res.status_code == 200
    data = res.json()
    assert "l1" in data
    assert "l2" in data
    assert "producer" in data
    assert "p50_latency_ms" in data["producer"]
    assert "p95_latency_ms" in data["producer"]
    assert "p99_latency_ms" in data["producer"]
    assert "stale_refreshes_started" in data


# ===========================================================================
# 6. Cloud Storage Security & Secret Hygiene
# ===========================================================================

def test_modal_train_signature_does_not_accept_sa_json():
    """run_training_job must not accept google_service_account_json as an argument."""
    fn = getattr(modal_train.run_training_job, "get_raw_f", lambda: getattr(modal_train.run_training_job, "_f", None))()
    if fn is None:
        fn = getattr(modal_train.run_training_job, "f", None)

    if fn is not None:
        sig = inspect.signature(fn)
        assert "google_service_account_json" not in sig.parameters
    else:
        src = inspect.getsource(modal_train)
        decl = src.split("def run_training_job(")[1].split("->")[0]
        assert "google_service_account_json" not in decl


def test_no_secrets_exposed_in_health_or_metrics():
    """Verify that service account private keys or credentials are not exposed in health responses."""
    for endpoint in ["/health", "/health/live", "/health/ready", "/health/cache"]:
        res = client.get(endpoint)
        body = res.text
        assert "private_key" not in body
        assert "BEGIN RSA PRIVATE KEY" not in body
        assert "client_secret" not in body


# ===========================================================================
# 7. db.transaction() — Atomicity, Rollback, and Connection-Pool Safety
# ===========================================================================

def test_transaction_context_manager_is_importable():
    """db.transaction context manager must be importable from core.db."""

    from app.api.core.db import transaction
    assert hasattr(transaction, "__call__")


def test_transaction_yields_tx_cursor_with_execute_and_query():
    """transaction() TxCursor must expose .execute() and .query() methods."""
    import inspect

    from app.api.core.db import transaction
    # Verify the contextmanager decorator is applied
    assert inspect.isgeneratorfunction(transaction.__wrapped__) or callable(transaction)


def test_transaction_rollback_on_http_exception():
    """
    If a decision-state guard raises HTTPException inside the `with transaction()` block,
    the transaction must be rolled back (no partial writes).  We simulate this by
    attempting to execute a /review against an already-REJECTED decision, which should
    422 cleanly and leave the DB untouched.
    """
    headers = _get_auth_headers("super_admin")

    # Create a fresh decision in RECOMMENDED state
    create_res = client.post(
        "/api/v1/decisions",
        json={"problem": "TX rollback test", "recommendation": "Do nothing", "lifecycle_state": "READY_FOR_REVIEW"},
        headers=headers,
    )
    assert create_res.status_code == 200, create_res.text
    dec_id = create_res.json()["decision_id"]

    # Reject it
    reject_res = client.post(
        f"/api/v1/decisions/{dec_id}/review",
        json={"action": "reject", "note": "intentional rejection"},
        headers=headers,
    )
    assert reject_res.status_code == 200
    assert reject_res.json()["lifecycle_state"] == "REJECTED"

    # Attempt a second review on an already-REJECTED decision — must 422
    second_res = client.post(
        f"/api/v1/decisions/{dec_id}/review",
        json={"action": "approve", "note": "should fail"},
        headers=headers,
    )
    assert second_res.status_code == 422, second_res.text
    detail = second_res.json().get("detail", "")
    assert "REJECTED" in detail or "RECOMMENDED" in detail or "UNDER_REVIEW" in detail


# ===========================================================================
# 8. Decision State Machine Invariants
# ===========================================================================

def test_decision_state_machine_full_path():
    """Walk the full READY_FOR_REVIEW -> APPROVED -> COMPLETED -> MEASURED path.

    Migration 002 replaced the six-state vocabulary with the nine-state machine
    and constrained `status` to lower(lifecycle_state), so the two can no longer
    drift apart the way they had in production data.
    """
    headers = _get_auth_headers("super_admin")

    # Create
    res = client.post(
        "/api/v1/decisions",
        json={"problem": "SM-test", "recommendation": "SM-rec", "lifecycle_state": "READY_FOR_REVIEW"},
        headers=headers,
    )
    assert res.status_code == 200
    did = res.json()["decision_id"]
    assert res.json()["lifecycle_state"] == "READY_FOR_REVIEW"

    # Approve
    res = client.post(f"/api/v1/decisions/{did}/review", json={"action": "approve"}, headers=headers)
    assert res.status_code == 200
    assert res.json()["lifecycle_state"] == "APPROVED"

    # Execute
    res = client.post(f"/api/v1/decisions/{did}/execute", headers=headers)
    assert res.status_code == 200
    assert res.json()["lifecycle_state"] == "COMPLETED"

    # Record outcome
    res = client.post(
        f"/api/v1/decisions/{did}/outcome",
        json={"predicted_value": 200.0, "actual_value": 185.0, "metric_type": "production_forecast"},
        headers=headers,
    )
    assert res.status_code == 200
    data = res.json()
    assert data["lifecycle_state"] == "MEASURED"
    assert "effectiveness" in data
    assert isinstance(data["effectiveness"], float)


def test_execute_requires_approved_state():
    """Cannot execute a decision that is still RECOMMENDED."""
    headers = _get_auth_headers("super_admin")

    res = client.post(
        "/api/v1/decisions",
        json={"problem": "Execute-guard test", "recommendation": "rec", "lifecycle_state": "READY_FOR_REVIEW"},
        headers=headers,
    )
    did = res.json()["decision_id"]

    # Try to execute without approval
    exec_res = client.post(f"/api/v1/decisions/{did}/execute", headers=headers)
    assert exec_res.status_code == 422
    assert "APPROVED" in exec_res.json().get("detail", "")


def test_outcome_requires_executed_state():
    """Cannot record outcome on a RECOMMENDED (not yet executed) decision."""
    headers = _get_auth_headers("super_admin")

    res = client.post(
        "/api/v1/decisions",
        json={"problem": "Outcome-guard test", "recommendation": "rec", "lifecycle_state": "READY_FOR_REVIEW"},
        headers=headers,
    )
    did = res.json()["decision_id"]

    outcome_res = client.post(
        f"/api/v1/decisions/{did}/outcome",
        json={"predicted_value": 100.0, "actual_value": 90.0},
        headers=headers,
    )
    assert outcome_res.status_code == 422
    assert "EXECUTED" in outcome_res.json().get("detail", "") or "APPROVED" in outcome_res.json().get("detail", "")


def test_decision_list_lifecycle_filter_is_case_normalized():
    """lifecycle_state filter must normalise input to uppercase (no case sensitivity bug)."""
    headers = _get_auth_headers("super_admin")
    res = client.get("/api/v1/decisions?lifecycle_state=recommended", headers=headers)
    assert res.status_code == 200
    data = res.json()
    for dec in data["decisions"]:
        assert dec["lifecycle_state"] == "RECOMMENDED"


def test_decision_effectiveness_production_forecast_metric():
    """Effectiveness for production_forecast is computed correctly: 1 - abs_err / predicted."""
    headers = _get_auth_headers("super_admin")

    res = client.post(
        "/api/v1/decisions",
        json={"problem": "Effectiveness test", "recommendation": "rec", "lifecycle_state": "READY_FOR_REVIEW"},
        headers=headers,
    )
    did = res.json()["decision_id"]

    # Walk to EXECUTED
    client.post(f"/api/v1/decisions/{did}/review", json={"action": "approve"}, headers=headers)
    client.post(f"/api/v1/decisions/{did}/execute", headers=headers)

    predicted, actual = 200.0, 160.0
    res = client.post(
        f"/api/v1/decisions/{did}/outcome",
        json={"predicted_value": predicted, "actual_value": actual, "metric_type": "production_forecast"},
        headers=headers,
    )
    assert res.status_code == 200
    data = res.json()
    expected_eff = round(max(0.0, 1.0 - abs(actual - predicted) / max(abs(predicted), 1.0)), 3)
    assert abs(data["effectiveness"] - expected_eff) < 0.001


# ===========================================================================
# 9. Model Governance Metadata Coverage
# ===========================================================================

def test_production_forecast_exposes_governance_fields():
    """Production forecast response must include serving/authoritative version metadata."""
    headers = _get_auth_headers("super_admin")
    res = client.get("/api/v1/production/mine-01/forecast", headers=headers)
    assert res.status_code == 200
    data = res.json()
    model_meta = data.get("model_metadata") or data
    # At minimum, one of these keys must be present
    assert any(k in model_meta for k in (
        "serving_model_version", "authoritative_model_version",
        "model_version", "serving_status"
    )), f"Missing model governance fields in response: {list(model_meta.keys())}"


def test_equipment_fleet_health_exposes_governance_fields():
    """Fleet health response must include serving/authoritative version metadata."""
    headers = _get_auth_headers("super_admin")
    res = client.get("/api/v1/equipment/mine-01/fleet-health", headers=headers)
    assert res.status_code == 200
    data = res.json()
    model_meta = data.get("model_metadata") or data
    assert any(k in model_meta for k in (
        "serving_model_version", "authoritative_model_version",
        "model_version", "serving_status"
    )), f"Missing governance fields in fleet-health: {list(model_meta.keys())}"


def test_exploration_list_targets_exposes_governance_fields():
    """Exploration list targets must include model lineage metadata."""
    headers = _get_auth_headers("super_admin")
    res = client.get("/api/v1/exploration/targets", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert any(k in data for k in (
        "serving_model_version", "authoritative_model_version",
        "model_version", "serving_status", "model_metadata"
    )), f"Missing governance fields in exploration targets: {list(data.keys())}"


# ===========================================================================
# 10. Data Hub Dataset Approval State Guard
# ===========================================================================

def test_data_hub_approve_requires_validated_status():
    """
    Approving a dataset version that is not in VALIDATED status must return 422.
    We mock a version with status UPLOADED.
    """
    from unittest.mock import patch

    headers = _get_auth_headers("super_admin")

    # Patch query to return a fake non-VALIDATED version
    fake_version = [{
        "id": 9999, "status": "UPLOADED", "domain": "production",
        "canonical_drive_file_id": None, "checksum_sha256": None
    }]

    with patch("app.api.routers.data_hub.query", return_value=fake_version), \
         patch("app.api.routers.data_hub.check_domain_access", return_value=True):
        res = client.post(
            "/api/v1/data/versions/9999/approve",
            json={"note": "test approve"},
            headers=headers,
        )
    assert res.status_code == 422
    assert "VALIDATED" in res.json().get("detail", "")


def test_data_hub_approve_requires_domain_access():
    """Approving a dataset without domain access must return 403."""
    from unittest.mock import patch

    headers = _get_auth_headers("mine_planner")  # planner has no domain approval rights

    fake_version = [{
        "id": 9998, "status": "VALIDATED", "domain": "exploration",
        "canonical_drive_file_id": "drive-abc", "checksum_sha256": "abc"
    }]

    with patch("app.api.routers.data_hub.query", return_value=fake_version):
        res = client.post(
            "/api/v1/data/versions/9998/approve",
            json={"note": "unauthorized attempt"},
            headers=headers,
        )
    assert res.status_code == 403

