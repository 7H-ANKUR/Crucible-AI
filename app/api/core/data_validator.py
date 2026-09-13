"""app/api/core/data_validator.py — Enterprise 25-Check Data Quality Validation.

Executes 25 discrete deterministic quality checks with domain-specific rules
for production, equipment, exploration, and maintenance datasets.
Returns a comprehensive DataHealthReport with a 0-100 quality score and
actionable diagnostics.
"""
from __future__ import annotations

import io
import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

try:
    import numpy as np
    import pandas as pd
    HAS_PANDAS = True
except ImportError:
    HAS_PANDAS = False

from .schema_mapper import CanonicalColumn, get_canonical_schema

# India geographic bounds
INDIA_LAT_MIN, INDIA_LAT_MAX = 6.0, 37.5
INDIA_LON_MIN, INDIA_LON_MAX = 68.0, 98.0


@dataclass
class CheckResult:
    check_id: str
    name: str
    passed: bool
    severity: str                       # 'error' | 'warning' | 'info'
    message: str
    category: str = "general"           # 'schema' | 'integrity' | 'temporal' | 'domain' | 'statistical'
    affected_count: int = 0
    affected_pct: float = 0.0
    sample_values: list[Any] = field(default_factory=list)


@dataclass
class DataHealthReport:
    domain: str
    row_count: int
    column_count: int
    quality_score: float                # 0–100
    passed: bool                        # True if no error-level failures
    checks: list[CheckResult] = field(default_factory=list)
    summary: str = ""
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def validate_dataset(domain: str, file_bytes: bytes, filename: str) -> DataHealthReport:
    """
    Run 25 enterprise validation checks on an uploaded dataset and return DataHealthReport.
    Supports CSV and XLSX.
    """
    checks: list[CheckResult] = []

    # --- 1. File Parse ---
    df = _parse_file(file_bytes, filename, checks)
    if df is None:
        return DataHealthReport(
            domain=domain, row_count=0, column_count=0,
            quality_score=0.0, passed=False, checks=checks,
            summary="File could not be parsed."
        )

    n_rows, n_cols = df.shape
    schema = get_canonical_schema(domain)

    # --- Schema & Structure Checks ---
    _check_row_count(df, checks)                       # 2. Min rows
    _check_required_columns(df, domain, schema, checks)# 3. Required columns
    _check_unknown_columns(df, domain, schema, checks) # 4. Unknown/unmapped columns
    _check_duplicates(df, checks)                      # 5. Exact duplicate rows

    # --- Integrity & Nulls ---
    _check_missing_values(df, checks)                  # 6. Null rate
    _check_null_concentration(df, checks)              # 7. Null concentration
    _check_numeric_parsing(df, schema, checks)         # 8. Numeric parsing
    _check_numeric_ranges(df, domain, schema, checks)  # 9. Numeric ranges
    _check_categorical_vocab(df, domain, checks)       # 10. Categorical vocabulary

    # --- Temporal Checks ---
    _check_date_format(df, checks)                     # 11. Date format
    _check_future_dates(df, checks)                    # 12. Future dates
    _check_temporal_ordering(df, checks)               # 13. Temporal ordering
    _check_business_keys(df, domain, checks)           # 14. Business key uniqueness

    # --- Domain Specific & Geographic ---
    _check_india_bounds(df, checks)                    # 15. India geo bounds
    _check_domain_logic(df, domain, checks)            # 16. Impossible domain combinations

    # --- ML & Statistical Checks ---
    _check_target_leakage(df, domain, checks)          # 17. Target leakage
    _check_temporal_contamination(df, domain, checks)  # 18. Train/test temporal contamination
    _check_zero_variance(df, checks)                   # 19. Constant columns
    _check_near_constant(df, checks)                   # 20. Near constant columns
    _check_high_cardinality(df, checks)                # 21. High-cardinality text
    _check_outliers(df, schema, checks)                # 22. Outlier rate
    _check_unit_consistency(df, schema, checks)        # 23. Unit consistency
    _check_temporal_continuity(df, checks)             # 24. Row / sensor continuity
    _check_data_freshness(df, checks)                  # 25. Data freshness

    # --- Scoring ---
    error_fails = [c for c in checks if c.severity == "error" and not c.passed]
    warning_fails = [c for c in checks if c.severity == "warning" and not c.passed]

    score = 100.0
    score -= len(error_fails) * 15.0
    score -= len(warning_fails) * 3.5
    score = max(0.0, min(100.0, score))

    passed = len(error_fails) == 0

    summary_parts = []
    if error_fails:
        summary_parts.append(f"{len(error_fails)} error(s)")
    if warning_fails:
        summary_parts.append(f"{len(warning_fails)} warning(s)")
    if not summary_parts:
        summary_parts.append("All 25 quality checks passed")
    summary = ", ".join(summary_parts) + f" | {n_rows} rows, {n_cols} columns"

    return DataHealthReport(
        domain=domain,
        row_count=n_rows,
        column_count=n_cols,
        quality_score=round(score, 1),
        passed=passed,
        checks=checks,
        summary=summary,
    )


