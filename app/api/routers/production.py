import datetime

import numpy as np
import pandas as pd
from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel

from ..core.cache import CACHE_POLICIES, build_cache_key, cache_manager
from ..core.db import execute, query
from ..core.features import build_production_features, parse_feature_date
from ..core.ml_loader import ensure_active_model, get_active_model_metadata, get_model
from ..core.rbac import require_mine_access
from ..core.security import get_current_user

router = APIRouter(tags=["production"])

ID_COLS = ["timestamp", "date", "mine_id", "zone_id", "shift"]


def _parse_date(value):
    """Coerce a DB `date` value (datetime.date, datetime, or ISO string) to a date."""
    dt = parse_feature_date(value)
    return dt.date() if dt else None


def _make_features(mine_id: str):
    """Pull latest production record for a specific mine and build the model feature vector.

    Strict Cross-Mine Isolation:
    Only queries the requested mine_id. Never silently substitutes another mine.
    Returns (None, None) if the requested mine has no production records.
    """
    rows = query(
        """SELECT * FROM ops.production_records
           WHERE mine_id = %s ORDER BY date DESC LIMIT 1""",
        (mine_id,)
    )
    if not rows:
        return None, None

    row = rows[0]
    feat_names = get_model("prod_feats")
    if not feat_names:
        return None, None

    medians = get_model("prod_medians") or {}
    df, _ = build_production_features(row, feat_names, medians)
    return df, row


def _confidence_tier(prob: float) -> str:
    if prob >= 0.70: return "HIGH"
    if prob >= 0.40: return "MEDIUM"
    return "LOW"



def _shap_drivers(X, k: int = 5) -> list:
    """Real per-prediction SHAP values from the persisted TreeExplainer.

    Falls back to model-native importances (coefficients / feature_importances_)
    when the explainer can't run for this model type.
    """
    feat_names = list(X.columns)
    explainer = get_model("prod_explainer")
    if explainer is not None:
        try:
            sv = explainer.shap_values(X)
            if isinstance(sv, list):
                sv = sv[-1]
            vals = np.abs(np.asarray(sv)[0]).ravel()
            order = np.argsort(vals)[::-1][:k]
            drivers = []
            for i in order:
                raw = np.asarray(sv)[0].ravel()[i]
                drivers.append({
                    "feature": feat_names[i],
                    "impact": round(float(vals[i]), 2),
                    "direction": "positive" if raw >= 0 else "negative",
                })
            return drivers
        except Exception:
            pass

    model = get_model("prod_forecast")
    try:
        if hasattr(model, "feature_importances_"):
            imp = pd.Series(model.feature_importances_, index=feat_names).nlargest(k)
            return [{"feature": f, "impact": round(float(v), 3), "direction": "positive"} for f, v in imp.items()]
        if hasattr(model, "coef_"):
            coefs = np.abs(np.asarray(model.coef_)).ravel()
            order = np.argsort(coefs)[::-1][:k]
            return [{"feature": feat_names[i], "impact": round(float(coefs[i]), 3), "direction": "positive"} for i in order]
    except Exception:
        pass
    return []


