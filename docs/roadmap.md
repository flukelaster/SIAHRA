# SIAHRA roadmap

## 0. What this file is

This is the **execution order** for SIAHRA: epics, ordered tasks, milestones with exit criteria, the
blockers that need a decision from the repository owner, and the work that is deliberately deferred.

- **Where it came from:** `docs/SIAHRA-Repository-Audit-Gap-Analysis-and-ImplementationRoadmap.md`
  (the audit) lists what SIAHRA still lacks to be a production hazard platform, written for a 5–7 FTE
  team over 12+ months. This file is that audit re-scoped to what one developer plus the `/implement`
  loop can actually land, and re-verified against the code as it exists today (see the closing
  reference section).
- **What it is not:** `docs/SIAHRA-implement-plan.md` is the original research blueprint (data
  sources, methodology, feasibility). It has no phase structure and is not a task list. Ops and
  deploy steps live in `docs/deploy.md`.

### Scoping decisions behind this roadmap
1. **Horizon:** a production *monitoring* beta, plus a **Tier A illustrative** flood-exposure layer
   (E10). Tier B/C hydrological and hydraulic forecast models are deferred — they need a hydrologist
   and external compute.
2. **Platform:** **defer** PostGIS/Hyperdrive, Queues, Workflows and KV. Harden the existing Durable
   Object SQLite + R2 path instead. Trigger conditions for revisiting are in the Deferred section.
3. **Delivery:** one task = one `/implement` run = one PR, tracked as one GitHub issue. Issue numbers
   are back-filled into the `Issue:` line of each task block once filed.
4. **No product rename.**

### How to read a task block
Each task is a `####` heading `E<epic>.<n> — <title>` followed by:

- **Touches** — the file cluster the change is allowed to span. If a task will not fit one coherent
  cluster and ≤3 QA rounds, split it before starting.
- **Depends** — task IDs defined in this file, `—` for none, or a named user blocker from §4.
- **Size** — S < 1 h agent loop, M 1–3 h, L = the largest allowed in one run (with a reason).
- **Risk** — what is most likely to go wrong, or `none identified`.
- **Issue** — the GitHub issue tracking it, or `_(not yet filed)_`.
- **Acceptance criteria** — a numbered list of 3–7 mechanically checkable items.

### Always in force (not repeated per task)
- The AGENTS.md data-honesty rules apply to every task; a `packages/shared-types` change means
  api/web/etl are updated in the **same** PR; a UI change means a screenshot in the PR; PR and commit
  text are English.
- `/implement` never edits `ci.yml` or the branch ruleset. The two CI tasks (E1.3, E5.4) are run as
  explicit standalone changes.
- **Ordering principle:** hybrid. Quick fixes that close AGENTS.md rules *shipping today* go first,
  in parallel with the minimal test harness; from then on every task adds tests for the pure code it
  touches. Then deep hardening, i18n, performance, and the illustrative layer last — it depends on
  the contract and visual-language work.

## 1. Milestones and exit criteria

| Milestone | Epics | Exit criterion |
|---|---|---|
| **M1 Foundation & quick honesty wins** | E1, E2 | `npm test` runs vitest (api pure + web pure); CI has an always-running `Test` job (not required yet); LICENSE exists; times render in `Asia/Bangkok`; the WS client survives a 2-minute API outage and returns to live; every route is GET/HEAD-only; no plaintext TMD credentials in the repo |
| **M2 Honest data contract & security** | E3, E4 | Every data response (earthquakes included) carries a descriptor whose `sourceIds` join to `SourceStatus.id`; the legend shows an epistemic badge plus observed/fetched age per layer, and null is never rendered as "now"; observed and illustrative are visually distinct; security headers, validated upstream payloads, named cache policy |
| **M3 Resilient & observable** | E5, E6 | One failing source cannot starve the others; health `ok` is false when a source is `down`; a `delayed` state exists; DO tests with fixtures; `docs/ops.md`; deploy runs a smoke check and can roll back |
| **M4 Bilingual, fast, versioned** | E7, E8, E9 | th/en toggle covers all visible strings; LOD no longer flickers; the deploy no longer ships legacy `buildings.geojson`; manifests carry per-layer provenance and checksums, and a `terrain.bin` checksum mismatch suppresses the terrain-derived hazard overlays instead of silently driving them; version-addressed tile prefix and a release script |
| **M5 Illustrative exposure & quake analytics** | E10 | `/api/v1/provinces/NN/exposure/latest` serves an immutable, run-id'd, `illustrative` layer with a `methodologyUrl`; the map drapes it in the "modelled" visual language; the earthquake card shows distance-to-province; no probability, "risk" or "forecast" wording anywhere |

## 2. Tasks

### E1 — Test harness (minimal, grows with each task)

#### E1.1 — Add a vitest workspace and the first pure unit tests
- Touches: root `package.json` (`"test"`), `apps/api/vitest.config.ts`, `apps/api/test/{rateLimit,archive}.test.ts`, `apps/web/vitest.config.ts` (`environment: "node"`), `apps/web/src/hooks/usePermalink.test.ts` (extract pure `parsePermalink`/`serialisePermalink`)
- Depends: —
- Size: M
- Risk: pin vitest to the range `@cloudflare/vitest-pool-workers` supports (needed by E5.5); no jsdom
- Issue: _(not yet filed)_

1. Root `npm test` exits 0.
2. `checkLimit` refill and `retryAfter` cases plus `originAllowed` cases are covered (`apps/api/src/rateLimit.ts`).
3. `bangkokDay`/`bangkokHour`/`addDays` boundary at 17:00 UTC is covered (`apps/api/src/archive.ts`).
4. Permalink round-trip for `p`/`cam`/`ex`/`layers`/`t`.
5. `tsc -b` and `oxlint` stay clean (tests excluded from the build tsconfig, or typed with explicit vitest imports).

#### E1.2 — Time/age formatter pinned to `Asia/Bangkok`, replacing three ad-hoc ones
- Touches: new `apps/web/src/lib/time.ts` (+ test), `SourceStatusBar.tsx:29`, `EarthquakeLiveCard.tsx:21`, `ApiStatusFooter.tsx:10`, `WaterLevelCard.tsx:158`, every `toLocaleString("th-TH")` site
- Depends: E1.1
- Size: S
- Risk: can ship before E1.1 with `node -e` checks if the harness lags — the formatter itself is the deliverable, the test can follow
- Issue: _(not yet filed)_

1. `formatDateTime`/`formatAge`/`formatFetchedAt` go through `Intl.DateTimeFormat` with `timeZone: "Asia/Bangkok"`.
2. `grep -rn "toLocaleString\|toLocaleTimeString\|toLocaleDateString" apps/web/src` returns 0 hits.
3. `formatFetchedAt(null)` returns the "never received" string and never a time.
4. `WaterLevelCard` shows a formatted time, not a raw ISO string.
5. Playwright run with `--timezone-id=UTC` still shows Bangkok hours; screenshot in the PR.

#### E1.3 — CI `Test` job and qa-verifier alignment *(standalone CI change, not via /implement)*
- Touches: `.github/workflows/ci.yml` (job `test`, name `Test`, **no `paths:` filter**, `npm ci && npm test`, `timeout-minutes: 15`), `.claude/agents/qa-verifier.md` (add `npm test` to the exact-CI-commands list), the AGENTS.md "Checks" line
- Depends: E1.1
- Size: S
- Risk: no Playwright or browser installs in CI (Actions minutes)
- Issue: _(not yet filed)_

1. The `Test` check appears on the PR and passes in ≤5 minutes.
2. `.claude/agents/qa-verifier.md` lists `npm test` among the commands it runs.
3. The AGENTS.md "Checks" line names the same command set as `ci.yml`.
4. `.github/rulesets/main.json` is **unchanged** — making `Test` required is a user action once it is stable.

### E2 — Quick honesty and security wins (no harness needed)

#### E2.1 — Earthquake WS client: backoff with jitter, heartbeat watchdog, REST fallback on close
- Touches: `apps/web/src/hooks/useEarthquakeFeed.ts`, new pure `src/lib/feed/{backoff,reducer}.ts` (+ tests once E1.1 lands), `EarthquakeLiveCard.tsx` (status chip)
- Depends: —
- Size: M
- Risk: keep the StrictMode CONNECTING-close deferral; the watchdog constant is retuned by E6.1
- Issue: _(not yet filed)_

1. Exponential full-jitter reconnect 1 s → 30 s, reset on `snapshot`.
2. No frame for 2× the heartbeat interval (server heartbeats once per 60 s poll ⇒ 150 s) closes the socket and sets `status: "reconnecting"`.
3. While not live, REST polls `/api/v1/earthquakes/recent` every 30 s — `onclose` polls too, which it does not today.
4. Malformed frames are counted and surfaced (`parseErrors`), never silently dropped.
5. `FeedStatus` gains `reconnecting`, and the card shows the `asOf` age — never "now" while reconnecting.
6. Manual check recorded in the PR: stop `wrangler dev` for 2 minutes, restart, the feed returns to live without a reload; screenshot of the degraded state.

#### E2.2 — Method guards: every route GET/HEAD, 405 with `Allow`, WS 426
- Touches: `apps/api/src/router.ts` (match pattern → method → limit; HEAD served as GET without a body), `apps/api/src/index.ts` (`method: "GET"` on all routes), tests
- Depends: —
- Size: S
- Risk: P1 territory — the same-origin guard and rate limiting must not be weakened
- Issue: _(not yet filed)_

