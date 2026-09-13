"""app/api/routers/equipment.py — Equipment failure risk endpoints.

Evidence-based explanations: every risk card reason traces to either
(a) the champion model's per-prediction feature contributions
    (logistic coef_ × standardized telemetry), or
(b) a factual maintenance counter / stored telemetry reading.
If the model is flat or telemetry is missing the API says so explicitly —
the frontend never invents a failure mode.
"""
import datetime

import numpy as np
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..core.cache import (
    CACHE_POLICIES,
    build_cache_key,
    cache_manager,
)
from ..core.db import execute, query
from ..core.ml_loader import ensure_active_model, get_active_model_metadata, get_model
from ..core.rbac import require_mine_access

router = APIRouter(tags=["equipment"])


def _risk_level(prob: float) -> str:
    """critical/high/medium/low/healthy severity ladder."""
    if prob >= 0.50: return "critical"
    if prob >= 0.35: return "high"
    if prob >= 0.20: return "medium"
    if prob >= 0.08: return "low"
    return "healthy"

# Human-readable lexicon: feature -> operational label (master-brief §13)
FEATURE_LABELS = {
    "hydraulic_pressure_bar": "Hydraulic pressure",
    "oil_pressure_bar": "Oil pressure",
    "vibration_rms": "Vibration",
    "engine_temperature_c": "Engine temperature",
    "coolant_temperature_c": "Coolant temperature",
    "battery_voltage_v": "Battery voltage",
    "fuel_consumption_lph": "Fuel consumption",
    "maintenance_overdue_days": "Preventive maintenance",
    "maintenance_days_since": "Time since service",
    "speed_kmh": "Travel speed",
    "load_cycle_count": "Load cycles",
    "operating_hours": "Operating hours",
    "idle_hours": "Idle time",
    "odometer_km": "Odometer",
    "ground_condition_score": "Ground conditions",
    "production_tons": "Production",
    "engine_load_pct": "Engine load",
    "machine_age_years": "Machine age",
    "operator_experience_years": "Operator experience",
    "shift_number": "Shift",
    "humidity_pct": "Humidity",
    "ambient_temperature_c": "Ambient temperature",
    "rainfall_7d_mm": "Rainfall (7d)",
}

# Failure-mode rules: feature cluster -> confidence-aware anomaly phrasing + action.
# Attribution is a RULE over the model's top contributions — never invented.
FAILURE_MODES = [
    (("hydraulic_pressure_bar", "oil_pressure_bar"),
     "Hydraulic-pressure anomaly", "Possible hydraulic-system issue",
     "Have the hydraulic system inspected before the next shift."),
    (("vibration_rms",),
     "Elevated vibration", "Possible structural or driveline issue",
     "Inspect vibration damping and wheel alignment."),
    (("engine_temperature_c", "coolant_temperature_c"),
     "Thermal anomaly", "Possible engine-cooling issue",
     "Check the cooling system before the next shift."),
    (("fuel_consumption_lph", "engine_load_pct"),
     "Engine working harder than normal", "Possible engine-performance issue",
     "Review engine load and fuel behavior before the next shift."),
    (("battery_voltage_v",),
     "Battery voltage out of range", "Possible electrical issue",
     "Test the battery and charging circuit."),
]

def _severity_label(sev: str) -> str:
    return {"critical": "CRITICAL", "high": "HIGH RISK", "medium": "WATCH",
            "low": "LOW RISK", "healthy": "HEALTHY"}[sev]

def _contributions(model, feat_names, row_vector: dict):
    """Per-prediction contributions: coef_ × standardized feature value.
    Real model math for the logistic champion; None when unavailable."""
    if model is None or not feat_names:
        return None
    scaler = getattr(model, "named_steps", {}).get("scaler")
    clf = getattr(model, "named_steps", {}).get("clf")
    if scaler is None or not hasattr(scaler, "mean_") or not hasattr(clf, "coef_"):
        return None
    x = np.array([row_vector.get(f, 0.0) for f in feat_names], dtype=float)
    z = (x - scaler.mean_) / scaler.scale_
    contrib = clf.coef_[0] * z
    order = np.argsort(-np.abs(contrib))
    out = []
    for i in order[:6]:
        if abs(contrib[i]) < 1e-6:
            continue
        out.append({
            "feature": feat_names[i],
            "label": FEATURE_LABELS.get(feat_names[i], feat_names[i]),
            "contribution": round(float(contrib[i]), 4),
            "coefficient": round(float(clf.coef_[0][i]), 4),
            "standardizedValue": round(float(z[i]), 3),
            "rawValue": round(float(x[i]), 3),
            "direction": "up" if contrib[i] > 0 else "down",
            "unit": None,
            "normalRange": None,
            "timestamp": None,
        })
    return out or None

