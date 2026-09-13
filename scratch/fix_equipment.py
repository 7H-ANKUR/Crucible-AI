
content = open('apps/api/routers/equipment.py', encoding='utf-8').read()

old = """    catmap  = get_model("equipment_catmap") or {}
    medians = get_model("equipment_medians") or {}
    X, _ = build_equipment_features(rows, feat_names, catmap, medians)"""

new = """    catmap  = get_model("equipment_catmap") or {}
    medians = get_model("equipment_medians") or {}
    # build_equipment_features expects a single dict; iterate over each row and concat
    dfs = []
    for row in rows:
        df_row, _ = build_equipment_features(row, feat_names, catmap, medians)
        dfs.append(df_row)
    if not dfs:
        return _heuristic_probs(rows)
    X = pd.concat(dfs, ignore_index=True)"""

if old in content:
    fixed = content.replace(old, new)
    open('apps/api/routers/equipment.py', 'w', encoding='utf-8').write(fixed)
    print("Fix applied successfully")
else:
    print("ERROR: target string not found!")
    # Find what's actually there
    idx = content.find('catmap  = get_model("equipment_catmap")')
    if idx >= 0:
        print("Found at index", idx)
        print(repr(content[idx:idx+200]))
    else:
        print("catmap line not found either")
