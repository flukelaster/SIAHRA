# SIAHRA — tests and upstream fixtures

How the test suite is laid out, and — the part that goes stale if nobody writes it down — **how to
re-capture an upstream fixture** when a source changes its payload.

Operational troubleshooting lives in [`docs/ops.md`](./ops.md); endpoint behaviour in
[`docs/api.md`](./api.md).

## Running the tests

```bash
npm test                              # root: apps/api, then apps/web, then apps/etl
npm test -w apps/api                  # API only
npx vitest run test/ingestion -w apps/api   # one folder
```

CI runs exactly the commands in `.github/workflows/ci.yml`; QA runs the same ones. If a command here
drifts from CI, CI is right.

## How the API suite is arranged

`apps/api` runs on **`@cloudflare/vitest-pool-workers`**, so tests execute in `workerd` through
miniflare with the real bindings from `wrangler.jsonc` — R2 and all five Durable Objects.

Version notes that cost time to rediscover (they are also in `apps/api/vitest.config.ts`):

- Pool 0.22 has **no** `defineWorkersConfig` and no `@cloudflare/vitest-pool-workers/config`
  subpath. The pool is a Vite plugin: `defineConfig({ plugins: [cloudflareTest({...})] })`.
- Import `env` and `exports` from **`cloudflare:workers`** — the `cloudflare:test` `env`/`SELF`
  exports are deprecated in 0.22. `runInDurableObject`, `runDurableObjectAlarm`,
  `evictDurableObject`, `listDurableObjectIds`, `createExecutionContext` and `reset` still come from
  `cloudflare:test`.
- **`fetchMock` is not exported at all.** Every test stubs `vi.spyOn(globalThis, "fetch")` instead;
  that works because the worker, the Durable Objects and the test share one isolate.
- **Storage isolation is per test *file*, not per test block.** Two files cannot see each other's
  Durable Object storage, but blocks inside one file share it. Tests therefore either use their own
  instance name per block, or call `reset()` (wipes every binding, R2 included) or
  `abortAllDurableObjects()` in `afterEach`.

| File / folder | What it covers |
|---|---|
| `test/router.test.ts`, `test/routeTable.test.ts` | Path-before-method order, `405 + Allow`, `404`, the same-origin guard, HEAD, removed routes, input validation |
| `test/rateLimit.test.ts` | The token bucket itself (`checkLimit`, `originAllowed`) |
| `test/rateLimitResponse.test.ts` | `429 + Retry-After` through the real Worker entrypoint. **Own file**: buckets and the 429 counter are isolate-global |
| `test/health.test.ts` | A cold `/api/v1/health`: every required source present, `fetchedAt: null`, never `ok`. **Own file**: it must not see any source another test warmed |
| `test/radarDurableObject.test.ts` | End to end HTTP → `RadarDO` → R2 → response, plus the alarm path (`runDurableObjectAlarm`), reschedule-after-failure and survival of `evictDurableObject` |
| `test/earthquakeFeedDurableObject.test.ts` | Three feeds ingesting from fixtures, and all three failing at once → `down` while stored events are still served |
| `test/upstreamShape.test.ts`, `test/upstreamShapeDurableObjects.test.ts` | Malformed payloads (`{}`, `[]`, truncated JSON) are **rejected** and never overwrite stored data |
| `test/ingestion/*.test.ts` | **Normalisation**: raw payload → our types, per upstream (units, timezones, ids, nulls) |
| `test/sourceStatus.test.ts`, `test/scheduledTick.test.ts`, `test/cachePolicy.test.ts`, … | Freshness ladder, cron orchestration, cache policy, archive keys |

Two rules that keep the suite honest:

1. **Assert on `lastError`, `status()` and HTTP responses — never on console output.** Log format is
   an operator concern and may change; what a user sees may not.
