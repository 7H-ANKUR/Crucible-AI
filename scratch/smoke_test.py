import json
import urllib.request

base = "https://friday2006-minex-backend.hf.space/api/v1"
tests = [
    f"{base}/equipment/MINE-A/fleet",
    f"{base}/production/MINE-A/history?limit=3&granularity=shift",
    f"{base}/mines",
    f"{base}/health",
]

for url in tests:
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
            # just print key names to avoid wall of text
            keys = list(data.keys()) if isinstance(data, dict) else f"list[{len(data)}]"
            print(f"  OK  {url.split('v1')[1]}  => {keys}")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")[:200]
        print(f"  {e.code}  {url.split('v1')[1]}  => {body}")
    except Exception as e:
        print(f"  ERR {url.split('v1')[1]}  => {e}")
