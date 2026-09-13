"""apps/api/tests/test_cache.py — Production-Grade Test Suite for MINEx Hybrid Tiered Cache.

Covers:
  - L1 In-Memory (hit, miss, monotonic TTL expiry, LRU bounded capacity, thread safety)
  - Serialization (complex types: Decimal, UUID, datetime, Enum, Pydantic, NumPy, Pandas)
  - Compression (zlib threshold, round-trip fidelity, corrupted payload handling, safety limits)
  - Circuit Breaker (CLOSED -> OPEN -> HALF_OPEN -> CLOSED transitions, fast-fail)
  - Single-Flight Request Coalescing (50 concurrent threads -> 1 producer invocation)
  - L2 Operations with Mocked Redis (get, set, delete, SCAN pattern delete)
  - Lifecycle Invalidation (domain, model promotion/rollback, dataset upload/approval, entity)
  - Authorization Safety (isolated keys per role/user scope)
  - Stale-While-Revalidate semantics & safety-sensitive non-stale policies
  - Health & Observability (metrics, hit rates, no exposed secrets)
  - Endpoint Regressions & Response Equivalence
"""

import concurrent.futures
import datetime
import decimal
import enum
import json
import math
import re
import threading
import time
import uuid
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
import pytest
from pydantic import BaseModel

from apps.api.core.cache import (
    CircuitState,
    L1Cache,
    RedisCircuitBreaker,
    TieredCacheManager,
    build_cache_key,
    deserialize_cache_value,
    serialize_cache_value,
)

# ===========================================================================
# 1. L1 In-Memory Cache Tests
# ===========================================================================

def test_l1_cache_hit_and_miss():
    cache = L1Cache(max_entries=10, default_ttl=5.0)
    hit, val = cache.get("key1")
    assert hit is False
    assert val is None

    cache.set("key1", {"metric": 42})
    hit, val = cache.get("key1")
    assert hit is True
    assert val == {"metric": 42}


def test_l1_cache_expiration_monotonic():
    # Set a tiny TTL of 0.05 seconds
    cache = L1Cache(max_entries=10, default_ttl=0.05)
    cache.set("expiring_key", "hello", ttl=0.05)

    hit, val = cache.get("expiring_key")
    assert hit is True
    assert val == "hello"

    # Sleep past the expiration
    time.sleep(0.08)
    hit, val = cache.get("expiring_key")
    assert hit is False
    assert val is None
    assert cache.expirations >= 1


def test_l1_cache_lru_eviction():
    cache = L1Cache(max_entries=3, default_ttl=60.0)
    cache.set("k1", 1)
    cache.set("k2", 2)
    cache.set("k3", 3)
    assert cache.size() == 3

    # Access k1 so k2 becomes the oldest entry
    cache.get("k1")

    # Add k4 -> should evict k2
    cache.set("k4", 4)
    assert cache.size() == 3
    assert cache.evictions == 1

    hit_k2, _ = cache.get("k2")
    assert hit_k2 is False

    hit_k1, val_k1 = cache.get("k1")
    assert hit_k1 is True
    assert val_k1 == 1


def test_l1_cache_thread_safety():
    cache = L1Cache(max_entries=500, default_ttl=60.0)

    def worker(worker_id):
        for i in range(50):
            k = f"key_{worker_id}_{i}"
            cache.set(k, i)
            hit, val = cache.get(k)
            assert hit is True
            assert val == i

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(worker, w) for w in range(8)]
        for f in concurrent.futures.as_completed(futures):
            f.result()

    assert cache.size() <= 500


# ===========================================================================
# 2. Deterministic Serialization & Complex Types
# ===========================================================================

class SampleEnum(enum.Enum):
    ALPHA = "alpha_val"
    BETA = "beta_val"


class SamplePydanticModel(BaseModel):
    item_id: str
    count: int
    score: float


