"""scripts/migrate_perf_indexes.py — Database performance optimization indexes.

Adds targeted composite indexes to eliminate sequential scans on slow queries:
1. ops.equipment_telemetry (mine_id, machine_id, datetime DESC) -> accelerates DISTINCT ON query
2. geo.prospectivity_grid (prospectivity_label, mn_geochemistry DESC NULLS LAST) -> accelerates target ranking
3. ops.production_records (mine_id, date DESC) -> accelerates latest production row lookups
"""
import pathlib
import sys

# Ensure repo root is on sys.path
root = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root))

from app.api.core.db import execute


def run_migrations():
    print("Running performance index migrations on Aiven PostgreSQL...")
    indexes = [
        (
            "idx_equip_mine_machine_dt",
            "CREATE INDEX IF NOT EXISTS idx_equip_mine_machine_dt ON ops.equipment_telemetry (mine_id, machine_id, datetime DESC);"
        ),
        (
            "idx_prosp_label_geochem",
            "CREATE INDEX IF NOT EXISTS idx_prosp_label_geochem ON geo.prospectivity_grid (prospectivity_label, mn_geochemistry DESC NULLS LAST);"
        ),
        (
            "idx_prod_mine_date_desc",
            "CREATE INDEX IF NOT EXISTS idx_prod_mine_date_desc ON ops.production_records (mine_id, date DESC);"
        ),
    ]

    for name, sql in indexes:
        try:
            print(f"Creating index: {name} ...")
            execute(sql)
            print(f"  [OK] {name} created successfully.")
        except Exception as e:
            print(f"  [FAIL] {name} failed or skipped: {e}")

    print("Index migration complete.")

if __name__ == "__main__":
    run_migrations()
