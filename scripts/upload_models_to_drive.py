#!/usr/bin/env python3
"""scripts/upload_models_to_drive.py

Uploads all .joblib artifacts from app/ml/artifacts/ to a Google Drive folder
and prints the file IDs to paste into gdrive_artifacts.py.

USAGE:
  1. Install: pip install google-auth google-auth-httplib2 google-api-python-client
  2. Create a Google Cloud service account:
       - Go to console.cloud.google.com → IAM → Service Accounts → Create
       - Enable the Google Drive API for the project
       - Download the JSON key file → save as scripts/service_account.json
  3. Share your target Google Drive folder with the service account email
  4. Run: python scripts/upload_models_to_drive.py --folder-id YOUR_FOLDER_ID

  --- OR (simpler, manual method) ---
  Upload the files manually to Drive, right-click each → Share → Anyone with link,
  then copy the file IDs and paste into gdrive_artifacts.py directly.
  The manual method requires no service account setup.

OUTPUT:
  Prints a ready-to-paste block for gdrive_artifacts.DRIVE_FILE_IDS
"""
import argparse
import pathlib
import sys

ARTIFACTS_DIR = pathlib.Path("app/ml/artifacts")

JOBLIB_FILES = [
    "production_forecast_champion.joblib",
    "production_forecast_p10.joblib",
    "production_forecast_p50.joblib",
    "production_forecast_p90.joblib",
    "production_forecast_features.joblib",
    "production_forecast_medians.joblib",
    "production_forecast_explainer.joblib",
    "shortfall_champion.joblib",
    "shortfall_features.joblib",
    "equipment_failure_champion.joblib",
    "equipment_failure_features.joblib",
    "equipment_failure_catmap.joblib",
    "equipment_failure_medians.joblib",
    "equipment_failure_calibrator.joblib",
    "prospectivity_champion.joblib",
    "prospectivity_features.joblib",
]


def upload_via_service_account(folder_id: str, key_file: str):
    """Upload using a Google service account JSON key."""
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaFileUpload
    except ImportError:
        print("ERROR: Missing packages. Run:")
        print("  pip install google-auth google-auth-httplib2 google-api-python-client")
        sys.exit(1)

    SCOPES = ["https://www.googleapis.com/auth/drive.file"]
    creds = service_account.Credentials.from_service_account_file(key_file, scopes=SCOPES)
    service = build("drive", "v3", credentials=creds)

    file_ids = {}
    for fname in JOBLIB_FILES:
        path = ARTIFACTS_DIR / fname
        if not path.exists():
            print(f"  SKIP (not found): {fname}")
            file_ids[fname] = ""
            continue

        size_kb = path.stat().st_size / 1024
        print(f"  Uploading {fname} ({size_kb:.1f} KB)...", end=" ", flush=True)

        file_metadata = {"name": fname, "parents": [folder_id]}
        media = MediaFileUpload(str(path), resumable=True)
        result = service.files().create(
            body=file_metadata, media_body=media, fields="id"
        ).execute()
        fid = result.get("id", "")
        file_ids[fname] = fid
        print(f"OK → {fid}")

    return file_ids


def print_registry(file_ids: dict):
    """Print the ready-to-paste DRIVE_FILE_IDS block."""
    print("\n" + "="*70)
    print("Paste this into app/api/core/gdrive_artifacts.py:")
    print("="*70)
    print("DRIVE_FILE_IDS: dict[str, str] = {")
    for fname, fid in file_ids.items():
        print(f'    "{fname}": "{fid}",')
    print("}")
    print("="*70 + "\n")


def main():
    parser = argparse.ArgumentParser(description="Upload Crucible AI ML artifacts to Google Drive")
    parser.add_argument("--folder-id", required=True, help="Target Google Drive folder ID")
    parser.add_argument("--key-file", default="scripts/service_account.json",
                        help="Path to service account JSON key (default: scripts/service_account.json)")
    args = parser.parse_args()

    print(f"\nUploading {len(JOBLIB_FILES)} artifacts to Drive folder: {args.folder_id}")
    print(f"Using service account key: {args.key_file}\n")

    file_ids = upload_via_service_account(args.folder_id, args.key_file)
    print_registry(file_ids)


if __name__ == "__main__":
    main()
