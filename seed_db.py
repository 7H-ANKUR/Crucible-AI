"""seed_db.py — Seed Aiven PostgreSQL with synthetic CSV data.

- geo.prospectivity_grid  : full prospectivity training grid
- ops.production_records  : sampled production history
- ops.equipment_telemetry : latest 30 shifts per machine with ALL ML feature
                            columns (so inference uses real values)
- gov.alerts              : seeded operational alerts for the alerts screen
"""
import os
import pathlib

import pandas as pd
import psycopg2
from dotenv import load_dotenv
from psycopg2.extras import execute_values

load_dotenv()
DATABASE_URL = os.environ["DATABASE_URL"]
DATA_DIR = pathlib.Path(r"docs\SIH26009_DATA\synthetic")

EQUIP_FEATURE_COLS = [
    "machine_age_years", "shift_number", "vibration_rms", "engine_temperature_c",
    "hydraulic_pressure_bar", "fuel_consumption_lph", "payload_tons",
    "operating_hours", "idle_hours", "load_cycle_count", "speed_kmh",
    "odometer_km", "coolant_temperature_c", "oil_pressure_bar",
    "battery_voltage_v", "ambient_temperature_c", "humidity_pct", "altitude_m",
    "maintenance_overdue_days", "maintenance_days_since", "failure_count_7d",
    "failure_count_30d", "failure_count_90d", "downtime_hours_7d",
    "downtime_hours_past_24h", "total_operating_hours", "utilization_pct",
    "ground_condition_score", "operator_experience_years", "production_tons",
]

def get_conn():
    return psycopg2.connect(DATABASE_URL)

def seed_prospectivity():
    print("\n--- Seeding geo.prospectivity_grid (full feature set) ---")
    df = pd.read_csv(DATA_DIR / "scenarios" / "17_manganese_prospectivity_training.csv")
    print(f"  Loaded {len(df)} rows")

    # All numeric training features go into the grid table (mixed-case names
    # are quoted to preserve them exactly — the model expects these names).
    feature_cols = [c for c in df.select_dtypes(include="number").columns
                    if c not in ("prospectivity_label", "latitude", "longitude")]
    target_cols = ["grid_id", "latitude", "longitude", "belt",
                   "mn_geochemistry", "lithology_code", "prospectivity_label", "data_origin"]

    with get_conn() as conn, conn.cursor() as cur:
        # Map each CSV feature to the table's actual column (Postgres
        # folded the early schema to lowercase; newer columns are exact).
        cur.execute(
            """SELECT column_name FROM information_schema.columns
                   WHERE table_schema='geo' AND table_name='prospectivity_grid'"""
        )
        db_cols = {r[0] for r in cur.fetchall()}
        by_lower = {}
        for c in db_cols:
            by_lower.setdefault(c.lower(), c)

        cur.execute("TRUNCATE geo.prospectivity_grid")
        resolved = []
        for c in feature_cols:
            db_col = c if c in db_cols else by_lower.get(c.lower())
            if db_col:
                resolved.append((c, db_col))
        cols_sql = ", ".join(target_cols + [f'"{db}"' for _, db in resolved])
        placeholders = ", ".join(["%s"] * (len(target_cols) + len(resolved)))
        rows = []
        for _, r in df.iterrows():
            row = [
                str(r["grid_id"]),
                float(r["latitude"]),
                float(r["longitude"]),
                str(r.get("belt") or "MH-NAGPUR"),
                float(r.get("litho_gondite_prob", 0) or 0),   # geochem proxy
                str(r.get("negative_sampling_method", "UNKNOWN") or "UNKNOWN"),
                int(r.get("prospectivity_label", 0) or 0),
                "SYNTHETIC",
            ]
            for src, _db in resolved:
                v = r.get(src)
                row.append(None if pd.isna(v) else float(v))
            rows.append(tuple(row))
        execute_values(cur,
            f"""INSERT INTO geo.prospectivity_grid ({cols_sql})
                    VALUES %s
                    ON CONFLICT (grid_id) DO NOTHING""",
            rows, page_size=1000
        )
        conn.commit()
    print(f"  Inserted {len(rows)} rows with {len(resolved)} feature columns")