1. `curl -X POST /api/v1/health` returns 405 with `Allow: GET, HEAD`.
2. `/api/v1/earthquakes/live` without an `Upgrade` header returns 426.
3. `originAllowed` and `checkLimit` keep their current order and behaviour (diff review plus tests).
4. HEAD on a data route returns the GET status and headers with no body.

#### E2.3 — TMD credentials to `wrangler secret`; drop hardcoded fallbacks; gitignore `.dev.vars`
- Touches: `apps/api/wrangler.jsonc` (remove the `TMD_UID`/`TMD_UKEY` vars), `apps/api/src/ingestion/tmd.ts:13-14`, the `Env` type, `.gitignore`, new `apps/api/.dev.vars.example`, `docs/deploy.md`
- Depends: blocker: TMD secrets
- Size: S
- Risk: the secrets must exist in the deployed Worker before merge, or the TMD feed degrades in production
- Issue: _(not yet filed)_

1. The hardcoded TMD fallback key no longer appears anywhere in the repo (`git grep` for it returns 0 hits — the literal is deliberately not written here).
2. A missing secret makes the TMD feed `degraded` with `lastError: "TMD credentials not configured"`, and leaves the other feeds unaffected.
3. `wrangler deploy --dry-run` succeeds.
4. `.gitignore` contains `.dev.vars`, and `.dev.vars.example` documents both keys.

#### E2.4 — LICENSE, `license` fields, README wording
- Touches: root `LICENSE`, every `package.json`, the README licence section
- Depends: blocker: licence choice
- Size: S
- Risk: none identified
- Issue: _(not yet filed)_

1. `LICENSE` exists at the repo root.
2. A `license` field is set in the root, `apps/*` and `packages/*` manifests.
3. The README states that the code licence is separate from the upstream data licences and keeps the data table.

#### E2.5 — Fix the remaining stale doc and comment pointers
- Touches: `apps/web/worker/index.ts:31-33` (the `run_worker_first` comment), `docs/deploy.md` (prerequisites: Workers Paid, secrets)
- Depends: —
- Size: S
- Risk: none identified
- Issue: _(not yet filed)_

1. `grep -rn "run_worker_first" apps/web` returns only text that matches the current `wrangler.jsonc`.
2. `docs/deploy.md` lists Workers Paid and the required secrets as prerequisites.
3. The README pointer fixes (phases, KV) are already done by the roadmap PR and are not re-done here.

### E3 — Data-honesty contract end to end

#### E3.1 — Source registry in shared-types; typed join key; earthquake descriptor; attributions from the registry
- Touches: new `packages/shared-types/src/sources.ts` (`SourceId` union, `SOURCES: Record<SourceId, {id,nameTh,nameEn,agency,homepageUrl,licenseName,licenseUrl,attributionText,kind:"live"|"static"}>` covering thaiwater, earthquakes, gistda-flood, tmd-radar, copernicus-dem, osm, worldcover, imagery providers), `hazard-layer.ts` (`sourceIds: SourceId[]`), `health.ts` (`SourceStatus.id: SourceId`, `labelEn`), `earthquake.ts` (`EarthquakeRecentResponse.layer`, `EqWsMessage.snapshot.layer?`); in `apps/api` the DO `status()` and descriptor emitters (fix `flood-extent.ts:254` `gistda-wfs-flooding_vis` → `gistda-flood`), `routes/earthquakes.ts`, delete the three `*_ATTRIBUTION` constants; in `apps/web` `SourceStatusBar.tsx` and `MapAttribution.tsx` render from the registry
- Depends: E1.1
- Size: L — a shared-types change means api and web in one PR, and the join key is the whole point
- Risk: keep `layer` optional in the WS message for one release so the E2.1 client tolerates both shapes
- Issue: _(not yet filed)_

1. `tsc` fails on an unknown source id — the join is mechanical, not by convention.
2. `curl /api/v1/earthquakes/recent | jq .layer` shows `observed`, live kind, `sourceIds: ["earthquakes"]` and a `fetchedAt` that is an ISO string or null.
3. A contract test asserts that every data route's `layer.sourceIds` is a subset of `/health .sources[].id`.
4. The attribution panel lists GISTDA and TMD radar.
5. The WS snapshot frame contains `layer`.

#### E3.2 — Three timestamps: `publishedAt` on descriptors
- Touches: `packages/shared-types/src/hazard-layer.ts` (`publishedAt?: string|null` with a doc comment defining observed / published / fetched(received); no `age*` fields ever — age is render-time), the emitters in `radar.ts`, `flood-extent.ts` and `earthquake-feed.ts` (`updated`), the contract test
- Depends: E3.1
- Size: S
- Risk: none identified
- Issue: _(not yet filed)_

1. The doc comment on the type defines all three timestamps and states that age is computed at render time.
2. A cold-DO test yields `fetchedAt === null`, not a fabricated time.
3. No route returns `""` or the string "now" for any timestamp field.
4. `publishedAt` is populated where the upstream actually publishes one (radar frames, GISTDA scene, feed `updated`) and null otherwise.

#### E3.3 — Freshness states including `delayed`; fix the `down` heuristics; health `ok` semantics
- Touches: `packages/shared-types/src/health.ts` (`SourceHealth` += `delayed`, `HealthResponse.worst`, `SourceStatus.nextAttemptAt`), each DO `status()` (`observation-cache.ts:753`, `radar.ts:164`, `flood-extent.ts:339`, `earthquake-feed.ts:312`), `routes/health.ts`, `SourceStatusBar.tsx` HEALTH_META, `App.tsx:99` (`delayed` dims like stale), new `docs/api.md`
- Depends: E3.1
- Size: L — four DOs, the type and the UI have to move together
- Risk: a wrong threshold makes every source look delayed; pick the lag per source from observed cadence
- Issue: _(not yet filed)_

1. `delayed` means the fetch succeeded but `latestObservedAt` is older than that source's `observedLagSeconds`.
2. `earthquake-feed.ts` decides `down` from `errors.length === feeds.length`, with no `3` literal.
3. `radar.ts` `detail.frames24h` counts only frames within 24 h.
4. `ok` is false when any source is `down` or `unknown`.
5. The status bar renders `delayed` distinctly; screenshot in the PR.
6. Each DO `status()` has a test per state using a fake clock.

#### E3.4 — Legend consumes `HazardLayerDescriptor`: epistemic badge and age per layer
- Touches: new `apps/web/src/hooks/useLayerDescriptors.ts` (server layers from `.layer`; client and static layers from new `src/data/staticLayerDescriptors.ts`: `lowland` = `illustrative`, static, `methodologyUrl` → `docs/methodology/lowland.md`; imagery/roads/water/buildings/trees = `static-reference` whose `fetchedAt` is that layer's **own** retrieval/build time, per layer, and `null` when it is not recorded; `sunlight` is not data), new `hooks/useNow.ts`, `MapLegend.tsx` (badge chip and "observed HH:mm · fetched N min ago" computed at render; null → a string chosen by descriptor **kind**, not by the null alone: `observed` → "never received", `static-reference` → "retrieval time not recorded"; stale → amber; the existing one-line `note` stays as the description), `App.tsx`
- Depends: E3.1, E1.2
- Size: M
- Risk: none identified
- Issue: _(not yet filed)_

**Do not use `AoiManifest.version` as `fetchedAt`.** `version` is one whole-build date, so rebuilding a
single artefact would make every static source claim it was newly retrieved — a false retrieval time.
`AoiManifest` records no per-layer provenance today; **E9.1** is the task that adds it, and until E9.1
lands these five layers ship `fetchedAt: null`, rendered as "retrieval time not recorded". E9.1 then
back-fills `staticLayerDescriptors.ts` from the manifest's per-layer `sources` entries; this task does
not depend on E9.1 and must not wait for it. A source's own publication epoch (the WorldCover 2021
product year, an OSM extract date) is `publishedAt` (E3.2), never `fetchedAt`.

1. `grep -rn epistemicClass apps/web/src` returns ≥3 hits.
2. Every legend row that has a descriptor shows an epistemic badge.
3. A playwright `route.fulfill` mock with `fetchedAt: null` shows the "never received" string and no "now".
4. The age text updates without a reload after 65 s.
5. `methodologyUrl` renders as a link; screenshot at 1536×960.
6. No static-reference descriptor reads `fetchedAt` from `AoiManifest.version` (`grep -n 'manifest\.version' apps/web/src/data/staticLayerDescriptors.ts` returns 0 hits); with today's manifests all five render "retrieval time not recorded", and any `publishedAt` they carry is the source's publication epoch.

#### E3.5 — Observed versus illustrative visual language (shader and legend swatches)
- Touches: `apps/web/src/scene/terrainMaterial.ts` (illustrative lowland gets a hatched/stippled non-water hue; GISTDA observed stays a solid fill), `MapLegend.tsx` swatches (SVG pattern for illustrative), `docs/methodology/lowland.md`
- Depends: E3.4
- Size: M
- Risk: this defines the language E10.4 reuses — changing it later means redoing both
- Issue: _(not yet filed)_

1. The two fills are distinguishable in a grayscale screenshot.
2. The legend swatches match what the shader draws.
3. `uHazardStale` dimming still applies (screenshot with a past `?t=`).
4. Frame-time delta ≤1 ms at 1536×960, with the numbers in the PR.
5. The low preset in `quality.ts` is checked and still renders both classes distinguishably.

### E4 — Security and input hygiene

