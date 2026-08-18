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

# Normalise whitespace, then treat every shell separator as a segment boundary so
# a guarded command hidden behind `&&`, `;`, a pipe or `$(...)` is still seen.
norm=$(printf '%s' "$cmd" | tr '\n\t' '  ' | tr -s ' ')
segments=$(printf '%s' "$norm" | sed 's/[;&|()`]/\n/g; s/\$(/\n/g')

# Which `gh pr` subcommand does this segment invoke, if any? Flags may appear
# anywhere gh accepts them — `gh -R o/r pr create`, `gh pr --repo o/r merge`,
# `gh pr create --fill` are all real forms, so skip over flags and their values
# rather than matching the literal string "gh pr create".
gh_pr_subcommand() {
  local -a tok=($1)
  local i=0 n=${#tok[@]} seen_gh=0 seen_pr=0 t
  while [ $i -lt $n ]; do
    t=${tok[$i]}
    case "$t" in
      -*)
        # `--repo owner/repo` and friends take a separate value; `--flag=value`
        # and boolean flags do not.
        if [ "${t#*=}" = "$t" ] && [ $((i+1)) -lt $n ] && [ "${tok[$((i+1))]#-}" = "${tok[$((i+1))]}" ]; then
          case "$t" in
            -R|--repo|-H|--hostname|-t|--title|-b|--body|-F|--body-file|-B|--base|-h|--head|-l|--label|-a|--assignee|-r|--reviewer|-p|--project|-m|--milestone|-d|--delete-branch)
              i=$((i+2)); continue ;;
          esac
        fi
        i=$((i+1)); continue ;;
    esac
    if [ $seen_gh -eq 0 ]; then
      [ "$t" = "gh" ] && seen_gh=1
      i=$((i+1)); continue
    fi
    if [ $seen_pr -eq 0 ]; then
      if [ "$t" = "pr" ]; then seen_pr=1; else seen_gh=0; fi
      i=$((i+1)); continue
    fi
    printf '%s' "$t"; return 0
  done
  return 0
}

reason=""
while IFS= read -r seg; do
  [ -n "$seg" ] || continue
  case "$seg" in *gh*) ;; *git\ push*) ;; *) continue ;; esac

  sub=$(gh_pr_subcommand "$seg")
  case "$sub" in
    create) reason="เปิด PR ต้องให้ผู้ใช้ตัดสินใจก่อนเสมอ (/implement ขั้นที่ 5) — อนุมัติที่นี่ถ้าผู้ใช้บอกให้เปิดแล้ว"; break ;;
    merge)  reason="agent ไม่ merge PR เอง — ผู้ใช้เป็นคนกดเอง"; break ;;
    ready)  reason="การเปลี่ยน draft → ready เท่ากับส่งเข้ารีวิวจริง ต้องให้ผู้ใช้ยืนยัน"; break ;;
  esac

  # `git push` reaching main. Two ways that happens, and the literal-argument
  # check only catches the first:
  #   1. main named explicitly — `origin main`, `main:main`, `HEAD:main`
  #   2. no refspec at all while checked out on main — a bare `git push` or
  #      `git push origin HEAD` publishes the current branch, so the word "main"
  #      never appears in the command
  case "$seg" in
    *"git push"*)
      if printf '%s' "$seg" | grep -Eq 'git push[^;&|]*(\bmain\b|:main\b)'; then
        reason="ห้าม push ตรงเข้า main — แตกสาขาแล้วเปิด PR (ruleset ฝั่ง GitHub ก็จะปฏิเสธอยู่ดี)"
        break
      fi
      # Resolve the branch we are actually on. Fail closed: if git cannot answer
      # (not a repo, detached HEAD), guard rather than wave it through.
      branch=$(git -C "${CLAUDE_PROJECT_DIR:-.}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
      if [ "$branch" = "main" ] || [ -z "$branch" ]; then
        reason="อยู่บนสาขา ${branch:-<ไม่ทราบ>} — \`git push\` เปล่า ๆ จะยิงเข้า main ตรง ๆ ให้แตกสาขาแล้วเปิด PR แทน"
        break
      fi
      ;;
  esac
done <<< "$segments"

[ -n "$reason" ] || exit 0

printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"%s"}}\n' "$reason"
