# SIAHRA — guide for agents and contributors

**SIAHRA** (Spatial Intelligence Atlas for Hazard & Resilience Analytics) — a 3D per-province map of Thailand that overlays *actually measured* hazard data (ThaiWater/HII, GISTDA, TMD, USGS/EMSC) on Three.js + React (Vite) with a Cloudflare Worker backend (Durable Objects, R2). The overall plan lives in `SIAHRA-implement-plan.md`; deploy steps in `docs/deploy.md`.

## Non-negotiable rules (data honesty)
- Every data layer must declare a `HazardLayerDescriptor` (`packages/shared-types/src/hazard-layer.ts`): observed / static-reference / illustrative / probabilistic — and the UI must always show when the data is from (`fetchedAt`/`observedAt`)
- **Never invent forecast numbers** — no "% chance of flooding" that does not come from a citable model; the "low-lying area" layer is *illustrative*, derived from a DEM, and its legend says so
- Stale data and dead sources must stay visible (dimmed dots, labels, the status bar fed by `/api/v1/health`) instead of silently disappearing; `fetchedAt` is null when a fetch has never succeeded — never render that as "now"
- Historical values (timeline) carry no ThaiWater `situationLevel` → colour is derived from the distance below bank level, and that is stated explicitly

## Layout
- `apps/web` — **deploy unit 1** (Worker `siahra-web`; its `wrangler.jsonc` is assets-only, no `main`): React 19 + Vite + Tailwind 4 + three r185 (raw scene graph, not R3F): `src/scene/*` (TerrainTiles LOD, BuildingTiles, FeatureTiles, VegetationTiles, RadarOverlay, floodMask, terrainMaterial shader), `src/components/layout/Map3DCanvas.tsx` assembles every layer, web workers in `src/workers/*`
- `apps/api` — **deploy unit 2** (Worker `siahra-api`, no `assets` block any more): `src/router.ts` (route table + rate limit + same-origin guard), DOs in `src/durable-objects/*` (ObservationCacheDO = ThaiWater + history + dams + archive, FloodExtentDO, RadarDO, EarthquakeFeedDO), ingestion in `src/ingestion/*`, permanent archive in `src/archive.ts`
- `apps/etl` — gdal/osmium pipelines: `build:all`, `build:tiles`, `build:building-tiles`, `build:feature-tiles`, `build:landcover-tiles` → small outputs (manifest/overview) land in `apps/web/public/aoi/{code}` (tracked) and the large tiles in `apps/etl/data/tiles` (gitignored, ~5.6 GB, served in dev by middleware in `apps/web/vite.config.ts`; prod = R2)
- `packages/shared-types` — the data contract between api/web/etl (always change it here first)
- Both Workers share one host (`siahra-radar.co`): web owns the Custom Domain (all paths), api is bound to the route `/api/*`, which runs **before** the origin and therefore claims `/api/*` first — still same-origin (relative `fetch("/api/v1/...")`, WS uses `location.host`, `ALLOWED_ORIGINS` empty) — **deployed separately**: `npm run deploy:web` / `npm run deploy:api` (see `docs/deploy.md` §0.1)

## Running it
- `npm run dev` (root) = vite :5173 + wrangler :8787 (in a worktree, ports come from `.env.worktree`) — vite serves the SPA and proxies `/api` to wrangler; **`apps/web/dist` is no longer needed** (build only to deploy web or to check the asset bundle size: `npm run build -w apps/web`)
- Checks: `npx tsc -b` in apps/web, `npx tsc --noEmit` in apps/api and apps/etl, `npx oxlint src` in apps/web
- See it for real: `playwright-cli -s=<session> open http://localhost:5173` then `screenshot` (wheel zoom does not work headless — use the on-screen zoom buttons or drag); `window.__siahraHandles` is available in dev to drive the camera
- cron does not fire under `wrangler dev` — every DO schedules its own alarm; trigger by hand at `GET /__scheduled?cron=*+*+*+*+*`

## Orca worktree
`orca.yaml` → `.orca/setup.sh` → `scripts/setup-worktree.sh` (symlink the dataset, copy state, reserve ports, npm ci — no web build any more); the Quick Command runs `.orca/run.sh`; the archive hook stops only that worktree's dev server