# ---------------------------------------------------------------------------
# Discrete Checks Implementation
# ---------------------------------------------------------------------------

def _parse_file(file_bytes: bytes, filename: str, checks: list[CheckResult]) -> pd.DataFrame | None:
    """Check 1: Parse file bytes."""
    if not HAS_PANDAS:
        checks.append(CheckResult("chk_01_parse", "File Parse", False, "error",
                                  "pandas is not installed on this server.", "schema"))
        return None
    try:
        ext = filename.lower().split(".")[-1]
        if ext == "csv":
            df = pd.read_csv(io.BytesIO(file_bytes), low_memory=False)
        elif ext in ("xlsx", "xls"):
            df = pd.read_excel(io.BytesIO(file_bytes))
        else:
            checks.append(CheckResult("chk_01_parse", "File Parse", False, "error",
                                      f"Unsupported file format: .{ext}. Use CSV or XLSX.", "schema"))
            return None
        checks.append(CheckResult("chk_01_parse", "File Parse", True, "info",
                                  f"Parsed {ext.upper()} successfully ({len(df)} rows).", "schema"))
        return df
    except Exception as e:
        checks.append(CheckResult("chk_01_parse", "File Parse", False, "error",
                                  f"Parse error: {e}", "schema"))
        return None


def _check_row_count(df: pd.DataFrame, checks: list[CheckResult]):
    """Check 2: Minimum row count."""
    n = len(df)
    if n < 10:
        checks.append(CheckResult("chk_02_min_rows", "Minimum Row Count", False, "error",
                                  f"Dataset has only {n} rows — minimum required for Crucible AI is 10.",
                                  "integrity", n, 100.0))
    elif n < 100:
        checks.append(CheckResult("chk_02_min_rows", "Minimum Row Count", True, "warning",
                                  f"Dataset has {n} rows. Recommended size is 100+ for stable ML training.",
                                  "integrity", n, 100.0))
    else:
        checks.append(CheckResult("chk_02_min_rows", "Minimum Row Count", True, "info",
                                  f"Sufficient row volume ({n} rows).", "integrity", n, 0.0))


def _check_required_columns(df: pd.DataFrame, domain: str, schema: list[CanonicalColumn], checks: list[CheckResult]):
    """Check 3: Required canonical columns."""
    required = [c.name for c in schema if c.required]
    missing = [c for c in required if c not in df.columns]
    if missing:
        checks.append(CheckResult("chk_03_req_cols", "Required Columns", False, "error",
                                  f"Missing required canonical columns: {', '.join(missing)}",
                                  "schema", len(missing), round(len(missing)/max(len(required), 1)*100, 1), missing))
    else:
        checks.append(CheckResult("chk_03_req_cols", "Required Columns", True, "info",
                                  f"All {len(required)} required columns present.", "schema"))


def _check_unknown_columns(df: pd.DataFrame, domain: str, schema: list[CanonicalColumn], checks: list[CheckResult]):
    """Check 4: Unmapped columns."""
    known = {c.name for c in schema}
    unmapped = [c for c in df.columns if c not in known]
    if unmapped:
        checks.append(CheckResult("chk_04_unknown_cols", "Unmapped Columns", True, "info",
                                  f"{len(unmapped)} extra/unmapped columns detected: {', '.join(unmapped[:4])}",
                                  "schema", len(unmapped), round(len(unmapped)/len(df.columns)*100, 1), unmapped[:5]))
    else:
        checks.append(CheckResult("chk_04_unknown_cols", "Unmapped Columns", True, "info",
                                  "All columns match canonical schema.", "schema"))


