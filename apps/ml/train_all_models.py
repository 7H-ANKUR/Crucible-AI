"""
apps/ml/train_all_models.py
Master training runner — executes all 4 model pipelines in sequence.
Outputs: artifacts/*.joblib + FINAL_MODEL_VALIDATION.csv
"""
import csv
import pathlib
import subprocess
import sys
import time

MODELS = [
    ("Model 1 - Prospectivity",      "apps/ml/models/train_prospectivity.py"),
    ("Model 2 - Production Forecast", "apps/ml/models/train_production_forecast.py"),
    ("Model 3 - Shortfall Classifier","apps/ml/models/train_shortfall.py"),
    ("Model 4 - Equipment Failure",   "apps/ml/models/train_equipment_failure.py"),
]

results = []
total_start = time.time()

for name, script in MODELS:
    print(f"\n{'='*60}")
    print(f"  TRAINING: {name}")
    print(f"{'='*60}")
    t0 = time.time()
    ret = subprocess.run([sys.executable, script], capture_output=False)
    elapsed = time.time() - t0
    status = "OK" if ret.returncode == 0 else "FAILED"
    results.append({"model": name, "script": script, "status": status, "time_s": round(elapsed, 1)})
    print(f"\n  [{status}] {name} completed in {elapsed:.1f}s")

print(f"\n{'='*60}")
print(f"  ALL MODELS DONE  ({time.time()-total_start:.0f}s total)")
print(f"{'='*60}")
for r in results:
    print(f"  [{r['status']:6s}] {r['model']}")

# Merge validation CSVs — union all fieldnames across models
val_rows = []
all_fields = []
for p in sorted(pathlib.Path("apps/ml/artifacts").glob("*_validation.csv")):
    with open(p) as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        for fn in (reader.fieldnames or []):
            if fn not in all_fields:
                all_fields.append(fn)
        val_rows.extend(rows)

if val_rows:
    out = pathlib.Path("apps/ml/FINAL_MODEL_VALIDATION.csv")
    with open(out, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=all_fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(val_rows)
    print(f"\n  FINAL_MODEL_VALIDATION.csv written: {len(val_rows)} rows")
