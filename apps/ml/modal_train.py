"""apps/ml/modal_train.py — Serverless Cloud Model Retraining on Modal.com.

Runs ML model training pipelines in a dedicated cloud container with durable Google Drive
artifact upload, SHA-256 checksums, and multi-domain split materialization.

Usage:
  1. Test training for one domain (local CLI dispatch):
     modal run apps/ml/modal_train.py --domain production

  2. Train all domains:
     modal run apps/ml/modal_train.py --all

  3. Deploy as a persistent serverless app (for API triggers):
     modal deploy apps/ml/modal_train.py
"""
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import time

import modal

# Define Modal App
app = modal.App("minex-training")

# Persistent storage volume for trained model artifacts
volume = modal.Volume.from_name("minex-artifacts", create_if_missing=True)

# Build container image with all ML and data dependencies
training_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "numpy==1.26.4",
        "pandas==2.2.3",
        "scikit-learn==1.5.2",
        "lightgbm==4.5.0",
        "xgboost==2.1.1",
        "joblib==1.4.2",
        "shap==0.46.0",
        "gdown==6.1.1",
        "requests>=2.31.0",
        "google-api-python-client>=2.100.0",
        "google-auth>=2.20.0",
    )
    .add_local_dir("docs/SIH26009_DATA/ml_ready", remote_path="/root/docs/SIH26009_DATA/ml_ready")
    .add_local_dir("apps/ml/models", remote_path="/root/apps/ml/models")
)

DOMAIN_SCRIPTS = {
    "exploration": [
        ("Model 1 - Prospectivity Scorer", "apps/ml/models/train_prospectivity.py")
    ],
    "production": [
        ("Model 2 - Production Forecast", "apps/ml/models/train_production_forecast.py"),
        ("Model 3 - Shortfall Classifier", "apps/ml/models/train_shortfall.py"),
    ],
    "equipment": [
        ("Model 4 - Equipment Failure", "apps/ml/models/train_equipment_failure.py")
    ],
}