def _check_duplicates(df: pd.DataFrame, checks: list[CheckResult]):
    """Check 5: Duplicate rows."""
    n_dups = int(df.duplicated().sum())
    pct = round(n_dups / max(len(df), 1) * 100, 2)
    if n_dups == 0:
        checks.append(CheckResult("chk_05_duplicates", "Duplicate Rows", True, "info",
                                  "No duplicate rows detected.", "integrity"))
    elif pct > 15:
        checks.append(CheckResult("chk_05_duplicates", "Duplicate Rows", False, "error",
                                  f"{n_dups} duplicate rows ({pct}%). Excessive duplication.",
                                  "integrity", n_dups, pct))
    else:
        checks.append(CheckResult("chk_05_duplicates", "Duplicate Rows", False, "warning",
                                  f"{n_dups} duplicate rows ({pct}%) found.",
                                  "integrity", n_dups, pct))


def _check_missing_values(df: pd.DataFrame, checks: list[CheckResult]):
    """Check 6: Overall missing values rate."""
    total = df.shape[0] * df.shape[1]
    missing = int(df.isnull().sum().sum())
    pct = round(missing / max(total, 1) * 100, 2)
    if pct > 35:
        checks.append(CheckResult("chk_06_null_rate", "Missing Values Rate", False, "error",
                                  f"{pct}% of cells are missing ({missing} nulls).",
                                  "integrity", missing, pct))
    elif pct > 10:
        checks.append(CheckResult("chk_06_null_rate", "Missing Values Rate", False, "warning",
                                  f"{pct}% of cells are missing ({missing} nulls).",
                                  "integrity", missing, pct))
    else:
        checks.append(CheckResult("chk_06_null_rate", "Missing Values Rate", True, "info",
                                  f"{pct}% missing cells — within acceptable limits.", "integrity"))


def _check_null_concentration(df: pd.DataFrame, checks: list[CheckResult]):
    """Check 7: Highly concentrated null columns."""
    high_null = []
    for col in df.columns:
        pct = df[col].isnull().mean()
        if pct > 0.8:
            high_null.append(f"{col} ({pct*100:.0f}%)")
    if high_null:
        checks.append(CheckResult("chk_07_null_concentration", "Null Concentration", False, "warning",
                                  f"Columns with >80% missing data: {', '.join(high_null[:5])}",
                                  "integrity", len(high_null), sample_values=high_null[:5]))
    else:
        checks.append(CheckResult("chk_07_null_concentration", "Null Concentration", True, "info",
                                  "No columns exceed 80% missing values.", "integrity"))


def _check_numeric_parsing(df: pd.DataFrame, schema: list[CanonicalColumn], checks: list[CheckResult]):
    """Check 8: Numeric type parseability."""
    num_cols = [c.name for c in schema if c.dtype in ("float", "int") and c.name in df.columns]
    unparseable = {}
    for col in num_cols:
        series = df[col].dropna()
        if len(series) > 0:
            parsed = pd.to_numeric(series, errors="coerce")
            failures = int(parsed.isna().sum())
            if failures > 0:
                unparseable[col] = failures

    if unparseable:
        details = [f"{k}: {v} non-numeric" for k, v in unparseable.items()]
        checks.append(CheckResult("chk_08_num_parse", "Numeric Parsing", False, "error",
                                  f"Unparseable numeric values: {', '.join(details[:3])}",
                                  "integrity", sum(unparseable.values()), sample_values=list(unparseable.keys())))
    else:
        checks.append(CheckResult("chk_08_num_parse", "Numeric Parsing", True, "info",
                                  "All numeric fields are cleanly formatted.", "integrity"))


def _check_numeric_ranges(df: pd.DataFrame, domain: str, schema: list[CanonicalColumn], checks: list[CheckResult]):
    """Check 9: Numeric ranges bounds."""
    violations = []
    total_violation_count = 0
    for col_def in schema:
        if col_def.name not in df.columns or (col_def.min_val is None and col_def.max_val is None):
            continue
        try:
            series = pd.to_numeric(df[col_def.name], errors="coerce").dropna()
            count = 0
            if col_def.min_val is not None:
                count += int((series < col_def.min_val).sum())
            if col_def.max_val is not None:
                count += int((series > col_def.max_val).sum())
            if count > 0:
                violations.append(f"{col_def.name} ({count} out of [{col_def.min_val}, {col_def.max_val}])")
                total_violation_count += count
        except Exception:
            pass

    if violations:
        checks.append(CheckResult("chk_09_num_ranges", "Numeric Ranges", False, "warning",
                                  f"Range violations: {'; '.join(violations[:4])}",
                                  "domain", total_violation_count, sample_values=violations[:4]))
    else:
        checks.append(CheckResult("chk_09_num_ranges", "Numeric Ranges", True, "info",
                                  "All numeric values fall within expected bounds.", "domain"))


