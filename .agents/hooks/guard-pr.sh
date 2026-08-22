#!/usr/bin/env bash
# Antigravity PreToolUse hook: Guards git push to main and gh pr create/merge/ready
set -euo pipefail

input=$(cat)

if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$input" | jq -r '.toolCall.args.CommandLine // .tool_input.command // ""')
else
  cmd=$(printf '%s' "$input" | sed -n 's/.*"CommandLine"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p')
fi

if [ -z "$cmd" ]; then
  printf '{"decision":"allow"}\n'
  exit 0
fi

# Check for PR creation / merge / ready
if printf '%s' "$cmd" | grep -Eq 'gh[[:space:]]+pr[[:space:]]+create'; then
  printf '{"decision":"ask","reason":"Opening a PR requires user confirmation (/implement step 5)."}\n'
  exit 0
fi

if printf '%s' "$cmd" | grep -Eq 'gh[[:space:]]+pr[[:space:]]+merge'; then
  printf '{"decision":"ask","reason":"Merging PRs is reserved for the user."}\n'
  exit 0
fi

if printf '%s' "$cmd" | grep -Eq 'gh[[:space:]]+pr[[:space:]]+ready'; then
  printf '{"decision":"ask","reason":"Marking PR ready requires user confirmation."}\n'
  exit 0
fi

# Check for push to main
if printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+push.*(\bmain\b|:main\b)'; then
  printf '{"decision":"ask","reason":"Direct push to main is prohibited by project branch rules. Use a feature branch."}\n'
  exit 0
fi

printf '{"decision":"allow"}\n'