def compute_sha256(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def _download_and_verify_dataset(drive_file_id: str, expected_checksum: str | None) -> pathlib.Path:
    """Download canonical dataset inside Modal container and verify SHA-256."""
    import gdown
    dest = pathlib.Path(f"/root/data_custom_{drive_file_id}.csv")
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        url = f"https://drive.google.com/uc?id={drive_file_id}"
        print(f"Downloading custom canonical dataset from Drive ({drive_file_id})...")
        gdown.download(url, str(dest), quiet=False)

    if not dest.exists():
        raise FileNotFoundError(f"Failed to download canonical dataset {drive_file_id} from Drive.")

    actual_hash = compute_sha256(dest)
    print(f"Downloaded dataset SHA-256: {actual_hash}")
    if expected_checksum and actual_hash != expected_checksum:
        raise ValueError(
            f"Checksum mismatch for dataset {drive_file_id}: expected {expected_checksum}, got {actual_hash}"
        )
    return dest


def _materialize_splits_from_canonical(canonical_path: pathlib.Path, domain: str, work_dir: pathlib.Path):
    """Split canonical dataset into ML-ready train/val/test splits for the given domain."""
    import pandas as pd

    df = pd.read_csv(canonical_path)
    ml_ready = work_dir / "docs/SIH26009_DATA/ml_ready"
    ml_ready.mkdir(parents=True, exist_ok=True)

    print(f"Materializing splits for domain '{domain}' from {len(df)} canonical rows...")
    n = len(df)
    n_train = max(1, int(n * 0.70))
    n_val = max(n_train + 1, int(n * 0.85)) if n > 2 else n

    train_df = df.iloc[:n_train].copy()
    val_df = df.iloc[n_train:n_val].copy() if n > n_train else train_df.copy()
    test_df = df.iloc[n_val:].copy() if n > n_val else val_df.copy()

    if domain == "production":
        # Ensure actual_production_t exists
        if "actual_production_t" not in df.columns:
            raise ValueError("Production canonical dataset must contain 'actual_production_t'.")

        # Derive shortfall_flag if missing
        for sub_df in (train_df, val_df, test_df):
            if "shortfall_flag" not in sub_df.columns:
                if "planned_production_t" in sub_df.columns:
                    sub_df["shortfall_flag"] = (sub_df["actual_production_t"] < sub_df["planned_production_t"]).astype(int)
                else:
                    median_val = sub_df["actual_production_t"].median()
                    sub_df["shortfall_flag"] = (sub_df["actual_production_t"] < median_val).astype(int)

        targets = ["actual_production_t", "shortfall_flag"]
        train_df.drop(columns=targets, errors="ignore").to_csv(ml_ready / "production_train_X.csv", index=False)
        train_df[targets].to_csv(ml_ready / "production_train_y.csv", index=False)

        val_df.drop(columns=targets, errors="ignore").to_csv(ml_ready / "production_validation_X.csv", index=False)
        val_df[targets].to_csv(ml_ready / "production_validation_y.csv", index=False)

        test_df.drop(columns=targets, errors="ignore").to_csv(ml_ready / "production_test_X.csv", index=False)
        test_df[targets].to_csv(ml_ready / "production_test_y.csv", index=False)
        print(f"Generated production splits (actual_production_t + shortfall_flag): {len(train_df)} train, {len(val_df)} val, {len(test_df)} test.")

    elif domain == "equipment":
        for sub_df in (train_df, val_df, test_df):
            if "failure_next_24h" not in sub_df.columns:
                sub_df["failure_next_24h"] = 0

        train_df.to_csv(ml_ready / "equipment_train.csv", index=False)
        val_df.to_csv(ml_ready / "equipment_validation.csv", index=False)
        test_df.to_csv(ml_ready / "equipment_test.csv", index=False)
        print(f"Generated equipment splits: {len(train_df)} train, {len(val_df)} val, {len(test_df)} test.")

    elif domain == "exploration":
        for sub_df in (train_df, val_df, test_df):
            if "prospectivity_label" not in sub_df.columns:
                sub_df["prospectivity_label"] = 0

        train_df.to_csv(ml_ready / "prospectivity_train.csv", index=False)
        val_df.to_csv(ml_ready / "prospectivity_validation.csv", index=False)
        test_df.to_csv(ml_ready / "prospectivity_test.csv", index=False)
        print(f"Generated prospectivity splits: {len(train_df)} train, {len(val_df)} val, {len(test_df)} test.")


def _get_or_create_drive_folder(drive_service, parent_id: str, folder_name: str) -> str:
    """Find or create a folder under parent_id in Google Drive."""
    try:
        q = f"'{parent_id}' in parents and name = '{folder_name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
        res = drive_service.files().list(q=q, spaces='drive', fields='files(id, name)').execute()
        files = res.get('files', [])
        if files:
            return files[0]['id']
        meta = {
            'name': folder_name,
            'mimeType': 'application/vnd.google-apps.folder',
            'parents': [parent_id]
        }
        folder = drive_service.files().create(body=meta, fields='id').execute()
        return folder.get('id')
    except Exception as e:
        print(f"Failed to get or create Drive folder {folder_name}: {e}")
        return parent_id


@app.function(
    image=training_image,
    volumes={"/root/artifacts_vol": volume},
    cpu=4,
    memory=8192,
    timeout=1800,
)
def run_training_job(
    domain: str = "all",
    dataset_drive_file_id: str | None = None,
    dataset_version_id: int | None = None,
    expected_checksum: str | None = None,
    data_origin: str = "REAL_USER_UPLOADED",
    gdrive_root_folder_id: str | None = None,
) -> dict:
    """Execute model training pipeline inside Modal serverless container."""
    import csv
    import shutil

    t0 = time.time()
    work_dir = pathlib.Path("/root")
    art_dir = work_dir / "apps/ml/artifacts"
    art_dir.mkdir(parents=True, exist_ok=True)

    # 1. Custom dataset ingestion
    if dataset_drive_file_id:
        try:
            custom_path = _download_and_verify_dataset(dataset_drive_file_id, expected_checksum)
            _materialize_splits_from_canonical(custom_path, domain, work_dir)
        except Exception as e:
            print(f"Error handling canonical dataset {dataset_drive_file_id}: {e}")
            raise e

    # 2. Identify scripts
    scripts_to_run = []
    if domain == "all":
        for task_list in DOMAIN_SCRIPTS.values():
            scripts_to_run.extend(task_list)
    elif domain in DOMAIN_SCRIPTS:
        scripts_to_run.extend(DOMAIN_SCRIPTS[domain])
    else:
        raise ValueError(
            f"Unknown domain '{domain}'. Must be one of: {list(DOMAIN_SCRIPTS.keys())} or 'all'"
        )

    print(f"Starting remote training on Modal for domain: '{domain}' ({len(scripts_to_run)} pipeline(s))")

    run_env = {**os.environ, "MINEX_DATA_ORIGIN": data_origin}

    run_results = []
    for name, script_path in scripts_to_run:
        full_script = work_dir / script_path
        print(f"\n{'='*60}\n  RUNNING: {name} ({script_path})\n{'='*60}")
        step_t0 = time.time()
        res = subprocess.run(
            [sys.executable, str(full_script)],
            cwd=str(work_dir),
            capture_output=True,
            text=True,
            env=run_env,
        )
        step_elapsed = time.time() - step_t0
        status = "OK" if res.returncode == 0 else "FAILED"
        print(res.stdout)
        if res.stderr:
            print("STDERR:", res.stderr, file=sys.stderr)

        run_results.append({
            "name": name,
            "script": script_path,
            "status": status,
            "duration_s": round(step_elapsed, 1),
            "error": res.stderr if status == "FAILED" else None,
        })
        if status == "FAILED":
            print(f"FAILED: {name}")

    # 3. Authenticated Google Drive Client for direct artifact upload
    # Reads service account JSON strictly from container environment (populated via Modal Secret or env)
    drive_service = None
    sa_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    root_folder = gdrive_root_folder_id or os.environ.get("GDRIVE_FOLDER_ID")

    if sa_json:
        try:
            from google.oauth2 import service_account  # type: ignore
            from googleapiclient.discovery import build  # type: ignore
            sa_info = json.loads(sa_json)
            scopes = ["https://www.googleapis.com/auth/drive"]
            creds = service_account.Credentials.from_service_account_info(sa_info, scopes=scopes)
            drive_service = build("drive", "v3", credentials=creds, cache_discovery=False)
            print("Authenticated Google Drive client initialized inside Modal container from environment.")
        except Exception as e:
            print(f"Could not initialize Google Drive client inside Modal: {e}")

    # 4. Gather generated artifacts, upload to task-specific Drive subfolder if credentials exist, commit to Volume
    generated_artifacts = []
    vol_dir = pathlib.Path("/root/artifacts_vol")
    folder_cache = {}

    for f in art_dir.glob("*.joblib"):
        dest = vol_dir / f.name
        shutil.copy2(f, dest)
        sha = compute_sha256(f)
        size = f.stat().st_size
        drive_file_id = None
        drive_folder_id = None

        if drive_service and root_folder:
            try:
                # Map artifact to specific task subfolder
                task_name = "general"
                for candidate in ["production_forecast", "shortfall", "equipment_failure", "prospectivity"]:
                    if f.name.startswith(candidate):
                        task_name = candidate
                        break

                if "models" not in folder_cache:
                    folder_cache["models"] = _get_or_create_drive_folder(drive_service, root_folder, "models")
                models_fid = folder_cache["models"]

                if task_name not in folder_cache:
                    folder_cache[task_name] = _get_or_create_drive_folder(drive_service, models_fid, task_name)
                task_fid = folder_cache[task_name]

                from googleapiclient.http import MediaFileUpload  # type: ignore
                media = MediaFileUpload(str(f), mimetype="application/octet-stream", resumable=True)
                file_metadata = {
                    "name": f.name,
                    "parents": [task_fid],
                    "description": f"modal_trained|task:{task_name}|sha256:{sha}",
                }
                up_res = drive_service.files().create(body=file_metadata, media_body=media, fields="id").execute()
                drive_file_id = up_res.get("id")
                drive_folder_id = task_fid
                print(f"Authoritative upload: {f.name} uploaded to Drive models/{task_name}/ (ID: {drive_file_id})")
            except Exception as e:
                print(f"Failed to upload {f.name} to Google Drive: {e}")

        generated_artifacts.append({
            "name": f.name,
            "size_bytes": size,
            "size_kb": round(size / 1024, 1),
            "sha256": sha,
            "drive_file_id": drive_file_id,
            "drive_folder_id": drive_folder_id,
            "volume_path": str(dest),
        })

    volume.commit()

    # 5. Collect validation metrics
    validation_records = []
    for csv_file in art_dir.glob("*_validation.csv"):
        try:
            with open(csv_file, mode="r", encoding="utf-8") as vf:
                reader = csv.DictReader(vf)
                for row in reader:
                    validation_records.append(row)
        except Exception as e:
            print(f"Error reading {csv_file}: {e}")

    total_time = round(time.time() - t0, 1)
    print(f"\n{'='*60}\n  TRAINING COMPLETE ({total_time}s)\n{'='*60}")
    print(f"Artifacts processed: {len(generated_artifacts)}")

    all_passed = all(r["status"] == "OK" for r in run_results)
    if not all_passed:
        failed_names = [r["name"] for r in run_results if r["status"] != "OK"]
        print(f"WARNING: Some pipelines failed: {failed_names}")

    return {
        "domain": domain,
        "dataset_version_id": dataset_version_id,
        "status": "completed" if all_passed else "failed",
        "total_duration_s": total_time,
        "runs": run_results,
        "artifacts": generated_artifacts,
        "metrics": validation_records,
        "data_origin": data_origin,
    }


@app.local_entrypoint()
def main(domain: str = "production", all: bool = False):
    """Local CLI entrypoint for running via `modal run apps/ml/modal_train.py`."""
    target_domain = "all" if all else domain
    print(f"Dispatching training run to Modal Cloud for domain: {target_domain}...")
    result = run_training_job.remote(domain=target_domain)
    print("\n--- Training Result ---")
    print(f"Status: {result['status']} (took {result['total_duration_s']}s)")
    print(f"Generated {len(result['artifacts'])} artifacts:")
    for a in result["artifacts"]:
        did = a.get("drive_file_id") or "no-drive-id"
        print(f"  • {a['name']} ({a['size_kb']} KB) [SHA-256: {a.get('sha256', '')[:12]}...] Drive: {did}")
    print(f"Validation records: {len(result['metrics'])}")
    for m in result['metrics']:
        print(f"  • Task: {m.get('task')} | Model: {m.get('model')} | Origin: {m.get('data_origin')}")
