"""The v3 environment contract.

Crucible AI and the Crucible AI engine share one interpreter and one dependency set. That
only stays true if three things hold, and each is easy to break by accident:

1. Versions are declared once, at the v3 root. The per-project requirements files
   point back at it instead of restating pins.
2. The resolved versions satisfy the floors Crucible AI declares in its pyproject.
   This is not theoretical — the first draft of the unified file pinned
   rasterio 1.4.3, geopandas 1.0.1, shapely 2.0.6 and pyproj 3.7.0 against floors
   of >=1.5, >=1.1, >=2.1 and >=3.8 respectively. pip would have refused the
   engine's own install while the gateway ran happily.
3. Anything that touches a model artifact is pinned exactly, and the interpreter
   actually running the tests has those versions installed.

A failure here means the two stacks can resolve to different builds of numpy,
scikit-learn, or joblib — which changes how the committed champion models
deserialize, quietly.
"""

from __future__ import annotations

import re
import sys
import tomllib
from importlib.metadata import PackageNotFoundError, version as installed_version
from pathlib import Path

import pytest
from packaging.requirements import Requirement
from packaging.version import Version

# app/api/tests -> app/api -> app -> repository root.
TESTS_DIR = Path(__file__).resolve().parent
V3_ROOT = TESTS_DIR.parents[2]

ROOT_REQS = V3_ROOT / "requirements.txt"
# The geospatial engine now lives under app/engine rather than as a sibling.
CRUCIBLE_PYPROJECT = V3_ROOT / "app" / "engine" / "pyproject.toml"

POINTER_FILES = [
    V3_ROOT / "app" / "api" / "requirements.txt",
]

#: Packages whose version determines whether a committed .joblib artifact
#: deserializes into the same estimator it was trained as.
SERVING_CRITICAL = {"numpy", "scikit-learn", "joblib", "lightgbm", "xgboost", "shap"}

#: shap publishes no wheels past cp312, which is what fixes the target
#: interpreter. Revisit only alongside a shap upgrade.
MAX_SUPPORTED_PYTHON = (3, 12)
MIN_SUPPORTED_PYTHON = (3, 11)

_PIN = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(==|>=|<=|~=|>|<|!=)")


def _normalise(name: str) -> str:
    return name.lower().replace("_", "-")


def _parse_pins(path: Path) -> dict[str, str]:
    """Map normalised name -> exact version, for `name==version` lines only."""
    pins: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or line.startswith("-"):
            continue
        try:
            req = Requirement(line)
        except Exception:
            continue
        specs = list(req.specifier)
        if len(specs) == 1 and specs[0].operator == "==":
            pins[_normalise(req.name)] = specs[0].version
    return pins


@pytest.fixture(scope="module")
def root_pins() -> dict[str, str]:
    assert ROOT_REQS.exists(), f"missing unified requirements at {ROOT_REQS}"
    return _parse_pins(ROOT_REQS)


@pytest.fixture(scope="module")
def crucible_floors() -> list[Requirement]:
    assert CRUCIBLE_PYPROJECT.exists(), f"missing {CRUCIBLE_PYPROJECT}"
    data = tomllib.loads(CRUCIBLE_PYPROJECT.read_text(encoding="utf-8"))
    return [Requirement(r) for r in data["project"]["dependencies"]]


# ---------------------------------------------------------------------------
# 1. One place declares versions
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("path", POINTER_FILES, ids=lambda p: str(p.name))
def test_project_requirements_declare_no_pins_of_their_own(path: Path):
    """Sub-project requirements must delegate, not restate."""
    assert path.exists(), f"missing {path}"

    offending = [
        raw.strip()
        for raw in path.read_text(encoding="utf-8").splitlines()
        if (line := raw.split("#", 1)[0].strip())
        and not line.startswith("-")
        and _PIN.match(line)
    ]

    assert not offending, (
        f"{path.relative_to(V3_ROOT)} declares its own pins: {offending}. "
        "Declare versions once in v3/requirements.txt instead."
    )


@pytest.mark.parametrize("path", POINTER_FILES, ids=lambda p: str(p.name))
def test_project_requirements_point_at_the_unified_file(path: Path):
    text = path.read_text(encoding="utf-8")
    includes = re.findall(r"^\s*-r\s+(\S+)", text, flags=re.MULTILINE)
    assert includes, f"{path.relative_to(V3_ROOT)} has no '-r' include"

    resolved = [(path.parent / inc).resolve() for inc in includes]
    assert ROOT_REQS.resolve() in resolved, (
        f"{path.relative_to(V3_ROOT)} includes {resolved}, not {ROOT_REQS}"
    )


# ---------------------------------------------------------------------------
# 2. The resolution satisfies the engine's declared floors
# ---------------------------------------------------------------------------

def test_unified_pins_satisfy_crucible_floors(root_pins, crucible_floors):
    """Every Crucible AI dependency floor must be met by the unified pin."""
    violations = []
    for req in crucible_floors:
        name = _normalise(req.name)
        pinned = root_pins.get(name)
        if pinned is None:
            violations.append(f"{req.name}: required by crucible, absent from v3/requirements.txt")
        elif not req.specifier.contains(Version(pinned), prereleases=True):
            violations.append(f"{req.name}: pinned {pinned}, crucible requires '{req.specifier}'")

    assert not violations, "unified pins violate crucible/pyproject.toml:\n  " + "\n  ".join(violations)


# ---------------------------------------------------------------------------
# 3. Serving-critical packages are exact, and actually installed
# ---------------------------------------------------------------------------

def test_serving_critical_packages_are_exactly_pinned(root_pins):
    loose = sorted(SERVING_CRITICAL - set(root_pins))
    assert not loose, (
        "serving-critical packages must be pinned with '==' in v3/requirements.txt: "
        + ", ".join(loose)
    )


def test_installed_versions_match_the_pins(root_pins):
    """The interpreter running these tests must be the environment we declared."""
    drift = []
    for name in sorted(SERVING_CRITICAL):
        expected = root_pins[name]
        try:
            actual = installed_version(name)
        except PackageNotFoundError:
            drift.append(f"{name}: pinned {expected}, not installed")
            continue
        if Version(actual) != Version(expected):
            drift.append(f"{name}: pinned {expected}, installed {actual}")

    assert not drift, "environment does not match v3/requirements.txt:\n  " + "\n  ".join(drift)


def test_interpreter_is_within_the_supported_window():
    current = sys.version_info[:2]
    assert MIN_SUPPORTED_PYTHON <= current <= MAX_SUPPORTED_PYTHON, (
        f"running Python {current[0]}.{current[1]}; v3 supports "
        f"{MIN_SUPPORTED_PYTHON[0]}.{MIN_SUPPORTED_PYTHON[1]}"
        f"–{MAX_SUPPORTED_PYTHON[0]}.{MAX_SUPPORTED_PYTHON[1]}. "
        "The ceiling is shap, which publishes no wheels past cp312."
    )