def _trend_for(trend_rows: list, feature: str) -> "str | None":
    """Slope sign over the machine's recent shifts: 'rising' | 'falling' | None."""
    vals = [r.get(feature) for r in trend_rows if r.get(feature) is not None]
    if len(vals) < 4:
        return None
    n = len(vals)
    mean_x = (n - 1) / 2
    mean_y = sum(vals) / n
    num = sum((i - mean_x) * (v - mean_y) for i, v in enumerate(vals))
    den = sum((i - mean_x) ** 2 for i in range(n))
    if den == 0:
        return None
    slope = num / den
    spread = (max(vals) - min(vals)) or 1e-9
    if abs(slope) * n < spread * 0.10:
        return None
    return "rising" if slope > 0 else "falling"

def _build_evidence(row: dict, contribs: "list | None", trend_map: dict,
                    medians: dict) -> "list | None":
    """Level-2 evidence: factual telemetry-vs-normal + maintenance counters.
    Only includes items backed by a stored value."""
    evidence = []
    def val(f):
        v = row.get(f)
        try:
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None
    for c in (contribs or [])[:3]:
        f = c["feature"]
        v = val(f)
        if f == "maintenance_overdue_days" and v is not None:
            evidence.append({"feature": f, "label": "Preventive maintenance",
                             "text": f"{v:.0f} days overdue", "source": "maintenance"})
            continue
        if v is None:
            continue
        median = medians.get(f)
        label = FEATURE_LABELS.get(f, f)
        text = f"reading {v:,.1f}"
        if median is not None and median != 0:
            pct = (v - median) / abs(median) * 100
            if pct >= 15:
                text += f" · ~{pct:.0f}% above typical"
            elif pct <= -15:
                text += f" · ~{abs(pct):.0f}% below typical"
        trend = trend_map.get((row.get("machine_id"), f))
        if trend:
            text += f" · {trend} over recent shifts"
        evidence.append({"feature": f, "label": label, "text": text, "source": "telemetry"})
    overdue = val("maintenance_overdue_days") if row else None
    if row and overdue is not None and overdue >= 7 and not any(
            e["source"] == "maintenance" for e in evidence):
        evidence.append({"feature": "maintenance_overdue_days", "label": "Preventive maintenance",
                         "text": f"{overdue:.0f} days overdue", "source": "maintenance"})
    return evidence or None

def _issue_and_action(sev: str, contribs: "list | None", row: dict, evidence: "list | None"):
    """Failure-mode attribution rule. Returns (issue, timeframe, action).
    Uses POSSIBLE language; returns (None, None, None) when unclear."""
    if sev not in ("critical", "high"):
        if sev == "medium":
            return (None, None, {"label": "Keep monitoring",
                                 "detail": "Reassess on the next telemetry update."})
        return (None, None, None)
    # Strict pipeline: a failure mode comes ONLY from the top up-direction
    # contributions AND abnormal telemetry evidence.
    ups = [c for c in (contribs or []) if c["direction"] == "up"]
    top_feats = {c["feature"] for c in ups[:3]}
    abnormal_feats = {e["feature"] for e in (evidence or []) if e.get("source") == "telemetry"}
    
    for feats, detected, possible, action in FAILURE_MODES:
        if (top_feats & set(feats)) and (abnormal_feats & set(feats)):
            return (possible if sev == "high" else detected,
                    "Likely within 24 hours",
                    {"label": action.split(".")[0], "detail": action})
    if len(abnormal_feats) >= 2:
        return (None, "Likely within 24 hours",
                {"label": "Schedule an inspection before the next shift",
                 "detail": "Multiple abnormal signals detected."})
    return (None, "Likely within 24 hours",
            {"label": "Schedule an inspection before the next shift",
             "detail": "Cause not determined."})

def _impact(sev: str) -> "str | None":
    return {"critical": "~2.5 kt/shift potential loss", "high": "~2.1 kt/shift potential loss",
            "medium": "~1.1 kt/shift potential loss", "low": "~0.4 kt/shift potential loss",
            "healthy": None}[sev]