def seed_production():
    print("\n--- Seeding ops.production_records (full feature set) ---")
    df = pd.read_csv(DATA_DIR / "production_operations" / "09_synthetic_mine_operations.csv")
    df = df.sample(min(5000, len(df)), random_state=42)
    print(f"  Loaded {len(df)} rows (sampled); mines: {df['mine_id'].unique()[:5]}")

    base_cols = {"planned_production_t", "actual_production_t", "shift",
                 "shortfall_flag", "shortfall_pct", "production_shortfall_t",
                 "production_shortfall_pct"}
    numeric_cols = [c for c in df.select_dtypes(include="number").columns
                    if c not in base_cols]

    with get_conn() as conn:
        with conn.cursor() as cur:
            # Sync table columns with the CSV feature set
            cur.execute(
                """SELECT column_name FROM information_schema.columns
                   WHERE table_schema='ops' AND table_name='production_records'"""
            )
            existing = {r[0].lower() for r in cur.fetchall()}
            for c in numeric_cols:
                if c.lower() not in existing:
                    cur.execute(f'ALTER TABLE ops.production_records ADD COLUMN "{c}" DOUBLE PRECISION')
                    existing.add(c.lower())

            cur.execute("TRUNCATE ops.production_records")
            cols_sql = ", ".join(["mine_id", "zone_id", "date", "shift",
                                  "planned_production_t", "actual_production_t",
                                  "shortfall_flag", "data_origin"]
                                 + [f'"{c}"' for c in numeric_cols])
            rows = []
            for _, r in df.iterrows():
                row = [
                    str(r.get("mine_id", "MINE-A") or "MINE-A"),
                    str(r.get("zone_id", "Z1") or "Z1"),
                    str(r.get("date", "2024-01-01"))[:10],
                    str(r.get("shift", "S1") or "S1"),
                    round(float(r.get("planned_production_t", 183) or 183), 1),
                    round(float(r.get("actual_production_t", 170) or 170), 1),
                    int(bool(r.get("shortfall_flag", False))),
                    "SYNTHETIC",
                ]
                for c in numeric_cols:
                    v = r.get(c)
                    row.append(None if pd.isna(v) else float(v))
                rows.append(tuple(row))
            execute_values(cur,
                f"""INSERT INTO ops.production_records ({cols_sql})
                    VALUES %s""",
                rows, page_size=500
            )
            conn.commit()
    print(f"  Inserted {len(rows)} rows with {len(numeric_cols)} feature columns")


def seed_equipment():
    """Latest 30 shifts per machine with every ML feature column."""
    print("\n--- Seeding ops.equipment_telemetry (latest 30 shifts/machine, full features) ---")
    keep = ["timestamp", "datetime", "machine_id", "mine_id", "equipment_type",
            "failure_next_24h"] + EQUIP_FEATURE_COLS
    df = pd.read_csv(DATA_DIR / "equipment" / "10_synthetic_equipment_telemetry.csv",
                     low_memory=False)
    print(f"  Loaded {len(df):,} rows")
    df["datetime"] = pd.to_datetime(df["datetime"], errors="coerce")
    df = df.sort_values(["machine_id", "datetime"])
    df = df.groupby("machine_id", as_index=False).tail(30)
    df = df.sample(frac=1.0, random_state=42)  # shuffle for fast parallel inserts
    print(f"  Kept latest 30 shifts/machine -> {len(df):,} rows")

    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("TRUNCATE ops.equipment_telemetry")
        cols_sql = ", ".join(keep)
        placeholders = ", ".join(["%s"] * len(keep))
        rows = []
        for _, r in df.iterrows():
            dt = r.get("datetime")
            row = []
            for c in keep:
                if c == "datetime":
                    val = None if pd.isna(dt) else dt.to_pydatetime()
                elif c == "failure_next_24h":
                    val = int(bool(r.get(c, 0) or 0))
                elif c in ("timestamp", "machine_id", "mine_id", "equipment_type"):
                    val = str(r.get(c) or "")
                else:
                    v = r.get(c)
                    val = None if pd.isna(v) else float(v)
                row.append(val)
            rows.append(tuple(row))
        execute_values(cur,
            f"""INSERT INTO ops.equipment_telemetry ({cols_sql})
                    VALUES %s""",
            rows, page_size=1000
        )
        conn.commit()
    print(f"  Inserted {len(rows):,} rows into ops.equipment_telemetry")


def seed_alerts():
    print("\n--- Seeding gov.alerts ---")
    alerts = [
        ("shortfall_risk", "critical", "MINE-A", "MINE-A",
         "Shortfall probability above 60% for the next shift — review shortfall workspace for root causes.", "SYNTHETIC"),
        ("equipment_failure", "critical", "MINE-A", "EQ-104",
         "Failure model flags EQ-104 HIGH risk within 24h — maintenance overdue beyond threshold.", "SYNTHETIC"),
        ("production_forecast", "warning", "MINE-A", "MINE-A",
         "P50 forecast trending 8% below plan over the last three shifts.", "SYNTHETIC"),
        ("prospectivity_update", "info", "MINE-A", "grid-0421",
         "New drill-recommended grid cells available in the Sausar exploration grid.", "SYNTHETIC"),
        ("data_freshness", "warning", "MINE-B", "production_records",
         "Production records ageing — latest sync older than 24h.", "SYNTHETIC"),
    ]
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("TRUNCATE gov.alerts")
        execute_values(cur,
            """INSERT INTO gov.alerts
                   (alert_type, severity, mine_id, entity_id, message, data_origin)
                   VALUES %s""",
            alerts
        )
        conn.commit()
    print(f"  Inserted {len(alerts)} alerts")


if __name__ == "__main__":
    import sys
    only = sys.argv[1] if len(sys.argv) > 1 else "all"
    jobs = {
        "prospectivity": seed_prospectivity,
        "production": seed_production,
        "equipment": seed_equipment,
        "alerts": seed_alerts,
    }
    for name, fn in jobs.items():
        if only not in ("all", name):
            continue
        try:
            fn()
        except Exception as e:
            print(f"  {name} FAILED: {e}")
    print("\nSeeding complete.")
