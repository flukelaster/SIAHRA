# SIAHRA API — endpoints, limits and input rules

The `siahra-api` Worker serves everything under `/api/v1/*` on `siahra-radar.co`, same-origin only
(see `apps/api/src/router.ts`). This file documents **what the API accepts** and **how hard you may
call it**. Response shapes are deliberately not documented yet — the data contract in
`packages/shared-types` is still moving (roadmap E3.x); once it settles, this file gets a payload
section.

## Request handling order

Every request goes through `createRouter()` in `apps/api/src/router.ts`, in this fixed order:

1. **Same-origin guard** — a cross-site `Origin`/`Sec-Fetch-Site` is refused with `403` before the
   router reveals whether the path exists at all.
2. **Path match** — no pattern matches → `404 {"error":"Not found"}`.
3. **Method** — the path exists but not for that method → `405` with an `Allow` header. Every route
   is `GET`; a `HEAD` is dispatched to the `GET` handler and answered with the same status and
   headers but no body.
4. **Rate limit** — per client (`CF-Connecting-IP`), per route bucket → `429` with `Retry-After`.
5. **Handler** — input validation first (below), then the Durable Object.

An unhandled exception inside a handler is logged and returned as `500 {"error":"Internal error"}`.
Bad *input* is never a 500: it is a `400` naming the parameter.

## Rate limits

Token buckets in isolate memory (`apps/api/src/rateLimit.ts`): `perMinute` is the sustained refill,
`burst` the extra headroom above it (default `ceil(perMinute * 0.5)`). Limits are per isolate, so
they are approximate across PoPs — the goal is protecting upstream sources and DO CPU, not
accounting. The Cloudflare WAF rules in `docs/deploy.md` are the second line of defence.

**Every route declares its limit explicitly** in the `routes` table in `apps/api/src/index.ts`; no
endpoint inherits the router's `DEFAULT_LIMIT` any more (E4.5), so changing a budget is a visible
edit in that table.

| Endpoint | Method | perMinute | burst | Bucket | Why this number |
|---|---|---|---|---|---|
| `/api/v1/health` | GET | 300 | default | per route | Polled by every open tab; several tabs behind one NAT address must not lock each other out of the status bar |
| `/api/v1/observations` | GET | 120 | default | per route | 2–4 MB upstream payload behind a DO cache; the map fetches it per province switch, not per frame |
| `/api/v1/dams` | GET | 300 | default | per route | Fetched on province switch |
| `/api/v1/stations/{id}/history` | GET | 60 | 20 | shared `history` | One bucket for all stations: clicking through many stations quickly is normal, scripted enumeration is not |
| `/api/v1/archive/days` | GET | 300 | default | per route | Small, cached 5 min |
| `/api/v1/archive/snapshot` | GET | 60 | default | per route | Reads an R2 object per call; the timeline scrubber requests one snapshot per settled position, not per drag frame |
| `/api/v1/earthquakes/recent` | GET | 300 | default | per route | Cheap DO SQL query |
| `/api/v1/earthquakes/live` | GET (WS) | 10 | 5 | per route | WebSocket upgrades: a handful per session at most, so a reconnect storm is capped |
| `/api/v1/flood-extent/summary` | GET | 300 | default | per route | Nationwide totals, cached |
| `/api/v1/provinces/{NN}/flood-extent` | GET | 300 | default | per route | Called for the selected province; kept high so a user browsing provinces quickly is never rate-limited into an empty layer |
| `/api/v1/provinces/{NN}/exposure/latest` | GET | 300 | default | per route | The current flood-exposure run scoped to one province; same reasoning as flood-extent |
| `/api/v1/exposure/runs/{runId}` | GET | 120 | default | shared `exposure-run` | Reads one immutable R2 object per call; one shared bucket across all run ids |
| `/api/v1/radar/frames` | GET | 300 | default | per route | Frame index for the last N hours |
| `/api/v1/radar/frame/{tsMs}.png` | GET | 600 | default | shared `radar-frame` | An animation loop pulls one image per frame; one shared bucket across all frames |

A rejected request answers `429 {"error":"Too many requests","retryAfterSeconds":N}` plus
`Retry-After: N`. `/api/v1/health` reports how many 429s this isolate issued in the last hour under
`api.rateLimited429LastHour`.

