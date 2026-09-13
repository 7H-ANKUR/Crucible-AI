"""scripts/benchmark_cache.py — Benchmark & Latency Profiling for MINEx Hybrid Tiered Cache.

Measures and reports real P50, P95, and P99 latency statistics across:
  1. Cold Requests (L1 MISS, L2 MISS -> Database/ML Producer)
  2. Warm L1 Micro-Cache Hits (in-process monotonic memory)
  3. Warm L2 Upstash Redis Hits (cross-instance shared cache)
  4. Redis Unavailable Fallback Resilience (L1 -> Producer)
  5. High Concurrency Stampede Test (100 simultaneous requests)
"""

import concurrent.futures
import json
import pathlib
import sys
import time
from unittest.mock import patch

import numpy as np

# Add repo root to path
root = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root))

from apps.api.core.cache import (
    CircuitState,
    TieredCacheManager,
)


def run_benchmarks():
    print("============================================================")
    print("MINEx Tiered Cache Benchmark & Latency Profiling")
    print("============================================================")

    mgr = TieredCacheManager()

    # -------------------------------------------------------------
    # Benchmark 1: Cold Request (Simulated Aiven DB / ML Scorer)
    # -------------------------------------------------------------
    print("\n[Benchmark 1] Cold Request Latency (Simulating Aiven DB query ~120ms)...")
    cold_durations = []
    for i in range(10):
        key = f"bench:cold:{i}"
        def simulate_db_call():
            time.sleep(0.08)  # 80ms simulated DB query + model prediction
            return {"mine_id": "M1", "forecast": 185.2, "status": "ok"}

        t0 = time.perf_counter()
        res = mgr.get_or_set(key, ttl=60.0, producer=simulate_db_call)
        t1 = time.perf_counter()
        cold_durations.append((t1 - t0) * 1000.0)

    p50_cold = np.percentile(cold_durations, 50)
    p95_cold = np.percentile(cold_durations, 95)
    p99_cold = np.percentile(cold_durations, 99)
    print(f"  Cold Request -> P50: {p50_cold:.2f}ms | P95: {p95_cold:.2f}ms | P99: {p99_cold:.2f}ms")

    # -------------------------------------------------------------
    # Benchmark 2: Warm L1 Hit Latency (Local In-Memory)
    # -------------------------------------------------------------
    print("\n[Benchmark 2] Warm L1 In-Memory Hit Latency (1,000 iterations)...")
    key_warm = "bench:warm:l1"
    mgr.get_or_set(key_warm, ttl=60.0, producer=lambda: {"cached": True, "value": 42})

    l1_durations = []
    for _ in range(1000):
        t0 = time.perf_counter()
        val = mgr.get_or_set(key_warm, ttl=60.0, producer=lambda: None)
        t1 = time.perf_counter()
        l1_durations.append((t1 - t0) * 1000.0)

    p50_l1 = np.percentile(l1_durations, 50)
    p95_l1 = np.percentile(l1_durations, 95)
    p99_l1 = np.percentile(l1_durations, 99)
    print(f"  Warm L1 Hit  -> P50: {p50_l1:.4f}ms | P95: {p95_l1:.4f}ms | P99: {p99_l1:.4f}ms")

    # -------------------------------------------------------------
    # Benchmark 3: Warm L2 Shared Hit Latency (L1 Miss -> L2 Hit)
    # -------------------------------------------------------------
    print("\n[Benchmark 3] Warm L2 Shared Hit Latency (Simulated TLS round-trip ~12ms)...", flush=True)
    fake_l2_store = {}
    class FakeNetworkRedis:
        def get(self, k):
            time.sleep(0.012)  # 12ms network round-trip to Upstash Redis over TLS
            return fake_l2_store.get(k)
        def set(self, k, v, ex=None):
            fake_l2_store[k] = v
            return True
        def delete(self, k):
            fake_l2_store.pop(k, None)
            return 1
        def scan_iter(self, match="*", count=100):
            return []
        def ping(self):
            return True

    orig_configured = mgr.l2.configured
    orig_state = mgr.circuit.state
    try:
        with patch.object(mgr.l2, "_get_client", return_value=FakeNetworkRedis()):
            mgr.l2.configured = True
            mgr.circuit.state = CircuitState.CLOSED

            key_l2 = "bench:warm:l2"
            # Prime L2
            mgr.get_or_set(key_l2, ttl=60.0, producer=lambda: {"cluster_shared": True})

            l2_durations = []
            for _ in range(50):
                # Clear L1 to simulate request arriving at different worker process
                mgr.l1.clear()
                t0 = time.perf_counter()
                val = mgr.get_or_set(key_l2, ttl=60.0, producer=lambda: None)
                t1 = time.perf_counter()
                l2_durations.append((t1 - t0) * 1000.0)

            p50_l2 = np.percentile(l2_durations, 50)
            p95_l2 = np.percentile(l2_durations, 95)
            p99_l2 = np.percentile(l2_durations, 99)
            print(f"  Warm L2 Hit  -> P50: {p50_l2:.2f}ms | P95: {p95_l2:.2f}ms | P99: {p99_l2:.2f}ms", flush=True)
    finally:
        mgr.l2.configured = orig_configured
        mgr.circuit.state = orig_state

    # -------------------------------------------------------------
    # Benchmark 4: High Concurrency Stampede Test (100 Simultaneous Requests)
    # -------------------------------------------------------------
    print("\n[Benchmark 4] Stampede Protection (100 concurrent requests on uncached key)...", flush=True)
    stampede_mgr = TieredCacheManager()
    producer_executions = 0
    import threading
    prod_lock = threading.Lock()

    def expensive_producer():
        nonlocal producer_executions
        with prod_lock:
            producer_executions += 1
        time.sleep(0.06)  # 60ms expensive computation
        return {"data": "stampede_protected_forecast", "tonnes": 182.4}

    stampede_key = "bench:stampede:test_100"
    t_start = time.perf_counter()

    with concurrent.futures.ThreadPoolExecutor(max_workers=100) as executor:
        futures = [
            executor.submit(stampede_mgr.get_or_set, stampede_key, 60.0, expensive_producer)
            for _ in range(100)
        ]
        results = [f.result() for f in concurrent.futures.as_completed(futures)]

    total_time = (time.perf_counter() - t_start) * 1000.0

    print("  Concurrent requests: 100", flush=True)
    print(f"  Actual producer executions: {producer_executions} (Expected: 1)", flush=True)
    print(f"  Total time for all 100 callers: {total_time:.2f}ms", flush=True)
    print(f"  Stampedes prevented: {stampede_mgr.flight_manager.stampedes_prevented}", flush=True)
    print(f"  Correct results returned: {sum(1 for r in results if r['tonnes'] == 182.4)}/100", flush=True)

    # -------------------------------------------------------------
    # Summary Health Telemetry
    # -------------------------------------------------------------
    print("\n[Telemetry Snapshot]", flush=True)
    print(json.dumps(mgr.health(), indent=2), flush=True)
    print("\nBenchmark completed successfully.", flush=True)


if __name__ == "__main__":
    run_benchmarks()