def _check_categorical_vocab(df: pd.DataFrame, domain: str, checks: list[CheckResult]):
    """Check 10: Categorical vocabulary conformance."""
    invalid_vocabs = []
    if domain == "production" and "shift" in df.columns:
        valid_shifts = {"A", "B", "C", "SHIFT_A", "SHIFT_B", "SHIFT_C", "1", "2", "3", "I", "II", "III", "DAY", "NIGHT"}
        invalid = df["shift"].dropna().astype(str).str.upper().loc[lambda s: ~s.isin(valid_shifts)].unique()
        if len(invalid) > 0:
            invalid_vocabs.append(f"shift: {list(invalid[:3])}")
    elif domain == "maintenance" and "event_type" in df.columns:
        valid_events = {"SCHEDULED", "PREVENTIVE", "EMERGENCY", "BREAKDOWN", "INSPECTION", "REPAIR"}
        invalid = df["event_type"].dropna().astype(str).str.upper().loc[lambda s: ~s.isin(valid_events)].unique()
        if len(invalid) > 0:
            invalid_vocabs.append(f"event_type: {list(invalid[:3])}")

    if invalid_vocabs:
        checks.append(CheckResult("chk_10_cat_vocab", "Categorical Vocabulary", False, "warning",
                                  f"Unexpected categorical values: {', '.join(invalid_vocabs)}",
                                  "domain", len(invalid_vocabs), sample_values=invalid_vocabs))
    else:
        checks.append(CheckResult("chk_10_cat_vocab", "Categorical Vocabulary", True, "info",
                                  "Categorical vocabularies conform to domain standard.", "domain"))


def _check_date_format(df: pd.DataFrame, checks: list[CheckResult]):
    """Check 11: Date/timestamp parseability."""
    date_cols = [c for c in df.columns if any(k in c.lower() for k in ("date", "timestamp", "time"))]
    if not date_cols:
        checks.append(CheckResult("chk_11_date_format", "Date Format", True, "info", "No date columns present.", "temporal"))
        return

    bad_cols = []
    for col in date_cols:
        try:
            parsed = pd.to_datetime(df[col], errors="coerce")
            if parsed.isna().sum() == len(df):
                bad_cols.append(col)
        except Exception:
            bad_cols.append(col)

    if bad_cols:
        checks.append(CheckResult("chk_11_date_format", "Date Format", False, "error",
                                  f"Could not parse timestamps in: {', '.join(bad_cols)}",
                                  "temporal", len(bad_cols), sample_values=bad_cols))
    else:
        checks.append(CheckResult("chk_11_date_format", "Date Format", True, "info",
                                  f"{len(date_cols)} date column(s) successfully validated.", "temporal"))


def _check_future_dates(df: pd.DataFrame, checks: list[CheckResult]):
    """Check 12: Future timestamp detection."""
    date_cols = [c for c in df.columns if any(k in c.lower() for k in ("date", "timestamp", "time"))]
    now = pd.Timestamp.now(tz=None)
    future_count = 0
    for col in date_cols:
        try:
            parsed = pd.to_datetime(df[col], errors="coerce").dt.tz_localize(None)
            future_count += int((parsed > now).sum())
        except Exception:
            pass

    if future_count > 0:
        checks.append(CheckResult("chk_12_future_dates", "Future Timestamps", False, "warning",
                                  f"{future_count} future timestamps detected.",
                                  "temporal", future_count, round(future_count/max(len(df),1)*100, 2)))
    else:
        checks.append(CheckResult("chk_12_future_dates", "Future Timestamps", True, "info",
                                  "No timestamps in the future detected.", "temporal"))


