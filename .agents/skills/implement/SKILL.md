---
name: implement
description: >-
  Feature implementation loop for SIAHRA: preflight checks, spec & acceptance criteria,
  multi-round implementation with senior-se and qa-verifier, documentation synchronization,
  and mandatory interactive confirmation before opening a PR.
---

# SIAHRA Feature Implementation Loop (`/implement`)

Execute the standard SIAHRA feature development loop:
**Preflight → Spec → (Senior SE ↔ QA Verifier Loop) → Docs Sync → Commit → Ask User → Open PR**

---

## 0. Preflight

1. **Check Git branch:**
   ```bash
   git branch --show-current
   ```
   If on `main`, switch to a feature branch: `git switch -c <type>/<slug>` (never commit to `main`).
2. **Check Git working tree:**
   ```bash
   git status --porcelain
   ```
   If unrelated changes exist, ask the user before proceeding.
3. **Verify Dev Server:**
   Read ports from `.env.worktree` (default 5173/8787) and check connectivity:
   ```bash
   curl -sf http://localhost:5173 >/dev/null || true
   ```
   If down and the task touches UI, inform the user to run `npm run dev` in their terminal (do not start long-running dev servers inside background tasks without bounds).

---

## 1. Specification & Acceptance Criteria

Formulate **3–7 concrete, mechanically checkable acceptance criteria** for the task before writing code.

> [!IMPORTANT]
> **Data-Honesty Rules (Mandatory for all hazard tasks):**
> - Every data layer must declare a valid `HazardLayerDescriptor` (`observed` | `static-reference` | `illustrative` | `probabilistic`).
> - **Never invent forecast numbers or probabilities** without a citable model.
> - `fetchedAt`/`observedAt` must always be displayed; `fetchedAt: null` is never rendered as "now".
> - Stale data and dead sources must stay visible (dimmed, labeled, in health status).
> - Any `packages/shared-types` contract change must be applied across `apps/api`, `apps/web`, and `apps/etl` in the same PR.

---

## 2. Implementation Loop (Maximum 3 Rounds)

Execute the engineering & verification loop:

### Round Workflow:
1. **Implementation (Senior SE):**
   - Implement the required changes strictly satisfying all acceptance criteria.
   - Follow existing patterns (Thai comments inside code, English symbols/files).
   - Never run `git commit`, `git push`, or `gh pr create` during this phase.

2. **Verification Gate (QA Verifier):**
   Run the exact CI suite and checks:
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
   If UI changed, capture headless screenshots using `playwright-cli` at 1536×960.

3. **Evaluate Verdict:**
   - **`pass`** (0 blocker/major findings, all criteria met) → Proceed to Step 3 (Docs).
   - **`fail`** (rounds remaining) → Fix blocker/major findings and re-verify.
   - **`fail`** (after 3 rounds) → Stop, summarize findings for the user, do not commit or push.
   - **`blocked`** (e.g. dev server down) → Stop and notify the user of the blocker.

---

## 3. Documentation Synchronization (`docs-sync`)

After QA passes:
1. Inspect the full branch diff: `git diff HEAD`.
2. Update relevant documentation if affected:
   - `AGENTS.md`
   - `README.md`
   - `docs/deploy.md`
   - `docs/SIAHRA-implement-plan.md`
   - `docs/roadmap.md`
3. All documentation must be written in **English**.

---

## 4. Commit

Create a single atomic commit covering code and documentation:
```bash
git add -A
git commit -m "<type>(<scope>): <English summary>"
```

> [!WARNING]
> **Commit and PR text must be 100% English.** Check with:
> `git log -1 --format='%s%n%b' | LC_ALL=C.UTF-8 grep -Pq '[\x{0E00}-\x{0E7F}]'` (Must return no Thai characters).

---

## 5. Ask Before Opening a PR (Mandatory)

**Never open a PR automatically.** Use `ask_question` to ask the user:
- "Open a PR now?"
  - Option 1: `Open it`
  - Option 2: `Keep the commit` (stay on branch, do not push)
  - Option 3: `More changes`

---

## 6. Open Pull Request (Upon User Confirmation)

1. Push branch:
   ```bash
   git push -u origin $(git branch --show-current)
   ```
2. If UI changed:
   Upload QA screenshot via `scripts/pr-media.sh "$(git branch --show-current)" <screenshot.png>` and embed in PR markdown.
3. Create PR in English:
   ```bash
   gh pr create --title "<English Title>" --body "<English Body with screenshots>"
   ```
