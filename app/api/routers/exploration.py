"""app/api/routers/exploration.py — Prospectivity map and target endpoints"""
import datetime

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query

from ..core.cache import (
    CACHE_POLICIES,
    build_cache_key,
    cache_manager,
)
from ..core.db import query
from ..core.ml_loader import ensure_active_model, get_active_model_metadata, get_model
from ..core.security import get_current_user

router = APIRouter(tags=["exploration"])


def _feat_lookup(r: dict, feat_names: list) -> dict:
    """Feature vector for one row; DB columns matched case-insensitively
    (Postgres folded early schema names to lowercase, CSV names are mixed)."""
    rl = {k.lower(): v for k, v in r.items()}
    data = {}
    for f in feat_names:
        raw = rl.get(f.lower())
        try:
            data[f] = float(raw) if raw is not None else 0.0
        except (TypeError, ValueError):
            data[f] = 0.0
    return data


def _score_rows(rows: list, model, feat_names: list) -> list:
    """Batch-score rows in a single predict_proba call (network-latency friendly)."""
    if model is None or not feat_names or not rows:
        return [float(r.get("prospectivity_label") or 0) for r in rows]
    X = pd.DataFrame([_feat_lookup(r, feat_names) for r in rows], columns=feat_names).fillna(0)
    try:
        probs = model.predict_proba(X)[:, 1]
        return [round(float(p), 3) for p in probs]
    except Exception:
        return [float(r.get("prospectivity_label") or 0.5) for r in rows]


def _score_row(r: dict, model, feat_names: list) -> float:
    return _score_rows([r], model, feat_names)[0]


def _maturity(prob: float) -> str:
    if prob >= 0.90:   return "Resource Candidate"
    elif prob >= 0.75: return "Drill Recommended"
    elif prob >= 0.60: return "Geologically Supported"
    elif prob >= 0.45: return "Screened"
    else:              return "Detected"


def _model_version() -> str:
    meta = get_active_model_metadata("prospectivity")
    return meta.get("version", "v1.0")


def _prospectivity_map_uncached(belt: str, min_prob: float):
    sql = "SELECT * FROM geo.prospectivity_grid"
    params = []
    filters = []
    if belt:
        filters.append("belt = %s"); params.append(belt)
    if filters:
        sql += " WHERE " + " AND ".join(filters)
    sql += " LIMIT 2000"
    rows = query(sql, params or None)

    model, meta = ensure_active_model("prospectivity")
    m_ver = str(meta.get("version", "v1.0"))
    feat_names = get_model("prospectivity_feats") or []
    probs      = _score_rows(rows, model, feat_names)

    for r, p in zip(rows, probs):
        r["prospectivity_prob"] = p
        r["data_origin"] = "SYNTHETIC"

    if min_prob > 0:
        rows = [r for r in rows if r.get("prospectivity_prob", 0) >= min_prob]

    return {
        "type":            "FeatureCollection",
        "as_of":           datetime.datetime.utcnow().isoformat() + "Z",
        "model_version":   m_ver,
        "serving_model_version": str(meta.get("serving_model_version", m_ver)),
        "authoritative_model_version": str(meta.get("authoritative_model_version", m_ver)),
        "serving_status":  str(meta.get("serving_status", "ACTIVE")),
        "dataset_version": meta.get("dataset_version_id") or meta.get("dataset_version", "v1.0"),
        "data_origin":     "SYNTHETIC",
        "features":        rows,
        "count":           len(rows),
    }


@router.get("/map")
def prospectivity_map(
    belt: str = Query(None, description="Filter by geological belt"),
    min_prob: float = Query(0.0, ge=0.0, le=1.0),
    user=Depends(get_current_user)
):
    """Prospectivity grid cells with ML-scored probability (memoised + zlib compressed)."""
    meta = get_active_model_metadata("prospectivity")
    m_ver = meta.get("version", "v1.0")
    d_ver = meta.get("dataset_version_id") or meta.get("dataset_version", "v1.0")
    cache_key = build_cache_key(
        domain="exploration",
        resource="map",
        params={"belt": belt, "min_prob": min_prob},
        model_version=m_ver,
        dataset_version=d_ver,
    )
    policy = CACHE_POLICIES["exploration_map"]
    return cache_manager.get_or_set(
        key=cache_key,
        ttl=policy["l2_ttl"],
        producer=lambda: _prospectivity_map_uncached(belt, min_prob),
        l1_ttl=policy["l1_ttl"],
        allow_stale=policy["allow_stale"],
        stale_max_seconds=policy.get("stale_max_ttl", 1800),
    )



