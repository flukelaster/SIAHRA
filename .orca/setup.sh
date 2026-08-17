#!/usr/bin/env bash
# Orca worktree setup for SIAHRA — delegates to the TRUSTED ROOT copy of
# scripts/setup-worktree.sh with the worktree path passed as data. Never exec
# the worktree's own (branch-controlled) copy.

set -euo pipefail

WT_DIR="${ORCA_WORKTREE_PATH:-$PWD}"
ROOT_DIR="${ORCA_ROOT_PATH:-$(git -C "$WT_DIR" worktree list --porcelain | head -1 | sed 's/^worktree //')}"

exec bash "$ROOT_DIR/scripts/setup-worktree.sh" "$WT_DIR"
