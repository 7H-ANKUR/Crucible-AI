"""Upload only the two fixed Python files to HF Spaces via the Hub API."""
import os

from huggingface_hub import HfApi

# Read from the environment — never hardcode. Export HF_TOKEN before running.
api = HfApi(token=os.environ["HF_TOKEN"])
repo_id = "friday2006/minex_backend"

files = [
    ("apps/api/routers/equipment.py", "apps/api/routers/equipment.py"),
    ("apps/api/routers/production.py", "apps/api/routers/production.py"),
]

for local_path, repo_path in files:
    result = api.upload_file(
        path_or_fileobj=local_path,
        path_in_repo=repo_path,
        repo_id=repo_id,
        repo_type="space",
        commit_message=f"fix: 500 errors - {repo_path.split('/')[-1]}",
    )
    print(f"Uploaded {repo_path}: {result}")

print("\nDone! Space will restart shortly.")
