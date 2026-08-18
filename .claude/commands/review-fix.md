---
description: Address Codex review on a PR in ONE batch — fix P1/P2 only, then react 👍 + reply + resolve every thread. Prevents endless review loops.
---

Close out the Codex review on PR `$ARGUMENTS` (no argument = the PR for the current branch).

## 0. Confirm you are on the right branch before touching anything
```bash
gh pr view <n> --json headRefName,headRepository,headRepositoryOwner,isCrossRepository \
  --jq '{branch:.headRefName, repo:"\(.headRepositoryOwner.login)/\(.headRepository.name)", fork:.isCrossRepository}'
git branch --show-current
git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null   # the remote this branch really tracks
```
**Both the branch name and the head repository** must match — branch names repeat across remotes, and a PR from a fork is easier still to mistake.
The safest move is always `gh pr checkout <n>` (the working tree must be clean first); if you cannot check it out, **stop** rather than continue.
Otherwise you end up editing one branch, pushing another, and resolving this PR's threads with an unrelated sha.

**Fork PRs**: never push to someone else's branch without permission — report back to the user instead.

Codex reviews every push, so fixing one comment per push is a loop that never ends. This command enforces **one batch per push**.

## 1. Fetch unresolved review threads (GraphQL only)
`gh pr view --comments` and `reviewDecision` **cannot see** Codex comments: they are inline review comments inside a `COMMENTED` review.

```bash
gh api graphql -f query='
query($o:String!,$r:String!,$n:Int!,$c:String){
  repository(owner:$o,name:$r){
    pullRequest(number:$n){
      reviews(first:100){ nodes{ author{login} state submittedAt body } }
      reviewThreads(first:100, after:$c){
        totalCount
        pageInfo{ hasNextPage endCursor }
        nodes{
          id isResolved isOutdated path line
          comments(first:100){ nodes{ databaseId author{login} createdAt body } } } } } } }' \
  -f o=<owner> -f r=<repo> -F n=<pr>
```
- `id` = the thread node id → used with `resolveReviewThread`
- `comments.nodes[0].databaseId` = the first comment's id → used with the REST reactions/replies endpoints
- **Read every comment in the thread, not just `first:1`** — if someone replied explaining that the behaviour is intentional or the finding is wrong, that reply stands: close the thread with that reason instead of fixing over it
- Codex comments are `author.login == "chatgpt-codex-connector"` — use that to separate them from human comments
- **Read `reviews` too, not only `reviewThreads`**: `AGENTS.md` asks Codex for one consolidated comment, and if it puts that list in the review body instead of an inline thread there is no thread to find. A Codex review with a non-empty `body` is a finding set to process even when `reviewThreads` comes back empty — it just has no thread to resolve, so answer it with one reply on the PR
- **Read `totalCount` and `pageInfo.hasNextPage` and page through until exhausted before concluding anything** — threads come back in creation order with the newest last, and a fixed `first: N` has already produced a false "0 findings" report

## 2. Classify against the rubric (`## Code Review Rules` + "Codex PR review — severity policy" in `AGENTS.md`)
**One thread can carry several findings.** The review rules ask Codex for a single consolidated,
severity-ordered comment per round, with non-blocking items under `### Minor / optional` at the end
of that same comment — so classify every line of the body, not just the first.
- **P1/P2** → fix
- **P3** → no code change, but the thread still gets closed per step 4

## 3. Fix the whole batch at once — commit and push **only when QA is green**
**If nothing needs fixing** (only P3s left, or every finding rejected with a reason) → **skip this step entirely**: no commit, no push, straight to step 4, replying with the reason instead of a sha (`No code change — <reason>`). Do not stall here waiting for a commit that does not exist.

Otherwise → `Agent(senior-se)` (hand it the whole finding set) → `Agent(qa-verifier)` → **branch on `verdict`**:
- `pass` → commit → **push once** → keep the sha for step 4.
  The commit message must be **English** (subject + body), like every commit in this repo. Check before pushing:
  `git log -1 --format='%s%n%b' | LC_ALL=C.UTF-8 grep -Pq '[\x{0E00}-\x{0E7F}]'` — fix anything it finds with `git commit --amend`
- `fail` → send the findings back to senior-se (at most 2 rounds) and have QA re-check; still failing after 2 rounds → **stop: no commit, no push, no resolving threads**, and report to the user
- `blocked` → stop immediately, say what has to happen before checking can continue, commit nothing

Never push work QA has not cleared — it triggers another CI/Codex round and invites resolving the original threads as though the repair had passed.

## 4. Close every thread — react → reply → resolve (all three, always, and only after a QA-cleared push)
```bash
# 4.1 react 👍
gh api -X POST repos/<owner>/<repo>/pulls/comments/<comment_id>/reactions -f content=+1

# 4.2 reply inside the same thread (not a floating comment)
gh api -X POST repos/<owner>/<repo>/pulls/<pr>/comments/<comment_id>/replies \
  -f body='Fixed in <sha> — <what changed, which file>.'

# 4.3 resolve
gh api graphql -f query='mutation($t:ID!){ resolveReviewThread(input:{threadId:$t}){ thread{ isResolved } } }' -f t=<thread_id>
```
- Replies are short and **in English**: what changed, in which file, plus `Fixed in <sha>` (on the no-change path, start with `No code change —` and give the reason)
- One reply per thread must cover **every finding that thread raised** — a consolidated comment holds several, and answering only the first leaves the rest silently unaddressed
- P3, or a finding you disagree with → reply with the actual reason it will not be fixed (cite the rubric), then resolve — **never resolve in silence**
- Order matters: react and reply **before** resolving
- Verify the mutation really returned `isResolved: true`; if it failed (insufficient rights, outdated thread), report it rather than counting it as done

## 5. Summarise and end the round
Print a table: `thread | finding | severity | action | sha | resolved?` — one row per **finding**, not per thread

**There is no cap on rounds** — Codex re-reviews every push, and new findings next cycle are simply more work (`/babysit-prs` is what re-invokes this command). Each invocation is one batch, one push.

The single thing that is not progress: **the same finding, unchanged, after it was already fixed** (the reviewer rejected the fix, or is repeating itself). Do not fix that one a third time — stop and ask the user. Genuinely new findings never hit this.

## Non-goals
- Never merge
- Never fix things nobody commented on — bonus refactors make the review cycle longer