#### E4.1 — Self-host fonts, drop Google Fonts
- Touches: `apps/web/index.html`, `apps/web/public/fonts/` (WOFF2 Thai+Latin subsets ≤400 KB plus the OFL file), `src/index.css`, `og/` if it uses them
- Depends: —
- Size: S
- Risk: prerequisite for a strict CSP — a missed external font reference blocks E4.2
- Issue: _(not yet filed)_

1. The playwright network log contains no request to a `fonts.g*` host.
2. Total added font weight is ≤400 KB and the OFL licence file ships with it.
3. A typography screenshot is unchanged against the current build.

#### E4.2 — Security headers for both Workers
- Touches: `apps/web/public/_headers` (CSP, HSTS, X-Content-Type-Options, Referrer-Policy, `frame-ancestors 'none'`, Permissions-Policy), `apps/web/worker/index.ts` (tile responses), `apps/api/src/router.ts` `json()` (XCTO/Referrer/XFO centrally; migrate `routes/observations.ts` and `routes/hazards.ts` off raw `Response.json`), new `docs/security.md` (audit checklist with status)
- Depends: E4.1, E2.2
- Size: M
- Risk: verify `_headers` is honoured under `wrangler dev`; the fallback is wrapping `env.ASSETS.fetch` in `worker/index.ts` (note the cost). HSTS `includeSubDomains`/`preload` only if the user says so
- Issue: _(not yet filed)_

1. `curl -I` shows the headers on `/`, on a tile, and on `/api/v1/health`.
2. The playwright console has zero CSP violations on load, province switch, radar toggle and WS connect.
3. CSP ships **report-only** for one release; a follow-up S task flips it to enforcing.
4. `docs/security.md` lists each header with its current status.

#### E4.3 — Runtime validation (zod) — earthquake feeds
- Touches: `apps/api/src/ingestion/{usgs,emsc,tmd}.ts`, new `src/ingestion/schemas/*.ts`, new `src/ingestion/errors.ts` (`UpstreamShapeError`), `apps/api/package.json` (zod 4 / `zod/mini`; never in shared-types), tests using the E5.6 fixtures
- Depends: E1.1
- Size: M
- Risk: bundle growth; record fixtures here if E5.6 lags
- Issue: _(not yet filed)_

1. All three fixtures validate.
2. `{}` and a truncated payload raise `UpstreamShapeError` carrying the zod path, truncated to ≤200 characters.
3. The DO keeps its prior rows and reports `degraded` with `lastError`.
4. The `wrangler deploy --dry-run` bundle delta is reported in the PR and is under 60 KB gzipped.

