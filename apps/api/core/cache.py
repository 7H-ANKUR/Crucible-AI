"""apps/api/core/cache.py — MINEx Production-Grade Hybrid Tiered Cache.

Architecture:
  API Request -> TieredCacheManager
    -> Check L1 (In-Memory Micro-Cache, Monotonic Time, Bounded LRU)
    -> Check L2 (Upstash Redis over TLS with Circuit Breaker & Strict Timeout)
    -> Single-Flight Coalescing (Prevent Stampede across concurrent requests)
    -> Database / ML Producer Execution
    -> L2 Populate (with Envelope & Optional Compression) -> L1 Populate
    -> Return Result

Resilience Guarantee:
  Redis is an accelerator, never the source of truth.
  If Redis is missing, offline, slow, or fails, requests continue transparently
  via L1 and the authoritative producer. Failures are logged and exposed in metrics.
"""

import base64
import collections
import concurrent.futures
import datetime
import decimal
import enum
import hashlib
import json
import logging
import re
import socket
import threading
import time
import uuid
import zlib
from collections.abc import Callable
from typing import Any, Optional

try:
    import numpy as np
except ImportError:
    np = None

try:
    import pandas as pd
except ImportError:
    pd = None

try:
    import redis
except ImportError:
    redis = None

from .config import settings

logger = logging.getLogger("minex.cache")


# ===========================================================================
# 1. Serialization Engine (Deterministic, Safe JSON + Zlib Compression)
# ===========================================================================

MAX_DECOMPRESSED_BYTES = 10 * 1024 * 1024  # 10 MB safety ceiling against zip bombs