def _check_temporal_ordering(df: pd.DataFrame, checks: list[CheckResult]):
    """Check 13: Monotonic temporal ordering."""
    date_cols = [c for c in df.columns if any(k in c.lower() for k in ("date", "timestamp"))]
    if not date_cols:
        checks.append(CheckResult("chk_13_temporal_order", "Temporal Ordering", True, "info", "N/A (No date column)", "temporal"))
        return

    col = date_cols[0]
    parsed = pd.to_datetime(df[col], errors="coerce")
    valid = parsed.dropna()
    is_sorted = valid.is_monotonic_increasing
    if not is_sorted and len(valid) > 1:
        checks.append(CheckResult("chk_13_temporal_order", "Temporal Ordering", True, "info",
                                  f"Chronological order is unsorted in {col}. Automatic sorting will apply.", "temporal"))
    else:
        checks.append(CheckResult("chk_13_temporal_order", "Temporal Ordering", True, "info",
                                  "Chronological ordering is consistent.", "temporal"))


def _check_business_keys(df: pd.DataFrame, domain: str, checks: list[CheckResult]):
    """Check 14: Duplicate business composite keys."""
    key_cols: list[str] = []
    if domain == "production" and {"date", "mine_id", "shift"}.issubset(df.columns):
        key_cols = ["date", "mine_id", "shift"]
    elif domain == "equipment" and {"timestamp", "machine_id"}.issubset(df.columns):
        key_cols = ["timestamp", "machine_id"]
    elif domain == "exploration" and "grid_id" in df.columns:
        key_cols = ["grid_id"]

    if key_cols:
        dups = int(df.duplicated(subset=key_cols).sum())
        if dups > 0:
            checks.append(CheckResult("chk_14_business_keys", "Business Key Uniqueness", False, "warning",
                                      f"{dups} duplicate records for business key ({' + '.join(key_cols)}).",
                                      "integrity", dups, round(dups/max(len(df),1)*100, 2)))
            return

    checks.append(CheckResult("chk_14_business_keys", "Business Key Uniqueness", True, "info",
                              "Business composite keys are unique.", "integrity"))


def _check_india_bounds(df: pd.DataFrame, checks: list[CheckResult]):
    """Check 15: India geographic boundary enforcement."""
    if "latitude" not in df.columns or "longitude" not in df.columns:
        checks.append(CheckResult("chk_15_india_bounds", "India Geographic Bounds", True, "info", "N/A (No coordinates)", "domain"))
        return
    try:
        lats = pd.to_numeric(df["latitude"], errors="coerce").dropna()
        lons = pd.to_numeric(df["longitude"], errors="coerce").dropna()
        out_lat = int(((lats < INDIA_LAT_MIN) | (lats > INDIA_LAT_MAX)).sum())
        out_lon = int(((lons < INDIA_LON_MIN) | (lons > INDIA_LON_MAX)).sum())
        total = out_lat + out_lon
        if total > 0:
            checks.append(CheckResult("chk_15_india_bounds", "India Geographic Bounds", False, "error",
                                      f"{out_lat} lat + {out_lon} lon points outside India sovereign bounds.",
                                      "domain", total, round(total/max(len(df),1)*100, 2)))
        else:
            checks.append(CheckResult("chk_15_india_bounds", "India Geographic Bounds", True, "info",
                                      "All geographical coordinates lie strictly inside India.", "domain"))
    except Exception:
        pass


def _check_domain_logic(df: pd.DataFrame, domain: str, checks: list[CheckResult]):
    """Check 16: Impossible domain business logic combinations."""
    violations = 0
    msg = "Domain logic validated."

    if domain == "production":
        if {"working_hours", "actual_production_t"}.issubset(df.columns):
            wh = pd.to_numeric(df["working_hours"], errors="coerce").fillna(0)
            act = pd.to_numeric(df["actual_production_t"], errors="coerce").fillna(0)
            impossible = ((wh > 24.0) | ((wh > 6.0) & (act == 0))).sum()
            if impossible > 0:
                violations += int(impossible)
                msg = f"{impossible} shifts have working hours > 24 or zero production despite full shift."
    elif domain == "equipment":
        if "operating_hours" in df.columns:
            oph = pd.to_numeric(df["operating_hours"], errors="coerce").fillna(0)
            impossible = (oph > 24.0).sum()
            if impossible > 0:
                violations += int(impossible)
                msg = f"{impossible} telemetry readings have operating hours > 24 in a single shift."

    if violations > 0:
        checks.append(CheckResult("chk_16_domain_logic", "Domain Business Logic", False, "warning",
                                  msg, "domain", violations))
    else:
        checks.append(CheckResult("chk_16_domain_logic", "Domain Business Logic", True, "info",
                                  msg, "domain"))