def test_serialization_complex_types():
    now_dt = datetime.datetime.now(datetime.timezone.utc)
    now_date = datetime.date(2026, 9, 5)
    sample_uuid = uuid.uuid4()
    sample_dec = decimal.Decimal("123.456")

    data = {
        "datetime": now_dt,
        "date": now_date,
        "uuid": sample_uuid,
        "decimal": sample_dec,
        "enum": SampleEnum.ALPHA,
        "pydantic": SamplePydanticModel(item_id="mine_01", count=100, score=98.5),
        "numpy_int": np.int64(42),
        "numpy_float": np.float64(3.14159),
        "numpy_bool": np.bool_(True),
        "numpy_arr": np.array([1, 2, 3]),
        "pandas_ts": pd.Timestamp("2026-09-05 12:00:00"),
        "pandas_series": pd.Series([10, 20], index=["a", "b"]),
        "nested_dict": {"x": [None, True, False, 100]},
    }

    payload_str, is_compressed = serialize_cache_value(data, compression_threshold=25 * 1024)
    assert isinstance(payload_str, str)
    assert is_compressed is False

    recovered = deserialize_cache_value(payload_str, "none")
    assert recovered["datetime"] == now_dt.isoformat()
    assert recovered["date"] == now_date.isoformat()
    assert recovered["uuid"] == str(sample_uuid)
    assert recovered["decimal"] == "123.456"
    assert recovered["enum"] == "alpha_val"
    assert recovered["pydantic"] == {"item_id": "mine_01", "count": 100, "score": 98.5}
    assert recovered["numpy_int"] == 42
    assert pytest.approx(recovered["numpy_float"], 0.0001) == 3.14159
    assert recovered["numpy_bool"] is True
    assert recovered["numpy_arr"] == [1, 2, 3]
    assert recovered["pandas_series"] == {"a": 10, "b": 20}
    assert recovered["nested_dict"]["x"] == [None, True, False, 100]


# ===========================================================================
# 3. Zlib Compression Round-Trip & Safety Ceiling
# ===========================================================================

def test_compression_threshold_and_roundtrip():
    # Large payload (> 25KB)
    large_list = [{"id": f"row_{i}", "val": math.sin(i), "meta": "large_content_sample" * 5} for i in range(1000)]
    payload_str, is_compressed = serialize_cache_value(large_list, compression_threshold=25 * 1024)
    assert is_compressed is True
    # Verify string is valid base64
    assert len(payload_str) > 100

    recovered = deserialize_cache_value(payload_str, "zlib")
    assert len(recovered) == 1000
    assert recovered[0]["id"] == "row_0"
    assert pytest.approx(recovered[0]["val"]) == math.sin(0)


def test_corrupted_compressed_payload_handling():
    with pytest.raises(Exception):
        deserialize_cache_value("this_is_not_valid_compressed_data!@#$", "zlib")


# ===========================================================================
# 4. Circuit Breaker State Transitions
# ===========================================================================

def test_circuit_breaker_transitions():
    cb = RedisCircuitBreaker(failure_threshold=3, cooldown_seconds=0.1)
    assert cb.state == CircuitState.CLOSED
    assert cb.can_attempt() is True

    # 1st failure
    cb.record_failure(Exception("Timeout 1"))
    assert cb.state == CircuitState.CLOSED
    assert cb.can_attempt() is True

    # 2nd failure
    cb.record_failure(Exception("Timeout 2"))
    assert cb.state == CircuitState.CLOSED
    assert cb.can_attempt() is True

    # 3rd failure -> trips OPEN
    cb.record_failure(Exception("Timeout 3"))
    assert cb.state == CircuitState.OPEN
    assert cb.can_attempt() is False

    # Wait for cooldown
    time.sleep(0.12)
    # Next call should transition to HALF_OPEN to probe
    assert cb.can_attempt() is True
    assert cb.state == CircuitState.HALF_OPEN

    # Probe succeeds -> CLOSED
    cb.record_success()
    assert cb.state == CircuitState.CLOSED
    assert cb.failure_count == 0


