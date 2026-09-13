import os
import urllib.request

# Read from the environment — never hardcode. Export HF_TOKEN before running:
#   export HF_TOKEN=hf_...        (bash)
token = os.environ["HF_TOKEN"]

req = urllib.request.Request(
    'https://huggingface.co/api/spaces/friday2006/minex_backend/logs/run',
    headers={'Authorization': f'Bearer {token}'}
)
with urllib.request.urlopen(req, timeout=8) as resp:
    with open('scratch/hf_logs2.txt', 'w', encoding='utf-8') as f:
        for _ in range(800):
            l = resp.readline().decode('utf-8', errors='ignore')
            if not l:
                break
            f.write(l)

print("Done writing logs")