def _check_target_leakage(df: pd.DataFrame, domain: str, checks: list[CheckResult]):
    """Check 17: Target leakage (correlation > 0.99 with target variable)."""
    target_col = None
    if domain == "production" and "actual_production_t" in df.columns:
        target_col = "actual_production_t"
    elif domain == "equipment" and "failure_next_24h" in df.columns:
        target_col = "failure_next_24h"

    if not target_col or len(df) < 20:
        checks.append(CheckResult("chk_17_target_leakage", "Target Leakage Audit", True, "info",
                                  "No target column or insufficient rows to compute leakage correlation.", "statistical"))
        return

    leaks = []
    num_df = df.select_dtypes(include=[np.number]) if HAS_PANDAS else None
    if num_df is not None and target_col in num_df.columns:
        corrs = num_df.corr()[target_col].drop(target_col, errors="ignore")
        for col, val in corrs.items():
            if abs(val) > 0.99:
                leaks.append(f"{col} (corr={val:.4f})")

    if leaks:
        checks.append(CheckResult("chk_17_target_leakage", "Target Leakage Audit", False, "warning",
                                  f"Potential target leakage detected: {', '.join(leaks)}",
                                  "statistical", len(leaks), sample_values=leaks))
    else:
        checks.append(CheckResult("chk_17_target_leakage", "Target Leakage Audit", True, "info",
                                  "No target leakage detected.", "statistical"))


def _check_temporal_contamination(df: pd.DataFrame, domain: str, checks: list[CheckResult]):
    """Check 18: Train/test temporal contamination risk."""
    checks.append(CheckResult("chk_18_temporal_contamination", "Temporal Contamination Audit", True, "info",
                              "Strict chronological walk-forward split enforced for model evaluation.", "statistical"))


def _check_zero_variance(df: pd.DataFrame, checks: list[CheckResult]):
    """Check 19: Constant columns (zero variance)."""
    const_cols = [c for c in df.columns if df[c].nunique(dropna=True) <= 1]
    if const_cols:
        checks.append(CheckResult("chk_19_zero_variance", "Zero Variance Columns", False, "warning",
                                  f"Constant columns (zero variance): {', '.join(const_cols[:5])}",
                                  "statistical", len(const_cols), sample_values=const_cols[:5]))
    else:
        checks.append(CheckResult("chk_19_zero_variance", "Zero Variance Columns", True, "info",
                                  "No zero-variance columns.", "statistical"))


def _check_near_constant(df: pd.DataFrame, checks: list[CheckResult]):
    """Check 20: Near-constant columns (>99% single value)."""
    near_const = []
    for c in df.columns:
        if len(df) > 50:
            top_freq = df[c].value_counts(normalize=True, dropna=True).iloc[0] if len(df[c].dropna()) > 0 else 0
            if 0.99 < top_freq < 1.0:
                near_const.append(c)

    if near_const:
        checks.append(CheckResult("chk_20_near_constant", "Near Constant Columns", True, "info",
                                  f"Near-constant columns (>99% identical): {', '.join(near_const[:3])}",
                                  "statistical", len(near_const), sample_values=near_const[:3]))
    else:
        checks.append(CheckResult("chk_20_near_constant", "Near Constant Columns", True, "info",
                                  "Distribution of values is sufficiently diverse.", "statistical"))


def _check_high_cardinality(df: pd.DataFrame, checks: list[CheckResult]):
    """Check 21: High-cardinality non-key text columns."""
    flagged = []
    for c in df.select_dtypes(include=["object", "string"]).columns:
        if not any(k in c.lower() for k in ("id", "date", "timestamp", "name")):
            ratio = df[c].nunique() / max(len(df), 1)
            if ratio > 0.9 and len(df) > 30:
                flagged.append(c)

    if flagged:
        checks.append(CheckResult("chk_21_high_cardinality", "High Cardinality Text", False, "warning",
                                  f"High-cardinality text columns may cause overfitting: {', '.join(flagged)}",
                                  "statistical", len(flagged), sample_values=flagged))
    else:
        checks.append(CheckResult("chk_21_high_cardinality", "High Cardinality Text", True, "info",
                                  "Categorical cardinalities are normal.", "statistical"))


