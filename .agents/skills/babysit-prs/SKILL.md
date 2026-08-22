---
name: babysit-prs
description: >-
  Monitors open SIAHRA PRs for CI check status and unresolved Codex review threads,
  automatically dispatching review-fix when findings exist until the PR is ready.
---

# SIAHRA PR Watcher & Dispatcher (`/babysit-prs`)

Watch PRs, check CI statuses, fetch GraphQL review threads, and automatically dispatch `/review-fix` whenever work is needed.

---

## 1. Check CI Status

```bash
gh pr view <n> --json state,mergeable,mergeStateStatus,headRefName,isDraft
gh pr checks <n>
```
Required checks in this repo: `Lint` / `TypeScript` / `Build`.

---

## 2. Fetch Unresolved Threads & Review Bodies

```bash
gh api graphql -f query='
query($o:String!,$r:String!,$n:Int!,$c:String,$rc:String,$cc:String){
  repository(owner:$o,name:$r){
    pullRequest(number:$n){
      reviews(first:100, after:$rc){ pageInfo{ hasNextPage endCursor } nodes{ author{login} state submittedAt body } }
      comments(first:100, after:$cc){ pageInfo{ hasNextPage endCursor } nodes{ author{login} body } }
      reviewThreads(first:100, after:$c){
        totalCount
        pageInfo{ hasNextPage endCursor }
        nodes{ id isResolved isOutdated path line
               comments(first:100){ nodes{ databaseId author{login} createdAt body } } } } } } }' \
  -f o=<owner> -f r=<repo> -F n=<n>
```
Page all cursors until `hasNextPage: false`.

---

## 3. Dispatch Review Fix

If unresolved Codex threads or unhandled review bodies exist:
- Invoke the `review-fix` workflow immediately in the current cycle.
- Repeat until checks pass and all threads are resolved.

---

## 4. Ready Status

Print `✅ ready` only when:
1. All required CI checks pass.
2. 0 unresolved review threads remain.
3. Any Codex review body with findings has its `Addressed Codex review <submittedAt>` marker in the PR comments.

> [!NOTE]
> Never merge the PR automatically. The user performs merge actions.
