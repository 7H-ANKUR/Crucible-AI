"""apps/api/core/schema_mapper.py — Canonical schema definitions and auto-column mapping.

Each domain has a canonical schema (the exact columns the ML models expect).
When a user uploads a CSV/XLSX, this module tries to map their column names
to the canonical names using exact match → normalized match → fuzzy similarity.
Columns with confidence < 0.7 are flagged as requires_review=True.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from difflib import SequenceMatcher

# ---------------------------------------------------------------------------
# Canonical column definitions per domain
# ---------------------------------------------------------------------------

@dataclass
class CanonicalColumn:
    name: str           # canonical DB column name
    dtype: str          # 'float' | 'int' | 'str' | 'date'
    required: bool
    description: str
    unit: str | None = None
    min_val: float | None = None
    max_val: float | None = None
    allowed_values: list[str] = field(default_factory=list)


CANONICAL_SCHEMAS: dict[str, list[CanonicalColumn]] = {

    "production": [
        CanonicalColumn("date",                  "date",  True,  "Shift/day date"),
        CanonicalColumn("mine_id",               "str",   True,  "Mine identifier"),
        CanonicalColumn("zone_id",               "str",   False, "Zone within the mine"),
        CanonicalColumn("shift",                 "str",   False, "Shift name (A/B/C)"),
        CanonicalColumn("planned_production_t",  "float", True,  "Planned output in tonnes",  "tonnes", 0, 10000),
        CanonicalColumn("actual_production_t",   "float", True,  "Actual output in tonnes",   "tonnes", 0, 10000),
        CanonicalColumn("ore_grade_mn_pct",      "float", False, "Manganese ore grade",       "%", 0, 100),
        CanonicalColumn("working_hours",         "float", False, "Working hours in the shift","hr", 0, 24),
        CanonicalColumn("shortfall_flag",        "int",   False, "1 if shortfall occurred",   None, 0, 1),
    ],

    "equipment": [
        CanonicalColumn("timestamp",                  "date",  True,  "Reading timestamp"),
        CanonicalColumn("machine_id",                 "str",   True,  "Machine identifier"),
        CanonicalColumn("mine_id",                    "str",   True,  "Mine identifier"),
        CanonicalColumn("equipment_type",             "str",   False, "Type of equipment"),
        CanonicalColumn("machine_age_years",          "float", False, "Age of the machine",            "yr", 0, 50),
        CanonicalColumn("vibration_rms",              "float", False, "Vibration RMS",                  None, 0, 50),
        CanonicalColumn("engine_temperature_c",       "float", False, "Engine temperature",             "°C", -20, 200),
        CanonicalColumn("hydraulic_pressure_bar",     "float", False, "Hydraulic pressure",             "bar", 0, 500),
        CanonicalColumn("fuel_consumption_lph",       "float", False, "Fuel consumption",               "L/h", 0, 200),
        CanonicalColumn("operating_hours",            "float", False, "Operating hours this shift",     "hr", 0, 24),
        CanonicalColumn("maintenance_overdue_days",   "float", False, "Days past last maintenance",     "days", 0, 365),
        CanonicalColumn("failure_count_30d",          "int",   False, "Failures in last 30 days"),
        CanonicalColumn("failure_next_24h",           "int",   False, "Label: failure in next 24h",     None, 0, 1),
    ],

    "exploration": [
        CanonicalColumn("grid_id",              "str",   True,  "Grid cell identifier"),
        CanonicalColumn("latitude",             "float", True,  "Latitude (India bounds)",    "°", 6.0, 37.5),
        CanonicalColumn("longitude",            "float", True,  "Longitude (India bounds)",   "°", 68.0, 98.0),
        CanonicalColumn("belt",                 "str",   False, "Geological belt"),
        CanonicalColumn("ndvi",                 "float", False, "NDVI index",                 None, -1, 1),
        CanonicalColumn("ndmi",                 "float", False, "NDMI index",                 None, -1, 1),
        CanonicalColumn("elevation_m",          "float", False, "Elevation",                  "m", -500, 9000),
        CanonicalColumn("slope_deg",            "float", False, "Slope",                      "°", 0, 90),
        CanonicalColumn("mn_geochemistry",      "float", False, "Mn geochemistry signal",     None),
        CanonicalColumn("lithology_code",       "str",   False, "Rock type code"),
        CanonicalColumn("prospectivity_label",  "int",   False, "Ground truth label",         None, 0, 1),
    ],

    "maintenance": [
        CanonicalColumn("event_date",      "date",  True,  "Maintenance event date"),
        CanonicalColumn("machine_id",      "str",   True,  "Machine identifier"),
        CanonicalColumn("mine_id",         "str",   True,  "Mine identifier"),
        CanonicalColumn("event_type",      "str",   True,  "Scheduled | Emergency | Inspection"),
        CanonicalColumn("duration_hours",  "float", False, "Duration of maintenance",  "hr", 0, 720),
        CanonicalColumn("cost_inr",        "float", False, "Cost in INR",              "INR", 0),
        CanonicalColumn("technician_id",   "str",   False, "Technician ID"),
        CanonicalColumn("parts_replaced",  "str",   False, "CSV list of replaced parts"),
        CanonicalColumn("notes",           "str",   False, "Free-text notes"),
    ],
}

# ---------------------------------------------------------------------------
# Column name normalizer
# ---------------------------------------------------------------------------

def _normalize(s: str) -> str:
    """Lowercase, strip punctuation/units, collapse whitespace."""
    s = s.lower().strip()
    s = re.sub(r"[\(\)°%/]", " ", s)  # strip common unit chars
    s = re.sub(r"[^a-z0-9]+", "_", s)  # non-alphanum → underscore
    s = re.sub(r"_+", "_", s).strip("_")
    return s


def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


# ---------------------------------------------------------------------------
# Mapping output
# ---------------------------------------------------------------------------

@dataclass
class ColumnMapping:
    source_column: str
    canonical_column: str | None
    confidence: float       # 0.0 – 1.0
    requires_review: bool
    reason: str             # 'exact' | 'normalized' | 'fuzzy' | 'unmatched'


COMMON_ALIASES: dict[str, str] = {
    "planned_tonnes": "planned_production_t",
    "planned_tons": "planned_production_t",
    "planned_prod": "planned_production_t",
    "target_production": "planned_production_t",
    "target_prod": "planned_production_t",
    "actual_tonnes": "actual_production_t",
    "actual_tons": "actual_production_t",
    "actual_prod": "actual_production_t",
    "ore_grade": "ore_grade_mn_pct",
    "mn_grade": "ore_grade_mn_pct",
    "grade": "ore_grade_mn_pct",
    "shift_code": "shift",
    "mine": "mine_id",
}


def map_columns(domain: str, source_columns: list[str]) -> list[ColumnMapping]:
    """
    Map a list of source column names to the canonical schema for the given domain.

    Returns a ColumnMapping for each source column.
    Unrecognised columns get canonical_column=None, confidence=0.0, requires_review=True.
    """
    schema = CANONICAL_SCHEMAS.get(domain, [])
    canonical_names = [col.name for col in schema]
    canonical_normalized = {_normalize(n): n for n in canonical_names}

    results: list[ColumnMapping] = []
    for src in source_columns:
        src_norm = _normalize(src)

        # 1. Exact match
        if src in canonical_names:
            results.append(ColumnMapping(src, src, 1.0, False, "exact"))
            continue

        # 2. Normalized exact
        if src_norm in canonical_normalized:
            canonical = canonical_normalized[src_norm]
            results.append(ColumnMapping(src, canonical, 0.95, False, "normalized"))
            continue

        # 3. Domain synonym / alias match
        if src_norm in COMMON_ALIASES and COMMON_ALIASES[src_norm] in canonical_names:
            canonical = COMMON_ALIASES[src_norm]
            results.append(ColumnMapping(src, canonical, 0.90, False, "alias"))
            continue

        # 3. Fuzzy best-match
        best_score = 0.0
        best_match = None
        for norm, canonical in canonical_normalized.items():
            score = _similarity(src_norm, norm)
            if score > best_score:
                best_score = score
                best_match = canonical

        if best_score >= 0.7:
            results.append(ColumnMapping(
                src, best_match, round(best_score, 3),
                best_score < 0.85,
                "fuzzy"
            ))
        else:
            results.append(ColumnMapping(src, None, round(best_score, 3), True, "unmatched"))

    return results


def get_canonical_schema(domain: str) -> list[CanonicalColumn]:
    """Return the canonical column list for a domain."""
    return CANONICAL_SCHEMAS.get(domain, [])


def list_domains() -> list[str]:
    return list(CANONICAL_SCHEMAS.keys())
