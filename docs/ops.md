# SIAHRA — operations runbook

What to do when something looks wrong on the running system. This is the **operator's** document:
symptom → what to look at → what to do.

It deliberately does not restate things that live elsewhere:

- **What each freshness state means, and the thresholds behind it** → [`docs/api.md`](./api.md)
  ("Freshness states"). This file only says what an operator *does* about each state.
- **How to deploy, bindings, secrets, WAF rules, tile upload** → [`docs/deploy.md`](./deploy.md).
- **Security headers** → [`docs/security.md`](./security.md).
- **How to run and re-capture tests and fixtures** → [`docs/testing.md`](./testing.md).

Golden rule of this system: **degradation is visible, never silent.** If a source is broken, the
right outcome is that `/api/v1/health` says so and the map keeps showing the old data with its age.
"Making the red go away" is not the goal — making it *true* is.

---

## 1. First look: `/api/v1/health`

```bash
curl -s https://siahra-radar.co/api/v1/health | jq
```

Read it in this order:

| Field | What it tells you |
|---|---|
| `ok` | `false` if **any** source is not `ok`/`delayed`, or any source has a standing `lastError`. A single dead source makes the whole endpoint `false` by design. |
| `worst` | The worst state across sources — the one-word summary for a dashboard. |
| `sources[].health` | Per-source state. Definitions in [`docs/api.md`](./api.md#freshness-states-apiv1health). |
| `sources[].lastError` | **The message a user can see in the status bar.** If a source is `degraded`/`down` and this is `null`, that is a bug — file it. |
| `sources[].fetchedAt` | Last *successful* fetch. `null` means never — the UI must render "ยังไม่เคยได้รับข้อมูล", never a time. |
| `sources[].lastAttemptAt` | Last attempt, successful or not. `fetchedAt` old but `lastAttemptAt` fresh = we are trying and failing. |
| `sources[].nextAttemptAt` | Read from the Durable Object's **real alarm**. `null` = nothing scheduled → the source will only wake on the next cron tick or request. |
| `api.rateLimited429LastHour` | In-isolate count of rejected requests. A jump here without a traffic increase means a client is hammering one route. |

Quick triage one-liners:

```bash
# Only the sources that are not fine
curl -s .../api/v1/health | jq '.sources[] | select(.health!="ok" and .health!="delayed")
  | {id, health, lastError, fetchedAt, lastAttemptAt, nextAttemptAt}'

# How old is each source, in minutes
curl -s .../api/v1/health | jq --arg now "$(date -u +%FT%TZ)" '
  .sources[] | {id, health,
    ageMin: (if .fetchedAt then (($now|fromdate) - (.fetchedAt|fromdate))/60 | floor else null end)}'
```

## 2. Symptom → action

| Symptom | Most likely cause | What to do |
|---|---|---|
| One source `degraded`, `lastError` names an upstream HTTP status | Upstream had a bad round; retry is already scheduled | Nothing. Check `nextAttemptAt` is in the future, then re-check in one refresh interval (§4). |
| One source `degraded`, `lastError` contains `shape` or a JSON path | **The upstream changed its payload shape.** The old data is intentionally still being served | Not self-healing. Capture the new payload, update the schema in `apps/api/src/ingestion/schemas/` and the fixture ([`docs/testing.md`](./testing.md)). |
| `earthquakes` `degraded` with `TMD credentials not configured` | `TMD_UID`/`TMD_UKEY` are unset — the deliberate honest-degradation path | Expected unless the secrets have been set. To fix: `npx wrangler secret put TMD_UID` (and `TMD_UKEY`) in `apps/api`. USGS and EMSC are unaffected. |
| `tmd-nwp` `degraded` with `TMD NWP token not configured` | `TMD_NWP_TOKEN` is unset — the honest-degradation path, and it means **we never asked**, not that TMD published nothing | `npx wrangler secret put TMD_NWP_TOKEN` in `apps/api` (`docs/deploy.md` §3). Until then `/api/v1/provinces/{NN}/forecast` answers `200` with `batch: null`; every other source is unaffected. |
| `tmd-nwp` `degraded`/`down` with `TMD NWP token rejected (401)` | The bearer token expired or was revoked — **retrying cannot fix it** | Issue a new token at `data.tmd.go.th/nwpapi/` and overwrite the secret. The token in use expires **2027-08-18**; an outage on or after that date with no other symptom is almost certainly this. |
| A source is `stale` (no error at all) | **Our side did not fetch** — a missed alarm or cron, not an upstream problem | Check `nextAttemptAt`. If `null`, force a refresh (§5). If cron is not firing at all, every source goes `stale` together — check the Worker's cron trigger in the dashboard. |
| A source is `down` | Every feed of that source failed, or an error is standing and the last success is past its budget | Read `lastError`. Curl the upstream yourself. If the upstream is genuinely down, the correct state *is* `down` — leave it visible. |
| A source is `delayed` | Fetching works; the upstream has not published a newer observation | Nothing to do. This is upstream cadence, not a fault. |
| `unknown` on a fresh deploy | No attempt has produced a result yet | Wait one cron tick (1 min). If it persists, the DO is throwing before it records anything — check `wrangler tail` (§3). |
| API answers `500`/`503` broadly, health itself errors | Durable Objects quota (see §7) or a bad deploy | `wrangler tail`, then roll back (§8) if a deploy caused it. |
| `429` with `Retry-After` for a normal client | Per-route rate limit tripped (`apps/api/src/index.ts` route table) | Check `api.rateLimited429LastHour`. Limits are per isolate and per client IP; a single client can only starve itself. |
| **Durable Objects "SQL rows read" climbing by billions a day** while "Total SQL storage" stays in the tens of MB | A statement that scans a whole table is running per request or per item (the 2026-08-18..23 incident: a retention `DELETE` per station pull + five aggregates per `/health`) | §9. Do not wait for the billing page — it lags a day; read the counter on **Workers & Pages → Durable Objects**. |
| Map loads but radar/tiles are missing | R2 object missing or the tile route is wrong | For radar: check `detail.skippedFrames` on the `tmd-radar` source in `/api/v1/health`. For tiles: see `docs/deploy.md` §2. |

## 3. Reading the logs

Every log line the API writes is one JSON object with the same three keys plus its own fields
(`apps/api/src/log.ts`):

```json
{"level":"error","ts":"2026-08-19T10:26:50.574Z","message":"usgs poll failed","error":"Error: USGS feed request failed: 500 Internal Server Error"}
```

`level` is `info` (stdout) / `warn` / `error` (stderr); `ts` is ISO-8601 UTC; `message` is a stable
short string you can grep on. Nothing else is guaranteed — every additional key belongs to that
message.

```bash
cd apps/api

# Everything, pretty
npx wrangler tail --format json | jq -r '.logs[]?.message[0] | fromjson? // .'

# Only failures
npx wrangler tail --format json \
  | jq -r '.logs[]?.message[0] | fromjson? | select(.level!="info")'

# One source's story
npx wrangler tail --format json \
  | jq -r '.logs[]?.message[0] | fromjson? | select(.message|test("radar"))'

# Every R2 write, with key and size
npx wrangler tail --format json \
  | jq -r '.logs[]?.message[0] | fromjson? | select(.message=="r2 put") | "\(.ts) \(.bytes)\t\(.key)"'

# The per-tick summary: one line per source per minute
npx wrangler tail --format json \
  | jq -r '.logs[]?.message[0] | fromjson? | select(.message=="scheduled source tick")
           | "\(.ts) \(.source)\t\(.outcome)\t\(.durationMs)ms"'
```

Messages worth knowing:

| `message` | Level | Meaning |
|---|---|---|
| `scheduled source tick` | info / error | One line per source per cron tick, with `source`, `outcome` (`ok`/`error`/`timeout`) and `durationMs`. A `timeout` bounds the *tick*, not the DO call — the source may still finish and record its own result. |
| `r2 put` | info | An archive or radar object was written: `key` and `bytes`. `bytes` near-zero on an archive key means we archived an empty round. |
| `radar frame skipped` | warn | One composite frame failed to download or validate; `file` names it. It is also recorded in `lastError`, so it reaches the UI. |
| `radar frames added` | info | New frames stored this round. |
| `observation cache refreshed` | info | ThaiWater round finished; `rainfall`/`waterlevel` are record counts or `"failed"`. |
| `archived day` / `archive tick failed` | info / error | Daily R2 archive rollup. |
| `gistda flood fetch failed` | error | Includes `consecutiveFailures` and `retryInSeconds` — the current backoff. |
| `tmd poll skipped` | error | TMD credentials missing (the expected state today). |
| `upstream queue paused` | warn | The ThaiWater circuit breaker tripped; `untilMs` is when it reopens. The source reports `degraded` while paused. |
| `unhandled route error` | error | A handler threw; the client got a `500`. `path` names the route. Always a bug. |

Logs are for operators. **Anything a user must know has to be in `lastError`/`/api/v1/health` as
well** — a failure that only exists in the log is a silent failure.

## 4. Alarm cadence

Cron (`* * * * *`, `apps/api/wrangler.jsonc`) runs all six refresh jobs every minute, each with its
own ~25 s budget, concurrently and in isolation. On top of that **every Durable Object schedules its
own alarm**, so a missed cron tick does not freeze a source. Both paths share the same in-flight
refresh, so they cannot double-fetch.

| Durable Object | Source id | Normal refresh | Retry after failure | `staleAfterSeconds` | `observedLagSeconds` | Retention |
|---|---|---|---|---|---|---|
| `ObservationCacheDO` | `thaiwater` | 5 min | 1 → 2 → 4 → … capped 10 min | 900 (15 min) | 7200 (2 h) | 7-day hot window in SQLite, older in R2; station history 8 days |
| `RadarDO` | `tmd-radar` | 5 min | 1 min | 900 (15 min) | 5400 (90 min) | frames 30 days |
| `FloodExtentDO` | `gistda-flood` | 30 min | 5 → 10 → 20 → 30 min (±15 % jitter on the alarm; the in-round fetch retry uses ±25 %) | 10800 (3 h) | `null` (no upstream cadence) | features 30 days |
| `EarthquakeFeedDO` | `earthquakes` | 1 min | next tick (1 min) | 300 (5 min) | `null` (quakes have no cadence) | events 30 days |
| `ForecastNwpDO` | `tmd-nwp` | 1 h | 5 min | 10800 (3 h) | `null` (a forecast has no observation to be late about) | none — latest round only, one row per province, overwritten in place |
| `ObservationCacheDO` (exposure) | `exposure-illustrative` | on every ThaiWater refresh (~5 min) | with that refresh | 3600 (1 h) | 1800 (30 min) | runs kept indefinitely (see §6) |

Side cadences inside `ObservationCacheDO`: dams every 30 min (5 min pause after a failure so a broken
feed is not hammered), station history at most every 10 min per station, one nationwide R2 snapshot
per Bangkok hour, the previous day's per-province archive written after 00:20 Bangkok time, and the
retention sweep of both history tables **at most once an hour** (`pruneRetention()`, gated by
`lastPruneMs` in the DO's `meta` table) — on the shared refresh path, deliberately not on the
per-station history pull. A failed prune is logged and leaves `lastPruneMs` alone, so the next tick
retries; it can never take the refresh or the alarm rearm down with it.

**Why a slow source needs more than a "is it old enough?" test.** The cron fires every minute and
`scheduledTick` has no per-job cadence gate, so each job's own `ensureFresh()` decides whether to go
out. A round that fails *entirely* deliberately does not write `fetchedAt` — so "older than an hour?"
stays true for as long as the upstream is down, and an age-only gate would send `ForecastNwpDO` out
for a fresh 12-call round **every 60 s**, erasing the 5-minute `alarm()` backoff and hammering an
upstream that is already struggling. `ForecastNwpDO.ensureFresh()` therefore also gates on
`lastAttemptAt` (written on every round, successful or not) so the cron path keeps `RETRY_MS`.
`RadarDO` contains the same code and is **deliberately unchanged**: its `RETRY_MS` is 60 s, exactly
the cron tick, so there is nothing there to over-drive. The difference is the cadence constant, not
the code — do not "fix" `RadarDO` to match. A regression test pins this
(`test/forecastNwpDurableObject.test.ts`).

If `nextAttemptAt` is `null` for a source, no alarm is scheduled — the next cron tick will re-arm it.

## 5. Forcing a refresh by hand

- **Production:** there is no admin endpoint by design. Any request that reads a source runs its
  `ensureFresh()` when the data is past its TTL, so `curl -s .../api/v1/radar/frames?hours=1
  > /dev/null` (or `/api/v1/observations`, `/api/v1/flood-extent/summary`,
  `/api/v1/earthquakes/recent`) triggers a real refresh. The next cron tick does the same.
  **`tmd-nwp` is the exception**: `/api/v1/provinces/{NN}/forecast` and `/api/v1/forecast/availability`
  read the Durable Object only and never call the upstream, by design (one primary-key read per
  request). The only things that fetch it are the cron tick and the DO's own alarm, so to force a
  round in production you wait for the next tick — and a round is skipped anyway if the last attempt
  was under 5 minutes ago (§4).
- **`wrangler dev`:** cron does **not** fire. Run the whole tick by hand:

  ```bash
  curl -s 'http://localhost:8787/__scheduled?cron=*+*+*+*+*'
  ```

  (In a worktree, use the port from `.env.worktree`.) Each Durable Object also arms its own alarm on
  first use, so hitting a route once starts the cycle.

## 6. R2 key layout (bucket `siahra-geodata`)

| Prefix | Written by | Contents |
|---|---|---|
| `archive/snapshots/{YYYY-MM-DD}/{HH}.json.gz` | `ObservationCacheDO`, hourly | Nationwide observation snapshot (Bangkok day/hour) |
| `archive/waterlevel/{YYYY-MM-DD}/{PP}.json.gz` | `ObservationCacheDO`, daily after 00:20 ICT | Per-province water level for the previous day |
| `archive/dams/{YYYY-MM-DD}.json.gz` | `ObservationCacheDO`, daily | Dam observations for that day |
| `archive/flood/{retrieval time, ISO with `:` and `.` replaced by `-`}.json.gz` | `FloodExtentDO`, when the scene changes | One GISTDA scene, keyed by retrieval time |
| `archive/index/{YYYY-MM-DD}.json` | `ObservationCacheDO` | Which of the above exist for that day — backs `/api/v1/archive/days` |
| `exposure/runs/{runId}.json.gz` | `ObservationCacheDO`, after a refresh whose result changed | One immutable flood-exposure run (E10.3), gzip JSON — **write-once, never rewritten** |
| `radar/tmd-composite/{frame time, ISO with `:` and `.` replaced by `-`}.png` | `RadarDO`, per new frame | One TMD composite frame, pruned after 30 days |
| `aoi/{PP}/{terrain,buildings,features,landcover}/{z}/{x}_{y}.bin` | uploaded by `scripts/upload-tiles.sh` | Terrain and feature tiles served by **siahra-web**, not the API. The legacy unversioned prefix — clients that cached it keep asking for it, so it is never deleted |
| `aoi/{PP}/v/{ver}/{terrain,buildings,features,landcover}/{z}/{x}_{y}.bin` | `scripts/release-dataset.sh` (stage 3, via `upload-tiles.sh --version=`) | The same tiles under a dataset version (E9.2), which is what `manifest.json`'s `urlTemplate` points at. Served `immutable` for a year, so a version name is **never reused for different bytes** and a released prefix is never deleted — the policy and the one narrow exception are in [`docs/dataset.md` §7](./dataset.md); the release procedure is [`docs/dataset-release.md`](./dataset-release.md) |

```bash
cd apps/api
npx wrangler r2 object list siahra-geodata --prefix "archive/index/" | tail
npx wrangler r2 object get siahra-geodata "archive/index/$(TZ=Asia/Bangkok date +%F).json" --file -
```

Archive objects are append-only history. **Never delete or rewrite them to "clean up" a bad round** —
a wrong archived value is data; a missing one is a hole nothing can reconstruct.

### 6.1 Flood-exposure runs: how many, and why they are kept

`exposure/runs/{runId}.json.gz` is the citable artefact behind
`GET /api/v1/exposure/runs/{runId}`, so it is written **once** and never rewritten — the endpoint
serves it `immutable` for a year, and a rewritten object would silently change what somebody already
quoted.

A new run is published whenever **any exposed field changes** — a level, any `factors.*` value, or
any station `observedAt` — not only when the level set changes. The artefact carries the per-station
measurements and their observation times, so publishing only on a level change would leave
`/exposure/latest` serving the previous measurements with the previous `observedAt`, possibly for
hours, while presenting itself as current. That is stale data rendered as fresh, which this project
does not do. The cost of that decision, stated plainly:

| | |
|---|---|
| Runs per day | ≈288 (one per successful ThaiWater refresh, ~5 min apart) |
| Objects per year | ≈105,000 JSON objects (~100× what a level-change-only rule would write) |
| Size each | **measured 2026-08-19 through the real write path** (run `20260819T161910Z`, 5,454 stations): 1,289,810 bytes of JSON → **102,609 bytes stored** (7.96 %, 12.6×). Take that number, not a `gzip -9` figure from the same JSON: `CompressionStream("gzip")` in the Workers runtime compresses at its default level, and the ~92 KB you get from `gzip -9` on the command line is ~10 % smaller than what actually lands in R2. |
| Storage growth | ≈29.6 MB/day, **≈10.8 GB (10.0 GiB) after a year**, growing linearly. Raw it would have been ≈371 MB/day and ≈136 GB, so gzip buys a factor of 12.6 — but it does **not** buy a free ride: this lands *on* R2's 10 GB free storage line at about the twelve-month mark. Assume the bucket leaves the free tier inside year one and budget for paid storage or a lifecycle rule (below) before it does. |
| Stored bytes | gzip. The key ends `.json.gz` for that reason — `wrangler r2 object get … --file -` gives you a gzip stream, not JSON. The API decompresses on read, so `GET /api/v1/exposure/runs/{runId}` still answers plain JSON to a plain `curl` |
| R2 writes per refresh | **at most one** — an unchanged refresh writes nothing, because the run id is derived from the run's content |
| Runs while ThaiWater is down | still ≈288/day. `factors.freeboardTrendMPerH` is measured over a 3 h window that slides with the clock, so points drop out of the window on their own and the content changes even with no new upstream data. The published trend is the one actually computed, so this is honest, not a bug — but the object count does **not** fall during an outage |
| Retention | **indefinite.** That is what makes `/api/v1/exposure/runs/{runId}` citable after the fact |

```bash
npx wrangler r2 object list siahra-geodata --prefix "exposure/runs/" | wc -l   # object count today
```

**If the bucket ever has to shrink, the lever is an R2 lifecycle rule on the `exposure/runs/` prefix**
(dashboard → R2 → bucket → Settings → Object lifecycle rules, or `wrangler r2 bucket lifecycle add`),
not a code change and not an ad-hoc delete: expiring old runs is a deliberate, stated policy change,
and any run id already published in a report stops resolving on the day the rule takes effect. Nothing
else in the code path prunes these objects.

## 7. Known degradation modes that are not bugs

- **TMD seismic credentials unset** → `earthquakes` is `degraded` with `lastError: "TMD credentials
  not configured"`, USGS and EMSC keep working. This is the intended honest degradation, not a
  failure to hide.
- **GISTDA publishes no acquisition time** → `gistda-flood` has `observedLagSeconds: null` and its
  layer carries `publishedAt: null`. It can never be `delayed`; that is correct, not missing data.
- **Durable Objects free tier** → the API starts answering `500`/`503` once the account passes
  ~100k DO rows written per day. There is no code fix; the account needs **Workers Paid** ($5/month),
  which Durable Objects require anyway (`docs/deploy.md` §0). Confirm from `wrangler tail`: the errors
  come from the DO call, not from the route.
  Rows **read** is a separate dimension from rows written, and it is billed by rows *scanned*, not
  rows returned or deleted — so a small, quiet database can still bill billions of rows read. Watch
  it independently of the rows-written cliff; the numbers and the query rule behind them are in
  `docs/deploy.md` § ค่าใช้จ่ายโดยประมาณ.
- **No new exposure run for 30 minutes** → `exposure-illustrative` is `delayed`, and this one **is
  worth looking at: it means our own refresh loop stopped producing runs**, not that the upstream went
  quiet. A run is published after *every* successful refresh — `inputs.thaiwaterFetchedAt` is part of
  the hashed content, so the content always differs — therefore no new run means no successful
  refresh. Look at the DO alarm, not at ThaiWater: check `nextAttemptAt` for
  `exposure-illustrative` and for `thaiwater` on `/api/v1/health` (`null` = nothing scheduled; the
  next cron tick re-arms it), then `npx wrangler tail siahra-api` for the refresh. Force one with
  `curl -s .../api/v1/observations > /dev/null` (§5). Past an hour the same silence escalates to
  `stale`. Note that `latestObservedAt` for this source is `run.computedAt` — the age of the
  *measurements* is `detail.runObservedAt`, normally 17–77 min older, and it being old is normal.
  A *failed* publish looks different again: `lastError` is populated (R2 or the run pointer) and the
  source goes `degraded`/`down`, which also flips `/api/v1/health` `ok` to `false`. The refresh alarm
  keeps its schedule in every one of these cases — the publish runs inside the refresh but can never
  take the alarm down with it (`finally` at all three `refreshOnce()` call sites).
- **`exposure-illustrative` reads `ok` while `thaiwater` is failing** → expected, and read both rows
  together. The exposure source only reports **its own** publish failures in `lastError`; an upstream
  outage reaches it indirectly, through `fetchedAt` ageing past `staleAfterSeconds` (1 h). ThaiWater
  failing for 45 min therefore shows on the `thaiwater` row first — that is the row to act on — while
  exposure is still serving the last honestly-computed run.
- **`tmd-nwp` has no `latestObservedAt` and can never be `delayed`** → `latestObservedAt` and
  `observedLagSeconds` are `null` by design: a forecast measures nothing, and its valid times are in
  the future. Putting a future time in `latestObservedAt` would claim we observed the future. Judge
  this source by `fetchedAt` and `lastError` only.
- **TMD NWP quota is generous and worth watching anyway** → 100,000 datapoints per hour (rolling from
  the first request, counted as `locations × duration × fields`) and 60 requests per minute. One round
  costs 77×48×3 + 77×7×2 = **12,166 datapoints (≈ 12%)** over **13 requests** (6 regions × hourly and
  daily, plus one availability call). The upstream's own counters are surfaced on `/api/v1/health` as
  `detail.datapointRemaining` and `detail.rateLimitRemaining` — these are the headers from the **last
  region call that carried them in that round**, not a round-level minimum, so read them as a
  trend, not a floor. Also on that source's `detail`: `regionsOk`, `regionsFailed` (every reason the
  round collected, named — failed regions, a failed availability read, unknown geocodes — never
  silently dropped), `writtenLastRound`, `unknownGeocodes` (non-null = TMD changed its geocode scheme,
  not "that province has no forecast") and `dailyAvailability`.
- **`tmd-nwp` `degraded` with `lastError: "availability: …"` while every province is fresh** → the
  six region rounds all succeeded and were stored; only the small availability call failed, so the
  previous date window is kept with its own older `detail`/`fetchedAt` and the failure is reported
  rather than papered over. Nothing to do beyond confirming it clears on the next hourly round.
- **One TMD NWP region fails, the rest do not** → `degraded` with the region named in `lastError`;
  the provinces of that region keep the previous round's values **with their own older
  `batch.fetchedAt`**, because the timestamp lives in the province row, not in one shared `meta` key.
  A round in which *every* region failed writes no `fetchedAt` at all and overwrites nothing.
- **Radar frames skipped** → `detail.skippedFrames > 0` with a `lastError` naming the files. TMD's
  24-slot ring buffer occasionally serves a truncated PNG; the good frames of that round are kept.

## 8. Rolling back a bad deploy

`deploy.yml` now smoke-checks every release and rolls back on its own; this section is the manual
lever for when you need it anyway.

**What the pipeline does for you.** After `deploy-web`, it asserts `/` and a real tile both answer
200. After `deploy-api`, it asserts `/api/v1/health` answers 200 and that `thaiwater`, `earthquakes`,
`gistda-flood` and `tmd-radar` are all present in `sources[].id`. Two deliberate non-assertions:

- it checks a **subset**, never a count — E10.3 added `exposure-illustrative` as a fifth source, and
  an exact-count assertion would have failed every deploy from that day and rolled back healthy
  releases;
- it does **not** gate on `ok`. `ok` is false whenever any source carries a `lastError`, including
  the unset TMD credential this project runs with today. A degraded source is the honest-degradation
  path working, not a bad deploy.

**Contract releases are both-or-neither.** A release touching `packages/shared-types/` ships one
contract across both Workers, so they deploy serialized web → api and, on any failure, roll back
together in reverse order — api first. The direction is not cosmetic: a new web bundle is written to
tolerate the old payload, so new-web-against-old-api degrades, while old-web-against-new-api is the
pairing that throws (E3.3's `delayed` reaching a bundle with no case for it is the worked example).
There is a bounded window between the two deploys where production runs new web against old api. That
window is the cost of the ordering, and it is the safe direction.

That forward-compatibility premise is the one thing no CI step can check. **When a change touches
`packages/shared-types/`, confirm by hand before merging that the new web bundle renders correctly
against the currently deployed API payload** — an unknown enum value must fall back, not throw.

The two Workers otherwise deploy and roll back **independently** (`docs/deploy.md` §0.1). Roll back
only the one you broke.

```bash
cd apps/api        # or apps/web
npx wrangler deployments list                 # find the last good version id
npx wrangler rollback --message "why"         # to the previous deployment
npx wrangler rollback <version-id> --message "why"
```

Notes before you press it:

- **Workers Paid is a prerequisite for this stack at all** — Durable Objects are not on the free
  plan. Rollback itself costs nothing extra; running cost stays ≈ $5–8/month (Workers Paid $5 + R2,
  `docs/deploy.md` "ค่าใช้จ่ายโดยประมาณ").
- Rollback **does not undo a Durable Object migration**. If the bad deploy added or renamed a DO
  class, roll forward with a fix instead — dropping a class in a migration destroys its stored data.
- Rollback does not touch R2 or secrets.
- After rolling back, confirm with `curl -s .../api/v1/health | jq '.ok, .worst'` and one real data
  route; `ok: false` right after a rollback is normal for a minute while each DO re-fetches.

## 9. Durable Object rows read — finding what scans

Rows read are billed by rows **scanned**, not returned (D1/DO pricing), so a small, quiet database
can bill billions: 2026-08-18..23 was 72.38B rows read on 64.57 MB of storage — $1 per billion past
the 25B included per cycle. The two statements responsible were a retention `DELETE … WHERE ts_ms < ?`
at the end of a per-station history pull (PK is `(station_id, ts_ms)`, so `ts_ms` alone cannot use
it → full scan, × 24 stations per province view) and five `COUNT`/`MAX` aggregates inside
`ObservationCacheDO.status()`, which `/health` calls once a minute per open tab. Fixed in #53 and #54.

**Where to look, in order**
1. **Workers & Pages → Durable Objects** (dashboard): the usage tiles are live; the billing page
   lags ~a day. Note the number and the time, come back in 30 min — after the fixes the counter
   moves by ~0.01B every few hours, not every minute. Per-namespace `Requests` on the same page shows
   which DO is being hit.
2. **Find the statement**: copy the DO's SQLite file out of a dev worktree
   (`apps/api/.wrangler/state/v3/do/siahra-api-<DO>/*.sqlite`) and run `EXPLAIN QUERY PLAN` on each
   suspect statement with `sqlite3`. `SCAN <table>` with no `USING INDEX` = every row is read.
   `apps/api/test/sqlQueryPlans.test.ts` does exactly this for every static SQL literal in
   `src/durable-objects/*.ts` and fails on any scan that is not in its `ALLOWED_SCANS` list with a
   reason, so a new offender normally never reaches `main`.
3. **Then ask how often it runs.** A scan once per 5-minute refresh is fine; the same scan inside a
   request handler, `status()`, or a loop over stations is the bug. Fix by (a) adding the index the
   predicate needs, (b) moving the statement onto the refresh/alarm path and caching its result in
   `meta`, or (c) rate-gating it (`pruneRetention()` runs at most hourly) — then list any remaining
   whole-table read in `ALLOWED_SCANS` with the reason.
4. **Set a budget alert** once: Durable Objects page → *Add Budget Alert* on the billing card. This
   is a one-time dashboard action, not something the repo can enforce.

**Included per cycle on Workers Paid** (2026-08): 25B rows read, 50M rows written, 1M DO requests,
400k GB-s. The post-#54 steady state is ≈ 80M rows read/day (≈ 2.4B/cycle, ~10% of the allowance);
anything an order of magnitude above that is a regression. **DO requests are the one dimension that
is no longer comfortable**: E12.2 made `/api/v1/health` fan out to 7 DO calls instead of 6 (six
distinct instances — `ObservationCacheDO` is asked twice), so DO requests rise ~17% and the worst
case lands around 1.2M against the 1M included, i.e. ~$0.03–0.10/month. The lever if it matters is
the `/health` cache (`public, max-age=15`), not removing a source from the endpoint.

**`ForecastNwpDO` (E12.2) is the worked example of designing for this from the start**: one table,
one row per province holding the whole batch as JSON (not one row per forecast step, which would be
4,235 writes per round instead of 77), no history table and therefore no retention `DELETE` that
could scan, `status()` reading precomputed counters out of `meta`, and a per-request path that is a
single primary-key lookup which never calls `ensureFresh()`. It is registered in
`sqlQueryPlans.test.ts` with **zero `ALLOWED_SCANS` entries** — none of its statements full-scans — and
measures at ~66k–130k rows written per cycle (0.13–0.26% of the 50M
allowance).
