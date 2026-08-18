#!/usr/bin/env bash
# PreToolUse(Bash) guard: an agent must never open, mark ready, or merge a PR on
# its own, and must never push to main — the operator decides those, in the
# moment. Returning "ask" (not "deny") keeps the human in the loop while still
# letting them approve it right there; "ask" also beats a permissive
# defaultMode, which a plain allow-list rule would not.
set -euo pipefail

input=$(cat)

# jq is what Claude Code ships against; fall back to a crude extraction so a
# missing jq degrades to "still guarded", never to "silently allows".
if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')
else
  cmd=$(printf '%s' "$input" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p')
fi

[ -n "$cmd" ] || exit 0

# Normalise: collapse whitespace so `gh   pr\n  create` matches too. Sub-commands
# joined with ; && || are all still visible in this single string, so a guarded
# command hidden mid-line is caught.
norm=$(printf '%s' "$cmd" | tr '\n\t' '  ' | tr -s ' ')

reason=""
case "$norm" in
  *"gh pr create"*)  reason="เปิด PR ต้องให้ผู้ใช้ตัดสินใจก่อนเสมอ (/implement ขั้นที่ 5) — อนุมัติที่นี่ถ้าผู้ใช้บอกให้เปิดแล้ว" ;;
  *"gh pr merge"*)   reason="agent ไม่ merge PR เอง — ผู้ใช้เป็นคนกดเอง" ;;
  *"gh pr ready"*)   reason="การเปลี่ยน draft → ready เท่ากับส่งเข้ารีวิวจริง ต้องให้ผู้ใช้ยืนยัน" ;;
esac

# `git push` targeting main in any argument order (origin main, main:main,
# HEAD:main, --force origin main …). Pushing a feature branch stays untouched.
if [ -z "$reason" ]; then
  case "$norm" in
    *"git push"*)
      if printf '%s' "$norm" | grep -Eq 'git push[^;&|]*(\bmain\b|:main\b)'; then
        reason="ห้าม push ตรงเข้า main — แตกสาขาแล้วเปิด PR (ruleset ฝั่ง GitHub ก็จะปฏิเสธอยู่ดี)"
      fi
      ;;
  esac
fi

[ -n "$reason" ] || exit 0

printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"%s"}}\n' "$reason"
