#!/bin/bash
# start.sh — Start both the Crucible AI engine (port 8100) and the gateway (port $PORT)
# The engine runs on loopback only (127.0.0.1) — it is never exposed publicly.
# The gateway proxies to it via CRUCIBLE_BASE_URL=http://127.0.0.1:8100

set -e

# Figure out where the project root is (works both on Render and locally)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENGINE_DIR="$SCRIPT_DIR/app/engine"

echo "[start.sh] Project root: $SCRIPT_DIR"
echo "[start.sh] Engine dir:   $ENGINE_DIR"
echo "[start.sh] Starting Crucible AI engine on 127.0.0.1:8100..."

# PYTHONPATH includes the engine dir so 'from api.xxx import' and 'from core.xxx import' resolve.
# Absolute paths for data dirs so the engine writes to a stable location regardless of cwd.
CRUCIBLE_API_HOST=127.0.0.1 \
CRUCIBLE_API_PORT=8100 \
CRUCIBLE_CHECKPOINT_ROOT="$ENGINE_DIR/.crucible_checkpoints" \
CRUCIBLE_ARTIFACT_ROOT="$ENGINE_DIR/.crucible_artifacts" \
CRUCIBLE_UPLOAD_TMP="$ENGINE_DIR/.crucible_uploads" \
CRUCIBLE_STORE_ROOT="$ENGINE_DIR/.crucible_store" \
PYTHONPATH="$ENGINE_DIR${PYTHONPATH:+:$PYTHONPATH}" \
  python -m uvicorn api.main:app --host 127.0.0.1 --port 8100 &

ENGINE_PID=$!
echo "[start.sh] Engine PID: $ENGINE_PID"

echo "[start.sh] Starting Crucible AI gateway on 0.0.0.0:$PORT..."
exec python -m uvicorn app.api.main:app --host 0.0.0.0 --port "$PORT"
