"""
Quick model comparison: adds Random Forest to all classifiers + checks if any algorithm does better.
Runs on validation sets only (fast). Saves improved champion if RF beats current.
"""
import pathlib
import warnings

import joblib
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

import lightgbm as lgb
import xgboost as xgb
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

DATA = pathlib.Path("docs/SIH26009_DATA/ml_ready")
ART  = pathlib.Path("apps/ml/artifacts")

def prep_drop(df, drop_cols):
    df2 = df.drop(columns=[c for c in drop_cols if c in df.columns], errors="ignore")
    cat = df2.select_dtypes(include=["object"]).columns
    for c in cat: df2[c] = pd.Categorical(df2[c]).codes
    return df2.select_dtypes(include=[np.number]).fillna(df2.median(numeric_only=True))

print("="*65)
print("MODEL 1 — PROSPECTIVITY (classification, small dataset ~6k)")
print("="*65)

tr = pd.read_csv(DATA/"prospectivity_train.csv")
vl = pd.read_csv(DATA/"prospectivity_validation.csv")
te = pd.read_csv(DATA/"prospectivity_test.csv")
ID1 = ["prospectivity_label","grid_id","synthetic_for_prototype"]
Xtr,ytr = prep_drop(tr,ID1), tr["prospectivity_label"].astype(int)
Xvl,yvl = prep_drop(vl,ID1), vl["prospectivity_label"].astype(int)
Xte,yte = prep_drop(te,ID1), te["prospectivity_label"].astype(int)

cls1 = {
    "Logistic (current champion)": Pipeline([("sc",StandardScaler()),("clf",LogisticRegression(max_iter=500,class_weight="balanced",random_state=42))]),
    "Random Forest 200":  RandomForestClassifier(n_estimators=200,max_depth=12,class_weight="balanced",n_jobs=-1,random_state=42),
    "Random Forest 500":  RandomForestClassifier(n_estimators=500,max_depth=16,min_samples_leaf=2,class_weight="balanced",n_jobs=-1,random_state=42),
    "XGBoost":            xgb.XGBClassifier(n_estimators=400,max_depth=6,learning_rate=0.05,scale_pos_weight=(ytr==0).sum()/(ytr==1).sum(),verbosity=0,random_state=42),
    "LightGBM":           lgb.LGBMClassifier(n_estimators=500,max_depth=8,learning_rate=0.05,num_leaves=63,class_weight="balanced",verbosity=-1,random_state=42),
    "GradientBoosting":   GradientBoostingClassifier(n_estimators=200,max_depth=5,learning_rate=0.05,random_state=42),
}
best1_pr, best1_name, best1_model = 0, None, None
for name, m in cls1.items():
    m.fit(Xtr,ytr)
    p = m.predict_proba(Xvl)[:,1]
    roc = roc_auc_score(yvl,p); pr = average_precision_score(yvl,p)
    flag = " <-- BETTER!" if pr > best1_pr else ""
    print(f"  {name:35s} VAL ROC={roc:.4f}  PR-AUC={pr:.4f}{flag}")
    if pr > best1_pr: best1_pr=pr; best1_name=name; best1_model=m

# Test best
p_te = best1_model.predict_proba(Xte)[:,1]
print(f"\n  BEST on val: {best1_name}")
print(f"  TEST ROC-AUC={roc_auc_score(yte,p_te):.4f}  PR-AUC={average_precision_score(yte,p_te):.4f}")
if best1_name != "Logistic (current champion)":
    joblib.dump(best1_model, ART/"prospectivity_champion.joblib")
    print(f"  *** NEW CHAMPION saved: {best1_name} ***")

print()
print("="*65)
print("MODEL 3 — SHORTFALL (classification, ~80k rows)")
print("="*65)
ID_OPS = ["timestamp","date","mine_id","zone_id","shift"]
Xtr3=prep_drop(pd.read_csv(DATA/"production_train_X.csv"),ID_OPS)
ytr3=pd.read_csv(DATA/"production_train_y.csv")["shortfall_flag"].astype(int)
Xvl3=prep_drop(pd.read_csv(DATA/"production_validation_X.csv"),ID_OPS)
yvl3=pd.read_csv(DATA/"production_validation_y.csv")["shortfall_flag"].astype(int)
Xte3=prep_drop(pd.read_csv(DATA/"production_test_X.csv"),ID_OPS)
yte3=pd.read_csv(DATA/"production_test_y.csv")["shortfall_flag"].astype(int)
sw3 = (ytr3==0).sum()/(ytr3==1).sum()