@router.get("/targets")
def list_targets(
    limit: int = Query(50, le=200),
    user=Depends(get_current_user)
):
    """All exploration targets with maturity stage and probability.

    Memoised — the grid is static reference data scored by a fixed model, so the
    result only changes when the grid or model changes.
    """
    meta = get_active_model_metadata("prospectivity")
    m_ver = meta.get("version", "v1.0")
    d_ver = meta.get("dataset_version_id") or meta.get("dataset_version", "v1.0")
    cache_key = build_cache_key(
        domain="exploration",
        resource="targets",
        params={"limit": limit},
        model_version=m_ver,
        dataset_version=d_ver,
    )
    policy = CACHE_POLICIES["exploration_targets"]
    return cache_manager.get_or_set(
        key=cache_key,
        ttl=policy["l2_ttl"],
        producer=lambda: _list_targets_uncached(limit),
        l1_ttl=policy["l1_ttl"],
        allow_stale=policy["allow_stale"],
        stale_max_seconds=policy.get("stale_max_ttl", 1800),
    )


def _list_targets_uncached(limit: int):
    # SELECT * (not a column subset): the model needs all ~37 engineered feature
    # columns (NDVI, elevation_m, litho_*, …) to score each target. A narrow
    # projection left them missing, so every row was scored on an all-zero vector
    # and returned the identical intercept-only probability (~1.000). /map and the
    # target-detail endpoint already SELECT *, which is why only this list was flat.
    rows = query(
        """SELECT * FROM geo.prospectivity_grid
           WHERE prospectivity_label = 1
           ORDER BY mn_geochemistry DESC NULLS LAST LIMIT %s""",
        (limit,)
    )
    model, meta = ensure_active_model("prospectivity")
    m_ver = str(meta.get("version", "v1.0"))
    feat_names = get_model("prospectivity_feats") or []
    probs      = _score_rows(rows, model, feat_names)

    targets = []
    for r, prob in zip(rows, probs):
        targets.append({
            "target_id":          r["grid_id"],
            "latitude":           r.get("latitude"),
            "longitude":          r.get("longitude"),
            "belt":               r.get("belt"),
            "prospectivity_prob": prob,
            "maturity_stage":     _maturity(prob),
            "mn_geochemistry":    r.get("mn_geochemistry"),
            "lithology_code":     r.get("lithology_code"),
            "data_origin":        "SYNTHETIC",
            "note":               "Prospectivity score — not a reserve claim",
        })
    return {
        "targets":         targets,
        "count":           len(targets),
        "data_origin":     "SYNTHETIC",
        "model_version":   m_ver,
        "serving_model_version": str(meta.get("serving_model_version", m_ver)),
        "authoritative_model_version": str(meta.get("authoritative_model_version", m_ver)),
        "serving_status":  str(meta.get("serving_status", "ACTIVE")),
        "dataset_version": meta.get("dataset_version_id") or meta.get("dataset_version", "v1.0"),
    }


@router.get("/targets/{grid_id}")
def target_detail(grid_id: str, user=Depends(get_current_user)):
    """Single target with full evidence."""
    rows = query("SELECT * FROM geo.prospectivity_grid WHERE grid_id = %s", (grid_id,))
    if not rows:
        raise HTTPException(404, f"Target {grid_id} not found")
    r = rows[0]

    model, meta = ensure_active_model("prospectivity")
    m_ver = str(meta.get("version", "v1.0"))
    feat_names = get_model("prospectivity_feats") or []
    prob       = _score_row(r, model, feat_names)

    shap_drivers = []
    if model and feat_names and hasattr(model, "feature_importances_"):
        imp = pd.Series(model.feature_importances_, index=feat_names).nlargest(5)
        for fname, fval in imp.items():
            shap_drivers.append({"feature": fname, "importance": round(float(fval), 4)})
    elif model is not None and hasattr(model, "coef_"):
        import numpy as np
        coefs = np.abs(np.asarray(model.coef_)).ravel()
        order = np.argsort(coefs)[::-1][:5]
        shap_drivers = [{"feature": feat_names[i], "importance": round(float(coefs[i]), 4)} for i in order]

    return {
        "target_id":          grid_id,
        "latitude":           r.get("latitude"),
        "longitude":          r.get("longitude"),
        "belt":               r.get("belt"),
        "prospectivity_prob": prob,
        "maturity_stage":     _maturity(prob),
        "confidence_tier":    "HIGH" if prob >= 0.70 else "MEDIUM",
        "top_drivers":        shap_drivers,
        "evidence": {
            "ndvi":            r.get("ndvi"),
            "ndmi":            r.get("ndmi"),
            "ndwi":            r.get("ndwi"),
            "elevation_m":     r.get("elevation_m"),
            "mn_geochemistry": r.get("mn_geochemistry"),
            "lithology_code":  r.get("lithology_code"),
        },
        "data_origin":     "SYNTHETIC",
        "model_version":   m_ver,
        "serving_model_version": str(meta.get("serving_model_version", m_ver)),
        "authoritative_model_version": str(meta.get("authoritative_model_version", m_ver)),
        "serving_status":  str(meta.get("serving_status", "ACTIVE")),
        "dataset_version": meta.get("dataset_version_id") or meta.get("dataset_version", "v1.0"),
        "note":            "Prospectivity score — not a reserve or resource claim.",
    }