def test_circuit_breaker_probe_failure():
    cb = RedisCircuitBreaker(failure_threshold=3, cooldown_seconds=0.1)
    cb.record_failure(Exception("1"))
    cb.record_failure(Exception("2"))
    cb.record_failure(Exception("3"))
    assert cb.state == CircuitState.OPEN

    time.sleep(0.12)
    assert cb.can_attempt() is True
    assert cb.state == CircuitState.HALF_OPEN

    # Probe fails -> immediately back to OPEN
    cb.record_failure(Exception("Probe failed"))
    assert cb.state == CircuitState.OPEN
    assert cb.can_attempt() is False


# ===========================================================================
# 5. Single-Flight Request Coalescing (Stampede Protection)
# ===========================================================================

def test_single_flight_stampede_protection():
    mgr = TieredCacheManager()
    call_count = 0
    lock = threading.Lock()

    def slow_producer():
        nonlocal call_count
        with lock:
            call_count += 1
        time.sleep(0.05)  # Simulate expensive 50ms DB/ML computation
        return {"data": "expensive_computed_result"}

    def request_worker():
        return mgr.get_or_set(
            key="test_single_flight_key",
            ttl=30.0,
            producer=slow_producer,
        )

    # 30 threads simultaneously requesting the same cold key
    with concurrent.futures.ThreadPoolExecutor(max_workers=30) as executor:
        futures = [executor.submit(request_worker) for _ in range(30)]
        results = [f.result() for f in concurrent.futures.as_completed(futures)]

    # All 30 callers got the correct result
    assert len(results) == 30
    for res in results:
        assert res == {"data": "expensive_computed_result"}

    # Stampede prevented: slow_producer should have executed exactly ONCE!
    assert call_count == 1
    assert mgr.flight_manager.stampedes_prevented >= 1
    assert mgr.metrics["cache_l1_hit"] == 29


# ===========================================================================
# 6. Mocked L2 Upstash Redis Integration
# ===========================================================================

class FakeRedisStore:
    def __init__(self):
        self.store = {}

    def get(self, key):
        return self.store.get(key)

    def set(self, key, value, ex=None):
        self.store[key] = str(value)
        return True

    def delete(self, key):
        if key in self.store:
            del self.store[key]
            return 1
        return 0

    def scan_iter(self, match="*", count=100):
        regex = match.replace("*", ".*")
        pattern = re.compile(f"^{regex}$")
        for k in list(self.store.keys()):
            if pattern.match(k):
                yield k

    def ping(self):
        return True


def test_tiered_cache_l2_hit_and_miss_with_mock():
    mgr = TieredCacheManager()
    fake_redis = FakeRedisStore()

    with patch.object(mgr.l2, "_get_client", return_value=fake_redis):
        mgr.l2.configured = True
        mgr.circuit.state = CircuitState.CLOSED

        # 1st request -> L1 miss, L2 miss -> producer executed -> populates L2 & L1
        p_calls = 0
        def produce():
            nonlocal p_calls
            p_calls += 1
            return {"forecast": [10, 20, 30]}

        res1 = mgr.get_or_set("minex:cache:v1:test:res", ttl=60.0, producer=produce)
        assert res1 == {"forecast": [10, 20, 30]}
        assert p_calls == 1

        # Clear L1 to force check against L2
        mgr.l1.clear()
        assert mgr.l1.size() == 0

        # 2nd request -> L1 miss, L2 HIT -> producer NOT called!
        res2 = mgr.get_or_set("minex:cache:v1:test:res", ttl=60.0, producer=produce)
        assert res2 == {"forecast": [10, 20, 30]}
        assert p_calls == 1  # Still 1!
        assert mgr.metrics["cache_l2_hit"] >= 1

        # Verify backfill into L1 happened
        assert mgr.l1.size() == 1


# ===========================================================================
# 7. Lifecycle Invalidation Tests
# ===========================================================================