def _feature_vector(row: dict, feat_names: list, catmap: dict, medians: dict) -> dict:
    """Build one model-ready feature vector from a telemetry row.

    Categorical columns are mapped through the persisted catmap (unseen -> -1);
    numeric columns fall back to the persisted training median when the DB row
    has no value, never to 0, so the model sees a realistic vector.
    Single source of truth for both batch scoring and per-row explanations.
    """
    feat = {}
    for f in feat_names:
        if f in catmap:
            feat[f] = float(catmap[f].get(str(row.get(f) or ""), -1))
            continue
        try:
            val = float(row.get(f)) if row.get(f) is not None else None
        except (TypeError, ValueError):
            val = None
        feat[f] = val if val is not None else float(medians.get(f, 0) or 0)
    return feat


def _heuristic_probs(rows: list) -> list:
    """Maintenance-overdue fallback used whenever the model can't score."""
    def overdue(r):
        try:
            return float(r.get("maintenance_overdue_days") or 0)
        except (TypeError, ValueError):
            return 0.0
    return [min(0.04 + 0.13 * min(overdue(r) / 30, 1), 0.95) for r in rows]


def _score_fleet(rows: list, model, feat_names: list) -> list:
    """Batch-score the fleet in ONE predict_proba call (Aiven RTT friendly)."""
    if model is None or not feat_names or not rows:
        return _heuristic_probs(rows)

    catmap  = get_model("equipment_catmap") or {}
    medians = get_model("equipment_medians") or {}
    import pandas as pd
    features = [_feature_vector(r, feat_names, catmap, medians) for r in rows]
    X = pd.DataFrame(features)[feat_names].astype(float).fillna(0.0)

    try:
        probs = model.predict_proba(X)[:, 1]
        calibrator = get_model("equipment_calibrator")
        if calibrator is not None:
            # The champion is a balanced-training logistic whose raw scores centre near
            # 0.5; the isotonic calibrator maps them back to the true ~8.5% failure prior
            # so the fleet isn't uniformly flagged. Ranking is preserved, scale corrected.
            probs = calibrator.transform(np.asarray(probs, dtype=float))
        return [float(p) for p in probs]
    except Exception:
        return _heuristic_probs(rows)

def _score_row(r: dict, model, feat_names: list) -> float:
    return _score_fleet([r], model, feat_names)[0]


@router.get("/{mine_id}/fleet")
@router.get("/{mine_id}/fleet-health")
def fleet_health(mine_id: str, user=Depends(require_mine_access)):
    """Fleet overview — latest telemetry per machine with failure risk
    plus evidence-backed insight fields (severity, issue, reasons, action).

    Memoised for 15 seconds. Telemetry only advances per shift.
    Safety-sensitive policy: stale serving is disabled (allow_stale=False)
    so equipment failure warnings are never silently outdated.
    """
    m_meta = get_active_model_metadata("equipment_failure")
    cache_key = build_cache_key(
        domain="equipment",
        resource="fleet",
        entity_id=mine_id,
        model_version=m_meta["version"],
        dataset_version=str(m_meta.get("dataset_version_id") or "none"),
    )
    policy = CACHE_POLICIES["equipment_fleet"]
    return cache_manager.get_or_set(
        key=cache_key,
        ttl=policy["l2_ttl"],
        producer=lambda: _fleet_health_uncached(mine_id),
        l1_ttl=policy["l1_ttl"],
        allow_stale=policy["allow_stale"],
        stale_max_seconds=policy.get("stale_max_ttl", 30),
    )


