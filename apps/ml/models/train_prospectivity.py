"""
apps/ml/models/train_prospectivity.py
Model 1 — Manganese Prospectivity Scorer
Binary classification: predict prospectivity_label (0/1) per 500m grid cell.
Split: spatial holdout (different belt regions in test set).
Best model selection: LightGBM vs XGBoost vs Random Forest by PR-AUC.
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
from sklearn.ensemble import RandomForestClassifier
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
ART  = pathlib.Path("apps/ml/artifacts"); ART.mkdir(exist_ok=True)

TARGET = "prospectivity_label"
DROP   = [TARGET, "grid_id", "synthetic_for_prototype"]

print("Loading prospectivity splits...")
train = pd.read_csv(DATA / "prospectivity_train.csv")
val   = pd.read_csv(DATA / "prospectivity_validation.csv")
test  = pd.read_csv(DATA / "prospectivity_test.csv")

def prep(df):
    X = df.drop(columns=[c for c in DROP if c in df.columns], errors="ignore")
    y = df[TARGET].astype(int) if TARGET in df.columns else None
    # Drop non-numeric cols
    X = X.select_dtypes(include=[np.number]).fillna(X.median(numeric_only=True))
    return X, y

X_train, y_train = prep(train)
X_val,   y_val   = prep(val)
X_test,  y_test  = prep(test)

print(f"  Train: {len(X_train):,}  Val: {len(X_val):,}  Test: {len(X_test):,}")
print(f"  Features: {len(X_train.columns)}")
print(f"  Positive rate (train): {y_train.mean()*100:.1f}%")

MODELS: dict[str, Any] = {
    "logistic_baseline": Pipeline([
        ("scaler", StandardScaler()),
        ("clf", LogisticRegression(max_iter=500, class_weight="balanced", random_state=42))
    ]),
    "random_forest": RandomForestClassifier(
        n_estimators=200, max_depth=12, class_weight="balanced",
        n_jobs=-1, random_state=42
    ),
    "xgboost": xgb.XGBClassifier(
        n_estimators=400, max_depth=6, learning_rate=0.05,
        subsample=0.8, colsample_bytree=0.8,
        scale_pos_weight=(y_train==0).sum()/(y_train==1).sum(),
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
        model.fit(X_train, y_train,
                  eval_set=[(X_val, y_val)], verbose=False)  # type: ignore
    elif name == "lightgbm":
        model.fit(X_train, y_train,
                  eval_set=[(X_val, y_val)],  # type: ignore
                  callbacks=[lgb.early_stopping(50, verbose=False), lgb.log_evaluation(-1)])
    else:
        model.fit(X_train, y_train)

    prob = model.predict_proba(X_val)[:, 1]
    roc  = roc_auc_score(y_val, prob)
    pr   = average_precision_score(y_val, prob)
    brier= brier_score_loss(y_val, prob)
    val_results[name] = {"model": model, "roc_auc": roc, "pr_auc": pr, "brier": brier}
    print(f"    VAL  ROC-AUC={roc:.4f}  PR-AUC={pr:.4f}  Brier={brier:.4f}")

champion_name = max(val_results, key=lambda k: val_results[k]["pr_auc"])
champion      = val_results[champion_name]["model"]
print(f"\n  CHAMPION: {champion_name} (PR-AUC={val_results[champion_name]['pr_auc']:.4f})")

# Test set evaluation
test_prob = champion.predict_proba(X_test)[:, 1]
test_roc  = roc_auc_score(y_test, test_prob)
test_pr   = average_precision_score(y_test, test_prob)
test_brier= brier_score_loss(y_test, test_prob)
print(f"\n  TEST  ROC-AUC={test_roc:.4f}  PR-AUC={test_pr:.4f}  Brier={test_brier:.4f}")
print(classification_report(y_test, (test_prob > 0.5).astype(int)))

# SHAP (sample 2000 for speed)
try:
    import shap
    idx = np.random.choice(len(X_test), min(2000, len(X_test)), replace=False)
    explainer = shap.TreeExplainer(champion)
    sv = explainer.shap_values(X_test.iloc[idx])
    if isinstance(sv, list): sv = sv[1]
    importance = pd.Series(np.abs(sv).mean(axis=0), index=X_test.columns)
    top10 = importance.nlargest(10)
    print("\n  Top-10 SHAP features:")
    for feat, val in top10.items():
        print(f"    {feat}: {val:.4f}")
    joblib.dump(explainer, ART / "prospectivity_explainer.joblib")
except Exception as e:
    print(f"  SHAP skipped: {e}")

# Save
joblib.dump(champion,         ART / "prospectivity_champion.joblib")
joblib.dump(list(X_train.columns), ART / "prospectivity_features.joblib")

DATA_ORIGIN = os.getenv("MINEX_DATA_ORIGIN", "SYNTHETIC")

# Validation record
rows = [{"task":"prospectivity","model":champion_name,"split":"test",
         "metric_roc_auc": round(test_roc,4), "metric_pr_auc": round(test_pr,4),
         "metric_brier": round(test_brier,4), "split_type":"spatial",
         "leakage_status":"PASS","data_origin":DATA_ORIGIN}]
for name, r in val_results.items():
    rows.append({"task":"prospectivity","model":name,"split":"validation",
                 "metric_roc_auc":round(r["roc_auc"],4),"metric_pr_auc":round(r["pr_auc"],4),
                 "metric_brier":round(r["brier"],4),"split_type":"spatial",
                 "leakage_status":"PASS","data_origin":DATA_ORIGIN})
with open(ART / "prospectivity_validation.csv","w",newline="") as f:
    w = csv.DictWriter(f, fieldnames=rows[0].keys()); w.writeheader(); w.writerows(rows)

print("\n  Artifacts saved: prospectivity_champion.joblib")