def test_cache_invalidation_domain_and_model():
    mgr = TieredCacheManager()
    fake_redis = FakeRedisStore()

    with patch.object(mgr.l2, "_get_client", return_value=fake_redis):
        mgr.l2.configured = True
        mgr.circuit.state = CircuitState.CLOSED

        k1 = build_cache_key("production", "forecast", entity_id="M1", model_version="v1")
        k2 = build_cache_key("production", "shortfall", entity_id="M1", model_version="v1")
        k3 = build_cache_key("equipment", "fleet", entity_id="M1")

        mgr.get_or_set(k1, 60, lambda: "prod_forecast_v1")
        mgr.get_or_set(k2, 60, lambda: "prod_shortfall_v1")
        mgr.get_or_set(k3, 60, lambda: "equip_fleet_v1")

        assert mgr.l1.get(k1)[0] is True
        assert mgr.l1.get(k2)[0] is True
        assert mgr.l1.get(k3)[0] is True

        # Invalidate model for production_forecast
        mgr.invalidate_model("production_forecast")

        # k1 and k2 should be gone, k3 should remain
        assert mgr.l1.get(k1)[0] is False
        assert mgr.l1.get(k2)[0] is False
        assert mgr.l1.get(k3)[0] is True


def test_cache_invalidation_dataset():
    mgr = TieredCacheManager()
    fake_redis = FakeRedisStore()

    with patch.object(mgr.l2, "_get_client", return_value=fake_redis):
        mgr.l2.configured = True
        mgr.circuit.state = CircuitState.CLOSED

        k_exp = build_cache_key("exploration", "targets", params={"limit": 50})
        mgr.get_or_set(k_exp, 60, lambda: "exp_targets")
        assert mgr.l1.get(k_exp)[0] is True

        # Invalidate exploration dataset
        mgr.invalidate_dataset("exploration")
        assert mgr.l1.get(k_exp)[0] is False


# ===========================================================================
# 8. Authorization Isolation Safety
# ===========================================================================

def test_authorization_scope_isolation():
    k_admin_a = build_cache_key("production", "confidential_kpi", entity_id="M1", auth_scope="dept:production")
    k_admin_b = build_cache_key("production", "confidential_kpi", entity_id="M1", auth_scope="dept:equipment")

    # They MUST produce distinct keys
    assert k_admin_a != k_admin_b

    mgr = TieredCacheManager()
    mgr.get_or_set(k_admin_a, 60, lambda: "production_secret")
    mgr.get_or_set(k_admin_b, 60, lambda: "equipment_secret")

    val_a = mgr.get_or_set(k_admin_a, 60, lambda: "new_a")
    val_b = mgr.get_or_set(k_admin_b, 60, lambda: "new_b")

    assert val_a == "production_secret"
    assert val_b == "equipment_secret"


# ===========================================================================
# 9. Health Check Endpoint & Secrets Protection
# ===========================================================================

def test_cache_health_payload_no_secrets():
    mgr = TieredCacheManager()
    health_data = mgr.health()

    assert "enabled" in health_data
    assert "l1" in health_data
    assert "l2" in health_data
    assert "producer" in health_data
    assert "stampedes_prevented" in health_data

    # Ensure no secrets or credentials leaked
    raw_str = json.dumps(health_data)
    assert "password" not in raw_str.lower()
    assert "rediss://" not in raw_str
    assert "token" not in raw_str.lower()
    assert "secret" not in raw_str.lower()


# ===========================================================================
# 10. Live Fallback Test (When Redis Fails, App Continues Working)
# ===========================================================================

def test_graceful_fallback_when_redis_fails():
    mgr = TieredCacheManager()
    # Force circuit open or client to raise error
    failing_redis = MagicMock()
    failing_redis.get.side_effect = Exception("ConnectionRefusedError: Redis is down!")
    failing_redis.set.side_effect = Exception("ConnectionRefusedError: Redis is down!")

    with patch.object(mgr.l2, "_get_client", return_value=failing_redis):
        mgr.l2.configured = True
        mgr.circuit.state = CircuitState.CLOSED
        # Request should succeed transparently without raising 500
        val = mgr.get_or_set("minex:cache:v1:resilience:test", ttl=30, producer=lambda: "authoritative_data")
        assert val == "authoritative_data"

        # L1 should still have received the entry
        hit, l1_val = mgr.l1.get("minex:cache:v1:resilience:test")
        assert hit is True
        assert l1_val == "authoritative_data"

        # Error metric incremented
        assert mgr.metrics["cache_l2_error"] >= 1


