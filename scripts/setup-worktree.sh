#!/usr/bin/env bash
# Set up a git worktree of SIAHRA so `npm run dev` works immediately.
#
# Usage:
#   scripts/setup-worktree.sh [worktree-path]   # default: $PWD
#
# Run the ROOT checkout's copy of this script (orca.yaml does this) — never the
# worktree's own copy, which is branch-controlled. The worktree path is data.
#
# What it does:
#   1. links the big generated datasets (apps/etl/data/{raw,work,tiles}: DEM,
#      OSM, WorldCover, terrain/building/feature/landcover tiles — ~12 GB,
#      gitignored) from the root checkout instead of copying them
#   2. copies apps/api/.dev.vars (if the root has one) and the local
#      wrangler state (Durable Object SQLite + local R2: caches + archive)
#   3. allocates a web + api dev port pair for this worktree -> .env.worktree
#   4. npm ci (falls back to npm install if the branch changed package.json)
#   5. builds apps/web/dist once — wrangler dev refuses to start without the
#      assets directory (this is what killed the API when dist was deleted)

set -euo pipefail

WT_DIR="${1:-$PWD}"
ROOT_DIR="$(git -C "$WT_DIR" worktree list --porcelain | head -1 | sed 's/^worktree //')"

if [ ! -f "$WT_DIR/package.json" ] || [ ! -d "$WT_DIR/apps/web" ]; then
  echo "setup-worktree: $WT_DIR ไม่ใช่ checkout ของ SIAHRA" >&2
  exit 1
fi

# 1) generated data: symlink, never copy (GBs). Only when this is a worktree.
if [ "$ROOT_DIR" != "$WT_DIR" ]; then
  mkdir -p "$WT_DIR/apps/etl/data"
  for d in raw work tiles; do
    src="$ROOT_DIR/apps/etl/data/$d"
    dst="$WT_DIR/apps/etl/data/$d"
    if [ -L "$dst" ]; then
      echo "✓ apps/etl/data/$d ลิงก์อยู่แล้ว"
    elif [ -e "$dst" ]; then
      echo "▸ apps/etl/data/$d มีของอยู่แล้ว (ไม่แตะ)"
    elif [ -d "$src" ]; then
      ln -s "$src" "$dst"
      echo "✓ apps/etl/data/$d → $src (symlink)"
    else
      echo "▸ root ไม่มี apps/etl/data/$d — ข้าม (รัน ETL ที่ root ก่อนถ้าต้องใช้ tile)"
    fi
  done
fi

# 2) local secrets + wrangler state
if [ -f "$WT_DIR/apps/api/.dev.vars" ]; then
  echo "✓ apps/api/.dev.vars มีอยู่แล้ว"
elif [ -f "$ROOT_DIR/apps/api/.dev.vars" ] && [ "$ROOT_DIR" != "$WT_DIR" ]; then
  cp "$ROOT_DIR/apps/api/.dev.vars" "$WT_DIR/apps/api/.dev.vars"
  echo "✓ Copied apps/api/.dev.vars from main"
fi
if [ -d "$WT_DIR/apps/api/.wrangler/state" ]; then
  echo "✓ apps/api/.wrangler/state มีอยู่แล้ว"
elif [ -d "$ROOT_DIR/apps/api/.wrangler/state" ] && [ "$ROOT_DIR" != "$WT_DIR" ]; then
  mkdir -p "$WT_DIR/apps/api/.wrangler"
  cp -R "$ROOT_DIR/apps/api/.wrangler/state" "$WT_DIR/apps/api/.wrangler/state"
  echo "✓ Copied apps/api/.wrangler/state from main (DO caches + local R2 archive)"
else
  echo "▸ ไม่มี wrangler state ให้ copy — DO จะดึงข้อมูลสดเองในนาทีแรก"
fi

# 3) allocate web+api dev ports (root keeps 5173/8787)
port_free() { ! lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
find_free_port() {
  local p="$1"
  while ! port_free "$p"; do p=$((p + 1)); done
  echo "$p"
}
if [ "$ROOT_DIR" = "$WT_DIR" ]; then
  WEB_PORT=5173
  API_PORT=8787
else
  WEB_PORT="$(find_free_port 5175)"
  API_PORT="$(find_free_port 8790)"
fi
{
  echo "SIAHRA_WEB_DEV_PORT=$WEB_PORT"
  echo "SIAHRA_API_DEV_PORT=$API_PORT"
} > "$WT_DIR/.env.worktree"
echo "alloc-worktree-ports: web:$WEB_PORT api:$API_PORT → $WT_DIR/.env.worktree"

# 4) dependencies
cd "$WT_DIR"
echo "Installing dependencies..."
if npm ci; then
  echo "✓ npm ci complete (lockfile-exact)"
else
  echo "▸ npm ci ไม่ผ่าน (ดู error ด้านบน) — falling back to npm install"
  npm install
  echo "✓ npm install complete — commit package-lock.json ที่อัปเดตด้วยถ้า dep เปลี่ยนจริง"
fi

# 5) web dist for wrangler's assets directory
if [ ! -d "$WT_DIR/apps/web/dist" ]; then
  echo "Building apps/web once (wrangler dev needs apps/web/dist to exist)..."
  npm run build -w apps/web
fi

echo ""
echo "┌─────────────────────────────────────────────"
echo "│ Worktree ready"
echo "│ Web:  http://localhost:${WEB_PORT}"
echo "│ API:  http://127.0.0.1:${API_PORT}/api/v1/health"
echo "└─────────────────────────────────────────────"
echo ""
echo "Start dev servers:  npm run dev   (ports from .env.worktree)"
