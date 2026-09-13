"""app/api/core/memo.py — short-lived memoisation for repeated reads.

The database is remote: a bare ``SELECT 1`` costs roughly 1.2 seconds of round
trip. Query cost on this platform is therefore dominated by *how many times* we
ask, not by what we ask for.

That matters because building one Command Center page evaluates six candidate
actions, and each one independently checks equipment availability, the
maintenance lockout and telemetry freshness for the same mine. Six identical
answers, six round trips, six seconds.

This is not a substitute for `core/cache.py`, which is the durable L1/L2 cache
with circuit breaking and versioned keys for whole computed responses. This is a
much smaller thing: in-process memoisation with a seconds-long lifetime, for the
individual reads that make up a single response.

**Never memoise a write, and never memoise something whose staleness could make
a safety decision wrong.** The TTLs here are seconds precisely so that a
constraint check reflects the same telemetry a human would see if they looked.
"""

from __future__ import annotations

import functools
import threading
import time
from typing import Any, Callable, TypeVar

T = TypeVar("T")

#: Default lifetime. Long enough to collapse the repeats within one request,
#: short enough that consecutive requests see fresh data.
DEFAULT_TTL_SECONDS = 20.0

_LOCK = threading.Lock()
_REGISTRY: list[Callable[[], None]] = []


def ttl_cache(ttl: float = DEFAULT_TTL_SECONDS, maxsize: int = 128):
    """Memoise a function's result per argument tuple for `ttl` seconds.

    Thread-safe for reading and writing the store. The wrapped function may run
    concurrently for the same key under contention — accepted deliberately, since
    these are idempotent reads and holding a lock across a 1.2-second query would
    serialise every request on the platform.
    """

    def decorator(fn: Callable[..., T]) -> Callable[..., T]:
        store: dict[Any, tuple[float, T]] = {}

        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> T:
            key = (args, tuple(sorted(kwargs.items())))
            now = time.monotonic()

            with _LOCK:
                hit = store.get(key)
                if hit is not None and (now - hit[0]) < ttl:
                    return hit[1]

            value = fn(*args, **kwargs)

            with _LOCK:
                if len(store) >= maxsize:
                    # Evict the oldest rather than clearing: a full clear under
                    # load would stampede every caller back onto the database.
                    oldest = min(store, key=lambda k: store[k][0])
                    store.pop(oldest, None)
                store[key] = (now, value)

            return value

        def cache_clear() -> None:
            with _LOCK:
                store.clear()

        wrapper.cache_clear = cache_clear  # type: ignore[attr-defined]
        wrapper.cache_size = lambda: len(store)  # type: ignore[attr-defined]
        _REGISTRY.append(cache_clear)
        return wrapper

    return decorator


def clear_all() -> None:
    """Drop every memoised value. For tests, and after a data import."""
    for clear in _REGISTRY:
        clear()


__all__ = ["DEFAULT_TTL_SECONDS", "clear_all", "ttl_cache"]