def _json_serial_default(obj: Any) -> Any:
    """Deterministic conversion of non-standard Python/NumPy/Pandas objects to JSON primitives."""
    if isinstance(obj, (datetime.datetime, datetime.date)):
        return obj.isoformat()
    if isinstance(obj, (decimal.Decimal, uuid.UUID)):
        return str(obj)
    if isinstance(obj, enum.Enum):
        return obj.value
    if hasattr(obj, "model_dump"):
        return obj.model_dump()
    if hasattr(obj, "dict") and callable(obj.dict):
        return obj.dict()
    if np is not None:
        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            return float(obj)
        if isinstance(obj, (np.bool_,)):
            return bool(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
    if pd is not None:
        if isinstance(obj, pd.Timestamp):
            return obj.isoformat()
        if isinstance(obj, pd.Series):
            return obj.to_dict()
        if isinstance(obj, pd.DataFrame):
            return obj.to_dict(orient="records")
    if isinstance(obj, (set, tuple)):
        return list(obj)
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def serialize_cache_value(value: Any, compression_threshold: int = 25 * 1024) -> tuple[str, bool]:
    """Serialize a Python object into a JSON string, compressing with zlib if size exceeds threshold.

    Returns:
        (payload_string, is_compressed)
    """
    raw_json = json.dumps(value, default=_json_serial_default, sort_keys=True, separators=(",", ":"))
    raw_bytes = raw_json.encode("utf-8")

    if len(raw_bytes) > compression_threshold:
        compressed_bytes = zlib.compress(raw_bytes, level=6)
        payload_str = base64.b64encode(compressed_bytes).decode("ascii")
        return payload_str, True
    return raw_json, False


def deserialize_cache_value(payload_str: str, compression: str) -> Any:
    """Deserialize a cached payload string, decompressing if tagged with zlib."""
    if compression == "zlib":
        compressed_bytes = base64.b64decode(payload_str.encode("ascii"))
        decompressed_bytes = zlib.decompress(compressed_bytes, bufsize=MAX_DECOMPRESSED_BYTES)
        if len(decompressed_bytes) > MAX_DECOMPRESSED_BYTES:
            raise ValueError(f"Decompressed payload size exceeds {MAX_DECOMPRESSED_BYTES} bytes limit")
        return json.loads(decompressed_bytes.decode("utf-8"))
    elif compression == "none":
        return json.loads(payload_str)
    else:
        raise ValueError(f"Unsupported compression type: {compression}")


# ===========================================================================
# 2. L1 In-Memory Cache (Monotonic Time, LRU Bounded, Thread-Safe)
# ===========================================================================

class L1Entry:
    __slots__ = (
        "created_at_epoch",
        "created_at_mono",
        "expires_at_epoch",
        "expires_at_mono",
        "stale_until_epoch",
        "value",
    )

    def __init__(
        self,
        value: Any,
        expires_at_mono: float,
        created_at_mono: float,
        created_at_epoch: float,
        expires_at_epoch: float,
        stale_until_epoch: float,
    ):
        self.value = value
        self.expires_at_mono = expires_at_mono
        self.created_at_mono = created_at_mono
        self.created_at_epoch = created_at_epoch
        self.expires_at_epoch = expires_at_epoch
        self.stale_until_epoch = stale_until_epoch


class L1Cache:
    """Process-local in-memory cache with monotonic TTL expiration, hard stale timestamps, and LRU bounds."""

    def __init__(self, max_entries: int = 1000, default_ttl: float = 10.0):
        self.max_entries = max_entries
        self.default_ttl = default_ttl
        self._store: collections.OrderedDict[str, L1Entry] = collections.OrderedDict()
        self._lock = threading.RLock()
        self.hits = 0
        self.misses = 0
        self.evictions = 0
        self.expirations = 0

    def get(self, key: str) -> tuple[bool, Any]:
        """Simple get for fresh L1 hit, preserving standard 2-tuple contract (hit, val)."""
        hit, is_stale, val, _ = self.get_detailed(key, allow_stale=False)
        return hit and not is_stale, val

    def get_detailed(self, key: str, allow_stale: bool = False) -> tuple[bool, bool, Any, dict | None]:
        """Detailed L1 lookup checking fresh and hard stale windows.
        Returns:
            (hit, is_stale, value, meta)
        """
        now_mono = time.monotonic()
        now_epoch = time.time()
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                self.misses += 1
                return False, False, None, None

            meta = {
                "created_at_epoch": entry.created_at_epoch,
                "expires_at_epoch": entry.expires_at_epoch,
                "stale_until_epoch": entry.stale_until_epoch,
            }

            # Fresh hit (monotonic + epoch valid)
            if now_epoch < entry.expires_at_epoch and now_mono < entry.expires_at_mono:
                self._store.move_to_end(key)
                self.hits += 1
                return True, False, entry.value, meta

            # Stale hit (within hard stale window, if allowed)
            if allow_stale and now_epoch < entry.stale_until_epoch:
                self._store.move_to_end(key)
                self.hits += 1
                return True, True, entry.value, meta

            # Hard expired (past stale_until_epoch or allow_stale=False)
            del self._store[key]
            self.expirations += 1
            self.misses += 1
            return False, False, None, None

    def set(
        self,
        key: str,
        value: Any,
        ttl: float | None = None,
        created_at_epoch: float | None = None,
        expires_at_epoch: float | None = None,
        stale_until_epoch: float | None = None,
    ) -> None:
        duration = ttl if ttl is not None else self.default_ttl
        now_mono = time.monotonic()
        now_epoch = time.time()
        expires_mono = now_mono + duration

        c_epoch = created_at_epoch if created_at_epoch is not None else now_epoch
        e_epoch = expires_at_epoch if expires_at_epoch is not None else (now_epoch + duration)
        s_epoch = stale_until_epoch if stale_until_epoch is not None else e_epoch

        with self._lock:
            if key in self._store:
                self._store.move_to_end(key)
            self._store[key] = L1Entry(
                value=value,
                expires_at_mono=expires_mono,
                created_at_mono=now_mono,
                created_at_epoch=c_epoch,
                expires_at_epoch=e_epoch,
                stale_until_epoch=s_epoch,
            )
            if len(self._store) > self.max_entries:
                # Evict oldest entry (LRU)
                self._store.popitem(last=False)
                self.evictions += 1

    def delete(self, key: str) -> bool:
        with self._lock:
            if key in self._store:
                del self._store[key]
                return True
            return False

    def delete_pattern(self, pattern: str) -> int:
        """Delete all keys matching regex or wildcard pattern."""
        regex_pat = pattern.replace("*", ".*")
        compiled = re.compile(f"^{regex_pat}$")
        count = 0
        with self._lock:
            keys_to_delete = [k for k in self._store.keys() if compiled.match(k)]
            for k in keys_to_delete:
                del self._store[k]
                count += 1
        return count

    def clear(self) -> None:
        with self._lock:
            self._store.clear()

    def size(self) -> int:
        with self._lock:
            return len(self._store)

    def stats(self) -> dict[str, Any]:
        with self._lock:
            total = self.hits + self.misses
            hit_rate = round(self.hits / total, 4) if total > 0 else 0.0
            return {
                "entries": len(self._store),
                "max_entries": self.max_entries,
                "hits": self.hits,
                "misses": self.misses,
                "hit_rate": hit_rate,
                "evictions": self.evictions,
                "expirations": self.expirations,
            }


# ===========================================================================
# 3. Circuit Breaker for L2 Redis
# ===========================================================================

class CircuitState(enum.Enum):
    CLOSED = "CLOSED"        # Normal operations
    OPEN = "OPEN"            # Fast-fail, skip Redis
    HALF_OPEN = "HALF_OPEN"  # Testing single probe request
    DISABLED = "DISABLED"    # Redis explicitly disabled or unconfigured


class RedisCircuitBreaker:
    """Strict circuit breaker preventing cascading socket hangs when Redis is impaired."""

    def __init__(self, failure_threshold: int = 3, cooldown_seconds: float = 30.0):
        self.failure_threshold = failure_threshold
        self.cooldown_seconds = cooldown_seconds
        self.state = CircuitState.CLOSED
        self.failure_count = 0
        self.last_state_change_mono = time.monotonic()
        self._lock = threading.Lock()

    def can_attempt(self) -> bool:
        with self._lock:
            if self.state == CircuitState.DISABLED:
                return False
            if self.state == CircuitState.CLOSED:
                return True
            now = time.monotonic()
            if self.state == CircuitState.OPEN:
                if now - self.last_state_change_mono >= self.cooldown_seconds:
                    logger.info("Redis circuit breaker entering HALF_OPEN probe state.")
                    self.state = CircuitState.HALF_OPEN
                    self.last_state_change_mono = now
                    return True
                return False
            if self.state == CircuitState.HALF_OPEN:
                # Allow probe
                return True
            return False

    def record_success(self) -> None:
        with self._lock:
            if self.state in (CircuitState.HALF_OPEN, CircuitState.OPEN):
                logger.info("Redis circuit breaker probe succeeded. Closing circuit (CLOSED).")
            self.state = CircuitState.CLOSED
            self.failure_count = 0

    def record_failure(self, error: Exception | None = None) -> None:
        with self._lock:
            if self.state == CircuitState.DISABLED:
                return
            self.failure_count += 1
            now = time.monotonic()
            if self.state == CircuitState.CLOSED and self.failure_count >= self.failure_threshold:
                self.state = CircuitState.OPEN
                self.last_state_change_mono = now
                logger.warning(
                    "Redis circuit breaker tripped OPEN after %d failures. Cooldown: %ss. Last error: %s",
                    self.failure_count, self.cooldown_seconds, error
                )
            elif self.state == CircuitState.HALF_OPEN:
                self.state = CircuitState.OPEN
                self.last_state_change_mono = now
                logger.warning("Redis circuit breaker probe failed. Re-opening circuit (OPEN). Error: %s", error)


# ===========================================================================
# 4. Single-Flight Request Coalescing (Cache Stampede Protection)
# ===========================================================================

class SingleFlightManager:
    """Process-local per-key lock manager ensuring only 1 producer executes for simultaneous misses."""

    def __init__(self):
        self._locks: dict[str, tuple[threading.Lock, int]] = {}
        self._pool_lock = threading.Lock()
        self.stampedes_prevented = 0

    def acquire_flight(self, key: str) -> threading.Lock:
        with self._pool_lock:
            if key in self._locks:
                lock, ref_count = self._locks[key]
                self._locks[key] = (lock, ref_count + 1)
                return lock
            else:
                new_lock = threading.Lock()
                self._locks[key] = (new_lock, 1)
                return new_lock

    def release_flight(self, key: str) -> None:
        with self._pool_lock:
            if key in self._locks:
                lock, ref_count = self._locks[key]
                if ref_count <= 1:
                    del self._locks[key]
                else:
                    self._locks[key] = (lock, ref_count - 1)


# ===========================================================================
# 5. L2 Upstash Redis Client Layer
# ===========================================================================

class L2RedisClient:
    """Managed Redis client supporting Upstash TLS (rediss://), pooling, and non-blocking safety."""

    def __init__(self, url: str | None, circuit_breaker: RedisCircuitBreaker, on_error: Callable[[str], None] | None = None):
        if url and "upstash.io" in url and url.startswith("redis://"):
            url = url.replace("redis://", "rediss://", 1)
        self.url = url
        self.circuit = circuit_breaker
        self.on_error = on_error
        self._client: redis.Redis | None = None
        self._pool: redis.ConnectionPool | None = None
        self._init_lock = threading.Lock()
        self.configured = bool(url and url.strip())

        if not self.configured or not getattr(settings, "REDIS_ENABLED", True):
            self.circuit.state = CircuitState.DISABLED

    def _get_client(self) -> Optional["redis.Redis"]:
        if not self.configured or not self.url or not getattr(settings, "REDIS_ENABLED", True) or redis is None:
            return None
        if self._client is not None:
            return self._client
        with self._init_lock:
            if self._client is not None:
                return self._client
            try:
                if not self.url:
                    return None
                is_tls = self.url.startswith("rediss://")
                self._pool = redis.ConnectionPool.from_url(
                    self.url,
                    max_connections=getattr(settings, "REDIS_MAX_CONNECTIONS", 10),
                    socket_connect_timeout=getattr(settings, "REDIS_CONNECT_TIMEOUT", 1.0),
                    socket_timeout=getattr(settings, "REDIS_SOCKET_TIMEOUT", 1.5),
                    decode_responses=True,
                )
                self._client = redis.Redis(connection_pool=self._pool)
                logger.info("Initialized Redis client pool (TLS=%s, max_conns=%d)", is_tls, getattr(settings, "REDIS_MAX_CONNECTIONS", 10))
                return self._client
            except Exception as e:
                logger.error("Failed to initialize Redis client pool: %s", e)
                self.circuit.record_failure(e)
                if self.on_error:
                    self.on_error("cache_l2_error")
                return None

    def get(self, key: str) -> str | None:
        if not self.circuit.can_attempt():
            return None
        client = self._get_client()
        if client is None:
            return None
        try:
            val = client.get(key)
            self.circuit.record_success()
            return val
        except Exception as e:
            self.circuit.record_failure(e)
            if self.on_error:
                if isinstance(e, (socket.timeout, TimeoutError)):
                    self.on_error("cache_l2_timeout")
                else:
                    self.on_error("cache_l2_error")
            logger.warning("Redis GET failed for key '%s': %s", key, e)
            return None

    def set(self, key: str, value: str, ex_seconds: int) -> bool:
        if not self.circuit.can_attempt():
            return False
        client = self._get_client()
        if client is None:
            return False
        try:
            client.set(key, value, ex=max(1, ex_seconds))
            self.circuit.record_success()
            return True
        except Exception as e:
            self.circuit.record_failure(e)
            if self.on_error:
                if isinstance(e, (socket.timeout, TimeoutError)):
                    self.on_error("cache_l2_timeout")
                else:
                    self.on_error("cache_l2_error")
            logger.warning("Redis SET failed for key '%s': %s", key, e)
            return False

    def delete(self, key: str) -> bool:
        if not self.circuit.can_attempt():
            return False
        client = self._get_client()
        if client is None:
            return False
        try:
            client.delete(key)
            self.circuit.record_success()
            return True
        except Exception as e:
            self.circuit.record_failure(e)
            return False

    def scan_iter(self, match: str, count: int = 100):
        """Safe non-blocking key scanner using Redis SCAN (never KEYS!)."""
        if not self.circuit.can_attempt():
            return
        client = self._get_client()
        if client is None:
            return
        try:
            for k in client.scan_iter(match=match, count=count):
                yield k
            self.circuit.record_success()
        except Exception as e:
            self.circuit.record_failure(e)
            logger.warning("Redis SCAN failed for match '%s': %s", match, e)

    def ping(self) -> bool:
        if not self.configured or not getattr(settings, "REDIS_ENABLED", True):
            return False
        client = self._get_client()
        if client is None:
            return False
        try:
            res = client.ping()
            self.circuit.record_success()
            return bool(res)
        except Exception as e:
            self.circuit.record_failure(e)
            return False

    def close(self) -> None:
        with self._init_lock:
            if self._pool is not None:
                try:
                    self._pool.disconnect()
                except Exception:
                    pass
                self._client = None
                self._pool = None


# ===========================================================================
# 6. Centralized Cache Policies & Key Builder
# ===========================================================================

CACHE_POLICIES = {
    "production_forecast": {
        "l1_ttl": 10,
        "l2_ttl": 60,
        "allow_stale": True,
        "stale_max_ttl": 300,
    },
    "production_history": {
        "l1_ttl": 15,
        "l2_ttl": 120,
        "allow_stale": True,
        "stale_max_ttl": 600,
    },
    "production_shortfall": {
        "l1_ttl": 10,
        "l2_ttl": 60,
        "allow_stale": True,
        "stale_max_ttl": 300,
    },
    "equipment_fleet": {
        "l1_ttl": 5,
        "l2_ttl": 15,
        "allow_stale": False,  # Safety-sensitive: never serve stale telemetry without warning
        "stale_max_ttl": 30,
    },
    "exploration_targets": {
        "l1_ttl": 30,
        "l2_ttl": 600,
        "allow_stale": True,
        "stale_max_ttl": 1800,
    },
    "exploration_map": {
        "l1_ttl": 30,
        "l2_ttl": 600,
        "allow_stale": True,
        "stale_max_ttl": 1800,
    },
    "intelligence_pulse": {
        "l1_ttl": 10,
        "l2_ttl": 30,
        "allow_stale": True,
        "stale_max_ttl": 120,
    },
}


def build_cache_key(
    domain: str,
    resource: str,
    entity_id: str | None = None,
    params: dict[str, Any] | None = None,
    model_version: str | None = None,
    dataset_version: str | None = None,
    auth_scope: str | None = None,
) -> str:
    """Build a deterministic, version-aware, authorization-safe cache key.

    Format:
      minex:cache:v{version}:{domain}:{resource}:{entity_id}:{params_hash}:{model_version}:{dataset_version}:{auth_scope}
    """
    version = getattr(settings, "CACHE_SCHEMA_VERSION", 1)
    parts = ["minex", "cache", f"v{version}", domain, resource]

    if entity_id:
        parts.append(str(entity_id))
    else:
        parts.append("all")

    if params:
        param_str = json.dumps(params, sort_keys=True, default=str)
        param_hash = hashlib.sha256(param_str.encode("utf-8")).hexdigest()[:10]
        parts.append(f"p:{param_hash}")
    else:
        parts.append("p:none")

    if model_version:
        clean_model = str(model_version).replace(":", "_").replace(" ", "_")
        parts.append(f"m:{clean_model}")

    if dataset_version:
        clean_ds = str(dataset_version).replace(":", "_").replace(" ", "_")
        parts.append(f"d:{clean_ds}")

    if auth_scope:
        parts.append(f"a:{auth_scope}")

    return ":".join(parts)


# ===========================================================================
# 7. The Authoritative TieredCacheManager
# ===========================================================================

class TieredCacheManager:
    """Authoritative Two-Tier Cache Manager with L1 Micro-Cache, L2 Upstash Redis,
    Single-Flight Request Coalescing, Envelope Versioning, True SWR, and Metric Observability.
    """

    def __init__(
        self,
        enabled: bool | None = None,
        l1_max_entries: int | None = None,
        l1_ttl_default: float | None = None,
        redis_url: str | None = None,
    ):
        self._enabled_override = enabled
        max_entries = l1_max_entries if l1_max_entries is not None else getattr(settings, "REDIS_L1_MAX_ENTRIES", 1000)
        default_ttl = l1_ttl_default if l1_ttl_default is not None else getattr(settings, "REDIS_L1_TTL_DEFAULT", 10.0)
        self.l1 = L1Cache(
            max_entries=max_entries,
            default_ttl=default_ttl,
        )
        self.circuit = RedisCircuitBreaker(
            failure_threshold=3,
            cooldown_seconds=getattr(settings, "REDIS_CIRCUIT_BREAKER_SECONDS", 30.0),
        )
        url = redis_url if redis_url is not None else getattr(settings, "REDIS_URL", None)
        self.l2 = L2RedisClient(url, self.circuit, on_error=self._inc_metric)
        self.flight_manager = SingleFlightManager()

        # Dedicated background SWR thread pool
        self._swr_executor = concurrent.futures.ThreadPoolExecutor(
            max_workers=4, thread_name_prefix="minex_swr_worker"
        )
        self._active_swr_keys: set[str] = set()
        self._swr_keys_lock = threading.Lock()

        # Observability Metrics
        self.metrics = {
            "cache_l1_hit": 0,
            "cache_l1_miss": 0,
            "cache_l2_hit": 0,
            "cache_l2_miss": 0,
            "cache_producer_call": 0,
            "cache_l2_error": 0,
            "cache_l2_timeout": 0,
            "cache_l2_circuit_open": 0,
            "cache_write_error": 0,
            "cache_deserialize_error": 0,
            "cache_compression": 0,
            "cache_invalidation": 0,
            "cache_stampede_prevented": 0,
            "cache_stale_served": 0,
            "cache_stale_refresh_started": 0,
            "cache_stale_refresh_completed": 0,
            "cache_stale_refresh_error": 0,
            "producer_durations_ms": collections.deque(maxlen=200),
            "l1_durations_ms": collections.deque(maxlen=200),
            "l2_durations_ms": collections.deque(maxlen=200),
        }
        self._metrics_lock = threading.Lock()

    @property
    def is_enabled(self) -> bool:
        if self._enabled_override is not None:
            return self._enabled_override
        return bool(getattr(settings, "REDIS_ENABLED", True))

    @property
    def single_flight_prevented(self) -> int:
        return self.flight_manager.stampedes_prevented

    def _inc_metric(self, name: str, count: int = 1) -> None:
        with self._metrics_lock:
            if name in self.metrics:
                self.metrics[name] += count

    def _record_producer_latency(self, duration_ms: float) -> None:
        with self._metrics_lock:
            self.metrics["producer_durations_ms"].append(duration_ms)

    def _record_l1_latency(self, duration_ms: float) -> None:
        with self._metrics_lock:
            self.metrics["l1_durations_ms"].append(duration_ms)

    def _record_l2_latency(self, duration_ms: float) -> None:
        with self._metrics_lock:
            self.metrics["l2_durations_ms"].append(duration_ms)

    # =======================================================================
    # Shared Primitives (Encoding, Decoding, Envelope Validation, Read/Write)
    # =======================================================================

    def _encode(
        self,
        value: Any,
        ttl: float,
        allow_stale: bool = False,
        stale_window: float = 0.0,
        created_at_epoch: float | None = None,
    ) -> tuple[str, dict]:
        """Unified serialization and envelope construction preserving authoritative creation timestamp."""
        thresh = getattr(settings, "REDIS_COMPRESSION_THRESHOLD_BYTES", 25 * 1024)
        payload_str, is_compressed = serialize_cache_value(value, compression_threshold=thresh)
        if is_compressed:
            self._inc_metric("cache_compression")

        now_epoch = time.time()
        c_epoch = created_at_epoch if created_at_epoch is not None else now_epoch
        e_epoch = c_epoch + ttl
        s_epoch = e_epoch + (stale_window if allow_stale else 0.0)

        envelope = {
            "schema_version": getattr(settings, "CACHE_SCHEMA_VERSION", 1),
            "serializer": "json",
            "compression": "zlib" if is_compressed else "none",
            "created_at": datetime.datetime.utcfromtimestamp(c_epoch).isoformat() + "Z",
            "created_at_epoch": c_epoch,
            "expires_at_epoch": e_epoch,
            "stale_until_epoch": s_epoch,
            "payload": payload_str,
        }
        return json.dumps(envelope), envelope

    def _decode(self, envelope_raw: str) -> tuple[bool, Any, dict | None]:
        """Unified envelope parsing, schema validation, and payload deserialization."""
        try:
            env = json.loads(envelope_raw)
            if not self._validate_envelope(env):
                self._inc_metric("cache_deserialize_error")
                return False, None, None
            val = deserialize_cache_value(env["payload"], env.get("compression", "none"))
            return True, val, env
        except Exception as e:
            self._inc_metric("cache_deserialize_error")
            logger.warning("Failed to decode cache envelope: %s", e)
            return False, None, None

    def _validate_envelope(self, env: dict) -> bool:
        """Validate envelope format and schema version."""
        if not isinstance(env, dict):
            return False
        if env.get("schema_version") != getattr(settings, "CACHE_SCHEMA_VERSION", 1):
            return False
        if "payload" not in env:
            return False
        return True

    def _read_l1(self, key: str, allow_stale: bool = False) -> tuple[bool, bool, Any, dict | None]:
        """Read from L1 micro-cache. Returns (hit, is_stale, value, meta)."""
        t0 = time.perf_counter()
        hit, is_stale, val, meta = self.l1.get_detailed(key, allow_stale=allow_stale)
        dur_ms = (time.perf_counter() - t0) * 1000.0
        self._record_l1_latency(dur_ms)
        return hit, is_stale, val, meta

    def _write_l1(self, key: str, value: Any, l1_ttl: float, envelope_meta: dict) -> None:
        """Write to L1 with exact timestamps preserved from envelope (never pushes T0 forward)."""
        self.l1.set(
            key=key,
            value=value,
            ttl=l1_ttl,
            created_at_epoch=envelope_meta.get("created_at_epoch"),
            expires_at_epoch=envelope_meta.get("expires_at_epoch"),
            stale_until_epoch=envelope_meta.get("stale_until_epoch"),
        )

    def _read_l2(self, key: str, allow_stale: bool = False) -> tuple[bool, bool, Any, dict | None]:
        """Read from L2 Redis. Returns (hit, is_stale, value, envelope)."""
        if self.l2 is None or not getattr(self.l2, "configured", False):
            return False, False, None, None

        t0 = time.perf_counter()
        envelope_raw = self.l2.get(key)
        dur_ms = (time.perf_counter() - t0) * 1000.0
        self._record_l2_latency(dur_ms)

        if envelope_raw is None:
            return False, False, None, None

        ok, val, env = self._decode(envelope_raw)
        if not ok or env is None:
            # Corrupted entry: invalidate in L2
            self.l2.delete(key)
            return False, False, None, None

        now_epoch = time.time()
        expires_at_epoch = env.get("expires_at_epoch", 0.0)
        stale_until_epoch = env.get("stale_until_epoch", expires_at_epoch)

        # Fresh hit
        if now_epoch < expires_at_epoch:
            return True, False, val, env

        # Stale hit (if allowed and within hard stale window)
        if allow_stale and now_epoch < stale_until_epoch:
            return True, True, val, env

        # Hard expired (past stale_until_epoch or allow_stale=False)
        return False, False, None, None

    def _write_l2(self, key: str, envelope_json: str, l2_ttl: int) -> bool:
        """Best-effort write to L2 Upstash Redis. Cache-write failure must never fail the authoritative response."""
        if self.l2 is None or not getattr(self.l2, "configured", False):
            return False
        try:
            return self.l2.set(key, envelope_json, l2_ttl)
        except Exception as e:
            self._inc_metric("cache_write_error")
            logger.warning("Best-effort L2 write failed for key '%s': %s", key, e)
            return False

    # =======================================================================
    # True Stale-While-Revalidate (SWR) Background Scheduler
    # =======================================================================

    def _schedule_swr_refresh(
        self,
        key: str,
        ttl: float,
        producer: Callable[[], Any],
        effective_l1_ttl: float,
        allow_stale: bool,
        stale_max_seconds: int | None,
    ) -> bool:
        """Schedule a non-blocking background refresh for a stale key using single-flight deduplication."""
        with self._swr_keys_lock:
            if key in self._active_swr_keys:
                return False
            self._active_swr_keys.add(key)

        self._inc_metric("cache_stale_refresh_started")

        def _refresh_worker():
            try:
                lock = self.flight_manager.acquire_flight(key)
                lock.acquire()
                try:
                    # Execute producer once for all coalesced callers
                    t_start = time.perf_counter()
                    self._inc_metric("cache_producer_call")
                    fresh_result = producer()
                    dur_ms = (time.perf_counter() - t_start) * 1000.0
                    self._record_producer_latency(dur_ms)

                    now_epoch = time.time()
                    stale_window = (
                        stale_max_seconds
                        if stale_max_seconds is not None
                        else getattr(settings, "REDIS_STALE_MAX_SECONDS", 300)
                    )
                    env_json, env_meta = self._encode(
                        fresh_result,
                        ttl=ttl,
                        allow_stale=allow_stale,
                        stale_window=stale_window,
                        created_at_epoch=now_epoch,
                    )
                    l2_ttl = int(ttl + (stale_window if allow_stale else 0))
                    self._write_l2(key, env_json, l2_ttl)
                    self._write_l1(key, fresh_result, effective_l1_ttl, env_meta)
                    self._inc_metric("cache_stale_refresh_completed")
                finally:
                    lock.release()
                    self.flight_manager.release_flight(key)
            except Exception as e:
                self._inc_metric("cache_stale_refresh_error")
                logger.warning("Background SWR refresh failed for key '%s': %s", key, e)
            finally:
                with self._swr_keys_lock:
                    self._active_swr_keys.discard(key)

        self._swr_executor.submit(_refresh_worker)
        return True

    # =======================================================================
    # Public Cache Interface (get, set, get_or_set, delete, invalidate)
    # =======================================================================

    def get(self, key: str, allow_stale: bool = False) -> tuple[bool, Any]:
        """Direct multi-tier get (checks L1 then L2) using unified envelope primitives."""
        hit, is_stale, val, meta = self._read_l1(key, allow_stale=allow_stale)
        if hit:
            if is_stale:
                self._inc_metric("cache_stale_served")
            else:
                self._inc_metric("cache_l1_hit")
            return True, val
        self._inc_metric("cache_l1_miss")

        l2_hit, l2_stale, l2_val, l2_env = self._read_l2(key, allow_stale=allow_stale)
        if l2_hit and l2_env is not None:
            if l2_stale:
                self._inc_metric("cache_stale_served")
            else:
                self._inc_metric("cache_l2_hit")
            # Backfill L1 with exact timestamps
            self._write_l1(key, l2_val, getattr(settings, "REDIS_L1_TTL_DEFAULT", 10.0), l2_env)
            return True, l2_val

        self._inc_metric("cache_l2_miss")
        return False, None

    def set(
        self,
        key: str,
        value: Any,
        ttl: float | None = None,
        allow_stale: bool = False,
        stale_max_seconds: int | None = None,
    ) -> bool:
        """Direct multi-tier set (writes L2 then L1) using unified envelope primitives.

        Best-effort cache write: failure to write cache never fails the caller.
        """
        effective_ttl = ttl if ttl is not None else getattr(settings, "REDIS_TTL_DEFAULT", 60.0)
        effective_l1_ttl = min(effective_ttl, getattr(settings, "REDIS_L1_TTL_DEFAULT", 10.0))
        stale_window = (
            stale_max_seconds
            if stale_max_seconds is not None
            else getattr(settings, "REDIS_STALE_MAX_SECONDS", 300)
        )
        try:
            env_json, env_meta = self._encode(
                value,
                ttl=effective_ttl,
                allow_stale=allow_stale,
                stale_window=stale_window,
            )
            l2_ttl = int(effective_ttl + (stale_window if allow_stale else 0))
            self._write_l2(key, env_json, l2_ttl)
            self._write_l1(key, value, effective_l1_ttl, env_meta)
            return True
        except Exception as e:
            self._inc_metric("cache_write_error")
            logger.warning("Cache set failed for key '%s': %s", key, e)
            return False

    def get_or_set(
        self,
        key: str,
        ttl: float,
        producer: Callable[[], Any],
        l1_ttl: float | None = None,
        allow_stale: bool = False,
        stale_max_seconds: int | None = None,
    ) -> Any:
        """Core get-or-set API with single-flight stampede protection, true SWR, and fallback resilience."""
        if not self.is_enabled:
            return producer()

        effective_l1_ttl = l1_ttl if l1_ttl is not None else min(ttl, getattr(settings, "REDIS_L1_TTL_DEFAULT", 10.0))
        stale_window = (
            stale_max_seconds
            if stale_max_seconds is not None
            else getattr(settings, "REDIS_STALE_MAX_SECONDS", 300)
        )

        # -------------------------------------------------------------
        # Step 1: Check L1 Micro-Cache
        # -------------------------------------------------------------
        l1_hit, l1_stale, l1_val, l1_meta = self._read_l1(key, allow_stale=allow_stale)
        if l1_hit:
            if l1_stale:
                self._inc_metric("cache_stale_served")
                # True SWR: Return stale result immediately + schedule single-flight refresh
                self._schedule_swr_refresh(key, ttl, producer, effective_l1_ttl, allow_stale, stale_max_seconds)
                return l1_val
            else:
                self._inc_metric("cache_l1_hit")
                return l1_val

        self._inc_metric("cache_l1_miss")

        # -------------------------------------------------------------
        # Step 2: Check L2 Upstash Redis
        # -------------------------------------------------------------
        l2_hit, l2_stale, l2_val, l2_env = self._read_l2(key, allow_stale=allow_stale)
        if l2_hit and l2_env is not None:
            if l2_stale:
                self._inc_metric("cache_stale_served")
                # Backfill L1 with original timestamps (DOES NOT RESET T0)
                self._write_l1(key, l2_val, effective_l1_ttl, l2_env)
                # True SWR: Return stale result immediately + schedule single-flight refresh
                self._schedule_swr_refresh(key, ttl, producer, effective_l1_ttl, allow_stale, stale_max_seconds)
                return l2_val
            else:
                self._inc_metric("cache_l2_hit")
                # Backfill L1
                self._write_l1(key, l2_val, effective_l1_ttl, l2_env)
                return l2_val

        self._inc_metric("cache_l2_miss")

        # -------------------------------------------------------------
        # Step 3: Single-Flight Request Coalescing
        # -------------------------------------------------------------
        lock = self.flight_manager.acquire_flight(key)
        lock.acquire()
        try:
            # Re-check L1 after acquiring lock
            re_l1_hit, re_l1_stale, re_l1_val, _ = self._read_l1(key, allow_stale=False)
            if re_l1_hit and not re_l1_stale:
                self.flight_manager.stampedes_prevented += 1
                self._inc_metric("cache_stampede_prevented")
                self._inc_metric("cache_l1_hit")
                return re_l1_val

            # Re-check L2 after acquiring lock
            re_l2_hit, re_l2_stale, re_l2_val, re_l2_env = self._read_l2(key, allow_stale=False)
            if re_l2_hit and not re_l2_stale and re_l2_env is not None:
                self.flight_manager.stampedes_prevented += 1
                self._inc_metric("cache_stampede_prevented")
                self._inc_metric("cache_l2_hit")
                self._write_l1(key, re_l2_val, effective_l1_ttl, re_l2_env)
                return re_l2_val

            # ---------------------------------------------------------
            # Step 4: Execute Authoritative Producer (Database / ML inference)
            # ---------------------------------------------------------
            t_start = time.perf_counter()
            self._inc_metric("cache_producer_call")
            result = producer()
            dur_ms = (time.perf_counter() - t_start) * 1000.0
            self._record_producer_latency(dur_ms)

            # ---------------------------------------------------------
            # Step 5: Best-Effort Cache Write: L2 then L1
            # ---------------------------------------------------------
            try:
                now_epoch = time.time()
                env_json, env_meta = self._encode(
                    result,
                    ttl=ttl,
                    allow_stale=allow_stale,
                    stale_window=stale_window,
                    created_at_epoch=now_epoch,
                )
                l2_ttl = int(ttl + (stale_window if allow_stale else 0))
                self._write_l2(key, env_json, l2_ttl)
                self._write_l1(key, result, effective_l1_ttl, env_meta)
            except Exception as e:
                self._inc_metric("cache_write_error")
                logger.warning("Best-effort cache populate failed for key '%s': %s", key, e)

            return result
        finally:
            lock.release()
            self.flight_manager.release_flight(key)

    def delete(self, key: str) -> bool:
        """Delete a single key from both L1 and L2."""
        l1_deleted = self.l1.delete(key)
        l2_deleted = self.l2.delete(key)
        self._inc_metric("cache_invalidation")
        return l1_deleted or l2_deleted

    def delete_pattern(self, pattern: str) -> int:
        """Delete all keys matching pattern from L1 and L2 using SCAN cursor."""
        count = self.l1.delete_pattern(pattern)
        for k in self.l2.scan_iter(match=pattern):
            self.l2.delete(k)
            count += 1
        self._inc_metric("cache_invalidation")
        return count

    def invalidate_domain(self, domain: str) -> int:
        """Invalidate all cached keys for a specific domain (e.g. 'production', 'equipment', 'exploration')."""
        ver = getattr(settings, "CACHE_SCHEMA_VERSION", 1)
        pattern = f"minex:cache:v{ver}:{domain}:*"
        count = self.delete_pattern(pattern)
        # Also clean legacy un-namespaced keys if any
        count += self.delete_pattern(f"{domain}:*")
        logger.info("Invalidated domain '%s' (%d keys removed)", domain, count)
        return count

    def invalidate_model(self, task: str, model_version: str | None = None) -> int:
        """Invalidate all caches dependent on a model task (called after champion promotion/rollback)."""
        domain_map = {
            "production_forecast": "production",
            "shortfall": "production",
            "equipment_failure": "equipment",
            "prospectivity": "exploration",
        }
        domain = domain_map.get(task, task)
        ver = getattr(settings, "CACHE_SCHEMA_VERSION", 1)
        if model_version:
            pattern = f"minex:cache:v{ver}:{domain}:*:m:{model_version}*"
        else:
            pattern = f"minex:cache:v{ver}:{domain}:*"
        count = self.delete_pattern(pattern)
        logger.info("Invalidated model caches for task '%s' (version=%s, %d keys removed)", task, model_version, count)
        return count

    def invalidate_dataset(self, domain: str, dataset_version: str | None = None) -> int:
        """Invalidate all caches dependent on a dataset domain (called after dataset upload/approval)."""
        return self.invalidate_domain(domain)

    def invalidate_entity(self, domain: str, entity_id: str) -> int:
        """Invalidate a specific entity's cache strictly inside its domain namespace."""
        ver = getattr(settings, "CACHE_SCHEMA_VERSION", 1)
        pattern = f"minex:cache:v{ver}:{domain}:*:{entity_id}:*"
        count = self.delete_pattern(pattern)
        # Strictly avoid broad cross-domain patterns like *:{entity_id}*
        return count

    def clear(self) -> None:
        """Clear all L1 entries and scan/delete all MINEx cache keys in L2."""
        self.l1.clear()
        ver = getattr(settings, "CACHE_SCHEMA_VERSION", 1)
        for k in self.l2.scan_iter(match=f"minex:cache:v{ver}:*"):
            self.l2.delete(k)
        self._inc_metric("cache_invalidation")

    def health(self) -> dict[str, Any]:
        """Observability health check exposing status, hit rates, latencies, and circuit breaker."""
        l1_stats = self.l1.stats()
        with self._metrics_lock:
            l2_total = self.metrics["cache_l2_hit"] + self.metrics["cache_l2_miss"]
            l2_hit_rate = round(self.metrics["cache_l2_hit"] / l2_total, 4) if l2_total > 0 else 0.0

            durations = list(self.metrics["producer_durations_ms"])
            avg_prod_ms = round(sum(durations) / len(durations), 2) if durations else 0.0
            p50_prod_ms = round(float(np.percentile(durations, 50)), 2) if np and durations else avg_prod_ms
            p95_prod_ms = round(float(np.percentile(durations, 95)), 2) if np and durations else avg_prod_ms
            p99_prod_ms = round(float(np.percentile(durations, 99)), 2) if np and durations else avg_prod_ms

            l1_durations = list(self.metrics["l1_durations_ms"])
            p50_l1_ms = round(float(np.percentile(l1_durations, 50)), 3) if np and l1_durations else 0.0
            p95_l1_ms = round(float(np.percentile(l1_durations, 95)), 3) if np and l1_durations else 0.0

            l2_durations = list(self.metrics["l2_durations_ms"])
            p50_l2_ms = round(float(np.percentile(l2_durations, 50)), 2) if np and l2_durations else 0.0
            p95_l2_ms = round(float(np.percentile(l2_durations, 95)), 2) if np and l2_durations else 0.0

            return {
                "enabled": getattr(settings, "REDIS_ENABLED", True),
                "l1": {
                    "entries": l1_stats["entries"],
                    "max_entries": l1_stats["max_entries"],
                    "hits": l1_stats["hits"],
                    "misses": l1_stats["misses"],
                    "hit_rate": l1_stats["hit_rate"],
                    "evictions": l1_stats["evictions"],
                    "p50_latency_ms": p50_l1_ms,
                    "p95_latency_ms": p95_l1_ms,
                },
                "l2": {
                    "configured": self.l2.configured,
                    "reachable": self.l2.ping() if self.l2.configured else False,
                    "circuit_state": self.circuit.state.value,
                    "hits": self.metrics["cache_l2_hit"],
                    "misses": self.metrics["cache_l2_miss"],
                    "hit_rate": l2_hit_rate,
                    "timeouts": self.metrics["cache_l2_timeout"],
                    "errors": self.metrics["cache_l2_error"],
                    "p50_latency_ms": p50_l2_ms,
                    "p95_latency_ms": p95_l2_ms,
                },
                "producer": {
                    "calls": self.metrics["cache_producer_call"],
                    "avg_latency_ms": avg_prod_ms,
                    "p50_latency_ms": p50_prod_ms,
                    "p95_latency_ms": p95_prod_ms,
                    "p99_latency_ms": p99_prod_ms,
                },
                "stampedes_prevented": self.flight_manager.stampedes_prevented,
                "stale_responses_served": self.metrics["cache_stale_served"],
                "stale_refreshes_started": self.metrics["cache_stale_refresh_started"],
                "stale_refreshes_completed": self.metrics["cache_stale_refresh_completed"],
                "stale_refreshes_failed": self.metrics["cache_stale_refresh_error"],
                "compressed_entries": self.metrics["cache_compression"],
                "invalidations": self.metrics["cache_invalidation"],
                "errors": (
                    self.metrics["cache_l2_error"]
                    + self.metrics["cache_write_error"]
                    + self.metrics["cache_deserialize_error"]
                ),
            }


# ===========================================================================
# 8. Global Singleton Instance & Backward Compatible Functions
# ===========================================================================

cache_manager = TieredCacheManager()


def cache_get_or_set(key: str, ttl: float, producer: Callable[[], Any], l1_ttl: float | None = None) -> Any:
    """Backward-compatible drop-in replacement for existing callers across all routers."""
    return cache_manager.get_or_set(key, ttl, producer, l1_ttl=l1_ttl)


def cache_clear() -> None:
    """Clear all cache tiers."""
    cache_manager.clear()


def cache_delete(key: str) -> bool:
    """Delete a specific cache key."""
    return cache_manager.delete(key)


def cache_delete_pattern(pattern: str) -> int:
    """Delete keys by pattern."""
    return cache_manager.delete_pattern(pattern)


def invalidate_domain(domain: str) -> int:
    """Invalidate all keys under a domain."""
    return cache_manager.invalidate_domain(domain)


def invalidate_model(task: str, model_version: str | None = None) -> int:
    """Invalidate model-dependent caches."""
    return cache_manager.invalidate_model(task, model_version)


def invalidate_dataset(domain: str, dataset_version: str | None = None) -> int:
    """Invalidate dataset-dependent caches."""
    return cache_manager.invalidate_dataset(domain, dataset_version)


def invalidate_entity(domain: str, entity_id: str) -> int:
    """Invalidate entity-specific caches."""
    return cache_manager.invalidate_entity(domain, entity_id)