2. **Never assert against wall-clock-dependent fixture data.** Adapters and DOs prune by age (TMD
   drops events older than 30 days, dams older than 48 h, the earthquake feed keeps 30 days). Pass an
   explicit `nowMs`, or re-stamp the fixture relative to `Date.now()` inside the test. A fixture with
   a frozen date that is compared against the real clock is a test that fails on a future Tuesday for
   no reason.

   **`vi.useFakeTimers()` does not reach the Durable Object alarm.** Fake timers replace the clock in
   the *test's* isolate; `ctx.storage.setAlarm()` is scheduled by workerd against the real one. Pass a
   frozen constant to `setAlarm()` and the moment real time walks past it the alarm is already due, so
   it fires immediately, the handler re-arms at the real now, and the assertion reads that instead.
   This actually happened: a `nextAttemptAt` test froze the clock at `2026-08-19T12:00Z` and armed at
   `T0 + 5 min`, so it was green for the five minutes after it was written and red for ever after.
   Derive alarm times from `Date.now()` at run time, and keep fake timers for pure functions that take
   an explicit `nowMs`.

## The fixtures

All six upstreams share **one** fixture directory, `apps/api/test/fixtures/`. Do not create a second
set beside it; extend these.

**These are hand-built, shape-faithful replicas, not raw captures.** Each one reproduces the structure,
field names, encodings and quirks measured from the live upstream on the date below, with the record
count cut to a handful — none of them is a byte-for-byte dump of a response. That distinction matters:
"shape verified" is a claim about the *format*, and it is the only claim these files can support.
Do not describe a fixture as a capture unless it really is one, and mark it as such in the table if
you add one.

| File | Upstream | Shape verified against the live source | Source URL (credentials stripped) |
|---|---|---|---|
| `usgs-all-hour.json` | USGS summary feed | 2026-08-19 | `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson` |
| `emsc-query.json` | EMSC / seismicportal FDSN | 2026-08-19 | `https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=200&minlat=…` |
| `text.ts` → `TMD_SEISMIC_XML` | TMD DailySeismicEvent (XML) | 2026-08-19 | `https://data.tmd.go.th/api/DailySeismicEvent/v1/?uid=…&ukey=…` (**never store the keys here**) |
| `text.ts` → `RADAR_LIST_TEXT`, `radarListAt()` | TMD radar composite index | 2026-08-19 | `https://weather.tmd.go.th/composite/images_composite.list` |
| `text.ts` → `validPngFrame()`, `truncatedPngFrame()` | TMD radar frame | synthetic | `https://weather.tmd.go.th/composite/images/zrNNNN.png` (1×1 PNG stands in for the real 1173×1668 frame) |
| `thaiwater-rain24h.json` | ThaiWater rainfall | 2026-08-19 | `https://api-v3.thaiwater.net/api/v1/thaiwater30/public/rain_24h` |
| `thaiwater-waterlevel-load.json` | ThaiWater water level | 2026-08-19 | `…/public/waterlevel_load` |
| `thaiwater-waterlevel-graph.json` | ThaiWater station history | 2026-08-19 | `…/public/waterlevel_graph?station_type=tele_waterlevel&station_id=…` |
| `thaiwater-analyst-dam.json` | ThaiWater dams | 2026-08-19 | `…/analyst/dam` |
| `gistda-wfs.json` | GISTDA flood extent (WFS) | 2026-08-19 | `https://flood-innotech.gistda.or.th/flooding_vis_public?service=WFS&version=2.0.0&request=GetFeature&typeNames=flooding_vis:FloodArea_Poly&outputFormat=application/json` |

Rules for every fixture:

- **≤ 50 KB.** These are shape samples, not datasets — keep a handful of records, including the awkward
  ones (a station with no coordinates, `min_bank: 0`, a `quarry blast`, a `Polygon` next to a
  `MultiPolygon`).
- **No credentials.** Not in a URL, not in a header, not in a comment. `test/ingestion/tmd.test.ts`
  asserts the TMD fixture carries no `uid=`/`ukey=`.
