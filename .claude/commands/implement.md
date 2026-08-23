---
description: Feature loop for SIAHRA — devops cost-gates anything touching DO/D1/R2 first, senior-se implements, qa-verifier gates, loop until green, devops re-verifies the diff, docs-sync updates docs, then ASK before opening a PR (never automatic).
---

Run the feature loop: **(devops, when the task is cost-bearing) → senior-se → qa-verifier → (loop until green) → (devops verify) → docs-sync → ask the user → PR**

Requested work: `$ARGUMENTS`

This command must run in the main session — the "open a PR?" gate uses `AskUserQuestion`, which a subagent cannot call.

## 0. Preflight
- `git branch --show-current` — if you are on `main`, `git switch -c <type>/<slug>` first (never commit to main)
- `git status --porcelain` — if unrelated work is sitting in the tree, ask the user before continuing
- Read the ports from `.env.worktree` (fallback 5173/8787) and `curl -sf http://localhost:<port>` — if the dev server is down and this task touches UI, ask the user to run `npm run dev` (do not start it yourself)

## 1. Spec
Turn the request into **3–7 acceptance criteria that can actually be checked**, and print them for the user before starting.
Any task touching hazard data always carries the data-honesty criteria from `AGENTS.md` as well (correct descriptor kind, no self-invented numbers, `fetchedAt` shown truthfully, dead sources still visible).

## 1b. Cost gate — `Agent(devops)` runs BEFORE senior-se on every cost-bearing task
A task is **cost-bearing** when the request, the spec, or the files it will touch match any of
(the same list as "Cost budget" in `AGENTS.md`):
- `apps/api/src/durable-objects/**`, `apps/api/src/archive.ts`, `apps/api/src/ingestion/**` (a new
  source is new writes on a tick), any `ctx.storage` / `sql.exec` / `setAlarm` / `stub.fetch`
- `apps/api/wrangler.jsonc` or `apps/web/wrangler.jsonc` — bindings (DO, **D1**, R2), `migrations`,
  `triggers.crons`, `observability`
- `HAZARD_BUCKET` / R2 anywhere (`apps/web/worker/**`, `scripts/upload-tiles.sh`,
  `scripts/release-dataset.sh`), a new tile layer or a new R2 prefix
- a `console.*` on a per-station / per-province / per-request path
- the words Durable Object, DO, D1, R2, cron, alarm, retention, archive, history, migration, backfill

When in doubt, run it — it is read-only and cheap; the bill it guards is not.

1. `Agent(devops)` — send `{mode: "pre", task, acceptance_criteria, touches}`
2. Read its JSON:
   - `go` → continue; print `devops: go, delta ≈ $<expected> (high $<high>), total ≈ $<projected>`
   - `go-with-constraints` → **append every entry of `constraints[]` to `acceptance_criteria`**
     (they are now criteria senior-se must meet and qa-verifier must check), print them, continue
   - `stop` → **halt before any code is written.** Show the user the drivers with their numbers and
     the `cheaper_design`, then `AskUserQuestion`: `Build the cheaper design` / `Build it as
     specified anyway (the user accepts the projected bill)` / `Cancel`. Never downgrade a `stop` to
     `go` on your own, and never let a `stop` through just because the user said "just do it"
     earlier — the number has to be in front of them when they decide
3. Keep `constraints[]` and `allowed_scans_to_add[]` — step 2b needs them

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

### 2b. Cost verify (only when step 1b ran)
After QA returns `pass`: `Agent(devops)` — send `{mode: "verify", constraints, summary of what the SE did}`
- `pass` → continue to docs
- `fail` → its `findings[]` go into the next senior-se round as `blocker`/`major` findings, and the
  round goes back through qa-verifier; **this counts as one of the 3 rounds**
- A `fail` still standing after round 3 → stop exactly as for a QA `fail`: no commit, no PR
Print: `devops verify: pass|fail, delta ≈ $<expected> vs modelled $<expected>`

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
- Never skip step 1b to save time on a task that matches the list — the 2026-08-18..23 bill (72B
  rows read, $104.95 projected) came from two statements that looked trivial
