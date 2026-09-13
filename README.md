# v3 — Crucible AI + AyaskX on one environment

The Crucible AI mining intelligence platform and the Crucible AI autonomous-ML engine, unified
onto a single Python 3.12 interpreter and a single dependency set, with Crucible AI's
Next.js application as the only user interface.

```
v3/
├── .venv/                 the one Python environment, shared by both stacks
├── requirements.txt       the one dependency set — exact pins, no ranges
├── requirements-dev.txt   adds pytest/ruff on top
├── crucible/                 Crucible AI — FastAPI gateway, ML serving, Next.js web
└── crucible/                Crucible AI — AutoML engine, fault analysis, geospatial
```

---

## Why one environment is now possible

The two stacks previously could not share an interpreter: Crucible AI pinned
`numpy==1.26.4`, Crucible AI required `numpy>=2.0`.

That pin turned out to be stale rather than load-bearing. `scikit-learn==1.9.0` —
the version that actually built Crucible AI's committed model artifacts, confirmed by
reading `_sklearn_version` out of the pickles — declares `numpy>=1.24.1` with **no
upper bound**. Moving Crucible AI to numpy 2.x is therefore a supported configuration, and
arrays pickled under 1.26 still read under 2.x.

What still sets the ceiling is `shap==0.46.0`, whose newest wheels are cp312. That is
why the target interpreter is **Python 3.12** and not something newer. See
[`crucible/docs/ENVIRONMENT.md`](crucible/docs/ENVIRONMENT.md).

> The claim that the artifacts survive numpy 2.x is verified, not assumed.
> `python crucible/scripts/verify_artifacts.py` loads every champion and runs a
> prediction. It must pass before this environment is trusted.

---

## Setup

```bash
py -3.12 -m venv .venv
.venv/Scripts/python -m pip install -U pip
.venv/Scripts/python -m pip install -r requirements-dev.txt
```

Confirm the artifacts still predict under the unified stack:

```bash
cd crucible && ../.venv/Scripts/python scripts/verify_artifacts.py
```

---

## Running

Each service runs from its own directory, so Python resolves each package tree from
its own root. They share the interpreter, not the working directory.

```bash
# Crucible AI engine — internal only, never exposed publicly
cd crucible && ../.venv/Scripts/python -m uvicorn api.main:create_app --factory --host 127.0.0.1 --port 8100

# Crucible AI gateway — the public API
cd crucible && ../.venv/Scripts/python -m uvicorn app.api.main:app --port 8000 --reload

# Crucible AI web — the only user interface
cd crucible/web && npm install --legacy-peer-deps && npm run dev
```

| Service | Port | Exposure |
|---|---|---|
| Web (Next.js) | 3000 | public |
| Crucible AI gateway | 8000 | public |
| Crucible AI engine | 8100 | **loopback only** |

The engine has no authentication of its own. It is safe only because it is not
reachable from outside the host, and the gateway enforces Crucible AI's RBAC in front of
it. Do not give it a public URL.

---

## Tests

```bash
# Crucible AI  (needs DATABASE_URL and JWT_SECRET_KEY)
cd crucible && ../.venv/Scripts/python -m pytest app/api/tests -q

# Crucible AI
cd crucible && ../.venv/Scripts/python -m pytest -q
```

---

## Rules that keep this working

**One dependency set.** `requirements.txt` at this root is the only place versions are
declared. The per-project requirements files point back at it rather than restating
pins, so they cannot drift.

**Exact pins for anything that touches a model artifact.** numpy, scikit-learn,
joblib, LightGBM, XGBoost and shap use `==`. A range lets a rebuild silently pick up a
version the artifacts were never validated against.

**Re-verify after any dependency change.** `verify_artifacts.py --check` compares
against the committed manifest and fails on drift. A green test suite does not prove
the models still predict correctly; this does.

**The engine trains, the engine serves.** A model produced by Crucible AI is never loaded
into Crucible AI's `ml_loader.py`. Inference for an engine-trained champion proxies to the
engine. This matters less now that both run the same numpy, but it keeps the two
artifact lineages distinguishable and the provenance manifest meaningful.