#### E4.4 — Runtime validation (zod) — ThaiWater, GISTDA WFS, TMD radar
- Touches: the other three adapters, their schemas, and the DO error paths (`observation-cache.ts`, `flood-extent.ts`, `radar.ts` — `RadarDO`'s `status()` in particular, see AC 3)
- Depends: E4.3
- Size: M
- Risk: a 2–4 MB ThaiWater payload can make eager validation the slowest step of a refresh
- Issue: _(not yet filed)_

1. The ThaiWater payload validates in <300 ms in a test, or validation is per-record and lazy.
2. A malformed GISTDA response keeps the last scene and never half-overwrites the R2 object.
3. A bad radar frame is skipped, counted in `detail.skippedFrames`, **and made visible**: `RadarDO.status()` reports `health: "degraded"` with a populated `lastError` naming the skipped frame, cleared only after a refresh in which every frame validated — `SourceStatusBar` renders `health` and `lastError`, never arbitrary `detail` keys, so a counter alone would hide the failure until the retained frames aged into staleness (AGENTS.md: stale and degraded sources stay visible).
4. `ObservationCacheDO` validates before the transaction, so a refresh is never half-applied.

#### E4.5 — Request-input validation and explicit per-endpoint limits
- Touches: `apps/api/src/routes/{observations,stations,archive,earthquakes,radar}.ts`, `index.ts`, one `parseQuery()` helper, tests, `docs/api.md`
- Depends: E2.2
- Size: S
- Risk: none identified
- Issue: _(not yet filed)_

1. A bad `at` parameter returns a 400 JSON body, not a 500.
2. `limit` is clamped to ≤500.
3. Every route sets an explicit rate limit — no implicit default.
4. `docs/api.md` carries the per-endpoint limit table.

#### E4.6 — Named cache-policy module
- Touches: new `apps/api/src/cachePolicy.ts` (`noStore`, `realtime`, `observations` with `stale-while-revalidate`, `frozenArtifact` immutable only for content-addressed keys, `health`), `json()` takes a policy, `flood.ts freshnessCache()` re-expressed, tests, `docs/api.md`
- Depends: E4.2
- Size: S
- Risk: none identified
- Issue: _(not yet filed)_

1. `grep -rn "Cache-Control" apps/api/src/routes` matches nothing outside `cachePolicy.ts`.
2. All 4xx and 5xx responses are `no-store` (test).
3. `frozenArtifact` is only applied to content-addressed keys.
4. `docs/api.md` documents which policy each endpoint uses.

### E5 — Ingestion resilience, observability, DO tests

#### E5.1 — Isolate the four sources in `scheduled()`
- Touches: `apps/api/src/index.ts`, new pure `src/scheduledTick.ts`, tests
- Depends: E1.1
- Size: S
- Risk: none identified
- Issue: _(not yet filed)_

1. Sources run under `Promise.allSettled` with a per-source timeout of about 25 s.
2. Stubbing one DO to throw still calls the other three (test).
3. One structured log line is emitted per source per tick.
4. The orchestrator is covered by a `SELF.scheduled()` test (E5.5 pool) or a unit test.

#### E5.2 — Remove the dead `/hazards/latest` route; keep `ForecastPointerDO` for E10
- Touches: `apps/api/src/index.ts`, delete `src/routes/hazards.ts`, a comment in `forecast-pointer.ts` ("becomes the exposure-run pointer, E10.3"), `docs/api.md`
- Depends: —
- Size: S
- Risk: never delete a DO class that has data — the binding and migrations stay
- Issue: _(not yet filed)_

1. The route returns a 404 JSON body (test).
2. The DO binding and migrations are untouched (`wrangler deploy --dry-run`).
3. `grep -rn "hazards/latest" apps/web/src` returns 0 hits.

#### E5.3 — Structured logging helper and a `docs/ops.md` runbook
- Touches: new `apps/api/src/log.ts`, every `console.log(JSON.stringify(...))` site, DO R2 puts log key and byte count, new `docs/ops.md`
- Depends: E3.3
- Size: S
- Risk: none identified
- Issue: _(not yet filed)_

1. `grep -rn "console.log(JSON" apps/api/src` returns 0 hits.
2. `docs/ops.md` explains what each source state means and what to do about it.
3. It contains `wrangler tail | jq` recipes, the `/__scheduled` dev trigger, the alarm cadence table and the R2 key layout.
4. It documents `wrangler rollback`, the Workers Paid prerequisite and the cost note.

#### E5.4 — Post-deploy smoke check and rollback in `deploy.yml` *(standalone CI change)*
- Touches: `.github/workflows/deploy.yml` (smoke steps, previous-deployment capture, the `needs: deploy-web` + `!cancelled()` gate on `deploy-api`, reverse-order rollback), `docs/ops.md`; the forward-compatibility premise (a new web bundle must accept the old payload) belongs on the shared-types-changing task's release checklist in `docs/ops.md`, not in a CI assertion — no step here can check a bundle's tolerance
- Depends: E3.3, E5.3
- Size: M — the both-or-neither path below turns two independent jobs into an ordered pair with a shared rollback, which is more than a step bolted onto each job
- Risk: the job stays path-filtered and non-required, so it can never block an unrelated PR; the serialized path lengthens a shared-types deploy to two sequential Worker deploys
- Issue: _(not yet filed)_

**Assert a required *set* of source IDs, never a count.** The smoke check must verify that
`thaiwater`, `earthquakes`, `gistda-flood` and `tmd-radar` are all present in `sources[].id`, and must
tolerate extra IDs — E10.3 adds a fifth source (`exposure-illustrative`), and an exact-count assertion
would fail every deploy from that day on and trigger the rollback below on a healthy release.

**A shared-types release is both-or-neither.** `deploy-web` and `deploy-api` today both carry only
`needs: changes`, so they run in parallel and roll back independently. That is fine while the two
Workers' contract is unchanged, but a release that touches `packages/shared-types` ships one contract
across both units: roll back only the failing one and production is left on a mismatched pair — e.g.
E3.3 has the API emit the new `delayed` health value while the old web bundle has no `HEALTH_META`
entry for it and throws while rendering `SourceStatusBar`. The selector already exists: the `changes`
job's path filter sets **both** `web=true` and `api=true` for anything under `packages/shared-types/`,
and that combination (not a new filter) is what selects the stricter path. On it, the two deploys are
**serialized — web first, then api** (the new web bundle is written to accept both the old and the new
payload, so the bounded window between the two deploys is new-web-against-old-api, the direction that
degrades rather than crashes; the window is stated in `docs/ops.md`, not hidden), and **both units'**
previous deployment ids are captured *before* either deploy runs, because rolling back the unit that
did not fail still needs its prior version id. **Rollback runs in the reverse order — api first, then
web** — for the same reason the deploy is ordered: rolling web back first would put the old web bundle
against the still-new API, which is precisely the crashing direction described above. Where a release
does not touch shared-types, only one unit deploys and per-Worker rollback is sufficient — the weaker
path stays.

**Two details `deploy.yml` gets wrong if they are not stated.** The strict path is selected by both
flags **and** a diff touching `packages/shared-types/` — both flags alone also fire for a release that
happens to touch `apps/web/` and `apps/api/` with no contract change, which belongs on the per-Worker
path. And `deploy-api` cannot simply take `needs: deploy-web`: a skipped job propagates, so an
api-only release would silently never deploy. The gate is `needs: deploy-web` plus
`if: !cancelled() && needs.changes.outputs.api == 'true' && (needs.deploy-web.result == 'success' ||
needs.deploy-web.result == 'skipped')`.

1. After `deploy-api`, `curl -fsS /api/v1/health` returns 200 and jq asserts the four required IDs `thaiwater`, `earthquakes`, `gistda-flood`, `tmd-radar` are a **subset** of `[.sources[].id]` — no `length ==` check anywhere in the step — and it does **not** gate on `ok`.
2. The step contains no exact-count expression (`grep -n 'length ==\|length !=\|== 4' .github/workflows/deploy.yml` over the smoke step returns 0 hits), so a health payload carrying an extra source ID still passes.
3. After `deploy-web`, `/` returns 200 and a known tile HEAD returns 200.
4. On a smoke failure in a release that does **not** touch `packages/shared-types` — whichever flags `changes` set — `if: failure()` runs `wrangler rollback` for that Worker only.
5. On a smoke failure in a release that **does** touch `packages/shared-types` (both flags set **and** the diff touched that path), the failure handler rolls **both** Workers back to the deployment ids captured before the release — never just the failing one — in the order api then web, and the two deploy jobs ran in the fixed order web → api with `deploy-api` gated on `deploy-web`, so a web failure never leaves a new API live.
6. An api-only release (no `apps/web/` or `packages/shared-types/` change) still deploys: `deploy-api` runs even though `deploy-web` was skipped.
7. The added wall-clock time is ≤1 minute for a single-unit release, and ≤3 minutes for a serialized shared-types release.

#### E5.5 — Workers-pool tests: router, health, one DO
- Touches: `apps/api/vitest.config.ts` (`defineWorkersConfig`, `wrangler.configPath`), `test/{router,health,earthquake-feed}.test.ts`
- Depends: E1.1, E2.2
- Size: L — the config plus three areas is what proves the pool works end to end
- Risk: `nodejs_compat` and `compatibility_date` must match `wrangler.jsonc`; keep isolated storage on
- Issue: _(not yet filed)_

1. Via `SELF.fetch`: 404, 403, 405 and 429 (with `Retry-After`) are asserted.
2. A cold `/health` includes at least the source IDs `thaiwater`, `earthquakes`, `gistda-flood`, `tmd-radar`, each with `fetchedAt: null` and health `unknown` or `down` — asserted as a required subset, not an exact count, so E10.3's fifth source does not break this test.
3. With `runInDurableObject` and `fetchMock`: three feed fixtures produce N events and `ok`.
4. All feeds returning 500 yields `down` while prior events are still served.
5. An R2 put/get smoke test passes.
6. `npm test -w apps/api` finishes in under 90 s.

#### E5.6 — Upstream fixtures and adapter normalisation tests
- Touches: `apps/api/test/fixtures/*.json|xml` (≤50 KB each, with a capture date and URL header and **no credentials in URLs**), `test/ingestion/*.test.ts`, new `docs/testing.md`
- Depends: E5.5
- Size: M
- Risk: fixtures go stale silently — the capture date header is what makes that visible
- Issue: _(not yet filed)_

1. Each adapter asserts the normalised shape, units, `observedAt` and `situationLevel` passthrough.
2. `{}` and `[]` inputs throw rather than producing empty-but-valid output.
3. No fixture contains a credential.
4. `docs/testing.md` explains how to re-capture a fixture.

### E6 — Realtime hardening (server side)

#### E6.1 — Explicit heartbeat cadence and WS ping auto-response
- Touches: `apps/api/src/durable-objects/earthquake-feed.ts` (heartbeat every ≤30 s independent of the poll, `setWebSocketAutoResponse(ping/pong)`), `packages/shared-types/src/earthquake.ts` (heartbeat carries `serverTime`/`asOf`), the `docs/api.md` protocol section, a test using `runDurableObjectAlarm`
- Depends: E3.1, E5.5
- Size: S
- Risk: the E2.1 client watchdog constant must be tightened in the same PR or the client closes healthy sockets
- Issue: _(not yet filed)_

1. A heartbeat is sent at least every 30 s regardless of poll cadence.
2. `setWebSocketAutoResponse` answers ping frames without waking the DO.
3. The heartbeat frame carries `serverTime` and `asOf`.
4. `docs/api.md` documents the protocol: snapshot first, then deltas, with cadence and close codes.
5. A `runDurableObjectAlarm` test asserts the heartbeat cadence.

#### E6.2 — Push `health.updated` over the existing socket (optional)
- Touches: `EqWsMessage` becomes `RealtimeMessage`, `EarthquakeFeedDO` collects the other DOs' `status()` on its tick and broadcasts on change, `useApiHealth.ts` prefers push and keeps the 60 s poll fallback, alias `/api/v1/stream`
- Depends: E2.1, E3.3, E6.1
- Size: M
- Risk: not on the M3 exit criterion — skip it under time pressure
- Issue: _(not yet filed)_

1. A health change reaches the UI within 60 s without polling.
2. The poll fallback still works when the Upgrade is rejected.
3. The message union stays backward compatible for one release.

### E7 — Localisation th/en (typed catalog, no framework)

#### E7.1 — i18n foundation, toggle and `?lang=`
- Touches: `apps/web/src/i18n/{index.ts,th.ts,en.ts,LanguageProvider.tsx}` (`th` is the source of truth; `en: Record<keyof typeof th, string>` so a missing key is a tsc error), `useT()`, `usePermalink.ts` (`lang`), `localStorage["siahra.lang"]`, `document.documentElement.lang`, the TopBar toggle, `lib/time.ts` takes a locale, a key-parity test
- Depends: E1.2, E3.4
- Size: M
- Risk: the default stays Thai unless the user decides otherwise (see §4)
- Issue: _(not yet filed)_

1. `?lang=en` round-trips through the permalink and persists across reloads.
2. `document.documentElement.lang` follows the selection.
3. The key-parity test fails if a key exists in one catalog and not the other.
4. Screenshots in both languages are in the PR.

#### E7.2 — Migrate the layout components
- Touches: TopBar, Sidebar, BottomBar/dock, MobileSheet, ProvinceSelector (`PROVINCES[].nameEn` already exists), MapLegend, SourceStatusBar (`labelTh`/`labelEn`), ApiStatusFooter, MapAttribution, StatStrip, TimelineBar
- Depends: E7.1, E3.1
- Size: M
- Risk: none identified
- Issue: _(not yet filed)_

1. `grep -Pn '[\x{0E00}-\x{0E7F}]' apps/web/src/components/layout/*.tsx` hits only comments.
2. Every migrated string resolves through `useT()`.
3. Screenshots in both languages at desktop and 390×844.

#### E7.3 — Migrate hazard cards, popup and hook error strings
- Touches: `apps/web/src/components/hazard/*`, `components/map/InfoPopup.tsx`, `hooks/*.ts` (error strings become keys)
- Depends: E7.1
- Size: M
- Risk: none identified
- Issue: _(not yet filed)_

1. The same Thai-character grep on those directories hits only comments.
2. Hook error strings are keys, so a failed fetch is readable in both languages.
3. Screenshots in both languages.

### E8 — 3D performance and shipping weight

#### E8.1 — LOD hysteresis and an altitude gate
- Touches: `apps/web/src/scene/TerrainTiles.ts` (`collect`: split at `d < size×f`, merge only at `d > size×f×1.25`), new pure `scene/lod.ts` plus tests, `BuildingTiles.ts` and `FeatureTiles.ts` altitude gate at about 25 km
- Depends: E1.1
- Size: M
- Risk: the dispose paths in `Map3DCanvas.tsx:460-494` must still free merged tiles, or hysteresis turns into a GPU leak
- Issue: _(not yet filed)_

1. `shouldSplit(distance, size, factor, wasSplit)` has dead-band tests.
2. A 10 s orbit across a threshold produces no toggling — a debug counter on `__siahraHandles`, before and after, in the PR.
3. Building and feature tile requests are absent above the altitude gate (network request count).
4. Merged tiles are still disposed; no growth in renderer info over ten province switches.

#### E8.2 — Bundle budget and chunking
- Touches: `apps/web/vite.config.ts` (`manualChunks` for three and react), new `scripts/check-bundle-budget.mjs`, `apps/web/package.json` (declares the `postbuild` hook that runs it, so CI picks it up **without** editing `ci.yml`)
- Depends: —
- Size: S
- Risk: none identified
- Issue: _(not yet filed)_

1. The build fails when entry plus vendor exceeds 900 KB gzipped.
2. The chunk sizes are listed in the PR.
3. `npm run build -w apps/web` still succeeds within the existing CI budget.

#### E8.3 — Stop shipping the legacy `buildings.geojson`
- Touches: delete `apps/web/public/aoi/[0-9][0-9]/buildings.geojson` (**not** `chiangmai-old-city`) and drop the now-dangling `buildings.url` from those 77 manifests, make `AoiManifest.buildings.url` optional, keep the legacy path in `BuildingLayer.ts` as the no-tiles fallback, new `scripts/check-building-tiles.mjs` (gate, wired into `deploy:web`), `apps/etl/src/{writeManifest,buildAllProvinces,buildProvinceBuildings}.ts`, `docs/deploy.md`
- Depends: —
- Size: M
- Risk: the blobs stay in git history (accepted; see the Deferred section)
- Issue: _(not yet filed)_

1. A script asserts that all 77 manifests carry `buildings.tiles` before anything is deleted.
2. `du -sh apps/web/public/aoi` drops from 262M to 98M — the 77 province `buildings.geojson`
   files are 164M of it (`du -ch apps/web/public/aoi/[0-9][0-9]/buildings.geojson`; 171,814,671
   apparent bytes = 163.9 MiB). Every figure with an `M` suffix here is `du`, i.e. MiB. The
   "at least 600 MB" written here originally was impossible: the whole directory only ever
   held 262M. `chiangmai-old-city/buildings.geojson` (6.5 MiB) stays — that AOI has no tile
   pyramid, so its GeoJSON is still the only way it renders buildings.
3. A three-province playwright spot check still renders buildings.
4. `AoiManifest.buildings.url` is optional in shared-types and every consumer tolerates its absence.

#### E8.4 — Overlay computation in a Web Worker
- Touches: new `apps/web/src/workers/overlay.worker.ts`, `scene/hazardOverlay.ts`, `scene/floodMask.ts`, `Map3DCanvas.tsx`
- Depends: E3.5
- Size: M
- Risk: none identified
- Issue: _(not yet filed)_

1. The main-thread long task on province switch drops by at least 50 % (`performance.measure` numbers in the PR).
2. The worker output is hash-identical to the synchronous version on a synthetic DEM.
3. The worker is terminated on dispose — ten province switches leak nothing.

### E9 — Provenance, versioned datasets, release

#### E9.1 — Manifest provenance: `datasetVersion`, `generatedAt`, `sources`, `checksums`
- Touches: `packages/shared-types/src/aoi.ts` (optional fields; `version` kept; `sources` carries **per-layer** provenance — for each of imagery/roads/water/buildings/trees/terrain, the retrieval or build time of that layer's own artefact, plus the upstream publication epoch where one exists), `apps/etl/src/writeManifest.ts` (plus sha256, and record each layer's own timestamp as it is written), `apps/web/src/scene/loadAoiManifest.ts` (tolerant; verify the `terrain.bin` checksum via SubtleCrypto → warn and export a `terrainIntegrity: "verified" | "mismatch" | "unknown"` flag, labelled per value: `"unknown"` → "integrity unknown", `"mismatch"` → "integrity check failed"), `scene/hazardOverlay.ts` (on `"mismatch"`, zero **only** the lowland R contribution inside `buildOverlayField` — G, the observed halo around stations reporting heavy rain or high water, and B, the mask, are not derived from `terrain.bin` and must keep rendering; the GISTDA satellite extent is a separate texture built by `scene/floodMask.ts` and sampled as `uFloodMask`, so it is untouched by a terrain mismatch), `MapLegend.tsx` (the suppressed rows say why), `src/data/staticLayerDescriptors.ts` (back-fill the E3.4 static-reference `fetchedAt` from the per-layer `sources` entries; still `null` → "retrieval time not recorded" for manifests without them), `MapAttribution.tsx` shows the build date, new `docs/dataset.md`
- Depends: E3.1, E3.4
- Size: L — the manifest fields, the integrity flag and the hazard-overlay gate that consumes it are only checkable together
- Risk: the fields only appear after the user reruns ETL, so the web side must tolerate old manifests indefinitely; a missing checksum is `"unknown"`, which must **not** suppress anything — only a real `"mismatch"` does
- Issue: _(not yet filed)_

**A checksum mismatch must not keep driving hazard output.** Those elevations feed `buildOverlayField`
in `scene/hazardOverlay.ts`, which produces the illustrative low-lying classification, and E10.4 gates
the exposure layer on that same R channel — so an untrusted DEM would otherwise go on generating hazard
values. Base terrain may keep rendering (labelled "integrity unknown"), but every **terrain-derived
hazard overlay** — the lowland channel and anything gated on it, including the E10 exposure layer — is
disabled until a manifest-matching `terrain.bin` loads, with the legend and status bar saying why.

1. An ETL unit test writes a manifest to a temp dir and asserts all four fields, including a per-layer timestamp for each static layer.
2. The web client loads both old and new manifests without error; a manifest with no checksum yields `terrainIntegrity: "unknown"` and suppresses nothing.
3. With a deliberately corrupted `terrain.bin`, base terrain still renders, the lowland overlay is suppressed (the R channel is zero) and its legend row is labelled "terrain integrity check failed — low-lying layer unavailable", while the observed station halos (G) and the mask (B) are unchanged, and the GISTDA extent layer still draws from its own texture; screenshot in the PR.
4. `MapAttribution.tsx` shows the dataset build date, and the E3.4 static-reference rows show their per-layer retrieval times once the manifest carries them.
5. `docs/dataset.md` states the mismatch behaviour and which layers it disables.

#### E9.2 — Version-addressed tile prefix
- Touches: `apps/web/worker/index.ts` regex extracted to `worker/tilePath.ts` (plus tests; accepts `/aoi/{code}/v/{ver}/{layer}/{z}/{x}_{y}.bin` and the legacy form; rejects traversal), `vite.config.ts` middleware, ETL fills a versioned `urlTemplate`, `scripts/upload-tiles.sh --version`, `scripts/verify-tiles.sh`
- Depends: E9.1
- Size: M
- Risk: legacy URLs are served `immutable` for a year, so they can never be deleted on the old prefix
- Issue: _(not yet filed)_

1. Legacy URLs still return 200 — nothing on the old prefix is deleted.
2. New manifests point at the versioned prefix.
3. `tilePath.ts` has tests including path-traversal rejection.
4. `docs/dataset.md` states the retention policy for old prefixes.

#### E9.3 — Dataset release script (local, no Actions job)
- Touches: new `scripts/release-dataset.sh`, new `docs/dataset-release.md`
- Depends: E9.2
- Size: S
- Risk: none identified
- Issue: _(not yet filed)_

1. The script runs build → checksum → upload → verify → manifest diff in that order.
2. A dry-run mode prints every action without writing to R2.
3. It refuses to run without `scripts/.env.r2`.
4. `docs/dataset-release.md` documents the procedure and the rollback.

#### E9.4 — `Range` support for R2 tiles (optional)
- Touches: `apps/web/worker/index.ts` (206 responses, `Content-Range`, `Accept-Ranges`), tests
- Depends: E9.2
- Size: S
- Risk: only worth doing as the gate for PMTiles, which is deferred
- Issue: _(not yet filed)_

1. A ranged request returns 206 with a correct `Content-Range`.
2. Responses advertise `Accept-Ranges: bytes`.
3. A malformed or unsatisfiable range returns 416, never a truncated 200.

### E10 — Tier A illustrative flood exposure and earthquake analytics

**Naming rule for this epic.** The layer is **"flood exposure (illustrative)"** — never "risk",
"nowcast", "forecast", "prediction", "%", "chance" or "probability". The Thai words that are likewise
forbidden in UI strings are `"เสี่ยง"`, `"พยากรณ์"`, `"คาดการณ์"`, `"โอกาส"`, `"ความน่าจะเป็น"`.
The ban is on *asserting* those things, so an explicit negation is exempt: the prescribed legend
note in E10.4 disclaims two of them by name, and the grep must allow a term preceded by `ไม่ใช่`
(and English "not a") while still failing on any bare use.
Levels `low | elevated | high | severe` rank *observed* inputs; `epistemicClass` is `"illustrative"`
and `methodologyUrl` is mandatory. It cannot become `probabilistic` under the current contract (see
Deferred D-1). qa-verifier greps the touched files for the forbidden words.

#### E10.1 — Contract and methodology document
- Touches: new `packages/shared-types/src/exposure.ts` (`ExposureLevel`, `StationExposure {stationId,provinceCode,lat,lon,level,factors:{rain1hMm,rain24hMm,freeboardM,freeboardTrendMPerH,situationLevel},observedAt}` — `provinceCode: string | null` is copied verbatim from `StationRef.provinceCode` (`packages/shared-types/src/observations.ts`, already `string | null` because the ThaiWater station record carries the province code and some stations have none) at compute time, so the run is self-describing and E10.3 can scope it without consulting live station data), `FloodExposureRun {runId,computedAt,inputs:{thaiwaterFetchedAt,historyWindowH},layer,stations[]}`; the doc comment forbids probability fields), new `docs/methodology/flood-exposure.md`
- Depends: E3.2
- Size: S
- Risk: none identified
- Issue: _(not yet filed)_

