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
# `$(command -v gh) pr create` / `$(which git) push` resolve to the executable at
# run time; fold them back to the plain name so the tokenisers below see it.
norm=$(printf '%s' "$norm" | sed -E 's/\$\((command -v|which) ([A-Za-z0-9_.-]+)\)/\2/g; s/`(command -v|which) ([A-Za-z0-9_.-]+)`/\2/g')
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
      # `/usr/local/bin/gh`, `$(command -v gh)` — compare the basename, not the
      # literal token, or a resolved path walks straight past the guard.
      [ "${t##*/}" = "gh" ] && seen_gh=1
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

# Is this segment a `git push`? `git` accepts global options before the
# subcommand — `git -C /path push`, `git --no-pager push`, `git -c k=v push` —
# so the literal text "git push" is not reliable.
is_git_push() {
  local -a tok=($1)
  local i=0 n=${#tok[@]} seen_git=0 t
  while [ $i -lt $n ]; do
    t=${tok[$i]}
    if [ $seen_git -eq 0 ]; then
      [ "${t##*/}" = "git" ] && seen_git=1
      i=$((i+1)); continue
    fi
    case "$t" in
      -C|-c|--git-dir|--work-tree|--namespace|--exec-path)
        i=$((i+2)); continue ;;
      -*) i=$((i+1)); continue ;;
    esac
    [ "$t" = "push" ] && return 0
    return 1
  done
  return 1
}

# The repository a `git -C <path> …` command actually acts on, so the
# current-branch check below looks at the right worktree.
git_target_dir() {
  local -a tok=($1)
  local i=0 n=${#tok[@]}
  while [ $i -lt $n ]; do
    if [ "${tok[$i]}" = "-C" ] && [ $((i+1)) -lt $n ]; then
      printf '%s' "${tok[$((i+1))]}"; return 0
    fi
    i=$((i+1))
  done
  printf '%s' "${CLAUDE_PROJECT_DIR:-.}"
}

reason=""
while IFS= read -r seg; do
  [ -n "$seg" ] || continue
  case "$seg" in *gh*) ;; *git*) ;; *) continue ;; esac  # basename check happens in the tokenisers

  sub=$(gh_pr_subcommand "$seg")
  # A leftover `pr create` fragment (e.g. produced by a substitution this script
  # could not fold) is treated the same way — fail closed.
  if [ -z "$sub" ]; then
    case "$seg" in
      "pr create"*|" pr create"*|"pr merge"*|" pr merge"*|"pr ready"*|" pr ready"*)
        sub=$(printf '%s' "$seg" | awk '{print $2}') ;;
    esac
  fi
  case "$sub" in
    create) reason="Opening a PR is always the user's call (/implement step 5) — approve here if they already said to open it"; break ;;
    merge)  reason="Agents do not merge PRs — the user does that themselves"; break ;;
    ready)  reason="Marking a draft ready sends it into real review — needs the user's confirmation"; break ;;
  esac

  # `git push` reaching main. Two ways that happens, and the literal-argument
  # check only catches the first:
  #   1. main named explicitly — `origin main`, `main:main`, `HEAD:main`
  #   2. no refspec at all while checked out on main — a bare `git push` or
  #      `git push origin HEAD` publishes the current branch, so the word "main"
  #      never appears in the command
  if is_git_push "$seg"; then
    if printf '%s' "$seg" | grep -Eq '(\bmain\b|:main\b)'; then
      reason="Never push straight to main — branch and open a PR (the GitHub ruleset rejects it anyway)"
      break
    fi
    # Resolve the branch we are actually on. Fail closed: if git cannot answer
    # (not a repo, detached HEAD), guard rather than wave it through.
    branch=$(git -C "$(git_target_dir "$seg")" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
    if [ "$branch" = "main" ] || [ -z "$branch" ]; then
      reason="On branch ${branch:-<unknown>} — a bare \`git push\` would go straight to main; branch and open a PR instead"
      break
    fi
  fi
done <<< "$segments"

[ -n "$reason" ] || exit 0

printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"%s"}}\n' "$reason"