## Git workflow (enforced by a GitHub ruleset — `.github/rulesets/main.json`)
- **Never push straight to `main`**, however small or urgent — branch, then open a PR, even when the user says "push" (unless they explicitly override in that moment); the ruleset has no bypass actors, so a direct push is rejected anyway
- `main` is mergeable once every status check passes: **Lint / TypeScript / Build** (`.github/workflows/ci.yml` — the same commands as "Checks" above); never make a path-filtered job a required check (a PR that does not touch those paths would wait forever)
- The "English PRs" and "screenshot for UI changes" rules **still apply, but no CI job enforces them any more** (`pr-rules.yml` was removed because it burned Actions minutes) — they are checked by `/implement` before it opens a PR, and by you when you open one by hand
- **PR text and commit messages must be entirely in English** (subject and body) — check before you push:
  `printf '%s' "$TITLE$BODY" | LC_ALL=C.UTF-8 grep -Pq '[\x{0E00}-\x{0E7F}]'` (the PR) and
  `git log main..HEAD --format='%s%n%b' | LC_ALL=C.UTF-8 grep -Pq '[\x{0E00}-\x{0E7F}]'` (every commit on the branch — these two do not substitute for each other; an English PR over Thai commits still breaks the rule)
  Rewrite whatever it finds (`gh pr edit <n> --title/--body`, `git commit --amend`, or `git rebase -i` if not pushed yet).
  **Comments inside code may still be written in Thai** — this rule covers what an outsider reads first in a public repo: the log and the review surface