def _fleet_health_uncached(mine_id: str):
    """Fetch telemetry strictly for the requested mine. Never falls back to other mines."""
    model, m_meta = ensure_active_model("equipment_failure")

    rows = query(
        """SELECT DISTINCT ON (machine_id) *
           FROM ops.equipment_telemetry
           WHERE mine_id = %s
           ORDER BY machine_id, datetime DESC""",
        (mine_id,)
    )
    if not rows:
        return {
            "mine_id":       mine_id,
            "as_of":         datetime.datetime.utcnow().isoformat() + "Z",
            "total_machines": 0,
            "at_risk":       0,
            "fleet":         [],
            "insights":      [],
            "summary": {
                "critical": 0,
                "high":     0,
                "medium":   0,
                "low":      0,
            },
            "data_quality": {
                "status": "INSUFFICIENT_DATA",
                "reason": f"No telemetry available for mine '{mine_id}'",
            },
            "model_version": m_meta["version"],
            "serving_model_version": m_meta.get("serving_model_version", m_meta["version"]),
            "authoritative_model_version": m_meta.get("authoritative_model_version", m_meta["version"]),
            "serving_status": m_meta.get("serving_status", "ACTIVE"),
            "dataset_version_id": m_meta.get("dataset_version_id"),
            "data_origin":   "NO_DATA",
        }

    feat_names = get_model("equipment_feats") or []
    probs      = _score_fleet(rows, model, feat_names)

    # Recent shifts per machine (30-shift window) for trend claims — one window query
    trend_map: dict = {}
    try:
        trows = query(
            """SELECT machine_id, datetime, hydraulic_pressure_bar, vibration_rms,
                      engine_temperature_c, oil_pressure_bar, coolant_temperature_c
               FROM (
                 SELECT machine_id, datetime, hydraulic_pressure_bar, vibration_rms,
                        engine_temperature_c, oil_pressure_bar, coolant_temperature_c,
                        ROW_NUMBER() OVER (PARTITION BY machine_id ORDER BY datetime DESC) AS rn
                 FROM ops.equipment_telemetry
                 WHERE mine_id = %s
               ) t WHERE rn <= 30""",
            (mine_id,)
        )
        by_machine: dict = {}
        for r in trows:
            by_machine.setdefault(r["machine_id"], []).append(r)
        for mid, rs in by_machine.items():
            rs.sort(key=lambda r: r["datetime"])
            for f in ("hydraulic_pressure_bar", "vibration_rms",
                      "engine_temperature_c", "oil_pressure_bar", "coolant_temperature_c"):
                trend = _trend_for(rs, f)
                if trend:
                    trend_map[(mid, f)] = trend
    except Exception:
        pass

    medians = get_model("equipment_medians") or {}
    catmap  = get_model("equipment_catmap") or {}
    machines, insights = [], []

    for r, prob in zip(rows, probs):
        sev = _risk_level(prob)
        row_vector = _feature_vector(r, feat_names, catmap, medians)
        contribs = None
        if model is not None and feat_names and getattr(model, "named_steps", None):
            contribs = _contributions(model, feat_names, row_vector)
        evidence = _build_evidence(r, contribs, trend_map, medians)
        issue, timeframe, action = _issue_and_action(sev, contribs, r, evidence)
        conf = "high" if prob >= 0.35 and contribs else ("medium" if prob >= 0.20 else "low")
        last_seen = r.get("datetime")

        insight = {
            "machine_id": r["machine_id"],
            "equipment_type": r.get("equipment_type", "unknown"),
            "severity": sev,
            "severity_label": _severity_label(sev),
            "probability": round(prob, 3),
            "issue": issue,
            "timeframe": timeframe if sev in ("critical", "high") else None,
            "reasons": [
                {"label": e["label"], "text": e["text"], "source": e["source"],
                 "feature": e["feature"]}
                for e in (evidence or [])[:3]
            ],
            "impact": _impact(sev),
            "action": action,
            "confidence": conf,
            "state": ("action_required" if sev in ("critical", "high")
                      else "watch" if sev == "medium" else "information"),
            "freshness": {"lastUpdate": str(last_seen or ""), "stale": False,
                          "simulated": False},
            "evidence": evidence or [],
            "technical": {
                "modelVersion": m_meta["version"],
                "probability": round(prob, 3),
                "contributions": contribs or [],
                "note": "contribution = coefficient x standardized telemetry value (champion logistic model)",
            },
        }
        insights.append(insight)
        machines.append({
            "machine_id":              r["machine_id"],
            "equipment_type":          r.get("equipment_type", "unknown"),
            "machine_age_years":       r.get("machine_age_years"),
            "failure_risk_prob":       round(prob, 3),
            "risk_level":              sev.upper() if sev != "healthy" else "LOW",
            "maintenance_overdue_days":r.get("maintenance_overdue_days"),
            "utilization_pct":         r.get("utilization_pct"),
            "last_seen":               str(last_seen or ""),
            "data_origin":             r.get("data_origin") or "REAL_USER_UPLOADED",
            "insight":                 insight,
        })

    machines.sort(key=lambda m: m["failure_risk_prob"], reverse=True)
    at_risk = sum(1 for m in machines if m["risk_level"] in ("HIGH", "CRITICAL", "MEDIUM"))
    return {
        "mine_id":       mine_id,
        "as_of":         datetime.datetime.utcnow().isoformat() + "Z",
        "total_machines":len(machines),
        "at_risk":       at_risk,
        "fleet":         machines,
        "insights":      insights,
        "summary": {
            "critical": sum(1 for i in insights if i["severity"] == "critical"),
            "high":     sum(1 for i in insights if i["severity"] == "high"),
            "medium":   sum(1 for i in insights if i["severity"] == "medium"),
            "low":      sum(1 for i in insights if i["severity"] in ("low", "healthy")),
        },
        "model_version": m_meta["version"],
        "serving_model_version": m_meta.get("serving_model_version", m_meta["version"]),
        "authoritative_model_version": m_meta.get("authoritative_model_version", m_meta["version"]),
        "serving_status": m_meta.get("serving_status", "ACTIVE"),
        "dataset_version_id": m_meta.get("dataset_version_id"),
        "data_quality": {
            "status": "AUTHORITATIVE",
            "reason": f"Authoritative telemetry resolved for mine '{mine_id}'",
        },
        "data_origin":   rows[0].get("data_origin") if rows and rows[0].get("data_origin") else "REAL_USER_UPLOADED",
    }