## Cache policy

Every `Cache-Control` value the API sends comes from one named policy in
`apps/api/src/cachePolicy.ts` (E4.6) — the route handlers reference a name, never a literal, so
`grep -rn "Cache-Control" apps/api/src/routes` finds nothing but the one PNG response that has to
build its headers by hand.

Two rules are enforced by `json()` in `apps/api/src/router.ts` rather than by each route:

- **every 4xx and 5xx is `no-store`**, whatever policy the handler asked for — a cached `503`
  would keep serving "the upstream is down" long after it came back
- a route that names no policy gets `noStore`

| Endpoint | Policy | `Cache-Control` |
|---|---|---|
| `/api/v1/health` | `health` | `public, max-age=15` |
| `/api/v1/observations` | `observations` | `public, max-age=60, s-maxage=120` |
| `/api/v1/dams` | `slowMoving` | `public, max-age=300` |
| `/api/v1/stations/{id}/history` | `history` | `public, max-age=120` |
| `/api/v1/archive/days` | `slowMoving` | `public, max-age=300` |
| `/api/v1/archive/snapshot` | `archivedSnapshot` | `public, max-age=3600` |
| `/api/v1/earthquakes/recent` | `realtime` | `public, max-age=10, s-maxage=20` |
| `/api/v1/earthquakes/live` | — | WebSocket upgrade; no cache headers |
| `/api/v1/flood-extent/summary` | `floodExtent(retrievedAt)` | `public, max-age=300, s-maxage=600`, or `no-store` when nothing has ever been retrieved |
| `/api/v1/provinces/{NN}/flood-extent` | `floodExtent(retrievedAt)` | as above |
| `/api/v1/provinces/{NN}/exposure/latest` | `observations` | `public, max-age=60, s-maxage=120` |
| `/api/v1/exposure/runs/{runId}` | `frozenArtifact(key)` | `public, max-age=31536000, immutable` — the key contains the run's content hash, so it can never change |
| `/api/v1/radar/frames` | `radarFrames` | `public, max-age=60` |
| `/api/v1/radar/frame/{tsMs}.png` | `radarFrame` | `public, max-age=86400, immutable` |
| any 4xx / 5xx | `noStore` | `no-store` |

`stale-while-revalidate` was considered for the observations response (roadmap E4.6 sketches it) and
**deliberately left out**: the UI renders "updated N minutes ago" from the payload's own `fetchedAt`,
so an edge serving a stale copy the browser believes is fresh would put a number on screen that does
not match reality. Every 2xx value here is unchanged from before the refactor; the one deliberate
change is the archive **404**, which dropped `public, max-age=60` for `no-store` — caching a
"no snapshot near that time" answer turns a transient miss into a permanent one for that client.

`frozenArtifact` (`public, max-age=31536000, immutable`) exists in the module but is not used by any
route yet — it is reserved for E10.3's exposure-run artefacts. It refuses any key that is not
content-addressed, because marking a re-writable key immutable would strand users on a year-old copy.

## Input rules

All query parameters are validated by the shared `parseQuery()` helper (`apps/api/src/query.ts`).
A violation answers `400 {"error":"Invalid <param> — …"}` with `Cache-Control: no-store`, before any
Durable Object is touched.

| Parameter | Rule | On violation |
|---|---|---|
| `province` | exactly two digits (`^[0-9]{2}$`), e.g. `50`; absent = nationwide | `400` |
| `at` | ISO-8601 instant accepted by `Date.parse`, e.g. `2026-08-18T09:00:00Z` | `400` |
| `limit` | integer, clamped into `1..500` (default 100) | out of range is **clamped**, fractional is **rounded**, non-numeric is `400` |
| `hours` | integer, clamped into `1..720` (default 72 for station history, 3 for radar frames) | clamped / rounded / `400` |
| `minMag` | finite number; absent = no magnitude filter | `400` |

Notes:

- **Fractional values are rounded, not truncated** — `hours=2.5` is served as 3 and `limit=12.7` as 13,
  so a caller never gets a fractional bound silently passed down to a Durable Object query.
- **Out of range is clamped, not refused** — asking for `limit=99999` is a reasonable way to say "as
  much as you have", and it answers with the 500 items the cap allows. A value that is not a number at all
  is a client bug and answers `400` rather than silently falling back to a default, which would make
  the response look like it honoured a filter it ignored.
