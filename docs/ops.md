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
| A source is `stale` (no error at all) | **Our side did not fetch** — a missed alarm or cron, not an upstream problem | Check `nextAttemptAt`. If `null`, force a refresh (§5). If cron is not firing at all, every source goes `stale` together — check the Worker's cron trigger in the dashboard. |
| A source is `down` | Every feed of that source failed, or an error is standing and the last success is past its budget | Read `lastError`. Curl the upstream yourself. If the upstream is genuinely down, the correct state *is* `down` — leave it visible. |
| A source is `delayed` | Fetching works; the upstream has not published a newer observation | Nothing to do. This is upstream cadence, not a fault. |
| `unknown` on a fresh deploy | No attempt has produced a result yet | Wait one cron tick (1 min). If it persists, the DO is throwing before it records anything — check `wrangler tail` (§3). |
| API answers `500`/`503` broadly, health itself errors | Durable Objects quota (see §7) or a bad deploy | `wrangler tail`, then roll back (§8) if a deploy caused it. |
| `429` with `Retry-After` for a normal client | Per-route rate limit tripped (`apps/api/src/index.ts` route table) | Check `api.rateLimited429LastHour`. Limits are per isolate and per client IP; a single client can only starve itself. |
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

Cron (`* * * * *`, `apps/api/wrangler.jsonc`) refreshes all four sources every minute, each with its
own ~25 s budget, concurrently and in isolation. On top of that **every Durable Object schedules its
own alarm**, so a missed cron tick does not freeze a source. Both paths share the same in-flight
refresh, so they cannot double-fetch.

| Durable Object | Source id | Normal refresh | Retry after failure | `staleAfterSeconds` | `observedLagSeconds` | Retention |
|---|---|---|---|---|---|---|
| `ObservationCacheDO` | `thaiwater` | 5 min | 1 → 2 → 4 → … capped 10 min | 900 (15 min) | 7200 (2 h) | 7-day hot window in SQLite, older in R2; station history 8 days |
| `RadarDO` | `tmd-radar` | 5 min | 1 min | 900 (15 min) | 5400 (90 min) | frames 30 days |
| `FloodExtentDO` | `gistda-flood` | 30 min | 5 → 10 → 20 → 30 min (±15 % jitter on the alarm; the in-round fetch retry uses ±25 %) | 10800 (3 h) | `null` (no upstream cadence) | features 30 days |
| `EarthquakeFeedDO` | `earthquakes` | 1 min | next tick (1 min) | 300 (5 min) | `null` (quakes have no cadence) | events 30 days |

Side cadences inside `ObservationCacheDO`: dams every 30 min (5 min pause after a failure so a broken
feed is not hammered), station history at most every 10 min per station, one nationwide R2 snapshot
per Bangkok hour, and the previous day's per-province archive written after 00:20 Bangkok time.

If `nextAttemptAt` is `null` for a source, no alarm is scheduled — the next cron tick will re-arm it.

## 5. Forcing a refresh by hand

- **Production:** there is no admin endpoint by design. Any request that reads a source runs its
  `ensureFresh()` when the data is past its TTL, so `curl -s .../api/v1/radar/frames?hours=1
  > /dev/null` (or `/api/v1/observations`, `/api/v1/flood-extent/summary`,
  `/api/v1/earthquakes/recent`) triggers a real refresh. The next cron tick does the same.
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
| `radar/tmd-composite/{frame time, ISO with `:` and `.` replaced by `-`}.png` | `RadarDO`, per new frame | One TMD composite frame, pruned after 30 days |
| `aoi/{PP}/{terrain,buildings,features,landcover}/{z}/{x}_{y}.bin` | uploaded by `scripts/upload-tiles.sh` | Terrain and feature tiles served by **siahra-web**, not the API |

```bash
cd apps/api
npx wrangler r2 object list siahra-geodata --prefix "archive/index/" | tail
npx wrangler r2 object get siahra-geodata "archive/index/$(TZ=Asia/Bangkok date +%F).json" --file -
```

Archive objects are append-only history. **Never delete or rewrite them to "clean up" a bad round** —
a wrong archived value is data; a missing one is a hole nothing can reconstruct.

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
- **Radar frames skipped** → `detail.skippedFrames > 0` with a `lastError` naming the files. TMD's
  24-slot ring buffer occasionally serves a truncated PNG; the good frames of that round are kept.

## 8. Rolling back a bad deploy

The two Workers deploy and roll back **independently** (`docs/deploy.md` §0.1). Roll back only the
one you broke.

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
