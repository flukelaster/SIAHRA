#!/usr/bin/env bash
# apply-branch-rules.sh — push .github/rulesets/main.json to GitHub as the
# repository ruleset for the default branch, and turn on "delete branch on
# merge". Idempotent: updates the ruleset in place if one with the same name
# already exists. Needs `gh` logged in as a repo admin.
#
# What the ruleset enforces on `main` (no bypass actors — applies to admins too;
# edit it in Settings → Rules → Rulesets if you must hotfix around it):
#   - no direct pushes: every change arrives via a pull request
#   - no force-push, no branch deletion
#   - required status checks (from GitHub Actions, integration_id 15368):
#       Lint, TypeScript, Build   (.github/workflows/ci.yml)
#       PR screenshot             (.github/workflows/pr-rules.yml)
#     0 approving reviews required — this is a solo-maintained repo; bump
#     required_approving_review_count in main.json when that changes.
#
# Usage:  scripts/apply-branch-rules.sh [owner/repo]
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
ruleset_file="$here/.github/rulesets/main.json"
[ -f "$ruleset_file" ] || { echo "missing $ruleset_file" >&2; exit 1; }
command -v gh >/dev/null || { echo "gh not found" >&2; exit 1; }

repo="${1:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
name="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["name"])' "$ruleset_file")"

existing_id="$(gh api "repos/$repo/rulesets" --jq ".[] | select(.name == \"$name\") | .id" | head -1)"
if [ -n "$existing_id" ]; then
  gh api -X PUT "repos/$repo/rulesets/$existing_id" --input "$ruleset_file" --jq '"updated ruleset #\(.id) \"\(.name)\" (\(.enforcement))"'
else
  gh api -X POST "repos/$repo/rulesets" --input "$ruleset_file" --jq '"created ruleset #\(.id) \"\(.name)\" (\(.enforcement))"'
fi

# Merged branches get deleted automatically (AGENTS.md: never leave a merged
# branch lying around). Locals still need `git branch -d` + `git pull`.
gh api -X PATCH "repos/$repo" -F delete_branch_on_merge=true --jq '"delete_branch_on_merge = \(.delete_branch_on_merge)"'
