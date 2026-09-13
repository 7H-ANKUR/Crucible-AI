# Environment Constraints

Why v3 pins what it pins, and what you must not do to it.

Crucible AI and the Crucible AI engine share **one interpreter and one dependency set**.
Versions are declared once, in [`v3/requirements.txt`](../../requirements.txt).
This file explains the reasoning behind that resolution.

---

## Target interpreter: CPython 3.12

| Constraint | Newest CPython with a wheel | Effect |
|---|---|---|
| `shap==0.46.0` | 3.12 | **Sets the ceiling** |
| Crucible AI `pyproject.toml` | declares `>=3.11,<3.15` | no constraint at 3.12 |
| `scikit-learn==1.9.0` | 3.14 | no constraint |
| `numpy==2.2.6` | 3.13+ | no constraint |

3.11 also works. 3.12 is chosen as the newest version both stacks support.

`scikit-learn` is **not** what holds the stack back, despite looking like the
suspicious pin. It publishes cp314 wheels and declares `numpy>=1.24.1` with no upper
bound. If you read the pin list and bump scikit-learn hoping to raise the ceiling,
you will have changed the one version that must not move — see below — and the
ceiling will not have moved.

### Raising the ceiling

Bump `shap` to a release with wheels for the target Python, then re-validate SHAP
output. Driver attribution is user-visible on `/production`, so the values need
checking, not just the import. Then re-record the artifact manifest and read the diff.

---

## numpy moved from 1.26.4 to 2.x, deliberately

Crucible AI previously pinned `numpy==1.26.4` while Crucible AI required `numpy>=2.0`. That was
read as an unresolvable ABI conflict, and it is why the two stacks were originally
planned as separate environments.

It was not unresolvable. The pin was stale, not load-bearing:

- `scikit-learn==1.9.0` — the version that actually built the committed artifacts —
  declares `numpy>=1.24.1` with no upper bound.
- `pandas==2.2.3` is the release that added numpy 2 support.
- Arrays pickled under numpy 1.26 still read under 2.x. Backward read compatibility
  holds in that direction.

The reverse direction does **not** hold: anything pickled under numpy 2.x fails to
load under 1.26. That asymmetry is why the move is one-way. Once artifacts are
re-trained under this environment, going back to 1.26 is not a rollback you can make
by changing a pin.

> **This is a claim about behaviour, so it is verified rather than assumed.**
> `python scripts/verify_artifacts.py` loads every champion under the unified stack
> and runs a prediction. It must pass before the numpy 2.x pin is trusted.

---

## The artifacts were built by scikit-learn 1.9.0

Verified by reading the pickles directly — `_sklearn_version` is stamped `1.9.0` in
the equipment, prospectivity and shortfall champions. The production forecast
artifacts are LightGBM boosters and carry no sklearn stamp.

scikit-learn warns on a version mismatch at load time rather than refusing, so a wrong
pin degrades quietly: the model loads, and predicts differently. `1.9.0` is therefore
the one version in this file that must not move without re-training and re-recording
the manifest.

This is also why versions are declared in exactly one place. The two requirements
files previously disagreed — root pinned `scikit-learn==1.5.2`, the API pinned
`1.9.0` — so which environment you got depended on which file you installed from.
`app/api/tests/test_environment_contract.py` now fails the build if a sub-project
requirements file declares any pin of its own.

---

## Verifying the artifacts

```bash
python scripts/verify_artifacts.py            # record app/ml/ARTIFACT_MANIFEST.json
python scripts/verify_artifacts.py --check    # verify; non-zero exit on drift
```

The manifest records, per artifact: SHA-256, size, class and module, the stamped
scikit-learn version, and whether a one-row smoke prediction returns a finite number.
`--check` also compares the interpreter and library versions it was recorded under.

Run `--check` after any change to numpy, scikit-learn, joblib, LightGBM, XGBoost or
shap. A passing test suite does not prove the models still predict correctly; this
does.

---

## Artifact provenance still matters

Both stacks now run the same numpy, so a model file no longer crosses an ABI boundary.
The provenance rule survives for a different reason: **a model produced by Crucible AI is
recorded with `serving_runtime = crucible_engine` and served by the engine.**

Keeping the two lineages distinguishable is what lets the manifest mean anything. If
engine-trained artifacts were loaded into `ml_loader.py` alongside Crucible AI's own, the
registry would no longer answer "what trained this, under which stack" — which is the
question you need answered the next time a dependency bump changes a prediction.
