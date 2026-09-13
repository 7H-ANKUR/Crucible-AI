"""
scripts/smoke_v3.py — does v3 actually work?

Checks the unified stack from the bottom up and stops at the first layer that is
genuinely broken, so the output names a cause rather than a pile of symptoms.

    python scripts/smoke_v3.py              # environment + artifacts + database
    python scripts/smoke_v3.py --services   # also probe running gateway/engine

Layers:
  1. Interpreter and pinned versions
  2. Both codebases import
  3. Committed model artifacts load and predict      <- the numpy 2.x question
  4. Database reachable, expected schemas present
  5. Engine and gateway respond, and the bridge works (--services)

Exit code is 0 only if every attempted check passed.
"""

from __future__ import annotations

import argparse
import importlib
import os
import sys
from pathlib import Path

V3_ROOT = Path(__file__).resolve().parents[1]
CRUCIBLE AI = V3_ROOT / "crucible"
CRUCIBLE AI = V3_ROOT / "crucible"

PASS = "  ok  "
FAIL = " FAIL "
WARN = " warn "

_failures: list[str] = []
_warnings: list[str] = []


def report(ok: bool | None, label: str, detail: str = "") -> bool:
    """Print one check. ``None`` means 'skipped / not fatal'."""
    mark = PASS if ok else (WARN if ok is None else FAIL)
    print(f"[{mark}] {label}" + (f"  —  {detail}" if detail else ""))
    if ok is False:
        _failures.append(label)
    elif ok is None:
        _warnings.append(label)
    return bool(ok)


def section(title: str) -> None:
    print(f"\n{title}\n{'-' * len(title)}")


# ---------------------------------------------------------------------------
# 1. Environment
# ---------------------------------------------------------------------------

def check_environment() -> bool:
    section("1. Environment")

    version = sys.version_info
    ok = (3, 11) <= version[:2] <= (3, 12)
    report(
        ok,
        f"Python {version.major}.{version.minor}.{version.micro}",
        "" if ok else "v3 needs 3.11-3.12; the ceiling is shap (no wheels past cp312)",
    )

    expected = {
        "numpy": "2.2.6",
        "pandas": "2.2.3",
        "scikit-learn": "1.9.0",
        "joblib": "1.4.2",
        "shap": "0.46.0",
        "lightgbm": "4.5.0",
    }
    from importlib.metadata import PackageNotFoundError
    from importlib.metadata import version as installed

    for name, want in expected.items():
        try:
            got = installed(name)
        except PackageNotFoundError:
            report(False, f"{name}", "not installed")
            continue
        report(got == want, f"{name} {got}", "" if got == want else f"pinned {want}")

    return not _failures


# ---------------------------------------------------------------------------
# 2. Imports
# ---------------------------------------------------------------------------

def check_imports() -> bool:
    section("2. Codebases import")

    ok_all = True

    # Both projects resolve config and packages relative to their own root:
    # Crucible AI reads `.env` via pydantic-settings `env_file=".env"`, which is
    # relative to the working directory, and Crucible AI imports `core` / `api` as
    # top-level packages. Import each from its own directory, exactly as the
    # services are run.
    sys.path.insert(0, str(CRUCIBLE AI))
    os.chdir(CRUCIBLE AI)
    try:
        importlib.import_module("app.api.main")
        report(True, "Crucible AI gateway imports")
    except Exception as exc:
        ok_all = report(False, "Crucible AI gateway imports", f"{type(exc).__name__}: {exc}")

    sys.path.insert(0, str(CRUCIBLE AI))
    os.chdir(CRUCIBLE AI)
    try:
        importlib.import_module("core.platform.orchestrator")
        report(True, "Crucible AI orchestrator imports")
    except Exception as exc:
        ok_all = report(False, "Crucible AI orchestrator imports", f"{type(exc).__name__}: {exc}")

    try:
        importlib.import_module("api.main")
        report(True, "Crucible AI API imports")
    except Exception as exc:
        ok_all = report(False, "Crucible AI API imports", f"{type(exc).__name__}: {exc}")

    os.chdir(V3_ROOT)
    return ok_all


# ---------------------------------------------------------------------------
# 3. Artifacts  — the claim that needed proving
# ---------------------------------------------------------------------------