1. The additive types compile in api, web and etl.
2. The methodology document contains the threshold table.
3. It states what is **not** included: radar (until E10.5), DEM depth, hydraulics.
4. It defines the run-id format.
5. `StationExposure.provinceCode` is documented as a snapshot of the station's province at compute time, `null` when the upstream record has none — never guessed from geometry, never back-filled into an already-published run.

#### E10.2 — Pure exposure computation with fixture tests
- Touches: new `apps/api/src/exposure/compute.ts` (`computeExposure(observations, hourlyLevels, thresholds, now)` — it builds the `StationExposure` records, so it is what copies `StationRef.provinceCode` into `StationExposure.provinceCode`, verbatim and `null`-preserving), tests
- Depends: E10.1, E5.6
- Size: M
- Risk: none identified
- Issue: _(not yet filed)_

1. Deterministic — the same input hashes to the same output.
2. One test per threshold row.
3. Missing inputs are never invented: `factors.*` is null and the level comes from what exists.
4. Zero stations is a valid run, not an error.

#### E10.3 — Publish runs: immutable R2 artefact, pointer DO, routes, health entry
- Touches: `observation-cache.ts` (compute one **nationwide** run after a successful refresh, and publish a new immutable run whenever **any exposed field changes** — a level, any `factors.*` value, or any station `observedAt`; the publish is wrapped so a failure cannot skip the alarm rearm, see the rearm note below), `forecast-pointer.ts` (repurposed as the run pointer, class name kept), new `routes/exposure.ts` (`GET /api/v1/provinces/NN/exposure/latest` filters the stored run **on `StationExposure.provinceCode` alone**; `GET /api/v1/exposure/runs/{runId}` uses `frozenArtifact`), `index.ts`, `health.ts` source `exposure-illustrative` (`delayed` after 30 minutes without a run, plus `lastError` when the last publish failed), tests, `docs/ops.md`
- Depends: E10.2, E5.2, E4.6
- Size: L — the artefact, the pointer, the routes and the health entry are only checkable together
- Risk: compute after the DO transaction commits; at most one R2 write per refresh; a rejecting publish must not take the refresh alarm down with it (rearm note below)
- Issue: _(not yet filed)_

