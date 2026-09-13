"""Decode a live Clerk token header to check kid, then compare against JWKS."""
import base64
import json
import urllib.request

# ---- 1. Fetch JWKS keys ----
jwks_url = "https://next-grizzly-4122.clerk.accounts.dev/.well-known/jwks.json"
with urllib.request.urlopen(jwks_url, timeout=8) as r:
    jwks = json.loads(r.read())

print("=== JWKS kids ===")
for k in jwks.get("keys", []):
    print(f"  kid={k.get('kid')}  alg={k.get('alg')}  kty={k.get('kty')}")

print()

# ---- 2. Paste a real token from browser devtools here ----
# Copy from: DevTools → Network → any /api/v1/ request → Authorization header → paste the token after "Bearer "
TOKEN = ""  # <-- paste token here to diagnose

if TOKEN:
    parts = TOKEN.split(".")
    if len(parts) >= 2:
        header_b64 = parts[0] + "=" * (-len(parts[0]) % 4)
        payload_b64 = parts[1] + "=" * (-len(parts[1]) % 4)
        header = json.loads(base64.urlsafe_b64decode(header_b64))
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        print("=== Token Header ===")
        print(json.dumps(header, indent=2))
        print("=== Token Payload (claims only) ===")
        safe = {k: v for k, v in payload.items() if k not in ("jti",)}
        print(json.dumps(safe, indent=2))

        kid = header.get("kid")
        jwks_kids = [k.get("kid") for k in jwks.get("keys", [])]
        print(f"\nToken kid: {kid}")
        print(f"JWKS kids: {jwks_kids}")
        print(f"Match: {kid in jwks_kids}")
else:
    print("(paste a real Clerk token into TOKEN above to diagnose kid mismatch)")
