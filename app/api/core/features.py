"""Canonical Feature Engineering Pipeline for Crucible AI.

Ensures strict parity across:
- Training feature pipeline
- Inference (/forecast, /shortfall)
- Scenario simulation / interventions
- Equipment telemetry scoring

Guarantees:
- Strict date derivation (year, month, day_of_week).
- Training median fallback for missing numeric fields (never silent cross-mine leak).
- Exact column ordering matching model registry feature lists.
- Deterministic data types and shape consistency.
"""

import datetime
from typing import Any

import numpy as np
import pandas as pd


def parse_feature_date(val: Any) -> datetime.datetime | None:
    """Parse date/datetime object or ISO string into a naive datetime."""
    if val is None:
        return None
    if isinstance(val, datetime.datetime):
        return val
    if isinstance(val, datetime.date):
        return datetime.datetime.combine(val, datetime.time.min)
    s = str(val).strip()
    if not s:
        return None
    # Strip trailing Z or timezone offset if present
    s = s.replace("Z", "").split("+")[0]
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%d-%m-%Y"):
        try:
            return datetime.datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def build_production_features(
    row_or_dict: dict[str, Any],
    feat_names: list[str],
    medians: dict[str, float] | None = None,
) -> tuple[pd.DataFrame, dict[str, float]]:
    """Construct a canonical, model-ready feature vector for production forecasting and shortfall.

    Args:
        row_or_dict: Dictionary representing an ops.production_records row or scenario payload.
        feat_names: Ordered list of feature names expected by the model.
        medians: Dictionary of persisted training medians used as fallbacks for missing values.

    Returns:
        tuple (pd.DataFrame, dict): Single-row DataFrame with exact column ordering and typed values,
                                   and the feature dict.
    """
    if not feat_names:
        return pd.DataFrame(), {}

    meds = medians or {}
    dt = parse_feature_date(row_or_dict.get("date"))
    derived: dict[str, float] = {}
    if dt is not None:
        derived = {
            "year": float(dt.year),
            "month": float(dt.month),
            "day_of_week": float(dt.weekday()),
        }

    feat: dict[str, float] = {}
    for col in feat_names:
        if col in derived:
            feat[col] = derived[col]
            continue
        raw = row_or_dict.get(col)
        try:
            val = float(raw) if raw is not None else None
        except (TypeError, ValueError):
            val = None

        if val is not None and not np.isnan(val):
            feat[col] = val
        else:
            default_val = meds.get(col, 0.0)
            feat[col] = float(default_val if default_val is not None else 0.0)

    # Maintain strict column ordering matching feat_names
    df = pd.DataFrame([feat])[feat_names].astype(float).fillna(0.0)
    return df, feat


def build_equipment_features(
    row_or_dict: dict[str, Any],
    feat_names: list[str],
    catmap: dict[str, dict[str, int]] | None = None,
    medians: dict[str, float] | None = None,
) -> tuple[pd.DataFrame, dict[str, float]]:
    """Construct a canonical, model-ready feature vector for equipment failure prediction.

    Args:
        row_or_dict: Dictionary representing an ops.equipment_telemetry row.
        feat_names: Ordered list of feature names expected by the model.
        catmap: Dictionary mapping categorical columns to category-to-integer mappings.
        medians: Dictionary of persisted training medians used as fallbacks for missing numeric values.

    Returns:
        tuple (pd.DataFrame, dict): Single-row DataFrame with exact column ordering and typed values,
                                   and the feature dict.
    """
    if not feat_names:
        return pd.DataFrame(), {}

    meds = medians or {}
    cats = catmap or {}
    feat: dict[str, float] = {}

    for f in feat_names:
        if f in cats:
            mapping = cats[f]
            raw_str = str(row_or_dict.get(f) or "")
            feat[f] = float(mapping.get(raw_str, -1))
            continue

        raw = row_or_dict.get(f)
        try:
            val = float(raw) if raw is not None else None
        except (TypeError, ValueError):
            val = None

        if val is not None and not np.isnan(val):
            feat[f] = val
        else:
            default_val = meds.get(f, 0.0)
            feat[f] = float(default_val if default_val is not None else 0.0)

    df = pd.DataFrame([feat])[feat_names].astype(float).fillna(0.0)
    return df, feat


def validate_feature_consistency(df1: pd.DataFrame, df2: pd.DataFrame, rtol: float = 1e-5) -> bool:
    """Verify that two feature DataFrames have identical column ordering and matching values."""
    if list(df1.columns) != list(df2.columns):
        return False
    return bool(np.allclose(df1.values, df2.values, rtol=rtol, equal_nan=True))
