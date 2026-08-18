---
description: Watch a SIAHRA PR — CI checks plus unresolved Codex threads — and dispatch /review-fix whenever there is something to fix. Pair with /loop for hands-off monitoring.
---

Watch PR `$ARGUMENTS` (no argument = the user's own open PRs).

This is the dispatcher that keeps the review loop moving on its own — `/review-fix` handles one batch, and this command is what invokes it again.

## 1. Status
```bash
gh pr view <n> --json state,mergeable,mergeStateStatus,headRefName,isDraft
gh pr checks <n>
```
This repo has three required checks: `Lint` / `TypeScript` / `Build` (`.github/workflows/ci.yml`).

## 2. Unresolved review threads — fetch every cycle, not only once CI is green
Codex comments are inline review comments inside a `COMMENTED` review, so `gh pr view --comments` cannot see them and `reviewDecision` stays blank. GraphQL is the only way:
```bash
gh api graphql -f query='
query($o:String!,$r:String!,$n:Int!,$c:String){
  repository(owner:$o,name:$r){
    pullRequest(number:$n){
      reviewThreads(first:100, after:$c){
        totalCount
        pageInfo{ hasNextPage endCursor }
        nodes{ id isResolved isOutdated path line
               comments(first:100){ nodes{ databaseId author{login} createdAt body } } } } } } }' \
  -f o=<owner> -f r=<repo> -F n=<n>
```
**Read `totalCount` and `pageInfo.hasNextPage` and page through until exhausted before concluding "no unresolved threads."** Threads come back in creation order with the newest last; a fixed `first:N` silently truncates them and has already produced a false "0 findings" report. Codex posts as `chatgpt-codex-connector`.

## 3. Report
```
#<n> <title>  (<branch>)
  state: OPEN  mergeState: CLEAN
  checks: 3 ok / 0 pending / 0 fail   (failed: <list>)
  review threads: 2/7 unresolved  (Codex: 2)
    - .claude/hooks/guard-pr.sh:30 — <first line of the comment>
  url: <url>
```

## 4. Unresolved threads → **dispatch `/review-fix <n>` in the same run, every time, no round limit**
- Do not wait to be asked again. Codex re-reviews every push; findings in the next cycle mean "more work to do", not "the loop is broken"
- Only report instead of fixing when (say which case applied): the thread is a human asking a question rather than reporting a defect, or the PR belongs to someone else and you cannot push to it
- **Needing to touch a file the PR has not changed yet is NOT a reason to skip** — valid findings often require it (a changed `packages/shared-types` contract whose api/web/etl consumers were never updated); excluding those would leave the loop stuck on that finding forever
- The single thing that is not progress: **the same finding, unchanged, after it was already fixed** → stop and ask the user (genuinely new findings never hit this)

## 5. Failing check → `gh run view <runId> --log-failed` and quote the last ~40 lines. Do not fix it here; let the user or the next cycle react.

## 6. All green
- Print `✅ ready` **only when the checks pass and there are zero unresolved threads** — never over the top of pending comments; use `⏳ checks green, N review threads unresolved` instead
- **Never merge**, however green it looks

## Output
- At most ~30 lines per PR
- If nothing changed since the last run (same checks, same unresolved-thread count, same newest thread), print `no change since last run` — but a new comment counts as a change even when every check stayed green

## Non-goals
- No merging, no opening PRs, no pushing code from this command (fixing belongs to `/review-fix`)
