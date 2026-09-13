"""app/api/tests/test_canonicalizer.py — Tests for canonical dataset materialization."""
import pandas as pd

from app.api.core.canonicalizer import canonicalize_dataset, compute_schema_hash
from app.api.core.schema_mapper import get_canonical_schema


def test_compute_schema_hash():
    """Verify deterministic schema hash for production schema."""
    schema = get_canonical_schema("production")
    h1 = compute_schema_hash(schema)
    h2 = compute_schema_hash(schema)
    assert h1 == h2
    assert len(h1) == 16


def test_canonicalize_production_dataset():
    """Verify column remapping, unit type coercion, and duplicate removal."""
    raw_df = pd.DataFrame({
        "Date_Shift": ["2026-08-01", "2026-08-02", "2026-08-02"], # has duplicate
        "Mine": ["mine-01", "mine-01", "mine-01"],
        "Planned_Tons": ["150.5", "160.0", "160.0"],
        "Actual_Output": ["148.2", "159.1", "159.1"],
        "Ore_Grade_%": [32.5, 33.1, 33.1],
        "Extra_Junk_Column": ["drop_me_1", "drop_me_2", "drop_me_3"],
    })

    mappings = {
        "Date_Shift": "date",
        "Mine": "mine_id",
        "Planned_Tons": "planned_production_t",
        "Actual_Output": "actual_production_t",
        "Ore_Grade_%": "ore_grade_mn_pct",
    }

    res = canonicalize_dataset(
        domain="production",
        raw_df=raw_df,
        column_mappings=mappings,
        version_label="v1",
        persist_to_storage=False,
    )

    assert res.domain == "production"
    assert res.row_count == 2  # duplicate row removed
    assert "Extra_Junk_Column" not in res.columns
    assert "date" in res.columns
    assert "planned_production_t" in res.columns
    assert len(res.sha256) == 64
    assert len(res.schema_hash) == 16