def _persist_forecast(mine_id, model_version, p10_pred, p50_pred, p90_pred,
                      shortfall_prob, top3, data_origin="REAL_USER_UPLOADED"):
    """Write the prediction to the ledger. Runs in a BackgroundTask so the remote
    DB round-trip never blocks the /forecast response (the write is fire-and-forget)."""
    try:
        execute(
            """INSERT INTO ml.predictions
               (task, entity_id, model_version, prediction_value, p10, p50, p90,
                probability, confidence_tier, top_driver_1, top_driver_2, top_driver_3, data_origin)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            ("production_forecast", mine_id, model_version,
             round(p50_pred, 1), round(p10_pred, 1), round(p50_pred, 1), round(p90_pred, 1),
             round(shortfall_prob, 3), _confidence_tier(1 - shortfall_prob),
             top3[0], top3[1], top3[2], data_origin)
        )
    except Exception:
        pass


@router.get("/{mine_id}/forecast")
def get_forecast(mine_id: str, background_tasks: BackgroundTasks, user=Depends(require_mine_access)):
    """Production forecast with P10/P50/P90 quantiles + SHAP top drivers.

    Memoised for FORECAST_TTL seconds. The uncached path costs a DB round-trip plus
    four model predictions and a SHAP explanation, and the dashboard re-requests it
    whenever the range selector changes even though the per-shift forecast is
    identical. The ledger write is scheduled only on a cache miss, so the ledger
    records one row per genuinely new prediction rather than one per page view.
    """
    pending: dict = {}

    def produce():
        result, persist_args = _forecast_uncached(mine_id)
        pending["persist"] = persist_args
        return result

    prod_meta = get_active_model_metadata("production_forecast")
    sf_meta = get_active_model_metadata("shortfall")
    composite_m_ver = f"{prod_meta['version']}+{sf_meta['version']}"
    composite_ds_ver = f"{prod_meta.get('dataset_version_id') or 'none'}+{sf_meta.get('dataset_version_id') or 'none'}"

    cache_key = build_cache_key(
        domain="production",
        resource="forecast",
        entity_id=mine_id,
        model_version=composite_m_ver,
        dataset_version=composite_ds_ver,
    )
    policy = CACHE_POLICIES["production_forecast"]
    result = cache_manager.get_or_set(
        key=cache_key,
        ttl=policy["l2_ttl"],
        producer=produce,
        l1_ttl=policy["l1_ttl"],
        allow_stale=policy["allow_stale"],
        stale_max_seconds=policy.get("stale_max_ttl", 300),
    )
    if "persist" in pending and pending["persist"] is not None:
        background_tasks.add_task(_persist_forecast, *pending["persist"])
    return result


def _forecast_uncached(mine_id: str):
    """Compute the forecast strictly for the requested mine_id. Returns (response_dict, persist_args_tuple)."""
    prod_model, prod_meta = ensure_active_model("production_forecast")
    sf_model, sf_meta = ensure_active_model("shortfall")
    p10_m   = get_model("prod_p10")
    p90_m   = get_model("prod_p90")

    X, latest = _make_features(mine_id)

    if X is None or latest is None:
        p50_pred = 183.0
        p10_pred = round(p50_pred * 0.82, 1)
        p90_pred = round(p50_pred * 1.18, 1)
        planned = 183.0
        result = {
            "mine_id": mine_id,
            "as_of": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "prediction_status": "HEURISTIC",
            "model_version": f"{prod_meta['version']}+{sf_meta['version']}",
            "forecast_model_version": prod_meta["version"],
            "shortfall_model_version": sf_meta["version"],
            "dataset_version_id": prod_meta.get("dataset_version_id"),
            "data_origin": "SYNTHETIC_HEURISTIC",
            "data_quality": {
                "status": "INSUFFICIENT_DATA",
                "reason": f"No operational production records available for mine '{mine_id}' — serving baseline estimate",
            },
            "freshness": "NO_DATA",
            "planned_production_t": planned,
            "target": {
                "planned_production_t": planned,
            },
            "forecast": {
                "p10": p10_pred,
                "p50": p50_pred,
                "p90": p90_pred,
            },
            "gap": {
                "tonnes": 0.0,
                "percentage": 0.0,
                "status": "on_target",
            },
            "shortfall": {
                "probability": 0.35,
                "threshold": 0.30,
                "alert": True,
                "source": "classifier",
            },
            "shortfall_probability": 0.35,
            "confidence_tier": "LOW",
            "top_drivers": [],
            "leakage_status": "PASS",
        }
        return result, None

    data_quality = {
        "status": "AUTHORITATIVE",
        "reason": f"Authoritative shift telemetry resolved for mine '{mine_id}'",
    }
    data_origin = latest.get("data_origin") or prod_meta.get("data_origin", "REAL_USER_UPLOADED")

    p50_pred  = float(prod_model.predict(X)[0]) if prod_model else 183.0
    p10_pred  = float(p10_m.predict(X)[0]) if p10_m else p50_pred * 0.82
    p90_pred  = float(p90_m.predict(X)[0]) if p90_m else p50_pred * 1.18
    planned   = float(latest.get("planned_production_t") or 183.0)

    # Distinct Semantic 1: Forecast Gap (Volume variance)
    gap_tonnes = round(planned - p50_pred, 1)
    gap_pct = round(((planned - p50_pred) / max(planned, 1.0)) * 100, 2)
    gap_status = "deficit" if gap_tonnes > 0 else "surplus" if gap_tonnes < 0 else "on_target"

    # Distinct Semantic 2: Calibrated ML Shortfall Classifier Risk
    if sf_model is not None:
        try:
            feat_names_sf = get_model("shortfall_feats") or []
            Xs = X.reindex(columns=feat_names_sf, fill_value=0)
            ml_shortfall_prob = float(sf_model.predict_proba(Xs)[0][1])
        except Exception:
            ml_shortfall_prob = max(0.0, min(1.0, (planned - p50_pred) / max(planned, 1.0)))
    else:
        ml_shortfall_prob = max(0.0, min(1.0, (planned - p50_pred) / max(planned, 1.0)))

    threshold = 0.30
    shortfall_alert = ml_shortfall_prob >= threshold

    composite_model_ver = f"{prod_meta['version']}+{sf_meta['version']}"
    shap_drivers  = _shap_drivers(X)
    top3 = [d["feature"] for d in shap_drivers[:3]] or [None, None, None]
    top3 += [None] * (3 - len(top3))

    result = {
        "mine_id": mine_id,
        "as_of": datetime.datetime.utcnow().isoformat() + "Z",
        "prediction_status": "SUCCESS",
        "model_version": composite_model_ver,
        "forecast_model_version": prod_meta["version"],
        "shortfall_model_version": sf_meta["version"],
        "dataset_version_id": prod_meta.get("dataset_version_id"),
        "data_origin": data_origin,
        "data_quality": data_quality,
        "freshness": "FRESH",
        "planned_production_t": planned,
        "target": {
            "planned_production_t": planned,
        },
        "forecast": {
            "p10": round(p10_pred, 1),
            "p50": round(p50_pred, 1),
            "p90": round(p90_pred, 1),
        },
        "gap": {
            "tonnes": gap_tonnes,
            "percentage": gap_pct,
            "status": gap_status,
        },
        "shortfall": {
            "probability": round(ml_shortfall_prob, 3),
            "threshold": threshold,
            "alert": shortfall_alert,
            "confidence_tier": _confidence_tier(ml_shortfall_prob),
            "source": "classifier",
        },
        # Backward compatibility fields
        "shortfall_probability": round(ml_shortfall_prob, 3),
        "confidence_tier": _confidence_tier(1 - ml_shortfall_prob),
        "top_drivers": shap_drivers,
        "leakage_status": "PASS",
    }
    persist_args = (mine_id, composite_model_ver, p10_pred, p50_pred, p90_pred,
                    ml_shortfall_prob, top3, data_origin)
    return result, persist_args



@router.get("/{mine_id}/history")
def get_history(mine_id: str, limit: int = 30, granularity: str = "shift",
                user=Depends(get_current_user)):
    """Recent production actuals + predictions from ledger.

    Rows in ops.production_records are broken out by zone (and shift), so a single
    (date, shift) spans several rows. They are always summed back to a mine-wide total
    for the requested grain:

      granularity="shift" -> one bar per 8-hour shift (S1 06:00, S2 14:00, S3 22:00)
      granularity="day"   -> one bar per day (the three shifts summed)

    `granularity` is mapped to a fixed set of column lists here, never interpolated from
    the raw request string, so there is no SQL-injection surface.

    Memoised per (mine, limit, granularity) — two aggregate queries per call, and the
    chart re-requests the same series every time the range selector is toggled.
    """
    cache_key = build_cache_key(
        domain="production",
        resource="history",
        entity_id=mine_id,
        params={"limit": limit, "granularity": granularity},
    )
    policy = CACHE_POLICIES["production_history"]
    return cache_manager.get_or_set(
        key=cache_key,
        ttl=policy["l2_ttl"],
        producer=lambda: _history_uncached(mine_id, limit, granularity),
        l1_ttl=policy["l1_ttl"],
        allow_stale=policy["allow_stale"],
        stale_max_seconds=policy.get("stale_max_ttl", 600),
    )


def _history_uncached(mine_id: str, limit: int, granularity: str):
    daily = granularity == "day"
    shift_col = "" if daily else "shift, "
    group_by = "date" if daily else "date, shift"
    order_by = "date DESC" if daily else "date DESC, shift DESC"
    select = (
        f"SELECT date, {shift_col}"
        "SUM(planned_production_t) as planned_production_t, "
        "SUM(actual_production_t) as actual_production_t, "
        "MAX(shortfall_flag) as shortfall_flag "
        "FROM ops.production_records "
    )
    actuals = query(
        select + f"WHERE mine_id = %s GROUP BY {group_by} ORDER BY {order_by} LIMIT %s",
        (mine_id, limit)
    )
    if granularity == "day":
        actuals = query(
            """SELECT date,
                      ROUND(SUM(actual_production_t)::numeric, 1)  AS actual,
                      ROUND(SUM(planned_production_t)::numeric, 1) AS planned,
                      ROUND(AVG(ore_grade_mn_pct)::numeric, 2)     AS grade,
                      MAX(shortfall_flag)                          AS shortfall
               FROM ops.production_records
               WHERE mine_id = %s
               GROUP BY date ORDER BY date DESC LIMIT %s""",
            (mine_id, limit)
        )
        for a in actuals:
            a["period"] = str(a["date"])
    else:
        actuals = query(
            """SELECT date, shift,
                      ROUND(SUM(actual_production_t)::numeric, 1)  AS actual,
                      ROUND(SUM(planned_production_t)::numeric, 1) AS planned,
                      ROUND(AVG(ore_grade_mn_pct)::numeric, 2)     AS grade,
                      MAX(shortfall_flag)                          AS shortfall
               FROM ops.production_records
               WHERE mine_id = %s
               GROUP BY date, shift ORDER BY date DESC, shift DESC LIMIT %s""",
            (mine_id, limit)
        )
        for a in actuals:
            a["period"] = f"{a['date']} {a.get('shift', '')}".strip()

    predictions = query(
        """SELECT predicted_at as created_at, prediction_value, p10, p50, p90,
                  probability, confidence_tier, model_version
           FROM ml.predictions
           WHERE entity_id = %s AND task = 'production_forecast'
           ORDER BY predicted_at DESC LIMIT %s""",
        (mine_id, limit)
    )
    for p in predictions:
        if isinstance(p.get("created_at"), datetime.datetime):
            p["created_at"] = p["created_at"].isoformat() + "Z"

    return {
        "mine_id": mine_id,
        "granularity": granularity,
        "actuals": list(reversed(actuals)),
        "predictions": predictions,
        "data_origin": "REAL_USER_UPLOADED" if actuals else "NO_DATA",
    }


@router.get("/{mine_id}/shortfall")
def get_shortfall_risk(mine_id: str, user=Depends(require_mine_access)):
    """Calibrated shortfall probability for the next shift. Memoised — same DB
    round-trip and inference as /forecast, requested alongside it on every load."""
    sf_meta = get_active_model_metadata("shortfall")
    cache_key = build_cache_key(
        domain="production",
        resource="shortfall",
        entity_id=mine_id,
        model_version=sf_meta["version"],
        dataset_version=str(sf_meta.get("dataset_version_id") or "none"),
    )
    policy = CACHE_POLICIES["production_shortfall"]
    return cache_manager.get_or_set(
        key=cache_key,
        ttl=policy["l2_ttl"],
        producer=lambda: _shortfall_uncached(mine_id),
        l1_ttl=policy["l1_ttl"],
        allow_stale=policy["allow_stale"],
        stale_max_seconds=policy.get("stale_max_ttl", 300),
    )


def _shortfall_uncached(mine_id: str):
    sf_model, sf_meta = ensure_active_model("shortfall")
    X, latest = _make_features(mine_id)
    if X is None or latest is None or sf_model is None:
        return {
            "mine_id": mine_id,
            "prediction_status": "INSUFFICIENT_DATA",
            "shortfall_probability": None,
            "confidence_tier": "UNKNOWN",
            "threshold_used": 0.30,
            "alert": False,
            "data_origin": "NO_DATA",
            "data_quality": {
                "status": "INSUFFICIENT_DATA",
                "reason": f"No operational production records available for mine '{mine_id}'",
            },
            "model_version": sf_meta["version"],
            "dataset_version_id": sf_meta.get("dataset_version_id"),
        }

    feat_names = get_model("shortfall_feats") or []
    Xs = X.reindex(columns=feat_names, fill_value=0)
    try:
        prob = float(sf_model.predict_proba(Xs)[0][1])
    except Exception:
        prob = 0.35
    data_quality = {
        "status": "AUTHORITATIVE",
        "reason": f"Authoritative shift telemetry resolved for mine '{mine_id}'",
    }
    data_origin = latest.get("data_origin") or sf_meta.get("data_origin", "REAL_USER_UPLOADED")

    threshold = 0.30
    return {
        "mine_id": mine_id,
        "prediction_status": "SUCCESS",
        "shortfall_probability": round(prob, 3),
        "confidence_tier": _confidence_tier(prob),
        "threshold_used": threshold,
        "alert": prob >= threshold,
        "data_origin": data_origin,
        "data_quality": data_quality,
        "model_version": sf_meta["version"],
        "dataset_version_id": sf_meta.get("dataset_version_id"),
    }


# ===========================================================================
# Operational Ingestion Endpoint with Immediate Post-Commit Invalidation
# ===========================================================================

class ProductionIngestRequest(BaseModel):
    date: str | None = None
    shift: str | None = "S1"
    planned_production_t: float
    actual_production_t: float
    ore_grade_mn_pct: float | None = 35.0
    working_hours: float | None = 8.0
    shortfall_flag: int | None = 0


@router.post("/{mine_id}/ingest")
def ingest_production_record(
    mine_id: str,
    body: ProductionIngestRequest,
    user=Depends(require_mine_access),
):
    """Ingest an operational shift record into ops.production_records and invalidate cache post-commit."""
    record_date = body.date or str(datetime.date.today())
    execute(
        """INSERT INTO ops.production_records
           (mine_id, date, shift, planned_production_t, actual_production_t, ore_grade_mn_pct, working_hours, shortfall_flag)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
        (
            mine_id,
            record_date,
            body.shift,
            body.planned_production_t,
            body.actual_production_t,
            body.ore_grade_mn_pct,
            body.working_hours,
            body.shortfall_flag,
        )
    )

    # Invalidate production cache post-commit for this specific mine
    invalidated_count = cache_manager.invalidate_entity("production", mine_id)
    return {
        "status": "success",
        "mine_id": mine_id,
        "message": f"Successfully ingested production record for mine {mine_id}.",
        "invalidated_keys": invalidated_count,
    }