- Path parameters are validated by the route pattern itself: `{NN}` is `[0-9]{2}`, a station id is
  `[0-9]+`, a radar frame id is `[0-9]+`. A path that does not match is a `404`, not a `400`.
- `at` on `/api/v1/archive/snapshot` is **required**; a missing `at` answers `400`. On
  `/api/v1/observations` it is optional (absent = latest).

## Realtime protocol (`/api/v1/earthquakes/live`)

One WebSocket, one direction. The frame union is `EqWsMessage` in
`packages/shared-types/src/earthquake.ts` — api and web cannot disagree about it, because both
import that file.

| Frame | When | Carries |
|---|---|---|
| `snapshot` | first frame on every connection, before any `event.*` | `asOf`, the layer descriptor, up to 200 most recent events |
| `event.created` / `event.updated` | on a poll that changed something | the event; **no** time reference, so the client must not move `asOf` |
| `event.deleted` | reserved; not emitted today | the event id |
| `heartbeat` | every ≤ 30 s while at least one client is connected | `serverTime`, `asOf`, and the deprecated `ts` |

**Cadence.** `WS_HEARTBEAT_INTERVAL_MS = 30_000` is declared once, in the shared contract, and both
sides read it: the Durable Object's alarm re-arms at that interval **while a socket is connected**
(with no client it falls back to the 60 s poll interval, because waking up to broadcast to nobody
only burns Durable Object storage writes), and the browser watchdog is
`WS_HEARTBEAT_WATCHDOG_MS = 2.5 × interval = 75 s`. Changing the cadence therefore moves the client
watchdog with it; it cannot be left behind. Because the two Workers deploy separately, a browser
starts each socket on the pre-E6.1 budget (`WS_HEARTBEAT_LEGACY_WATCHDOG_MS = 150 s`, from the old
60 s poll-bound heartbeat) and tightens to 75 s the first time a heartbeat arrives carrying
`serverTime` — the presence of that field is the version signal. Both legacy constants can be
deleted one release after E6.1 is live on both Workers. The heartbeat is independent of the 60 s poll: a poll
that is slow, or that fails on every feed, still leaves the socket beating, so the client never
mistakes a broken upstream for a dead connection.

**`serverTime` vs `asOf`.** `serverTime` is the server clock at the moment the frame was sent and
proves only that the connection is alive. `asOf` is the time of the **last poll round** — the age of
the data the frame vouches for — and is `null` when no poll has ever completed. It means exactly that
in **both** the `snapshot` and the `heartbeat` frame, deliberately: they travel on the same socket, so
if `snapshot.asOf` were the response-build time instead, the displayed timestamp would jump backwards
by up to one poll interval when the first heartbeat arrived — and the value it jumped *to* would be
the true one, meaning the snapshot had been overstating freshness all along. The client moves its
displayed `asOf` from `asOf` only, never from `serverTime`: heartbeats keep coming while every
upstream feed is failing, and using the server clock there would advertise a freshness we do not
have. `ts` duplicates `serverTime` and is kept for one release so a web build shipped before E6.1
keeps parsing frames (the two Workers deploy separately, which is also why `layer`, `serverTime` and
`asOf` are optional in the type).

**Client → server.** The only message the server understands is the text `"ping"`, answered with the
text `"pong"` by `setWebSocketAutoResponse` in the runtime, without waking the Durable Object.
(A browser cannot send a protocol-level ping frame, which is why the pair is a text pair.) Any other
message is ignored.

**Close.** A request without `Upgrade: websocket` is answered `426`, not a hanging connection.
The Durable Object defines no close codes of its own: when a peer closes, the server echoes that
peer's code and reason back and the client reconnects with full-jitter backoff, 1 s → 30 s, reset
when a `snapshot` arrives. While the socket is down the client falls back to polling
`/api/v1/earthquakes/recent` every 30 s and keeps showing the stale `asOf` with its age — never
"now".

## Freshness states (`/api/v1/health`)

Every live source reports one `health` value. The point of the list is that **"we could not fetch"
and "the source has not published anything new" are different failures** — collapsing them into one
colour makes the status bar useless.

