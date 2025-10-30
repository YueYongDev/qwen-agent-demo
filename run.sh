#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
VENV_DIR="$BACKEND_DIR/.venv"

echo "[qwen-agent] Starting launch helper..."

command -v python3 >/dev/null 2>&1 || { echo "python3 is required but not found."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "npm is required but not found."; exit 1; }

if [ ! -d "$VENV_DIR" ]; then
  echo "[qwen-agent] Creating Python virtual environment at $VENV_DIR"
  python3 -m venv "$VENV_DIR"
fi

echo "[qwen-agent] Installing backend dependencies..."
"$VENV_DIR/bin/python" -m pip install --disable-pip-version-check --upgrade pip >/dev/null
"$VENV_DIR/bin/python" -m pip install --disable-pip-version-check -r "$BACKEND_DIR/requirements.txt"

if [ -f "$BACKEND_DIR/.env" ]; then
  echo "[qwen-agent] Loading backend environment variables from backend/.env"
  set -a
  # shellcheck disable=SC1090
  source "$BACKEND_DIR/.env"
  set +a
fi

echo "[qwen-agent] Preparing frontend dependencies..."
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  (cd "$FRONTEND_DIR" && npm install)
fi

BACKEND_PID=""
FRONTEND_PID=""
__CLEANED_UP=0

cleanup() {
  if [ "$__CLEANED_UP" -eq 1 ]; then
    return
  fi

  __CLEANED_UP=1
  set +e
  echo
  echo "[qwen-agent] Stopping services..."
  if [ -n "$FRONTEND_PID" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null
    wait "$FRONTEND_PID" 2>/dev/null
  fi
  if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null
    wait "$BACKEND_PID" 2>/dev/null
  fi
  set -e
  echo "[qwen-agent] Shutdown complete."
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# 新增：在启动前确保端口空闲，避免旧实例占用端口
ensure_port_free() {
  local port="$1"
  local pids
  pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "[qwen-agent] Found processes on port ${port}: ${pids}"
    echo "[qwen-agent] Stopping processes on port ${port}..."
    kill ${pids} 2>/dev/null || true
    sleep 1
    pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
      echo "[qwen-agent] Force killing processes on port ${port}..."
      kill -9 ${pids} 2>/dev/null || true
    fi
  fi
}

# 新增：启动前清理端口（后端 8000，前端 5173）
echo "[qwen-agent] Ensuring ports 8000 and 5173 are free before launch"
ensure_port_free 8000
ensure_port_free 5173

echo "[qwen-agent] Launching backend on http://localhost:8000"
PYTHONPATH="$BACKEND_DIR" "$VENV_DIR/bin/python" -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

echo "[qwen-agent] Launching frontend dev server on http://localhost:5173"
(cd "$FRONTEND_DIR" && npm run dev -- --host 0.0.0.0 --port 5173) &
FRONTEND_PID=$!

echo "[qwen-agent] Backend PID: $BACKEND_PID"
echo "[qwen-agent] Frontend PID: $FRONTEND_PID"
echo "[qwen-agent] Press Ctrl+C to stop both services."

wait $BACKEND_PID $FRONTEND_PID