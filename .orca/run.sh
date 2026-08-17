#!/usr/bin/env bash
# Orca "Run" quick command for SIAHRA — starts web (Vite) + API (wrangler dev)
# in this worktree via `npm run dev` (concurrently under the hood).
#
# Add as an Orca Quick Command (Action: Terminal Command, Scope: Project):
#   f="${ORCA_WORKTREE_PATH:-.}/.orca/run.sh"; [ -f "$f" ] || f="${ORCA_ROOT_PATH:-.}/.orca/run.sh"; bash "$f"

set -uo pipefail
cd "${ORCA_WORKTREE_PATH:-$PWD}" || exit 1

# Parse (never source) the per-worktree ports so the Run pane shows the URLs
# up front; vite.config.ts and apps/api/scripts/dev-api.mjs read the same file.
WEB_PORT="$(sed -n 's/^SIAHRA_WEB_DEV_PORT=\([0-9]*\)$/\1/p' .env.worktree 2>/dev/null | head -1)"
API_PORT="$(sed -n 's/^SIAHRA_API_DEV_PORT=\([0-9]*\)$/\1/p' .env.worktree 2>/dev/null | head -1)"
echo "▶ SIAHRA dev — web http://localhost:${WEB_PORT:-5173} · api http://127.0.0.1:${API_PORT:-8787}/api/v1/health"
echo

# exec so stop/restart signals from the Run pane reach the dev servers directly.
exec npm run dev
