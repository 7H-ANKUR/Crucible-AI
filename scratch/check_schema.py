import sys

sys.path.insert(0, '.')
from dotenv import load_dotenv

load_dotenv('.env')
from apps.api.core.db import query

try:
    rows = query(
        "SELECT column_name, data_type FROM information_schema.columns "
        "WHERE table_schema='ml' AND table_name='predictions' ORDER BY ordinal_position"
    )
    print("ml.predictions columns:")
    for r in rows:
        print(f"  {r['column_name']}  ({r['data_type']})")
except Exception as e:
    print("Error checking ml.predictions:", e)

try:
    rows2 = query(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema='ops' AND table_name='equipment_telemetry' ORDER BY ordinal_position"
    )
    print("\nops.equipment_telemetry columns:")
    for r in rows2:
        print(f"  {r['column_name']}")
except Exception as e:
    print("Error checking equipment_telemetry:", e)