| State | Means | Decided by |
|---|---|---|
| `ok` | Last fetch succeeded and the newest observation is inside the source's cadence | — |
| `delayed` | **The fetch succeeded** and we hold a real observation, but `latestObservedAt` is older than `observedLagSeconds` — the upstream simply has not published a newer reading | `now - latestObservedAt > observedLagSeconds` |
| `stale` | No *successful* fetch for longer than `staleAfterSeconds`, **and no error either** — we simply have not fetched (a missed alarm/cron), which says nothing about the upstream | `now - fetchedAt > staleAfterSeconds` and `lastError` empty |
| `degraded` | The last round partially failed (`lastError` non-empty), or our upstream queue is paused by its circuit breaker; the data we hold is still served | `lastError` / paused |
| `down` | Every upstream feed of that source failed; or we have never fetched successfully and the last attempt errored; or an error is standing **and** the last successful fetch is older than `staleAfterSeconds` (failing repeatedly with nothing fresh to show = dead, not merely old) | see below |
| `unknown` | No attempt has ever produced a result to judge — `fetchedAt` is `null` and there is no error either | — |

The ladder is evaluated in one place (`apps/api/src/sourceHealth.ts`), and **failure is judged before
age**, in this order: `unknown`/`down` (never fetched) → `down` (all feeds failed) → `down` (error
standing *and* the last success is past `staleAfterSeconds`) → `degraded` (error standing, last
success still recent) → `stale` (past `staleAfterSeconds`, no error) → `delayed` → `ok`.
Ordering age first would let a source that has been failing for hours report the milder `stale`, and
the `down`/`degraded` branches below it would become unreachable — which is why `stale` now means
strictly "no error, we just have not fetched".

So a source is only ever `delayed` when the most recent fetch actually succeeded **and** we hold an
observation to be late about. A successful fetch that left us with no observation at all (e.g. the
radar index arrived but no frame image could be downloaded) is `degraded`, never `delayed`: we have
no evidence the upstream is behind, and blaming it would be exactly the conflation this list exists
to prevent.

`fetchedAt: null` means **no fetch has ever succeeded**. It is never rendered as a time, and never as
"now"; the UI shows "ยังไม่เคยได้รับข้อมูล".

### `observedLagSeconds` per source

The threshold is taken from each source's *real* observed cadence, not from one global number — a
threshold that is too tight makes every source look delayed, which is as dishonest as hiding
staleness. `null` means the source has no expected observation cadence, so `delayed` cannot be
decided for it at all and never fires.

| Source | `observedLagSeconds` | Where the number comes from |
|---|---|---|
| `thaiwater` | `7200` (2 h) | Measured nationwide on 2026-08-19: rainfall reports on an hourly grid (2,413 stations at 00:00, 1,581 at 01:00), water level mostly hourly with some 10-minute reporters, publication lag ≈17 min. Two hourly cycles tolerate one missed publication. **Caveat:** `latestObservedAt` is `MAX()` over ~5,900 stations, so it is dominated by the freshest reporter — `delayed` fires on a near-total upstream outage, not on partial staleness, and `ok` does **not** mean every station is current. |
| `tmd-radar` | `5400` (90 min) | The composite is produced on a 15-minute grid (:00/:15/:30/:45). Measured on the running API, 2026-08-19: `/api/v1/radar/frames?hours=24` returned 53 frames spanning 17.0 h, gaps between consecutive frames `{15 min: 47, 30 min: 2, 45 min: 2, 165 min: 1}`, and the newest frame was 47.6 min behind wall clock. 90 min clears both the routine publication lag and the largest *recurring* gap (45 min) with headroom; the single 165-min gap was a real publication outage, which this threshold correctly reports as `delayed`. It is also the value the code already compared against frame age. |
| `earthquakes` | `null` | `latestObservedAt` is when an earthquake *happened*. A quiet day is a normal day, not a stalled feed — marking it `delayed` would be inventing a failure that no observation supports. |
| `exposure-illustrative` | `1800` (30 min) | Not an upstream feed: it is the run this API computes from ThaiWater after every refresh. `latestObservedAt` is **`run.computedAt` of the latest published run — when we computed it, not when any station was read.** A run is published on *every* successful refresh (`inputs.thaiwaterFetchedAt` is inside the hashed content, so the content always differs), so 30 minutes without a new one means **our** refresh loop stopped producing runs — a missed alarm or cron tick — not that the upstream went quiet. The newest station observation actually inside that run is reported separately as `detail.runObservedAt`, and it is normally 17–77 min older than `latestObservedAt`; read that one, not this one, for observation age. A *failed* publish is a different state and shows as `lastError` (`degraded`/`down`). `staleAfterSeconds` is deliberately **larger** (3600) than this: the health ladder checks `stale` before `delayed`, so equal budgets would make `delayed` unreachable — silence for 30 min reads as "the run loop slipped", silence past an hour as "our side stopped fetching altogether". |
| `gistda-flood` | `null` | GISTDA publishes no acquisition or observation time with the flood scene (E3.2), so there is no cadence to compare against. Guessing one would be a fabricated timestamp. |