cls3 = {
    "Logistic (current champion)": Pipeline([("sc",StandardScaler()),("clf",LogisticRegression(max_iter=500,class_weight="balanced",random_state=42))]),
    "Random Forest 200":  RandomForestClassifier(n_estimators=200,max_depth=12,class_weight="balanced",n_jobs=-1,random_state=42),
    "Random Forest 500":  RandomForestClassifier(n_estimators=500,max_depth=16,min_samples_leaf=5,class_weight="balanced",n_jobs=-1,random_state=42),
    "XGBoost":            xgb.XGBClassifier(n_estimators=400,max_depth=6,learning_rate=0.05,scale_pos_weight=sw3,verbosity=0,random_state=42),
    "LightGBM":           lgb.LGBMClassifier(n_estimators=500,max_depth=8,learning_rate=0.05,class_weight="balanced",verbosity=-1,random_state=42),
}
best3_pr, best3_name, best3_model = 0, None, None
for name, m in cls3.items():
    m.fit(Xtr3,ytr3)
    p = m.predict_proba(Xvl3)[:,1]
    roc=roc_auc_score(yvl3,p); pr=average_precision_score(yvl3,p)
    flag = " <-- BETTER!" if pr > best3_pr else ""
    print(f"  {name:35s} VAL ROC={roc:.4f}  PR-AUC={pr:.4f}{flag}")
    if pr > best3_pr: best3_pr=pr; best3_name=name; best3_model=m

p_te3 = best3_model.predict_proba(Xte3)[:,1]
print(f"\n  BEST on val: {best3_name}")
print(f"  TEST ROC-AUC={roc_auc_score(yte3,p_te3):.4f}  PR-AUC={average_precision_score(yte3,p_te3):.4f}")
if best3_name != "Logistic (current champion)":
    joblib.dump(best3_model, ART/"shortfall_champion.joblib")
    print(f"  *** NEW CHAMPION saved: {best3_name} ***")

print()
print("="*65)
print("MODEL 4 — EQUIPMENT FAILURE (NOTE: RF very slow on 717k rows)")
print("Comparing only lightweight models + LightGBM with better tuning")
print("="*65)
ID_EQ=["timestamp","datetime","machine_id","mine_id","zone_id",
       "equipment_status","shift_type","synthetic_for_prototype","failure_next_24h"]
tr4=pd.read_csv(DATA/"equipment_train.csv",low_memory=False)
vl4=pd.read_csv(DATA/"equipment_validation.csv",low_memory=False)
te4=pd.read_csv(DATA/"equipment_test.csv",low_memory=False)
Xtr4=prep_drop(tr4,ID_EQ); ytr4=tr4["failure_next_24h"].astype(int)
Xvl4=prep_drop(vl4,ID_EQ); yvl4=vl4["failure_next_24h"].astype(int)
Xte4=prep_drop(te4,ID_EQ); yte4=te4["failure_next_24h"].astype(int)
sw4=(ytr4==0).sum()/(ytr4==1).sum(); base_pr=average_precision_score(yvl4,np.full(len(yvl4),ytr4.mean()))

cls4 = {
    "Logistic (current champion)": Pipeline([("sc",StandardScaler()),("clf",LogisticRegression(max_iter=500,class_weight="balanced",random_state=42))]),
    "XGBoost deeper":     xgb.XGBClassifier(n_estimators=600,max_depth=7,learning_rate=0.03,min_child_weight=10,scale_pos_weight=sw4,verbosity=0,random_state=42,n_jobs=-1),
    "LightGBM tuned":     lgb.LGBMClassifier(n_estimators=600,max_depth=9,learning_rate=0.03,num_leaves=127,min_child_samples=50,class_weight="balanced",verbosity=-1,random_state=42,n_jobs=-1),
    "RF 100 (fast)":      RandomForestClassifier(n_estimators=100,max_depth=10,min_samples_leaf=20,class_weight="balanced",n_jobs=-1,random_state=42),
}
best4_pr, best4_name, best4_model = 0, None, None
for name, m in cls4.items():
    print(f"  Training {name}...",flush=True)
    m.fit(Xtr4,ytr4)
    p=m.predict_proba(Xvl4)[:,1]
    roc=roc_auc_score(yvl4,p); pr=average_precision_score(yvl4,p)
    lift=pr/base_pr
    flag = " <-- BETTER!" if pr > best4_pr else ""
    print(f"  {name:35s} VAL ROC={roc:.4f}  PR-AUC={pr:.4f}  Lift={lift:.2f}x{flag}")
    if pr > best4_pr: best4_pr=pr; best4_name=name; best4_model=m

p_te4=best4_model.predict_proba(Xte4)[:,1]
base_pr_te=average_precision_score(yte4,np.full(len(yte4),yte4.mean()))
print(f"\n  BEST on val: {best4_name}")
print(f"  TEST ROC-AUC={roc_auc_score(yte4,p_te4):.4f}  PR-AUC={average_precision_score(yte4,p_te4):.4f}  Lift={average_precision_score(yte4,p_te4)/base_pr_te:.2f}x")
if best4_name != "Logistic (current champion)":
    joblib.dump(best4_model, ART/"equipment_failure_champion.joblib")
    print(f"  *** NEW CHAMPION saved: {best4_name} ***")

print("\nDone.")
