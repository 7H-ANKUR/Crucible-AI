content = open('apps/api/routers/production.py', encoding='utf-8').read()

fixed = content.replace(
    'SELECT created_at, prediction_value',
    'SELECT predicted_at, prediction_value'
).replace(
    'ORDER BY created_at DESC LIMIT %s',
    'ORDER BY predicted_at DESC LIMIT %s'
).replace(
    '"created_at"), datetime.datetime',
    '"predicted_at"), datetime.datetime'
).replace(
    'p["created_at"] = p["created_at"].isoformat',
    'p["predicted_at"] = p["predicted_at"].isoformat'
)

open('apps/api/routers/production.py', 'w', encoding='utf-8').write(fixed)

# verify
if 'created_at' in fixed:
    import re
    for m in re.finditer(r'.{0,40}created_at.{0,40}', fixed):
        print('STILL HAS created_at:', m.group())
else:
    print('All created_at replaced successfully')

if 'predicted_at' in fixed:
    print('predicted_at present - OK')
