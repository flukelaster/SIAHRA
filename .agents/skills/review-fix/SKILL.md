---
name: review-fix
description: >-
  Address Codex PR code review findings in ONE batch on SIAHRA PRs.
  Fetches unresolved review threads via GitHub GraphQL, classifies findings against
  AGENTS.md severity policy (P1/P2 vs P3), implements fixes, verifies with QA,
  and executes react 👍 + reply with sha + resolve mutations.
---

# SIAHRA Review Fix (`/review-fix`)

Address Codex review on a PR in **ONE batch** — fix P1/P2 only, commit & push after QA passes, then react 👍 + reply + resolve every thread.

---

## 0. Preflight & Branch Confirmation

```bash
gh pr view <n> --json headRefName,headRepository,headRepositoryOwner,isCrossRepository \
  --jq '{branch:.headRefName, repo:"\(.headRepositoryOwner.login)/\(.headRepository.name)", fork:.isCrossRepository}'
git branch --show-current
git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null
```
Ensure you are on the matching branch. For PRs, use `gh pr checkout <n>`.

---

## 1. Fetch Unresolved Review Threads (GraphQL Only)

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
        nodes{
          id isResolved isOutdated path line
          comments(first:100){ nodes{ databaseId author{login} createdAt body } } } } } } }' \
  -f o=<owner> -f r=<repo> -F n=<pr>
```

- **Page all cursors (`$c`, `$rc`, `$cc`) to exhaustion.**
- Codex comments have `author.login == "chatgpt-codex-connector"`.
- Read every comment in each thread to avoid undoing intentional behavior.
- If findings sit in the review body rather than an inline thread, answer with a PR comment ending in `Addressed Codex review <submittedAt>`.

---

## 2. Classify Findings Against `AGENTS.md` Rubric

- **P1 (Blocking):** Data-honesty violation (invented forecast, wrong descriptor, `fetchedAt: null` rendered as "now"), runtime crash, wrong hazard values/units/CRS, shared-types mismatch, rate-limiting or security bypass.
- **P2 (Non-blocking):** Swallowed errors, unhandled stale states, DO alarm race condition, bundle/perf regression.
- **P3 (Ignore code change):** Style, naming, micro-optimization, preference, anything oxlint/tsc catches. (Thread is still replied to with reason and resolved).

---

## 3. Batch Fix & QA Verification

1. Implement fixes for all P1/P2 findings in the batch.
2. Run full QA check suite:
   ```bash
   cd apps/web && npx oxlint src worker
   cd apps/web && npx tsc -b
   cd apps/api && npx tsc --noEmit
   cd apps/api && npx tsc -p test/tsconfig.json --noEmit
   cd apps/etl && npx tsc --noEmit
   npm test
   npm run build -w apps/web
   cd apps/web && npx wrangler deploy --dry-run --outdir=/tmp/siahra-web
   cd apps/api && npx wrangler deploy --dry-run --outdir=/tmp/siahra-api
   ```
3. Commit in English and push once:
   ```bash
   git commit -m "fix: address review feedback (<summary>)"
   git push
   ```

---

## 4. Close Every Thread (React → Reply → Resolve)

```bash
# 4.1 React 👍
gh api -X POST repos/<owner>/<repo>/pulls/comments/<comment_id>/reactions -f content=+1

# 4.2 Reply inside thread
gh api -X POST repos/<owner>/<repo>/pulls/<pr>/comments/<comment_id>/replies \
  -f body='Fixed in <sha> — <what changed, which file>.'

# 4.3 Resolve thread
gh api graphql -f query='mutation($t:ID!){ resolveReviewThread(input:{threadId:$t}){ thread{ isResolved } } }' -f t=<thread_id>

# 4.4 Body-only review marker (if applicable)
gh pr comment <pr> --body 'Fixed in <sha> — <what changed, which file>.

Addressed Codex review <submittedAt>'
```

---

## 5. Summary Table

Print a Markdown summary table:
`thread | finding | severity | action | sha | resolved?`
