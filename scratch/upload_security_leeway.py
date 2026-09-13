"""Upload updated security.py to HF."""
import os

from huggingface_hub import HfApi

# Read from the environment — never hardcode. Export HF_TOKEN before running.
api = HfApi(token=os.environ["HF_TOKEN"])
repo_id = "friday2006/minex_backend"

result = api.upload_file(
    path_or_fileobj="apps/api/core/security.py",
    path_in_repo="apps/api/core/security.py",
    repo_id=repo_id,
    repo_type="space",
    commit_message="fix: add leeway to jwt verification to prevent clock skew 401s",
)
print(f"Uploaded security.py: {result}")
