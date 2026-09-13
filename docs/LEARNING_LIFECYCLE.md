# MINEx Continuous Learning Lifecycle & Model Governance

## 1. Core Principles

MINEx enforces strict human-in-the-loop governance over all machine learning model promotions.
No retraining run is permitted to autonomously replace production champions. Every candidate model must pass verification gates and explicit administrator approval before deployment.

---

## 2. Learning Lifecycle Stages

```
1. Approved Dataset ──► 2. Training Run ──► 3. Register Challenger ──► 4. Human Approval Gate ──► 5. Champion Promotion
   (hub.datasets)          (Modal / BG)         (gov.model_registry)       (Metric delta & leak)    (Retire predecessor)
                                                                                                            │
                                                                                                            ▼
                                                                                                  6. Emergency Rollback
                                                                                                     (1-click restore)
```

### Stage 1: Approved Dataset
Retraining requires a dataset version in `APPROVED_FOR_TRAINING` status with a validation score $\ge 70$.

### Stage 2: Training Run Execution (`apps/api/routers/training.py`)
- Triggered via `POST /api/v1/training/trigger` by an authorized domain administrator.
- Generates a unique run tag (e.g. `run-PROD-A8F19C`).
- Executes the training pipeline (or Modal.com remote GPU serverless container).
- Records state transitions: `queued -> running -> completed | failed`.

### Stage 3: Challenger Model Registration & Artifact Storage
Trained models are stored durably in Google Drive under `models/{task}/` and registered into `gov.model_registry` under `status = 'challenger'` with detailed metadata in `gov.model_artifacts`:
- Out-of-sample test metrics ($R^2$, MAE, ROC-AUC, PR-AUC, Lift)
- Validation split type (`temporal` vs `spatial`)
- Data origin (`SYNTHETIC` vs `FIELD_IOT`)
- Target leakage verification (`PASS` / `FAIL`)
- Storage ID, file size, and SHA-256 cryptographic checksum

### Stage 4: Human Review & Approval Gate (`apps/api/routers/model_approval.py`)
Domain operators review candidates in the **Model Approvals & Training** tab of `/governance`.
- Reviewer checks metric improvements over the active champion.
- Target leakage test must show `PASS` and validation score $\ge 70$.
- Calls `POST /api/v1/models/{id}/approve` with review notes.
- Status updates from `challenger` → `approved`. Only approved models can be promoted.

### Stage 5: Verified Champion Promotion & Safe In-Memory Hot-Reload
When an administrator calls `POST /api/v1/models/{id}/promote`:
1. **Pre-flight Gate**: Verifies model status is explicitly `approved`.
2. **Integrity Gate**: Validates SHA-256 checksum against registered artifact record.
3. **Smoke-Test Gate**: Executes a test inference pass (`smoke_test_model`) using sample domain features to ensure the artifact unpacks and executes cleanly.
4. **Promotion**: Upgrades status to `champion`, demotes the previous active champion to `retired`, and updates `ml.model_registry`.
5. **In-Memory Hot-Reload**: Calls `load_model(task, reload=True)` dynamically reloading the active model in the running API process without service downtime.
6. **Audit Trail**: Logs immutable audit records into `gov.model_approvals` and `gov.audit_log`.
7. **Event-Driven Cache Invalidation**: Automatically calls `invalidate_model(task)` after the database transaction commits, invalidating old champion prediction entries in both L1 (in-memory) and L2 (Upstash Redis).

### Stage 6: Emergency Rollback
If operational drift, anomalous variance, or sensor degradation is detected post-deployment:
- `super_admin` executes `POST /api/v1/models/{id}/rollback`.
- Immediately demotes the degraded champion to `rolled_back` and re-promotes the previous stable model, triggering an in-memory hot-reload.
- Automatically triggers `invalidate_model(task)` to flush degraded predictions from all cache tiers.


---

## ⚡ Serverless Cloud Training with Modal.com

MINEx includes native integration with [Modal.com](https://modal.com) for running GPU/CPU model training pipelines in serverless cloud containers (`apps/ml/modal_train.py`).

### 1. Authentication
```bash
python -m modal setup
# Or set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET in .env
```

### 2. Manual CLI Dispatch
```bash
# Train a specific domain
modal run apps/ml/modal_train.py --domain production
modal run apps/ml/modal_train.py --domain exploration
modal run apps/ml/modal_train.py --domain equipment

# Train all models in cloud
modal run apps/ml/modal_train.py --all
```

### 3. Automated API Integration
When `MODAL_TOKEN_ID` is present in `.env` or `~/.modal.toml` exists, triggering training via the UI (`POST /api/v1/training/trigger`) automatically delegates the training run to Modal serverless containers in the cloud, saves model artifacts to a persistent `modal.Volume`, and records challenger metrics directly into `gov.model_registry`.
