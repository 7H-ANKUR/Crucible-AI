"""apps/api/tests/test_data_hub.py — Schema mapping and data validation tests."""
import pandas as pd

from apps.api.core.data_validator import validate_dataset
from apps.api.core.schema_mapper import list_domains, map_columns


def test_supported_domains():
    """Verify supported canonical domains."""
    domains = list_domains()
    assert "production" in domains
    assert "equipment" in domains
    assert "exploration" in domains
    assert "maintenance" in domains


def test_schema_mapping_exact_and_fuzzy():
    """Verify exact and normalized column matching."""
    uploaded_cols = ["date", "planned_tonnes", "actual_tons", "shift_code", "mine"]
    mappings = map_columns("production", uploaded_cols)
    assert len(mappings) == len(uploaded_cols)

    mapping_dict = {m.source_column: m.canonical_column for m in mappings}
    assert mapping_dict.get("date") == "date"
    assert mapping_dict.get("planned_tonnes") == "planned_production_t"
    assert mapping_dict.get("actual_tons") == "actual_production_t"


def test_data_validator_clean_df():
    """Verify validator on a compliant DataFrame with at least 10 rows and required columns."""
    df = pd.DataFrame({
        "date": [f"2026-08-{i:02d}" for i in range(1, 15)],
        "mine_id": ["mine-01"] * 14,
        "planned_production_t": [150.0 + i for i in range(14)],
        "actual_production_t": [148.0 + i for i in range(14)],
        "ore_grade_mn_pct": [32.5] * 14,
        "working_hours": [8.0] * 14,
    })
    csv_bytes = df.to_csv(index=False).encode("utf-8")
    report = validate_dataset("production", csv_bytes, "test_prod.csv")
    assert report.row_count == 14
    assert report.quality_score >= 80.0
    assert report.passed is True
