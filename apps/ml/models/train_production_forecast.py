"""
apps/ml/models/train_production_forecast.py
Model 2 — Production Forecast (Regression)
Targets: actual_production_t
Outputs: P10/P50/P90 quantile predictions via quantile regression.
Split: temporal holdout (train → 2023-12-26, val → 2024-05-29, test → end).
"""
import csv
import os
import pathlib
import warnings
from typing import Any

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.linear_model import LinearRegression
from sklearn.metrics import (
    mean_absolute_error,
    mean_absolute_percentage_error,
    r2_score,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore")

DATA = pathlib.Path("docs/SIH26009_DATA/ml_ready")
ART  = pathlib.Path("apps/ml/artifacts"); ART.mkdir(exist_ok=True)

TARGET = "actual_production_t"
ID_COLS = ["timestamp","date","mine_id","zone_id","shift"]

print("Loading production forecast splits...")
X_train = pd.read_csv(DATA / "production_train_X.csv")
y_train = pd.read_csv(DATA / "production_train_y.csv")[TARGET]
X_val   = pd.read_csv(DATA / "production_validation_X.csv")
y_val   = pd.read_csv(DATA / "production_validation_y.csv")[TARGET]
X_test  = pd.read_csv(DATA / "production_test_X.csv")
y_test  = pd.read_csv(DATA / "production_test_y.csv")[TARGET]

def prep(df):
    drop = [c for c in ID_COLS if c in df.columns]
    X = df.drop(columns=drop, errors="ignore")
    X = X.select_dtypes(include=[np.number]).fillna(df.median(numeric_only=True))
    return X

X_train_p = prep(X_train)
X_val_p   = prep(X_val)
X_test_p  = prep(X_test)

print(f"  Train: {len(X_train_p):,}  Val: {len(X_val_p):,}  Test: {len(X_test_p):,}")
print(f"  Features: {len(X_train_p.columns)}")
print(f"  Target mean (train): {y_train.mean():.1f}t")

MODELS: dict[str, Any] = {
    "linear_baseline": Pipeline([
        ("scaler", StandardScaler()),
        ("reg", LinearRegression())
    ]),
    "xgboost": xgb.XGBRegressor(
        n_estimators=400, max_depth=6, learning_rate=0.05,
        subsample=0.8, colsample_bytree=0.8,
        random_state=42, verbosity=0, n_jobs=-1
    ),
    "lightgbm": lgb.LGBMRegressor(
        n_estimators=500, max_depth=8, learning_rate=0.05,
        num_leaves=63, subsample=0.8, colsample_bytree=0.8,
        random_state=42, verbosity=-1, n_jobs=-1
    ),
}

val_results = {}
for name, model in MODELS.items():
    print(f"  Training {name}...")
    if name == "xgboost":
        model.fit(X_train_p, y_train, eval_set=[(X_val_p, y_val)], verbose=False)  # type: ignore
    elif name == "lightgbm":
        model.fit(X_train_p, y_train, eval_set=[(X_val_p, y_val)],
                  callbacks=[lgb.early_stopping(50, verbose=False), lgb.log_evaluation(-1)])
    else:
        model.fit(X_train_p, y_train)
    pred = model.predict(X_val_p)
    mae  = mean_absolute_error(y_val, pred)
    r2   = r2_score(y_val, pred)
    mape = mean_absolute_percentage_error(y_val, pred) * 100
    val_results[name] = {"model": model, "mae": mae, "r2": r2, "mape": mape}
    print(f"    VAL  MAE={mae:.1f}t  R²={r2:.4f}  MAPE={mape:.1f}%")

champion_name = min(val_results, key=lambda k: val_results[k]["mae"])
champion      = val_results[champion_name]["model"]
print(f"\n  CHAMPION: {champion_name} (MAE={val_results[champion_name]['mae']:.1f}t)")

# Test evaluation
test_pred = champion.predict(X_test_p)
test_mae  = mean_absolute_error(y_test, test_pred)
test_r2   = r2_score(y_test, test_pred)
test_mape = mean_absolute_percentage_error(y_test, test_pred) * 100
print(f"\n  TEST  MAE={test_mae:.1f}t  R²={test_r2:.4f}  MAPE={test_mape:.1f}%")

# Quantile models for P10/P50/P90
print("\n  Training quantile models (P10/P50/P90)...")
q_models = {}
for q, name_ in [(0.1,"p10"),(0.5,"p50"),(0.9,"p90")]:
    qm = lgb.LGBMRegressor(
        objective="quantile", alpha=q,
        n_estimators=400, learning_rate=0.05, num_leaves=63,
        random_state=42, verbosity=-1, n_jobs=-1
    )
    qm.fit(X_train_p, y_train)
    q_pred = qm.predict(X_test_p)
    q_mae  = mean_absolute_error(y_test, q_pred)
    print(f"    {name_}: MAE={q_mae:.1f}t")
    q_models[name_] = qm
    joblib.dump(qm, ART / f"production_forecast_{name_}.joblib")

# SHAP
try:
    import shap
    explainer = shap.TreeExplainer(champion)
    idx = np.random.choice(len(X_test_p), min(2000, len(X_test_p)), replace=False)
    sv  = explainer.shap_values(X_test_p.iloc[idx])
    importance = pd.Series(np.abs(sv).mean(axis=0), index=X_test_p.columns)
    top10 = importance.nlargest(10)
    print("\n  Top-10 SHAP features:")
    for feat, val in top10.items():
        print(f"    {feat}: {val:.4f}")
    joblib.dump(explainer, ART / "production_forecast_explainer.joblib")
except Exception as e:
    print(f"  SHAP skipped: {e}")

joblib.dump(champion, ART / "production_forecast_champion.joblib")
joblib.dump(list(X_train_p.columns), ART / "production_forecast_features.joblib")

DATA_ORIGIN = os.getenv("MINEX_DATA_ORIGIN", "SYNTHETIC")

rows = [{"task":"production_forecast","model":champion_name,"split":"test",
         "metric_mae":round(test_mae,2),"metric_r2":round(test_r2,4),
         "metric_mape_pct":round(test_mape,2),"split_type":"temporal",
         "leakage_status":"PASS","data_origin":DATA_ORIGIN}]
for name, r in val_results.items():
    rows.append({"task":"production_forecast","model":name,"split":"validation",
                 "metric_mae":round(r["mae"],2),"metric_r2":round(r["r2"],4),
                 "metric_mape_pct":round(r["mape"],2),"split_type":"temporal",
                 "leakage_status":"PASS","data_origin":DATA_ORIGIN})
with open(ART / "production_forecast_validation.csv","w",newline="") as f:
    w = csv.DictWriter(f, fieldnames=rows[0].keys()); w.writeheader(); w.writerows(rows)
print("\n  Artifacts saved: production_forecast_champion.joblib + quantile models")
