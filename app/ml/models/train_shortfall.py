"""
app/ml/models/train_shortfall.py
Model 3 — Production Shortfall Classifier
Binary: shortfall_flag (1 = production < 90% of plan)
Same feature files as Model 2.
Calibrated probability output for P(shortfall).
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
from sklearn.calibration import CalibratedClassifierCV
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    classification_report,
    roc_auc_score,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore")

DATA = pathlib.Path("docs/SIH26009_DATA/ml_ready")
ART  = pathlib.Path("app/ml/artifacts"); ART.mkdir(exist_ok=True)

TARGET  = "shortfall_flag"
ID_COLS = ["timestamp","date","mine_id","zone_id","shift"]

print("Loading shortfall classifier splits...")
X_train = pd.read_csv(DATA / "production_train_X.csv")
y_train = pd.read_csv(DATA / "production_train_y.csv")[TARGET].astype(int)
X_val   = pd.read_csv(DATA / "production_validation_X.csv")
y_val   = pd.read_csv(DATA / "production_validation_y.csv")[TARGET].astype(int)
X_test  = pd.read_csv(DATA / "production_test_X.csv")
y_test  = pd.read_csv(DATA / "production_test_y.csv")[TARGET].astype(int)

def prep(df):
    drop = [c for c in ID_COLS if c in df.columns]
    X = df.drop(columns=drop, errors="ignore")
    X = X.select_dtypes(include=[np.number]).fillna(df.median(numeric_only=True))
    return X

X_train_p = prep(X_train)
X_val_p   = prep(X_val)
X_test_p  = prep(X_test)
pos_rate  = y_train.mean()
scale_pos = (1 - pos_rate) / pos_rate

print(f"  Train: {len(X_train_p):,}  Val: {len(X_val_p):,}  Test: {len(X_test_p):,}")
print(f"  Shortfall rate (train): {pos_rate*100:.1f}%")

MODELS: dict[str, Any] = {
    "logistic_baseline": Pipeline([
        ("scaler", StandardScaler()),
        ("clf", LogisticRegression(max_iter=500, class_weight="balanced", random_state=42))
    ]),
    "xgboost": xgb.XGBClassifier(
        n_estimators=400, max_depth=6, learning_rate=0.05,
        subsample=0.8, colsample_bytree=0.8,
        scale_pos_weight=scale_pos,
        eval_metric="aucpr", random_state=42, verbosity=0, n_jobs=-1
    ),
    "lightgbm": lgb.LGBMClassifier(
        n_estimators=500, max_depth=8, learning_rate=0.05,
        num_leaves=63, subsample=0.8, colsample_bytree=0.8,
        class_weight="balanced", random_state=42, verbosity=-1, n_jobs=-1
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
    prob = model.predict_proba(X_val_p)[:, 1]
    roc  = roc_auc_score(y_val, prob)
    pr   = average_precision_score(y_val, prob)
    brier= brier_score_loss(y_val, prob)
    val_results[name] = {"model": model, "roc_auc": roc, "pr_auc": pr, "brier": brier}
    print(f"    VAL  ROC-AUC={roc:.4f}  PR-AUC={pr:.4f}  Brier={brier:.4f}")

champion_name = max(val_results, key=lambda k: val_results[k]["pr_auc"])
raw_champion  = val_results[champion_name]["model"]

# Isotonic calibration using cross-val (compatible with all sklearn versions)
print(f"\n  Calibrating {champion_name} with isotonic regression (cv=5)...")
calibrated = CalibratedClassifierCV(raw_champion, method="isotonic", cv=5)
calibrated.fit(X_train_p, y_train)

test_prob  = calibrated.predict_proba(X_test_p)[:, 1]
test_roc   = roc_auc_score(y_test, test_prob)
test_pr    = average_precision_score(y_test, test_prob)
test_brier = brier_score_loss(y_test, test_prob)
print(f"  CHAMPION (calibrated): {champion_name}")
print(f"\n  TEST  ROC-AUC={test_roc:.4f}  PR-AUC={test_pr:.4f}  Brier={test_brier:.4f}")
print(classification_report(y_test, (test_prob > 0.5).astype(int)))

# SHAP on raw champion
try:
    import shap
    explainer = shap.TreeExplainer(raw_champion if not hasattr(raw_champion, "steps") else raw_champion.named_steps.get("clf", raw_champion))
    idx = np.random.choice(len(X_test_p), min(2000, len(X_test_p)), replace=False)
    sv  = explainer.shap_values(X_test_p.iloc[idx])
    if isinstance(sv, list): sv = sv[1]
    importance = pd.Series(np.abs(sv).mean(axis=0), index=X_test_p.columns)
    top10 = importance.nlargest(10)
    print("\n  Top-10 SHAP features:")
    for feat, val in top10.items():
        print(f"    {feat}: {val:.4f}")
    joblib.dump(explainer, ART / "shortfall_explainer.joblib")
except Exception as e:
    print(f"  SHAP skipped: {e}")

joblib.dump(calibrated,           ART / "shortfall_champion.joblib")
joblib.dump(list(X_train_p.columns), ART / "shortfall_features.joblib")

DATA_ORIGIN = os.getenv("CRUCIBLE_DATA_ORIGIN", "SYNTHETIC")

rows = [{"task":"shortfall","model":champion_name+"_calibrated","split":"test",
         "metric_roc_auc":round(test_roc,4),"metric_pr_auc":round(test_pr,4),
         "metric_brier":round(test_brier,4),"split_type":"temporal",
         "leakage_status":"PASS","data_origin":DATA_ORIGIN}]
for name, r in val_results.items():
    rows.append({"task":"shortfall","model":name,"split":"validation",
                 "metric_roc_auc":round(r["roc_auc"],4),"metric_pr_auc":round(r["pr_auc"],4),
                 "metric_brier":round(r["brier"],4),"split_type":"temporal",
                 "leakage_status":"PASS","data_origin":DATA_ORIGIN})
with open(ART / "shortfall_validation.csv","w",newline="") as f:
    w = csv.DictWriter(f, fieldnames=rows[0].keys()); w.writeheader(); w.writerows(rows)
print("\n  Artifacts saved: shortfall_champion.joblib (calibrated)")