- **A UI change needs a screenshot in the PR** — if the PR touches `apps/web/src/{components,scene}/**`, `App.tsx`, `main.tsx`, `index.css`, `branding.ts`, `index.html`, or a top-level file in `public/` (not `public/aoi/**`), the description must embed at least one image: capture it from the dev server with `playwright-cli`, run `scripts/pr-media.sh "$(git branch --show-current)" <png...>`, and paste the Markdown it prints into the PR body (uploaded as the prerelease asset `primg-<branch>` using plain `gh`; `pr-image-cleanup.yml` deletes it when the PR closes). No visible change → add the `no-screenshot` label
- After merging: delete the branch both on the remote (`gh pr merge --delete-branch`, or rely on the repo's delete-on-merge setting) and locally (`git branch -d`), then `git checkout main && git pull` before starting the next task
- To change the ruleset: edit `.github/rulesets/main.json` and run `scripts/apply-branch-rules.sh` (idempotent; needs `gh` with admin rights)

## Loop engineering (`.claude/`)
The standard loop for writing code: `/implement <task>` → **senior-se** writes it → **qa-verifier** checks it → up to 3 rounds of fixes until the verdict is `pass` → **docs-sync** updates the docs → commit → **always ask the user before opening a PR**
- Agent definitions live in `.claude/agents/{senior-se,qa-verifier,docs-sync}.md`; commands in `.claude/commands/{implement,review-fix,babysit-prs}.md`
- `qa-verifier` **has no Write/Edit tool, deliberately** — QA cannot fix its own findings, and that is what makes the loop a loop; it returns JSON `{verdict, findings[], screenshots[]}` so the loop condition is machine-checkable rather than a matter of interpretation
- QA runs exactly the commands `ci.yml` runs (if they drift, QA goes green while CI goes red) plus a visual acceptance pass with `playwright-cli` — it **must not start a dev server itself** (one per worktree; if none is running it returns `blocked`)
- **Agents do not open PRs**, whatever the user said earlier about "push" — `.claude/hooks/guard-pr.sh` (PreToolUse) intercepts `gh pr create/merge/ready` and `git push … main` and forces the question back to the user; the hook is a safety net, not an excuse to skip asking
- `.claude/settings.json` (tracked) holds the hook and the allow-list; `.claude/settings.local.json` is per-machine (gitignored)

## Code Review Rules
This is the section Codex's GitHub code review reads and applies to every changed file
([`## Code Review Rules` is the surface it consumes](https://developers.openai.com/blog/custom-code-review-rules-for-codex));
the rest of this file is background context, not a review instruction — so every rule that has to
bind lives here, in full, and [Codex PR review — severity policy](#codex-pr-review--severity-policy)
below is the human-facing explanation of the same thing. Mechanical checks stay in `ci.yml`.

**Comment only on P1 and P2**, both listed below. Anything under that is not a finding here.

### Output contract — one comment per review round
- Post **one consolidated comment per round**, findings ordered by severity, each on its own line:
  severity, `file:line`, what breaks at runtime (not the code smell), and a concrete fix
- Post it as **one inline comment anchored at the most relevant `file:line`**, with every finding
  in that body — not as a floating review summary. The fixing side reads `reviewThreads` only, so a
  finding that lives outside a thread is a finding nobody ever sees
- **Never open a separate thread per finding.** Every thread costs the author a react → reply →
  resolve cycle, so ten threads make the loop ten times longer without surfacing one extra defect
- Blocking findings lead; everything non-blocking goes at the end of the *same* comment under a
  `### Minor / optional` heading — still stated, still fixed, but never its own thread
- Nothing to report → say so in one line, or post nothing at all. Never an LGTM re-review

### P1 — blocking; data honesty first
- A forecast number no citable model produced; a hazard layer whose `HazardLayerDescriptor` kind
  does not match what the data actually is; `fetchedAt: null` rendered as a real time ("now").
  Honest degradation *is* the product: stale data and dead sources must stay visible (dimmed,
  labelled, in `/api/v1/health`), never disappear silently
- A correctness bug a user would hit: crash, wrong hazard value, wrong units or CRS, GPU or memory
  leak in the render loop
- A `packages/shared-types` change whose api/web/etl consumers were not updated in the same diff
- The same-origin guard or rate limiting in `apps/api/src/router.ts` weakened or bypassed; a
  Durable Object / R2 change that loses or corrupts stored observations; a leaked credential; a
  `wrangler.jsonc`, route or binding change that breaks a deploy

### P2 — non-blocking; same comment, never its own thread
These are the only non-blocking findings worth a comment. They go under `### Minor / optional` at
the end of the consolidated comment, never in a thread of their own:
- Error handling that swallows failures instead of surfacing them
- Stale or degraded source state not shown in the UI
- A race or a missed reschedule in a Durable Object alarm
- A measurable performance regression, or an asset bundle growing toward the `ci.yml` limits

### Re-review restraint
- On re-review, look only at findings still unresolved and at regressions introduced by the repair
  diff. Do not reopen unchanged code, and do not re-raise a point the author already answered with
  a reason
- A round that turns up no new P1/P2 finding ends the loop: post nothing

### P3 and below — not a finding
Naming, style, comment wording, micro-optimisation, personal preference, anything outside the two
lists above, and anything `oxlint` or `tsc` already catches — `ci.yml` owns those, and a review
comment about them is pure loop tax.

## Codex PR review — severity policy
The reasoning behind the operative [Code Review Rules](#code-review-rules) above — that section is
what Codex actually applies, and it already carries the full P1 and P2 lists; this one exists so a
human can see why. Codex reviews this repo on every push. **Comment only on P1 and P2.** Anything
below that is noise: it lengthens the review loop without making the product more honest or more
correct.

**P1 — blocking; leads the consolidated comment**
- Data-honesty violation: a self-invented forecast number, a hazard layer without the right `HazardLayerDescriptor` kind, `fetchedAt: null` rendered as a real time ("now"), stale data or a dead source disappearing silently instead of degrading visibly
- Correctness bug a user would hit: crash, wrong hazard value, wrong units/CRS, GPU or memory leak in the render loop
- A `packages/shared-types` contract change whose api/web/etl consumers were not updated
- Leaked secret or credential
- Same-origin guard or rate limiting in `apps/api/src/router.ts` weakened or bypassed
- Durable Object / R2 change that loses or corrupts stored observations
- Config change that breaks a deploy (`wrangler.jsonc`, routes, bindings, environments)

**P2 — non-blocking; goes under `### Minor / optional` in that same comment, never its own thread**
- Error handling that swallows failures instead of surfacing them
- Stale / degraded source state not shown in the UI
- Race or missed reschedule in a DO alarm
- Measurable performance regression, or an asset bundle growing toward the `ci.yml` limits

**P3 and below — do not comment at all**
Naming, style, comment wording, micro-optimisation, personal preference, and anything `oxlint` or
`tsc` already catches.

**Loop discipline**
- **One comment per review round, not one per finding** — a round with three P1s is one comment with three lines. The cost of a review is threads, not findings: each thread has to be reacted to, replied to and resolved one by one
- Never re-raise a thread that is already resolved, or a point the author answered with a reason
- If a push introduces no new P1/P2, post nothing — no "LGTM" re-review
- Codex review is **advisory**: never add it as a required status check in `.github/rulesets/main.json`
- **No cap on review rounds.** A cap stops progress, not noise — PR #22 turned up real P2 defects four rounds deep. What stops a genuine loop is narrower: the same finding repeating unchanged after it was already fixed, and `/review-fix` already halts and asks the user on that

**On the fixing side** (`/review-fix <pr>`): fetch unresolved threads with the GraphQL `reviewThreads` query (Codex comments are inline review comments — `gh pr view --comments` and `reviewDecision` cannot see them). **One thread now carries several findings** — read the whole comment body, fix the entire set of P1/P2 findings **in one batch**, push once, then close each thread with all three steps: **react 👍 → reply saying what changed, with the sha → resolve**, covering every finding that thread raised. When a Codex review carries findings in the review **body** rather than a thread, there is nothing to resolve, so `/review-fix` answers it with one PR comment that ends in the marker `Addressed Codex review <submittedAt>` — that marker is the only thing telling the next cycle the body was handled, because a review body stays non-empty forever. `/babysit-prs` (`.claude/commands/babysit-prs.md`) dispatches this automatically whenever it finds unresolved threads, with no cap on rounds — it only stops when the same finding repeats unchanged after it was already fixed. (A thread whose findings are all P3 must be closed too, but with a reply explaining why they will not be fixed — never resolve silently.)
