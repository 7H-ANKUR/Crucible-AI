"""Quick smoke test for the MINEx API — run from project root."""
import json
import sys
import urllib.request

BASE = "http://localhost:8000/api/v1"

def get(path):
    try:
        with urllib.request.urlopen(BASE + path, timeout=12) as r:
            return json.loads(r.read()), None
    except Exception as e:
        return None, str(e)

TESTS = [
    "/health",
    "/exploration/targets",
    "/production/MINE-A/forecast",
    "/production/MINE-A/shortfall",
    "/equipment/MINE-A/fleet",
    "/ledger/data-health",
    "/ledger",
]

ok = True
print("=== MINEx API Smoke Test ===")
for path in TESTS:
    data, err = get(path)
    if err:
        print(f"  FAIL  {path}")
        print(f"        {err[:120]}")
        ok = False
    else:
        snippets = []
        for k in ["status","database","model_count","count","total_machines",
                  "at_risk","shortfall_probability","alert","aggregate_status"]:
            if k in data:
                snippets.append(f"{k}={data[k]}")
        if "forecast" in data:
            snippets.append(f"P50={data['forecast']['p50']}t")
        print(f"  OK    {path}  |  {', '.join(snippets)}")

print()
print("ALL PASSED" if ok else "SOME TESTS FAILED")
sys.exit(0 if ok else 1)