**Publish rule and its cost.** The run artefact defined in E10.1 carries per-station `factors`
(`rain1hMm`, `rain24hMm`, `freeboardM`, `freeboardTrendMPerH`, `situationLevel`) and `observedAt`, so
publishing only when the *level set* changed would leave `/latest` serving the previous measurements
and the previous `observedAt` — possibly for hours — while the layer presents itself as current. That
is stale data rendered as fresh. So: **a new run is published whenever any exposed factor or timestamp
changes**, not only on a level change. In practice that is one run per successful ThaiWater refresh,
i.e. roughly every 5 minutes, ≈288 runs/day (≈105k small JSON objects a year, about 100× what the
level-change rule would have written) — still at most one R2 write per refresh. Runs are kept
indefinitely, which is what makes `/exposure/runs/{runId}` citable; `docs/ops.md` records the object
count and states that an R2 lifecycle rule is the lever if the bucket ever needs one. The level-change-only optimisation becomes available **only** if the artefact stops
carrying per-station measurements and freshness is advanced through a separate, always-updated pointer
field; it is not available while the artefact exposes measurements.

**Province scoping lives inside the run.** `/provinces/NN/exposure/latest` must decide which stations
belong to `NN` using only what the run itself stores — the `provinceCode` E10.1 adds to
`StationExposure`. Deriving it at request time from the live `waterlevel`/`rainfall` tables would
scope a *historical* run by *today's* station list: a station that has since been retired upstream
would silently drop out of a run it was part of, and a station whose province record changed would be
re-attributed, so the same run id would answer differently on different days. The boundary rings that
would allow a geometric fallback do not exist until E10.6 either, and geometry is not the source of
truth for administrative membership anyway. Stations with `provinceCode: null` belong to no province
endpoint and appear only in the nationwide run — that is honest, not a gap to be filled by guessing.

**The alarm rearm cannot depend on the publish.** `ObservationCacheDO.alarm()` today is
`await this.refreshOnce(...)` then `await this.armAlarm()`, with no `finally`; the same pattern repeats
at every site where a refresh precedes the rearm — `ensureFresh()`, and the lazy path in
`getObservations()`, where `armAlarm()` is not even awaited. Adding an R2 write and a pointer update to the refresh path puts a rejecting
promise in front of `armAlarm()`, and one rejection then leaves the DO with **no** alarm scheduled, so
observation refreshes stop too, not just exposure ones. Production cron papers over this; a missed
cron or `wrangler dev` (where cron does not fire at all) does not. So the publish error is caught and
surfaced on `/health` (`lastError`, source `exposure-illustrative`) so it can never reject out of
`refreshOnce()`, and `armAlarm()` runs from a `finally` at all three sites.

1. The key `exposure/runs/{runId}.json` is never overwritten (test).
2. A refresh that changes a measurement (a `factors.*` value or a station `observedAt`) but no level produces a **new** run id, and `/latest` then serves the new measurements and the new `observedAt` (test).
3. `/latest` returns `layer.epistemicClass === "illustrative"`, a non-empty `methodologyUrl`, an `X-Run-Id` header, and no response key matching `probability|chance|likelihood|risk` (one contract test covering all four assertions).
4. An unknown province code returns 404.
5. Two known province endpoints return disjoint, correctly-scoped station sets filtered on `StationExposure.provinceCode` only, and re-reading an old run id through `/exposure/runs/{runId}` (then scoping it) yields exactly the scoping it had when written, even after the live station table has changed (test that removes a station from the live table and asserts the old run is unaffected).
6. `/health` lists `exposure-illustrative` and marks it `delayed` after 30 minutes without a run.
7. An alarm whose exposure publish rejects (R2 put or pointer update failing, in a test) still leaves the next alarm armed — `ctx.storage.getAlarm()` is non-null afterwards — and the failure shows on `/health` as a populated `lastError` on `exposure-illustrative`, never as silence.

#### E10.4 — Map layer, legend and permalink
- Touches: new `apps/web/src/hooks/useFloodExposure.ts`, `scene/hazardOverlay.ts` (station levels draped as halos **gated by the lowland R channel**, so only low ground lights up), `terrainMaterial.ts` (the E3.5 illustrative treatment plus a level ramp), `MapLegend.tsx` row (illustrative badge, input list, methodology link, `computedAt` age), `usePermalink.ts` (`layers` += `exposure`), i18n keys th/en — Thai label `"พื้นที่ลุ่มต่ำที่ขณะนี้มีฝนหนัก/น้ำสูงในบริเวณใกล้เคียง (ภาพประกอบ)"`, Thai note `"คำนวณเองจากภูมิประเทศ + ค่าตรวจวัดจริง ไม่ใช่การพยากรณ์ ไม่ใช่ความน่าจะเป็น"`
- Depends: E10.3, E3.5, E3.4, E7.1, E9.1
- Size: L — the hook, overlay, shader and legend have to land together to be checkable
- Risk: `low` is two different states in one word — see the note below
- Issue: _(not yet filed)_

**`low` means two things, and the renderer must not merge them.** E10.2 fixes the contract so that a
station whose factors are *all* `null` gets `level: "low"` — the same word as a station that was
measured and landed in the lowest band (`docs/methodology/flood-exposure.md` §ขั้นตอนการคำนวณ item 3
says so explicitly). A "no usable factor at all" station is a station nobody measured, not a safe one,
and drawing it with the safe colour is exactly the silent-disappearance failure AGENTS.md forbids.
The two are already distinguishable from the run alone — *no factor produced a band* (in practice
every `factors.*` is `null`, and a non-finite value produces no band either) — so this is a
rendering and legend decision, not a contract change: do **not** add a level or a flag to
`packages/shared-types/src/exposure.ts` for it.

1. The layer is off by default; the toggle and the permalink round-trip.
2. A screenshot shows the treatment as distinct from GISTDA observed and from plain lowland.
3. The legend text contains the illustrative wording plus the input list and the methodology link.
4. When the API is down the layer dims and the legend says there has been no run since a stated time.
5. With a `terrain.bin` checksum mismatch (E9.1 `terrainIntegrity: "mismatch"`) the exposure layer is suppressed along with the lowland channel it is gated on, and the legend says why — it never drapes over an unverified DEM.
6. Frame-time delta ≤1 ms.
7. The forbidden-word grep over the touched files is clean.
8. A station for which no factor produced a band is drawn and labelled distinctly from a measured `low` station (no data ≠ safe), and the legend names both states; screenshot in the PR.

#### E10.5 — Radar term as an input (optional)
- Touches: new `apps/api/src/exposure/radarTrend.ts` (decode the last three TMD PNGs, sample at station locations, class 0–3 via a documented lookup table), a methodology update, tests
- Depends: E10.3
- Size: M
- Risk: skip it if the CPU or bundle cost is out of line, and document that decision in the PR
- Issue: _(not yet filed)_

1. The radar class is derived from a lookup table documented in `docs/methodology/flood-exposure.md`.
2. A missing or unreadable frame yields a null term, never a substituted value.
3. Tests cover the sampling against a fixture frame with known pixel values.
4. The added CPU time per run is measured and reported in the PR.

#### E10.6 — Earthquake distance-to-province (no prediction, no shaking model)
- Touches: `packages/shared-types/src/earthquake.ts` (`nearest?: {provinceCode,nameTh,nameEn,distanceKm,inside:boolean}[]` — `distanceKm` is the distance to the province **polygon**, 0 when the epicentre is inside it), a new simplified-ring artefact `apps/api/src/data/provinceRings.json` (emitted by the existing `apps/etl/src/provinceBoundaries.ts`, which already parses boundaries — do not re-implement that; built from `apps/web/public/aoi/*/boundary.geojson` — those files are web assets a Worker cannot read at runtime, so the rings must be baked into the api bundle; simplify and quantise to a budget of **≤400 KB** raw for all 77 provinces, and state the simplification tolerance in the PR), new `apps/api/src/geo/pointInProvince.ts` (point-in-ring plus point-to-segment distance, pure, tested), `EarthquakeFeedDO` (exact point-to-polygon distance against **all 77** province ring sets per new event — no shortlisting step, see the callout; `ALTER TABLE … ADD COLUMN` guarded by `PRAGMA table_info`, never a table recreate), `EarthquakeLiveCard.tsx`, `InfoPopup.tsx`, i18n keys th/en for both wordings — `"ในเขต <province>"` / `"within <province>"` and `"ห่างจาก <province> ≈ N กม."` / `"≈ N km from <province>"`
- Depends: E3.1, E7.3
- Size: L — the ring artefact, the pure geometry module, the DO migration and the two UI surfaces are only checkable together
- Risk: a careless migration drops stored events — the guarded `ALTER TABLE` is the point; second, the ring artefact inflates the api bundle, hence the stated budget and the reported simplification tolerance
- Issue: _(not yet filed)_