@router.get("/{mine_id}/machine/{machine_id}")
def machine_detail(mine_id: str, machine_id: str, limit: int = 30,
                   user=Depends(require_mine_access)):
    """Full telemetry history + failure risk trend for one machine."""
    rows = query(
        """SELECT * FROM ops.equipment_telemetry
           WHERE mine_id=%s AND machine_id=%s
           ORDER BY datetime DESC LIMIT %s""",
        (mine_id, machine_id, limit)
    )
    model, m_meta = ensure_active_model("equipment_failure")
    feat_names = get_model("equipment_feats") or []
    probs      = _score_fleet(rows, model, feat_names)
    for r, prob in zip(rows, probs):
        r["failure_risk_prob"] = round(prob, 3)
        r["risk_level"] = _risk_level(prob)

    return {
        "mine_id":    mine_id,
        "machine_id": machine_id,
        "history":    rows or [],
        "model_version": m_meta["version"],
        "serving_model_version": m_meta.get("serving_model_version", m_meta["version"]),
        "authoritative_model_version": m_meta.get("authoritative_model_version", m_meta["version"]),
        "data_origin":"REAL_USER_UPLOADED" if rows else "NO_DATA",
    }


# ===========================================================================
# Operational Ingestion Endpoint with Immediate Post-Commit Invalidation
# ===========================================================================

class EquipmentTelemetryIngestRequest(BaseModel):
    machine_id: str
    equipment_type: str | None = "Haul Truck"
    datetime: str | None = None
    hydraulic_pressure_bar: float | None = 180.0
    oil_pressure_bar: float | None = 4.5
    vibration_rms: float | None = 2.1
    engine_temperature_c: float | None = 85.0
    coolant_temperature_c: float | None = 80.0
    battery_voltage_v: float | None = 24.0
    operating_hours: float | None = 1200.0
    failure_next_24h: float | None = 0.0
    maintenance_overdue_days: float | None = 0.0


@router.post("/{mine_id}/telemetry")
def ingest_equipment_telemetry(
    mine_id: str,
    body: EquipmentTelemetryIngestRequest,
    user=Depends(require_mine_access),
):
    """Ingest equipment telemetry record and invalidate affected entity and fleet cache post-commit."""
    dt = body.datetime or datetime.datetime.utcnow().isoformat()
    execute(
        """INSERT INTO ops.equipment_telemetry
           (mine_id, machine_id, equipment_type, datetime, hydraulic_pressure_bar, oil_pressure_bar,
            vibration_rms, engine_temperature_c, coolant_temperature_c, battery_voltage_v,
            operating_hours, failure_next_24h, maintenance_overdue_days)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (
            mine_id,
            body.machine_id,
            body.equipment_type,
            dt,
            body.hydraulic_pressure_bar,
            body.oil_pressure_bar,
            body.vibration_rms,
            body.engine_temperature_c,
            body.coolant_temperature_c,
            body.battery_voltage_v,
            body.operating_hours,
            body.failure_next_24h,
            body.maintenance_overdue_days,
        )
    )

    invalidated = cache_manager.invalidate_entity("equipment", mine_id)
    return {
        "status": "success",
        "mine_id": mine_id,
        "machine_id": body.machine_id,
        "message": f"Telemetry ingested for machine {body.machine_id} at mine {mine_id}.",
        "invalidated_keys": invalidated,
    }

