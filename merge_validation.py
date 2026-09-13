import csv
import pathlib

val_rows=[]; all_fields=[]
for p in sorted(pathlib.Path('apps/ml/artifacts').glob('*_validation.csv')):
    with open(p) as f:
        reader=csv.DictReader(f); rows=list(reader)
        for fn in (reader.fieldnames or []):
            if fn not in all_fields: all_fields.append(fn)
        val_rows.extend(rows)
out=pathlib.Path('apps/ml/FINAL_MODEL_VALIDATION.csv')
with open(out,'w',newline='') as f:
    w=csv.DictWriter(f,fieldnames=all_fields,extrasaction='ignore')
    w.writeheader(); w.writerows(val_rows)
print('FINAL_MODEL_VALIDATION.csv: ' + str(len(val_rows)) + ' rows')
print()
for r in val_rows:
    if r.get('split')=='test':
        metrics = {k:v for k,v in r.items() if k.startswith('metric_')}
        print('  ' + r['task'].ljust(25) + ' | ' + r['model'].ljust(30) + ' | ' + str(metrics))
