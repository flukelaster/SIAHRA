#!/usr/bin/env bash
# Orca worktree teardown for SIAHRA (the `archive` hook in orca.yaml).
#
# Orca removes the worktree directory afterwards (node_modules, dist, the
# worktree's own apps/api/.wrangler state). The only thing left to stop is a
# dev server (vite / wrangler / workerd) still running from THIS worktree — we
# kill only processes whose cwd is inside this worktree, never a broad pkill.

set -uo pipefail

WT_DIR="${ORCA_WORKTREE_PATH:-$PWD}"

killed=0
for pid in $(pgrep -f "vite|wrangler dev|workerd" 2>/dev/null || true); do
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
  case "$cwd" in
    "$WT_DIR"|"$WT_DIR"/*)
      kill "$pid" 2>/dev/null && killed=$((killed + 1))
      ;;
  esac
done

if [ "$killed" -gt 0 ]; then
  echo "teardown: stopped $killed dev process(es) running in $WT_DIR"
else
  echo "teardown: no dev servers running in this worktree"
fi