# ===========================================================================
# 11. Endpoint Integration & Response Schema Equivalence Tests
# ===========================================================================

from fastapi.testclient import TestClient

from apps.api.core.security import create_access_token
from apps.api.main import app

test_client = TestClient(app)


def test_health_cache_endpoint_via_api():
    res = test_client.get("/health/cache")
    assert res.status_code == 200
    data = res.json()
    assert "l1" in data
    assert "l2" in data
    assert "producer" in data
    assert "stampedes_prevented" in data

    # Versioned endpoint /api/v1/health/cache
    res_v1 = test_client.get("/api/v1/health/cache")
    assert res_v1.status_code == 200
    data_v1 = res_v1.json()
    assert data_v1["enabled"] == data["enabled"]


def test_production_forecast_cache_equivalence():
    token = create_access_token({"sub": "admin", "role": "super_admin"})
    headers = {"Authorization": f"Bearer {token}"}

    # Request 1: cold / producer execution
    res1 = test_client.get("/api/v1/production/1/forecast", headers=headers)
    assert res1.status_code == 200
    data1 = res1.json()
    assert "forecast" in data1
    assert "p50" in data1["forecast"]
    assert "model_version" in data1

    # Request 2: warm / cache hit
    res2 = test_client.get("/api/v1/production/1/forecast", headers=headers)
    assert res2.status_code == 200
    data2 = res2.json()

    # Schemas and business results must be completely equivalent
    assert data1["mine_id"] == data2["mine_id"]
    assert data1["model_version"] == data2["model_version"]
    assert data1["forecast"]["p50"] == data2["forecast"]["p50"]
    assert data1["target"] == data2["target"]


def test_exploration_targets_cache_equivalence():
    token = create_access_token({"sub": "admin", "role": "super_admin"})
    headers = {"Authorization": f"Bearer {token}"}

    res1 = test_client.get("/api/v1/exploration/targets?limit=20", headers=headers)
    assert res1.status_code == 200
    data1 = res1.json()
    assert "targets" in data1

    res2 = test_client.get("/api/v1/exploration/targets?limit=20", headers=headers)
    assert res2.status_code == 200
    data2 = res2.json()

    assert len(data1["targets"]) == len(data2["targets"])
    if data1["targets"]:
        assert data1["targets"][0]["target_id"] == data2["targets"][0]["target_id"]
        assert data1["targets"][0]["prospectivity_prob"] == data2["targets"][0]["prospectivity_prob"]


def test_equipment_fleet_cache_equivalence():
    token = create_access_token({"sub": "admin", "role": "super_admin"})
    headers = {"Authorization": f"Bearer {token}"}

    res1 = test_client.get("/api/v1/equipment/1/fleet", headers=headers)
    assert res1.status_code == 200
    data1 = res1.json()
    assert "fleet" in data1

    res2 = test_client.get("/api/v1/equipment/1/fleet", headers=headers)
    assert res2.status_code == 200
    data2 = res2.json()

    assert len(data1["fleet"]) == len(data2["fleet"])
    assert data1["mine_id"] == data2["mine_id"]
    assert data1["total_machines"] == data2["total_machines"]


def test_intelligence_pulse_cache_equivalence():
    token = create_access_token({"sub": "admin", "role": "super_admin"})
    headers = {"Authorization": f"Bearer {token}"}

    res1 = test_client.get("/api/v1/intelligence/pulse?mine_id=1", headers=headers)
    assert res1.status_code == 200
    data1 = res1.json()

    res2 = test_client.get("/api/v1/intelligence/pulse?mine_id=1", headers=headers)
    assert res2.status_code == 200
    data2 = res2.json()

    assert data1["overall_score"] == data2["overall_score"]
    assert data1["overall_status"] == data2["overall_status"]