def check_artifacts() -> bool:
    section("3. Model artifacts under numpy 2.x")

    os.chdir(CRUCIBLE AI)
    if str(CRUCIBLE AI) not in sys.path:
        sys.path.insert(0, str(CRUCIBLE AI))

    try:
        import joblib

        from app.api.core.config import ARTIFACTS
        from app.api.core.ml_loader import _SPECS, MODELS, load_all_models, smoke_test_model
    except Exception as exc:
        os.chdir(V3_ROOT)
        return report(False, "load ml_loader", f"{type(exc).__name__}: {exc}")

    load_all_models()

    smoke_tasks = {
        "prospectivity": "prospectivity",
        "prod_forecast": "production_forecast",
        "shortfall": "shortfall",
        "equipment": "equipment_failure",
    }

    ok_all = True
    for key, fname in _SPECS:
        path = Path(ARTIFACTS) / fname
        if not path.exists():
            report(None, f"{key}", "artifact not present locally")
            continue

        obj = MODELS.get(key)
        if obj is None:
            try:
                obj = joblib.load(path)
            except Exception as exc:
                ok_all = report(False, f"{key} loads", f"{type(exc).__name__}: {exc}")
                continue

        task = smoke_tasks.get(key)
        if not task:
            report(True, f"{key} loads", type(obj).__name__)
            continue

        passed, message = smoke_test_model(task, obj)
        if not passed:
            ok_all = False
        report(passed, f"{key} predicts", message)

    os.chdir(V3_ROOT)
    return ok_all


# ---------------------------------------------------------------------------
# 4. Database
# ---------------------------------------------------------------------------

def check_database() -> bool:
    section("4. Database")

    os.chdir(CRUCIBLE AI)
    try:
        from app.api.core.db import init_db, query
    except Exception as exc:
        os.chdir(V3_ROOT)
        return report(False, "import db module", f"{type(exc).__name__}: {exc}")

    try:
        init_db()
        rows = query("SELECT current_database() AS db, version() AS v")
        db = rows[0]["db"] if rows else "?"
        report(True, "connected", f"database={db}")
    except Exception as exc:
        os.chdir(V3_ROOT)
        return report(False, "connect", f"{type(exc).__name__}: {str(exc)[:120]}")

    ok_all = True
    try:
        found = {
            r["schema_name"]
            for r in query(
                "SELECT schema_name FROM information_schema.schemata "
                "WHERE schema_name IN ('ops','ml','gov','hub')"
            )
        }
        for schema in ("ops", "ml", "gov", "hub"):
            present = schema in found
            if not present:
                ok_all = False
            report(present, f"schema {schema}", "" if present else "run scripts/migrate_all.py")
    except Exception as exc:
        ok_all = report(False, "inspect schemas", f"{type(exc).__name__}: {exc}")

    os.chdir(V3_ROOT)
    return ok_all


# ---------------------------------------------------------------------------
# 5. Services
# ---------------------------------------------------------------------------

def check_services() -> bool:
    section("5. Running services")

    import requests

    gateway = os.environ.get("CRUCIBLE_URL", "http://127.0.0.1:8000")
    engine = os.environ.get("CRUCIBLE_BASE_URL", "http://127.0.0.1:8100")

    ok_all = True

    try:
        r = requests.get(f"{engine}/health", timeout=5)
        ok = r.status_code == 200
        if not ok:
            ok_all = False
        report(ok, "Crucible AI engine /health", f"HTTP {r.status_code}")
    except Exception as exc:
        ok_all = report(False, "Crucible AI engine /health", f"{type(exc).__name__}")

    try:
        r = requests.get(f"{gateway}/health/live", timeout=5)
        ok = r.status_code == 200
        if not ok:
            ok_all = False
        report(ok, "Crucible AI gateway /health/live", f"HTTP {r.status_code}")
    except Exception as exc:
        ok_all = report(False, "Crucible AI gateway /health/live", f"{type(exc).__name__}")

    # The bridge: the gateway's own view of the engine. This is the integration.
    try:
        r = requests.get(f"{gateway}/api/v1/health/engine", timeout=10)
        payload = r.json()
        ok = payload.get("status") == "ok"
        if not ok:
            ok_all = False
        report(
            ok,
            "bridge gateway -> engine",
            payload.get("reason") or f"{payload.get('latency_ms')} ms",
        )
    except Exception as exc:
        ok_all = report(False, "bridge gateway -> engine", f"{type(exc).__name__}: {exc}")

    return ok_all


def main() -> int:
    ap = argparse.ArgumentParser(description="v3 stack smoke test")
    ap.add_argument("--services", action="store_true", help="also probe running services")
    ap.add_argument("--skip-db", action="store_true", help="skip database checks")
    args = ap.parse_args()

    print(f"v3 smoke test — {V3_ROOT}")

    check_environment()
    check_imports()
    check_artifacts()
    if not args.skip_db:
        check_database()
    if args.services:
        check_services()

    section("Result")
    if _failures:
        print(f"{len(_failures)} check(s) failed:")
        for f in _failures:
            print(f"  - {f}")
    if _warnings:
        print(f"{len(_warnings)} skipped / non-fatal:")
        for w in _warnings:
            print(f"  - {w}")
    if not _failures:
        print("All attempted checks passed.")
    return 1 if _failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