`staleAfterSeconds` is the separate fetch-side budget: thaiwater 900 s (refresh every 5 min),
tmd-radar 900 s (refresh 5 min, retry 1 min → three missed rounds), gistda-flood 10800 s (refresh
every 30 min), earthquakes 300 s (cron every minute).

### `down`, `ok` and `worst`

- `earthquakes` is `down` only when **every** feed it polls failed in that round — the count comes
  from the feed list (`EQ_FEEDS`), never a hardcoded number, so adding a fourth feed moves the
  threshold with it. One failed feed (today: TMD, whose credentials are deliberately unset) is
  `degraded`, and the reason stays visible in `lastError`.
- `nextAttemptAt` is read from the Durable Object's **real alarm**. No alarm scheduled → `null`; it
  is never derived from `fetchedAt + refresh interval`, which would be an invented time. For
  `gistda-flood` the alarm can be scheduled *earlier* than the failure backoff allows an attempt (an
  early wake-up only re-arms the alarm, it does not call the upstream), so the reported value is the
  later of the alarm and that backoff wall — the time an attempt will actually be made.
- `HealthResponse.ok` is `healthOk()` in `apps/api/src/routes/health.ts`:
  `sources.every(health ∈ {ok, delayed} && !lastError)`. It is therefore **false** whenever any
  source is `down`, `unknown`, `degraded` or `stale` — silence is not health, and neither is "we have
  not managed to fetch for longer than this source's own budget". The `!lastError` half is
  deliberately redundant: it keeps `ok` false for any source that is actively failing even if the
  ladder above it is ever reordered. `delayed` keeps `ok` true because the fetch is working and the
  data on screen is real, carrying its own age.
- `HealthResponse.worst` is the worst state across all sources, ranked
  `ok < delayed < stale < degraded < unknown < down` (`HEALTH_SEVERITY` in
  `packages/shared-types/src/health.ts`, so api and web cannot rank them differently). An empty
  source list is `unknown`, not `ok`.

## Removed endpoints

| Endpoint | Status | Note |
|---|---|---|
| `/api/v1/provinces/{NN}/hazards/latest` | **removed** (E5.2) — answers `404` | It served a forecast manifest that no pipeline ever published, so it could only ever return "no forecast published yet". The `ForecastPointerDO` class, its binding and its migrations stay in place: E10.3 repurposes it as the exposure-run pointer behind `/api/v1/provinces/{NN}/exposure/latest`. Dropping a Durable Object class in a migration destroys its stored data — so that never happens for a route removal. |

## Scheduled refresh (not an endpoint)

The cron tick refreshes four sources — `earthquakes`, `thaiwater`, `gistda-flood`, `tmd-radar` —
concurrently and in isolation (`apps/api/src/scheduledTick.ts`), each with its own ~25 s budget.
One source failing or hanging does not stop the other three, and every source emits exactly one
structured log line per tick with `source`, `outcome` (`ok` / `error` / `timeout`) and `durationMs`.
Each source's own freshness and last error stay visible in `/api/v1/health` — a failed refresh
degrades visibly instead of disappearing. (The timeout above bounds the *tick*, not the Durable
Object call it started: a source logged as `timeout` may still finish and record its own result
afterwards, so the log line and `/api/v1/health` answer two different questions.)
`cron` does not fire under `wrangler dev` — trigger a tick by hand with
`GET /__scheduled?cron=*+*+*+*+*`.
