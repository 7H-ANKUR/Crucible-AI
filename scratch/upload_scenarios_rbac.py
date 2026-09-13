"""Upload updated scenarios.py to HF."""
import os

from huggingface_hub import HfApi

# Read from the environment — never hardcode. Export HF_TOKEN before running.
api = HfApi(token=os.environ["HF_TOKEN"])
repo_id = "friday2006/minex_backend"

result = api.upload_file(
    path_or_fileobj="apps/api/routers/scenarios.py",
    path_in_repo="apps/api/routers/scenarios.py",
    repo_id=repo_id,
    repo_type="space",
    commit_message="fix: loosen rbac for scenarios run to require_authenticated instead of specific roles to allow demo users",
)
print(f"Uploaded scenarios.py: {result}")
