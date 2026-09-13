#!/usr/bin/env python3
"""scripts/sync_drive_ids.py

Queries a Google Drive folder using gdown and automatically populates
DRIVE_FILE_IDS in app/api/core/gdrive_artifacts.py.

USAGE:
  python scripts/sync_drive_ids.py
  python scripts/sync_drive_ids.py --folder-id 1XykuJ8El-yQ_27FrdCzL7VHraoyGrBKy
"""
import argparse
import pathlib
import re
import sys

DEFAULT_FOLDER_ID = "1XykuJ8El-yQ_27FrdCzL7VHraoyGrBKy"
TARGET_FILE = pathlib.Path("app/api/core/gdrive_artifacts.py")


def main():
    parser = argparse.ArgumentParser(description="Sync Drive file IDs from a shared folder")
    parser.add_argument("--folder-id", default=DEFAULT_FOLDER_ID, help="Google Drive folder ID")
    args = parser.parse_args()

    print(f"Scanning Google Drive folder: {args.folder_id} ...")
    try:
        import gdown
    except ImportError:
        print("ERROR: gdown not installed. Run: pip install gdown")
        sys.exit(1)

    try:
        items = gdown.download_folder(id=args.folder_id, skip_download=True, quiet=False)
    except Exception as e:
        print(f"ERROR: Failed to scan folder: {e}")
        sys.exit(1)

    if not items:
        print("\nWARNING: No files found in the Google Drive folder yet!")
        print("Please upload your .joblib files from app/ml/artifacts/ into:")
        print(f"  https://drive.google.com/drive/folders/{args.folder_id}")
        return

    found = {}
    for item in items:
        name = pathlib.Path(item.path).name
        if name.endswith(".joblib"):
            found[name] = item.id

    print(f"\nFound {len(found)} .joblib artifacts in Drive folder:")
    for name, fid in sorted(found.items()):
        print(f"  ✓ {name}: {fid}")

    if not TARGET_FILE.exists():
        print(f"\nError: {TARGET_FILE} not found.")
        return

    # Update TARGET_FILE
    content = TARGET_FILE.read_text(encoding="utf-8")
    updated_count = 0
    for name, fid in found.items():
        pattern = rf'("{re.escape(name)}":\s*)"[^"]*"'
        if re.search(pattern, content):
            content = re.sub(pattern, rf'\g<1>"{fid}"', content)
            updated_count += 1

    TARGET_FILE.write_text(content, encoding="utf-8")
    print(f"\nUpdated {updated_count} file IDs in {TARGET_FILE}")


if __name__ == "__main__":
    main()
