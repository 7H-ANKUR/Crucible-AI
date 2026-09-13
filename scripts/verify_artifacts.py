"""
scripts/verify_artifacts.py — ML artifact provenance manifest.

Records what each committed .joblib artifact is, which library versions built
it, and whether it still answers a prediction. The manifest it writes is the
regression guard for any change that touches the serving stack: if a dependency
bump silently alters or breaks a champion model, `--check` fails loudly instead
of the platform serving quietly wrong numbers.

Run it under the Crucible AI environment only (scikit-learn 1.9.0 / numpy 1.26.x).
The artifacts were built by that stack; loading them under another one is the
exact situation this script exists to detect.

    python scripts/verify_artifacts.py            # write app/ml/ARTIFACT_MANIFEST.json
    python scripts/verify_artifacts.py --check    # verify against it, non-zero exit on drift

Exit codes:
    0  all artifacts present, loadable, and matching the manifest
    1  drift, corruption, or a failed smoke test
    2  the manifest is missing under --check
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

MANIFEST_PATH = REPO_ROOT / "apps" / "ml" / "ARTIFACT_MANIFEST.json"

#: Artifact key -> the task whose smoke test exercises it. Artifacts absent
#: here are supporting data (feature lists, medians, category maps) that are
#: hashed but have no prediction path of their own.
_SMOKE_TASKS = {
    "prospectivity": "prospectivity",
    "prod_forecast": "production_forecast",
    "prod_p10": "production_forecast",
    "prod_p50": "production_forecast",
    "prod_p90": "production_forecast",
    "shortfall": "shortfall",
    "equipment": "equipment_failure",
}


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def describe(obj: object) -> dict[str, str | None]:
    """Identify a loaded artifact without assuming it is an estimator."""
    return {
        "type": type(obj).__name__,
        "module": type(obj).__module__,
        # sklearn stamps every estimator it pickles; a mismatch against the
        # installed version is what produces InconsistentVersionWarning on load.
        "sklearn_version": getattr(obj, "_sklearn_version", None),
    }


def build_manifest() -> dict:
    from app.api.core.ml_loader import _SPECS, MODELS, load_all_models, smoke_test_model
    from app.api.core.config import ARTIFACTS

    import joblib
    import numpy
    import sklearn

    # Populate MODELS so smoke_test_model can resolve feature lists and medians.
    load_all_models()

    entries: dict[str, dict] = {}
    for key, fname in _SPECS:
        path = Path(ARTIFACTS) / fname
        entry: dict = {"filename": fname}

        if not path.exists():
            entry["status"] = "MISSING"
            entries[key] = entry
            continue

        entry["sha256"] = sha256_of(path)
        entry["bytes"] = path.stat().st_size

        obj = MODELS.get(key)
        if obj is None:
            try:
                obj = joblib.load(path)
            except Exception as exc:
                entry["status"] = "LOAD_FAILED"
                entry["error"] = str(exc)
                entries[key] = entry
                continue

        entry.update(describe(obj))

        task = _SMOKE_TASKS.get(key)
        if task:
            passed, message = smoke_test_model(task, obj)
            entry["smoke_task"] = task
            entry["smoke_passed"] = passed
            entry["smoke_message"] = message
            entry["status"] = "OK" if passed else "SMOKE_FAILED"
        else:
            entry["status"] = "OK"
            entry["smoke_passed"] = None

        entries[key] = entry

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "environment": {
            "python": sys.version.split()[0],
            "numpy": numpy.__version__,
            "scikit_learn": sklearn.__version__,
            "joblib": joblib.__version__,
        },
        "artifacts": entries,
    }


def report(manifest: dict) -> int:
    """Print a manifest and return the exit code its contents imply."""
    env = manifest["environment"]
    print(
        f"env: python {env['python']}  numpy {env['numpy']}  "
        f"scikit-learn {env['scikit_learn']}  joblib {env['joblib']}"
    )
    print()

    failed = 0
    for key, e in manifest["artifacts"].items():
        status = e["status"]
        mark = {"OK": "ok  "}.get(status, "FAIL")
        if status != "OK":
            failed += 1
        digest = e.get("sha256", "-")[:12]
        print(f"  {mark}  {key:22s} {digest:12s} {status}")
        if e.get("smoke_message") and not e.get("smoke_passed", True):
            print(f"          {e['smoke_message']}")
        if e.get("error"):
            print(f"          {e['error']}")

    print()
    total = len(manifest["artifacts"])
    print(f"{total - failed}/{total} artifacts healthy")
    return 1 if failed else 0


def check(current: dict) -> int:
    if not MANIFEST_PATH.exists():
        print(f"No manifest at {MANIFEST_PATH}. Run without --check to create it.")
        return 2

    recorded = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    rec_env = recorded["environment"]
    cur_env = current["environment"]

    drift = 0

    for lib in ("numpy", "scikit_learn", "joblib", "python"):
        if rec_env.get(lib) != cur_env.get(lib):
            print(
                f"  env  {lib}: manifest {rec_env.get(lib)} -> current {cur_env.get(lib)}"
            )
            drift += 1

    rec_arts = recorded["artifacts"]
    cur_arts = current["artifacts"]

    for key in sorted(set(rec_arts) | set(cur_arts)):
        r = rec_arts.get(key)
        c = cur_arts.get(key)
        if r is None:
            print(f"  new  {key}: not in manifest")
            drift += 1
        elif c is None:
            print(f"  gone {key}: in manifest but not on disk")
            drift += 1
        elif r.get("sha256") != c.get("sha256"):
            print(
                f"  hash {key}: {str(r.get('sha256'))[:12]} -> {str(c.get('sha256'))[:12]}"
            )
            drift += 1
        elif c["status"] != "OK":
            print(f"  sick {key}: {c['status']} — {c.get('smoke_message') or c.get('error')}")
            drift += 1

    if drift:
        print()
        print(f"{drift} difference(s) against the recorded manifest.")
        print(
            "If this change is intended, re-record with "
            "`python scripts/verify_artifacts.py` and commit the manifest."
        )
        return 1

    print("Artifacts match the recorded manifest.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument(
        "--check",
        action="store_true",
        help="compare against the committed manifest instead of rewriting it",
    )
    args = ap.parse_args()

    current = build_manifest()

    if args.check:
        code = report(current)
        return check(current) or code

    code = report(current)
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(current, indent=2) + "\n", encoding="utf-8")
    print(f"\nManifest written to {MANIFEST_PATH.relative_to(REPO_ROOT)}")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