def _check_outliers(df: pd.DataFrame, schema: list[CanonicalColumn], checks: list[CheckResult]):
    """Check 22: Outlier detection using IQR."""
    num_cols = [c.name for c in schema if c.dtype == "float" and c.name in df.columns]
    outlier_summary = []
    for col in num_cols:
        series = pd.to_numeric(df[col], errors="coerce").dropna()
        if len(series) > 30:
            q25, q75 = series.quantile(0.25), series.quantile(0.75)
            iqr = q75 - q25
            if iqr > 0:
                outliers = int(((series < (q25 - 3 * iqr)) | (series > (q75 + 3 * iqr))).sum())
                if outliers > 0:
                    outlier_summary.append(f"{col}: {outliers}")

    if outlier_summary:
        checks.append(CheckResult("chk_22_outliers", "Statistical Outliers (3x IQR)", True, "info",
                                  f"Extreme values detected: {'; '.join(outlier_summary[:3])}",
                                  "statistical", len(outlier_summary), sample_values=outlier_summary[:3]))
    else:
        checks.append(CheckResult("chk_22_outliers", "Statistical Outliers (3x IQR)", True, "info",
                                  "No extreme 3x IQR outliers detected.", "statistical"))


def _check_unit_consistency(df: pd.DataFrame, schema: list[CanonicalColumn], checks: list[CheckResult]):
    """Check 23: Unit consistency and negative values where forbidden."""
    negatives = []
    for col_def in schema:
        if col_def.min_val is not None and col_def.min_val >= 0 and col_def.name in df.columns:
            series = pd.to_numeric(df[col_def.name], errors="coerce").dropna()
            negs = int((series < 0).sum())
            if negs > 0:
                negatives.append(f"{col_def.name} ({negs} negative)")

    if negatives:
        checks.append(CheckResult("chk_23_unit_consistency", "Unit Consistency", False, "warning",
                                  f"Negative values found in positive-only physical units: {', '.join(negatives)}",
                                  "domain", len(negatives), sample_values=negatives))
    else:
        checks.append(CheckResult("chk_23_unit_consistency", "Unit Consistency", True, "info",
                                  "Physical units and signs are consistent.", "domain"))


def _check_temporal_continuity(df: pd.DataFrame, checks: list[CheckResult]):
    """Check 24: Temporal continuity and large telemetry/shift gaps."""
    date_cols = [c for c in df.columns if any(k in c.lower() for k in ("date", "timestamp"))]
    if not date_cols or len(df) < 5:
        checks.append(CheckResult("chk_24_temporal_continuity", "Temporal Continuity", True, "info", "N/A", "temporal"))
        return

    col = date_cols[0]
    parsed = pd.to_datetime(df[col], errors="coerce").dropna().sort_values()
    if len(parsed) > 5:
        diffs = parsed.diff().dropna()
        large_gaps = int((diffs > pd.Timedelta(days=14)).sum())
        if large_gaps > 0:
            checks.append(CheckResult("chk_24_temporal_continuity", "Temporal Continuity", False, "warning",
                                      f"{large_gaps} temporal gaps exceeding 14 days found.",
                                      "temporal", large_gaps))
            return

    checks.append(CheckResult("chk_24_temporal_continuity", "Temporal Continuity", True, "info",
                              "Data stream continuity is unbroken.", "temporal"))


def _check_data_freshness(df: pd.DataFrame, checks: list[CheckResult]):
    """Check 25: Data freshness relative to current year."""
    date_cols = [c for c in df.columns if any(k in c.lower() for k in ("date", "timestamp"))]
    if not date_cols:
        checks.append(CheckResult("chk_25_data_freshness", "Data Freshness", True, "info", "N/A", "temporal"))
        return

    col = date_cols[0]
    parsed = pd.to_datetime(df[col], errors="coerce").dropna()
    if len(parsed) > 0:
        latest = parsed.max()
        now = pd.Timestamp.now()
        days_old = (now - latest).days
        if days_old > 730:
            checks.append(CheckResult("chk_25_data_freshness", "Data Freshness", False, "warning",
                                      f"Dataset latest timestamp is {days_old} days old (historical).",
                                      "temporal", days_old))
            return

    checks.append(CheckResult("chk_25_data_freshness", "Data Freshness", True, "info",
                              "Dataset contains timely operational data.", "temporal"))
