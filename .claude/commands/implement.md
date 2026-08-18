---
description: Feature loop for SIAHRA — senior-se implements, qa-verifier gates, loop until green, docs-sync updates docs, then ASK before opening a PR (never automatic).
---

Run the feature loop: **senior-se → qa-verifier → (loop until green) → docs-sync → ask the user → PR**

Requested work: `$ARGUMENTS`

This command must run in the main session — the "open a PR?" gate uses `AskUserQuestion`, which a subagent cannot call.

## 0. Preflight
- `git branch --show-current` — if you are on `main`, `git switch -c <type>/<slug>` first (never commit to main)
- `git status --porcelain` — if unrelated work is sitting in the tree, ask the user before continuing
- Read the ports from `.env.worktree` (fallback 5173/8787) and `curl -sf http://localhost:<port>` — if the dev server is down and this task touches UI, ask the user to run `npm run dev` (do not start it yourself)

## 1. Spec
Turn the request into **3–7 acceptance criteria that can actually be checked**, and print them for the user before starting.
Any task touching hazard data always carries the data-honesty criteria from `AGENTS.md` as well (correct descriptor kind, no self-invented numbers, `fetchedAt` shown truthfully, dead sources still visible).

## 2. Loop (at most 3 rounds)
Each round:
1. `Agent(senior-se)` — send `{task, acceptance_criteria, qa_verdict?, screenshots?}`
2. `Agent(qa-verifier)` — send `{acceptance_criteria, summary of what the SE did}`
3. Read `verdict` from the JSON QA returns:
   - `pass` → leave the loop (`minor` findings are reported at the end, not looped on)
   - `fail` with rounds remaining → send the findings and screenshots into the next round
   - `fail` after 3 rounds → **stop**, summarise the remaining findings for the user, do not commit, do not open a PR
   - `blocked` → stop immediately and say what needs to happen (e.g. start the dev server) — this does not count as a round

Print one short line per round: `round N: verdict=... blocker=x major=y minor=z`

## 3. Docs
`Agent(docs-sync)` — give it the full diff of the branch

## 4. Commit
One commit covering both code and docs, **written in English** (subject + body), then **stop**

## 5. Ask before opening a PR — mandatory
Use `AskUserQuestion`: "Open a PR now?"
- `Open it`
- `Keep the commit` (end here, no push)
- `More changes` (back to step 1 with the new instructions)

**Never open a PR without asking, whatever the user said earlier about "push"** — the `guard-pr.sh` hook catches it as well, but the hook is a safety net, not an excuse.

## 6. Open the PR (only after the user says to)
1. `git push -u origin <branch>`
2. If the diff touches UI → `scripts/pr-media.sh "$(git branch --show-current)" <png from QA>` and paste the Markdown it prints into the body
3. Write the title and body **in English**
4. **Self-check before firing** (no CI job catches these any more — a miss here ships):
   - Language: `printf '%s' "$TITLE$BODY" | LC_ALL=C.UTF-8 grep -Pq '[\x{0E00}-\x{0E7F}]'` (title/body) **and** `git log main..HEAD --format='%s%n%b' | LC_ALL=C.UTF-8 grep -Pq '[\x{0E00}-\x{0E7F}]'` (every commit on the branch) → rewrite wherever Thai text turns up
   - Screenshot: if `git diff --name-only main...HEAD` touches `apps/web/index.html`, `apps/web/src/App.tsx`, `apps/web/src/main.tsx`, `apps/web/src/index.css`, `apps/web/src/branding.ts`, `apps/web/src/components/**`, `apps/web/src/scene/**`, or `apps/web/public/*` → the body needs at least one image, otherwise apply the `no-screenshot` label (only when nothing visibly changed — types, comments, refactors; never manufacture a screenshot)
5. `gh pr create` (the hook asks for approval once more)
6. Afterwards, tell the user that Codex reviews every push and that `/review-fix <n>` handles the next round

## Non-goals
- Never merge
- Never touch `.github/rulesets/main.json` or `ci.yml` while building a feature