- **Keep the upstream's real oddities**: numbers as strings, Thai text as numeric character
  references (TMD) or TIS-620 mojibake (GISTDA), timestamps without a timezone. Those are exactly
  what the normalisation tests exist to pin — "cleaning them up" while capturing silently deletes
  the test.
- The provenance date lives in the table above, not inside the JSON. Adding a `_meta` key would change
  the payload that the shape validators see.
- Because they are typed by hand, a fixture can carry an **authoring** bug that the upstream never
  produced — e.g. the GISTDA `TB_TN` value once held `µÓÁÅ`, which decodes from TIS-620 to "ตำมล"
  (`Á` = 0xC1 = ม) instead of `µÓºÅ` → "ตำบล" (`º` = 0xBA = บ). When a normalisation test disagrees
  with a fixture, decide which one is wrong by decoding the bytes, not by whichever is easier to edit.

## Re-capturing a fixture

When an upstream changes shape, `/api/v1/health` shows the source as `degraded` with a `lastError`
containing the failing path ([`docs/ops.md`](./ops.md) §2). That is the trigger to re-capture.

1. **Fetch the live payload** (never through a browser — copy exactly what the Worker would get):

   ```bash
   curl -s 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/rain_24h' \
     -H 'User-Agent: siahra-api/0.0.0 (observation ingestion)' -o /tmp/rain.json
   ```

   The exact URL and headers for each upstream are in `apps/api/src/ingestion/*.ts`. For TMD, put the
   credentials in the shell, never in the saved file.

2. **Trim it to a handful of records**, keeping the awkward ones and any newly changed field:

   ```bash
   jq '{result, data: (.data[0:2])}' /tmp/rain.json > apps/api/test/fixtures/thaiwater-rain24h.json
   ```

3. **Strip anything that identifies you or the key**: query strings with `uid`/`ukey`, tokens,
   `Set-Cookie` echoes. Then confirm:

   ```bash
   grep -nEi 'uid=|ukey=|api[-_]?key|authorization|token' apps/api/test/fixtures/*
   ```

4. **Update the "shape verified" date** in the table above, in the same commit — and if you keep raw
   upstream bytes rather than a trimmed replica, say so in that row.

5. **Update the schema and both test layers**: the validator in
   `apps/api/src/ingestion/schemas/`, the rejection test in `test/upstreamShape.test.ts`, and the
   normalisation expectations in `test/ingestion/`. If a real field changed meaning, the normalisation
   test is the one that must change — and the change should be visible in the diff, not absorbed by a
   loosened assertion.

6. `npm test -w apps/api` and `npx tsc -p test/tsconfig.json --noEmit` in `apps/api`.

Non-JSON fixtures (`text.ts`) follow the same steps; XML and the radar index are stored as template
literals so the exact bytes, entities and line format survive review.

## apps/web

`apps/web` runs plain vitest in a `node` environment (no jsdom): pure modules only — permalink
parsing, the `Asia/Bangkok` time formatter, the `terrain.bin` checksum verdict and the overlay
channel it suppresses, and similar. Anything that needs the 3D scene is verified visually with
`playwright-cli` against the running dev server, not in vitest (see `AGENTS.md`).

## apps/etl

`apps/etl` also runs plain vitest, and has **no `vitest.config.ts`** — the default `include` picks up
`src/**/*.test.ts`, which is where its tests live. That placement is deliberate and is the opposite
of `apps/api`: because `apps/etl/tsconfig.json` is `"include": ["src"]`, `npx tsc --noEmit` already
type-checks the tests, so there is no second tsconfig to remember.

`src/provenance.test.ts` covers the manifest provenance derivation (E9.1). It pins the honesty rules,
not the object shape: a layer with no artefact directory gets **no key** rather than a borrowed time,
`publishedAt` is absent when the upstream never declared one, and `generatedAt` / `datasetVersion`
never leak in as a `builtAt`. Every case runs on a machine with no tile dataset, no `osmium` and no
`.osm.pbf` — the tests build temp directories with explicit `utimes` mtimes and pass `publishedAt` in
as a parameter instead of spawning a process.