**Centroid distance is not the province distance.** Ranking centroids by haversine and printing
"≈ N km from <province>" is wrong for large or elongated provinces: an epicentre already inside the
province can be reported tens of km away, and the containing province can drop out of the nearest-three
list entirely. Specified behaviour is **point-to-polygon** distance from the boundary rings, 0 when the
point is inside — and **evaluated against all 77 provinces, with no shortlisting step**. Ranking or
pre-filtering by centroid is not a safe lower bound and reintroduces exactly this defect: an elongated
province can have its centroid hundreds of km from the epicentre while its boundary runs right past
it, so it never reaches the polygon phase and the true containing or nearest province is dropped.
The full pass is cheap enough not to need one: the ring set is the ≤400 KB artefact above, held in
module memory, giving a few tens of thousands of point-to-segment tests — sub-millisecond, run **once
per new event on ingest** inside `EarthquakeFeedDO` and persisted on the row, so no request ever pays
for it. (The only shortlist that would be admissible is one whose bound is provably never greater than
the polygon distance — e.g. distance to each province's precomputed bounding box — and it is not worth
the extra artefact and the extra failure mode at this scale.) If polygon distance is
judged too costly at implementation time, the only acceptable alternative is to rename and type the
field explicitly as distance to the province *centre* (`centroidDistanceKm`, UI "≈ N km from the centre
of <province>", the centre derived from `provinceRings.json` at build time — no separate centroid
artefact exists or is needed) — but polygon distance is what this task specifies.

1. Each event carries its three nearest provinces, ranked by polygon distance.
2. An epicentre inside a province reports `distanceKm === 0` / `inside: true`, that province ranks first, and the card reads `ในเขต <province>` / `within <province>` rather than a non-zero distance (fixture test with a known inland epicentre).
3. Otherwise the card reads `≈ N km from <province>` and links to the upstream event page.
4. `pointInProvince.ts` has unit tests: inside, outside-near-edge, and — against an elongated province whose geometric centre lies far from the test point while its boundary passes close by — that province is still ranked first, proving no shortlisting step can discard it.
5. Existing rows gain `nearest` on the next poll and the row count is unchanged (test).
6. `provinceRings.json` is ≤400 KB and `wrangler deploy --dry-run` for `siahra-api` stays inside the Worker script-size limit (`ci.yml` bounds only `apps/web/dist`, so it does not cover this).
7. The wording contains nothing that reads as a forecast or a prediction; screenshot in the PR.

### E12 — TMD numerical weather forecast

Unlike E1–E10 above, this epic does not come from the audit: it is **W7+W8** of
`docs/roadmap-Impact Decision-Support.md`. E12.1 (contract), E12.2 (ingestion, Durable Object,
routes), E12.3 (the per-province forecast card) and E12.4a (the forecast time strip) have landed;
**the card is on the timeline now but still not on the 3D map itself** — E12.4b is named here for
order, not specified, and still needs its own task block in the format described in §0 before it
is implemented.

- **E12.1 — forecast contract and epistemic class** — *done*. `EpistemicClass` gains a fifth member
  `"forecast"`: a named, cited, third-party **deterministic** model (TMD NWP), deliberately not
  `probabilistic`, which stays reserved for a *probabilistic* third-party model and stays unused.
  `HazardLayerDescriptor` gains an optional `forecast` block (`modelName`, `resolutionKm`,
  `horizonHours`, `issuedAt`), and new `packages/shared-types/src/forecast.ts` carries
  `ForecastStep` / `ProvinceForecastBatch` / `ProvinceForecastResponse`. The honesty facts the
  contract encodes: TMD's NWP API publishes only the forecast **valid** time — no run/issue time, no
  cycle — so `issuedAt` is `null` for it and is never filled in from `fetchedAt`; a field TMD did not
  return is `null`, never `0`; `batchId` is *our* fetch round, not a model run id; `queryPoint` is
  the grid point TMD used, not the one we sent; `batch: null` means "never fetched successfully" and
  must not render as an empty table. `apps/web/src/lib/layerFreshness.ts` gains the fifth badge and
  counts a `forecast` layer with `fetchedAt: null` as stale, and `i18n/catalog.test.ts` gains a
  narrow key-scoped, TMD-gated exemption to the banned-word gate that still bans every
  probability word. `sources.ts` is deliberately **untouched**: the `tmd-nwp` `SourceId` belongs with
  the ingestion that feeds `/api/v1/health`, because `apps/api/test/contract.test.ts` asserts that
  every `LIVE_SOURCE_IDS` entry appears in `/health` — registering the id now would either fail that
  test or force a fabricated health row for an ingestion path that does not exist, so it lands in
  E12.2, not here.
- **E12.2 — ingestion, Durable Object, routes** — *done*. `ForecastNwpDO` (binding `FORECAST_NWP`,
  migration v8, instance `"tmd"`) polls `data.tmd.go.th/nwpapi/v1` hourly: **12 calls per round**
  (6 TMD regions × hourly/daily — `/region` returns every province in the region and
  `location.geocode` is the province code, so no Thai name matching) plus one availability call.
  Storage is deliberately **one row per province holding the whole batch as JSON**, latest-only,
  no history table and no retention `DELETE`: 77 province rows/hour = 55,440 per billing cycle,
  plus the `meta` counters every round → **measured 66k–130k rows written per cycle (0.13–0.26% of
  the 50M allowance)**, and one primary-key read per request. `status()` reads `meta` only, and
  `ForecastNwpDO` is registered in `apps/api/test/sqlQueryPlans.test.ts` with **no `ALLOWED_SCANS`
  entry at all**. `GET /api/v1/provinces/{NN}/forecast` and `GET /api/v1/forecast/availability`; the
  `tmd-nwp` `SourceId` and its `/health` row land here. `ProvinceForecastResponse` carries **two**
  descriptors (`layers.hourly`, `layers.daily`) because the two series reach different distances
  ahead (48 h vs 168 h) and one descriptor would have to overstate one of them; `resolutionKm`
  became `number | null` and is `null` for both, because the API publishes no grid metadata and the
  TMD doc pages that carry the 2 km / 18–27 km figures were measured wrong about the response keys
  on the same day. `horizonHours` is counted from the steps the upstream actually returned, not from
  the `duration` we asked for (the cold state, with nothing to count, is the one exception).
  `ensureFresh()` gates on `lastAttemptAt` as well as `fetchedAt`, so the one-minute cron cannot
  erase the 5-minute failure backoff while the upstream is down (`docs/ops.md` §4).
- **E12.3 — per-province forecast card** — *done*. `useProvinceForecast.ts` polls
  `GET /api/v1/provinces/{NN}/forecast` for the **selected province only** (never all 77) every 10
  minutes — above the devops cost gate's 120 s floor (PR #58) by a wide margin, and structured
  after `useActiveAlerts.ts` (state reset before the `provinceCode` guard, `AbortController`,
  `nextReconnectDelayMs` backoff). `ForecastCard.tsx` renders it in both `RightPanel` (desktop,
  after `RainfallCard`) and the mobile sheet (new tab, labelled "TMD" rather than a
  forecast-family word, since `sheet.tab.forecast` sits outside the E12.1 i18n exemption's key
  pattern), with three explicit states: never-fetched (`batch: null` on a real `200` — the copy
  may say "TMD" because a request actually succeeded), our-own-fetch-failed (`error`, silent on
  TMD's own state), and stale-but-shown (dimmed, old figures never hidden). Two small chart
  components, `HourlyRainChart` (48 h, mm/h, a null-safe gap in the line so a missing step never
  reads as 0 mm) and `DailyRainBars` (7 d, mm/24 h — a real-but-tiny value floors at a 3 %-height
  bar, a missing value at a visually distinct 10 % dashed marker so the two are legible without
  relying on colour alone), rather than reusing `Sparkline.tsx`, which is hard-typed to
  `WaterLevelHistoryPoint` and its bank-level reference line. `lib/time.ts` gains
  `formatWeekday()` (Bangkok-pinned short weekday name) for the daily bar labels. `forecast.note`
  states outright that the figures are a deterministic model output, not a probability.
- **E12.4a — forecast time strip** — *done*. `ForecastStrip.tsx` scrubs forward through TMD's
  hourly steps (≤48), rendered next to `TimelineBar` (which scrubs backward through observed
  history) — stacked in `App.tsx`, side-by-side at `@2xl` in `BottomBar.tsx` — and reuses
  `useProvinceForecast` from E12.3, no new fetch. New `forecastAtIso` state in `App.tsx` is kept
  mutually exclusive with `atIso` in two places: `handleAtIsoChange`/`handleForecastAtIsoChange`
  clear the other `useState` on selection, and `serialisePermalink`/`parsePermalink` add a `f=`
  query param that is never written alongside the existing `t=`, with `t` winning on a
  hand-edited URL that carries both — keyed on the `t` param being *present*, not on whether it
  parses, so a malformed `t` still suppresses `f`. Visually distinct from `TimelineBar` by pattern,
  not colour (`.range-slider-forecast`'s hatched/dashed track, following the same
  observed-vs-computed convention as `lib/illustrativeStyle.ts`), using the existing
  `EPISTEMIC_BADGE.forecast` token. No colour banding on the hourly rain values shown — no
  TMD-cited band exists at hourly granularity, only the 24 h band E12.3 already cites; a step
  TMD did not send renders as an explicit "not sent", never `0` or blank. Tick labels are hours
  counted from the first returned step, not from "now" (TMD's first step may not align with it).
  **Selecting a forecast step has zero effect on the 3D map** — no prop from `ForecastStrip`
  reaches `scene/**`.
- **E12.4b — observed-versus-forecast visual language on the 3D map** — *not started, not yet
  specified*. The remaining part of the original E12.4 task: a province-level forecast rain band
  drawn on the terrain while scrubbing `forecastAtIso`. Deliberately deferred rather than folded
  into E12.4a — reusing the existing exposure shader channel for it would make a forecast band
  pixel-identical to observed exposure data on the same colour ramp, a data-honesty problem that
  needs its own design decision before implementation. Needs its own task block in the format
  described in §0 before it is implemented.

**Scope decision.** **W9 (forecast → per-อปท. impact) is deliberately not in E12.** Turning forecast
rainfall into an impact number needs a hydrological model, which stays deferred as Tier B/C
(scoping decision 1 in §0 and **Forecast Tier B/C** in §5). E12 shows what TMD's model says; it does
not translate that into an impact.

## 3. Suggested first two weeks

- **Week 1** (all independent, can run in any order): E1.1, E1.2, E2.1, E2.2, E2.3 (once the secrets
  exist), E2.4 (once the licence is chosen), E2.5.
- **Week 2**: E1.3, then E3.1 → E3.2 → E3.3 → E3.4, and E4.1.

## 4. Blockers that need the user

Tracked as one pinned `needs-user` checklist issue, not as tasks.

| Blocker | Needed by | Status |
|---|---|---|
| Workers Paid active (the DO-backed endpoints return 500 on the Free tier — already documented) | any api change deployed | **open** — user action, deploy-time only |
| **blocker: TMD secrets** — `wrangler secret put TMD_UID` / `TMD_UKEY` (a registered key is preferable) | E2.3 | **open** — user action; the code degrades honestly without them, but the TMD feed stays `degraded` in production until they are set |
| **blocker: licence choice** — MIT / Apache-2.0 / other | E2.4 | **resolved 2026-08-18: MIT** |
| Make `Test` a required check (`.github/rulesets/main.json` + `scripts/apply-branch-rules.sh`) once E1.3 is stable | after M1 | **open** — user action |
| HSTS `includeSubDomains`/`preload`: yes or no | E4.2 | **resolved 2026-08-18: `max-age` only** — no `includeSubDomains`, no `preload` |
| Does the default UI language stay Thai? | E7.1 | **resolved 2026-08-18: yes, Thai always** — English via the toggle or `?lang=en`, never auto-detected |
| Rerun ETL and upload with `scripts/.env.r2` (the user's machine, hours of runtime) | E9.1, E9.2, E9.3, and verifying E8.3 | **partly resolved 2026-08-20** — no rebuild was needed: none of E8.3/E9.1/E9.2/E9.3 changes a tile byte, so a `--force` rebuild would have spent hours writing byte-identical output through the symlink into the main checkout. What the provenance actually needed was a manifest refresh (`npm run refresh:manifests -w apps/etl`), run over the existing artefacts: 78 manifests written, checksums verified independently, per-layer `builtAt` taken from the untracked tile directories because the tracked files' mtimes are the checkout instant. **Still open:** copying the tiles to E9.2's versioned prefix on R2, which needs the storage decision below |
| **blocker: R2 storage past the free tier** — E9.2's versioned prefix means the same 5.174 GiB / 303,260 objects exist twice (the old prefix is served `immutable` for a year and can never be deleted), taking the bucket to about 10.35 GiB against a 10 GB free allowance. Server-side copy, so nothing is re-uploaded from a laptop; 303k Class A operations stay inside the free 1M/month | E9.2, E9.3 | **resolved 2026-08-20: copy all 303,260 objects** — accepted the overage. Server-side copy only, proved on one province (11, 903 files) with a 200 through `siahra-radar.co` before the other 76 |
| Is a GitHub blob URL acceptable as the methodology URL? | E3.4, E10.1 | **resolved 2026-08-18: no — a `/methodology` page on the web app**, rendering the Markdown in `docs/methodology/` |

## 5. Deferred — deliberately not doing now (with triggers)

- **D-1 contract gap for in-house validated models** — `probabilistic` means a third-party model
  today. Widening it (operator plus `skillMetricsUrl`) or adding a class is a shared-types change
  with all consumers. Trigger: published hindcast metrics for the E10 computation exist.
  **Partly answered by E12.1, but not for this entry's own subject:** a fifth class `forecast` was
  added — and it is again a *third-party* model, a cited deterministic one (TMD NWP). An in-house
  validated model still has no class it can honestly claim, `probabilistic` still means a
  third-party model, and the trigger above is unchanged.
- **Forecast Tier B/C** — needs a hydrologist and external compute; not a Workers workload.
- **Platform: PostGIS/Hyperdrive, Queues, Workflows, KV** — triggers: a DO SQLite table beyond about
  1 GB, or a write rate causing alarm overlap; more than about 8 sources making even an isolated
  `scheduled()` exceed a minute; a multi-step ETL that must survive isolate eviction; spatial
  predicates beyond a bounding box. Order when it happens: Queues → PostGIS via Hyperdrive →
  Workflows.
- **Unified multi-hazard WS stream** — only earthquakes are pushed today; E6.2 is the cheap first
  step; a full protocol only once a second sub-minute layer exists.
- **React Three Fiber rewrite, product rename** — no.
- **PMTiles** — only after E9.4 `Range` support and a measured need.
- **Staging environment, visual-regression CI, Playwright in Actions** — Actions minutes and cost;
  the E5.4 smoke-plus-rollback and the local qa-verifier pass cover the same ground.
- **Admin auth** — there are no mutation endpoints; revisit with Cloudflare Access when the first
  one appears.
- **Population or asset exposure for earthquakes** — needs a licensed population raster; a separate
  decision.
- **Git history rewrite for `public/aoi`** — no.

## 6. Test stack decision

- `apps/api`: vitest plus `@cloudflare/vitest-pool-workers` (`SELF`, `env`, `fetchMock`,
  `runInDurableObject`, `runDurableObjectAlarm`, `createScheduledController`; R2 and the five DO
  bindings come from `wrangler.jsonc`, with isolated storage). The pure modules (`rateLimit`,
  `archive`, `scheduledTick`, `cachePolicy`, `exposure/compute`) use the same runner.
- `apps/web`: vitest with `environment: "node"`, pure modules only (`lib/time`, `lib/feed/*`,
  `scene/lod`, `worker/tilePath`, the permalink parsers, i18n parity). No jsdom or RTL in this
  horizon.
- `packages/shared-types`: type-only; the contract is enforced by `tsc` in three consumers plus
  `apps/api/test/contract.test.ts`.
- Playwright stays local (qa-verifier drives `playwright-cli` against the running dev server); no
  browser install in Actions.
- CI: one always-running `Test` job (E1.3). Flipping it to a required check is a user action.

## Reference: verified code state, 2026-08-18

File:line anchors from the three code audits that produced this roadmap. They are accurate as of the
date in this heading and will drift — re-check before relying on a line number.

- **API routes:** 13 routes in `apps/api/src/index.ts:18-48`; `Route` in `router.ts:16-24`; `json()`
  in `router.ts:28-38`; `originAllowed` in `rateLimit.ts:81-108`; `checkLimit` in
  `rateLimit.ts:36-54`; `scheduled()` in `index.ts:53-64`.
- **Durable Objects:** `earthquake-feed.ts` (heartbeat at `:258`, once per poll; the `down` magic
  number `3` at `:305`; WS handling `:345-369`); `observation-cache.ts` (`status()` `:728-775`,
  descriptor `:895-903`); `flood-extent.ts` (descriptor `:245-255`, `sourceIds` `:253`); `radar.ts`
  (`frames24h` `:160`); `forecast-pointer.ts` (stub at `:15`).
- **shared-types:** `hazard-layer.ts:1-25`, `health.ts:6-32`, `earthquake.ts:1-29`, `flood.ts`,
  `aoi.ts:134` (`AoiManifest`).
- **Web:** `useEarthquakeFeed.ts` (5 s reconnect at `:14`, switch `:93-115`, fallback `:50-70`);
  `MapLegend.tsx` (notes at `:39`, `:50`, `:61`, `:72`); `SourceStatusBar.tsx`; `ApiStatusFooter.tsx`;
  `useApiHealth.ts`; `TerrainTiles.ts:291` (split test); `hazardOverlay.ts` (R = lowland, G =
  observed, B = mask); `floodMask.ts`; `terrainMaterial.ts:147-175`; `Map3DCanvas.tsx:39-54`
  (`MapLayers`) and `:460-494` (dispose); `usePermalink.ts`; `worker/index.ts:17` (tile regex);
  `vite.config.ts:37` (the same regex).
- **CI:** `ci.yml` runs Lint / TypeScript / Build (all required); `deploy.yml` is path-filtered
  auto-deploy with no rollback; `.claude/commands/implement.md` states as a non-goal that a feature
  run never touches `ci.yml` or the ruleset.
- **Data:** `PROVINCES[].nameEn` exists in `apps/web/src/data/provinces.ts`; no GitHub issues or
  milestones exist yet; the labels that do exist are bug, enhancement, documentation, no-screenshot
  and dependencies.
