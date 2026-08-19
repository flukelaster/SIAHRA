import { DurableObject } from "cloudflare:workers";
import {
  SOURCES,
  type EarthquakeEvent,
  type EarthquakeRecentResponse,
  type EqWsMessage,
  type HazardLayerDescriptor,
  type SourceStatus,
} from "@siahra/shared-types";
import type { Bbox } from "../ingestion/usgs.js";
import { backfillUsgsEvents, fetchUsgsEvents } from "../ingestion/usgs.js";
import { fetchEmscEvents } from "../ingestion/emsc.js";
import { fetchTmdEvents, TMD_MISSING_CREDENTIALS, tmdCredentials } from "../ingestion/tmd.js";
import { findCorroboratingCluster, type StoredEventRow } from "../ingestion/normalize.js";
import { deriveSourceHealth } from "../sourceHealth.js";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const BACKFILL_DAYS = 30;
const BACKFILL_MIN_MAG = 2.5;
const EMSC_LOOKBACK_MS = 70 * 60 * 1000; // trailing ~70 min window per 1-min cron tick
const CORROBORATION_LOOKBACK_MS = 2 * 60 * 60 * 1000; // only recent rows can corroborate
const POLL_INTERVAL_MS = 60 * 1000;
/**
 * ต้นทางที่ poll ทุกครั้ง — `down` คือ "ล้มเหลวครบทุกตัวในรายการนี้" จึงต้องนับ
 * จากความยาวของรายการ ไม่ใช่เลข 3 ที่ฝังไว้ (เพิ่ม/ลดฟีดแล้วเกณฑ์ต้องขยับตาม)
 */
const EQ_FEEDS = ["usgs", "emsc", "tmd"] as const;

/** Outcome of the last cron poll, kept for /health. */
interface PollStatus {
  at: string;
  created: number;
  updated: number;
  /** จำนวน "เหตุการณ์" ที่พิจารณาในรอบนั้น ไม่ใช่จำนวนฟีด */
  polled: number;
  /** จำนวนฟีดที่พยายามดึงในรอบนั้น — ใช้เทียบกับ errors.length เพื่อตัดสิน `down` */
  feeds?: number;
  errors: string[];
}

interface EventRow extends Record<string, SqlStorageValue> {
  id: string;
  cluster_id: string;
  source: string;
  source_id: string;
  mag: number | null;
  mag_type: string | null;
  place: string | null;
  lat: number;
  lon: number;
  depth_km: number | null;
  time_ms: number;
  updated_ms: number;
  status: string;
  tsunami: number;
  url: string | null;
  raw_json: string;
  ingested_at_ms: number;
}

interface CorroborationRow extends Record<string, SqlStorageValue> {
  id: string;
  clusterId: string;
  source: string;
  lat: number;
  lon: number;
  mag: number | null;
  time_ms: number;
}

function rowToEvent(row: EventRow): EarthquakeEvent {
  return {
    id: row.id,
    clusterId: row.cluster_id,
    sources: [row.source as EarthquakeEvent["sources"][number]],
    mag: row.mag,
    magType: row.mag_type,
    place: row.place,
    lat: row.lat,
    lon: row.lon,
    depthKm: row.depth_km,
    time: new Date(row.time_ms).toISOString(),
    updated: new Date(row.updated_ms).toISOString(),
    status: row.status as EarthquakeEvent["status"],
    tsunami: row.tsunami === 1,
    url: row.url,
  };
}

export class EarthquakeFeedDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          cluster_id TEXT NOT NULL,
          source TEXT NOT NULL,
          source_id TEXT NOT NULL,
          mag REAL,
          mag_type TEXT,
          place TEXT,
          lat REAL NOT NULL,
          lon REAL NOT NULL,
          depth_km REAL,
          time_ms INTEGER NOT NULL,
          updated_ms INTEGER NOT NULL,
          status TEXT,
          tsunami INTEGER DEFAULT 0,
          url TEXT,
          raw_json TEXT NOT NULL,
          ingested_at_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_events_cluster ON events(cluster_id);
        CREATE INDEX IF NOT EXISTS idx_events_time ON events(time_ms DESC);
      `);
    });
  }

  private resolveBbox(): Bbox {
    return JSON.parse(this.env.EQ_DEFAULT_BBOX) as Bbox;
  }

  private pollInflight: Promise<{ created: number; updated: number; polled: number }> | null = null;

  /**
   * Self-scheduling fallback: production polls from the 1-minute cron, but
   * `wrangler dev` never fires crons, and a missed cron tick should not
   * silently freeze the feed either. The alarm re-arms itself every minute
   * and shares the in-flight poll with the cron path.
   */
  private async armAlarm(): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing !== null && existing > Date.now()) return;
    await this.ctx.storage.setAlarm(Date.now() + POLL_INTERVAL_MS);
  }

  async alarm(): Promise<void> {
    await this.pollAndBroadcast().catch((err: unknown) => {
      console.error(JSON.stringify({ level: "error", message: "alarm poll failed", error: String(err) }));
    });
    await this.armAlarm();
  }

  /** Called by the Worker's scheduled() handler on the 1-minute cron (and by the alarm). */
  async pollAndBroadcast(): Promise<{ created: number; updated: number; polled: number }> {
    if (!this.pollInflight) {
      this.pollInflight = this.pollOnce().finally(() => {
        this.pollInflight = null;
      });
      void this.armAlarm();
    }
    return this.pollInflight;
  }

  private async pollOnce(): Promise<{ created: number; updated: number; polled: number }> {
    const bbox = this.resolveBbox();
    const nowMs = Date.now();

    // Cold start: the 1-hour summary feed is usually empty for a single
    // region, so seed a useful window before entering steady-state polling.
    const isEmpty =
      (
        this.ctx.storage.sql
          .exec<{ n: number }>("SELECT COUNT(*) AS n FROM events")
          .toArray()[0]?.n ?? 0
      ) === 0;
    const seededEvents = isEmpty
      ? await backfillUsgsEvents(bbox, BACKFILL_DAYS, BACKFILL_MIN_MAG).catch((err: unknown) => {
          console.error(
            JSON.stringify({ level: "error", message: "usgs backfill failed", error: String(err) }),
          );
          return [] as EarthquakeEvent[];
        })
      : [];

    const feedErrors: string[] = [];

    /**
     * TMD is the only keyed feed. With no secret set there is nothing to call,
     * so report it as this poll's error and keep USGS/EMSC untouched — the
     * whole refresh must never throw over a missing credential.
     */
    const tmdEvents = async (): Promise<EarthquakeEvent[]> => {
      if (!tmdCredentials(this.env)) {
        console.error(JSON.stringify({ level: "error", message: "tmd poll skipped", error: TMD_MISSING_CREDENTIALS }));
        feedErrors.push(TMD_MISSING_CREDENTIALS);
        return [];
      }
      return fetchTmdEvents(bbox, this.env, nowMs).catch((err: unknown) => {
        console.error(JSON.stringify({ level: "error", message: "tmd poll failed", error: String(err) }));
        feedErrors.push(`tmd: ${String(err).slice(0, 120)}`);
        return [] as EarthquakeEvent[];
      });
    };

    const [usgsEvents, emscEvents, tmdFeedEvents] = await Promise.all([
      fetchUsgsEvents(bbox).catch((err: unknown) => {
        console.error(JSON.stringify({ level: "error", message: "usgs poll failed", error: String(err) }));
        feedErrors.push(`usgs: ${String(err).slice(0, 120)}`);
        return [] as EarthquakeEvent[];
      }),
      fetchEmscEvents(bbox, nowMs - EMSC_LOOKBACK_MS).catch((err) => {
        console.error(JSON.stringify({ level: "error", message: "emsc poll failed", error: String(err) }));
        feedErrors.push(`emsc: ${String(err).slice(0, 120)}`);
        return [] as EarthquakeEvent[];
      }),
      tmdEvents(),
    ]);

    // Backfill first so live-feed revisions of the same event win on updated_ms.
    // TMD (the Thai national network) is listed last only so that its events
    // corroborate into clusters already seeded by the global feeds; all four
    // sources share the same dedupe path below.
    const candidates = [...seededEvents, ...usgsEvents, ...emscEvents, ...tmdFeedEvents];
    let created = 0;
    let updated = 0;
    const messages: EqWsMessage[] = [];

    for (const candidate of candidates) {
      const existing = this.ctx.storage.sql
        .exec<EventRow>("SELECT * FROM events WHERE id = ?", candidate.id)
        .toArray();

      if (existing.length > 0) {
        const prevUpdatedMs = existing[0].updated_ms;
        const candidateUpdatedMs = Date.parse(candidate.updated);
        if (candidateUpdatedMs > prevUpdatedMs) {
          this.ctx.storage.sql.exec(
            `UPDATE events SET mag=?, mag_type=?, place=?, depth_km=?, updated_ms=?, status=?, tsunami=?, url=?, raw_json=? WHERE id=?`,
            candidate.mag,
            candidate.magType,
            candidate.place,
            candidate.depthKm,
            candidateUpdatedMs,
            candidate.status,
            candidate.tsunami ? 1 : 0,
            candidate.url,
            JSON.stringify(candidate),
            candidate.id,
          );
          updated++;
          messages.push({ type: "event.updated", event: { ...candidate, clusterId: existing[0].cluster_id } });
        }
        continue;
      }

      const timeMs = Date.parse(candidate.time);
      const recentRows: StoredEventRow[] = this.ctx.storage.sql
        .exec<CorroborationRow>(
          `SELECT id, cluster_id as clusterId, source, lat, lon, mag, time_ms FROM events WHERE time_ms > ? AND time_ms < ?`,
          timeMs - CORROBORATION_LOOKBACK_MS,
          timeMs + CORROBORATION_LOOKBACK_MS,
        )
        .toArray()
        .map((r) => ({ id: r.id, clusterId: r.clusterId, source: r.source, lat: r.lat, lon: r.lon, mag: r.mag, timeMs: r.time_ms }));

      const corroboratedClusterId = findCorroboratingCluster(candidate, recentRows);
      const clusterId = corroboratedClusterId ?? candidate.id;

      this.ctx.storage.sql.exec(
        `INSERT INTO events (id, cluster_id, source, source_id, mag, mag_type, place, lat, lon, depth_km, time_ms, updated_ms, status, tsunami, url, raw_json, ingested_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        candidate.id,
        clusterId,
        candidate.sources[0],
        candidate.id.split(":").slice(1).join(":"),
        candidate.mag,
        candidate.magType,
        candidate.place,
        candidate.lat,
        candidate.lon,
        candidate.depthKm,
        timeMs,
        Date.parse(candidate.updated),
        candidate.status,
        candidate.tsunami ? 1 : 0,
        candidate.url,
        JSON.stringify(candidate),
        nowMs,
      );
      created++;
      messages.push({ type: "event.created", event: { ...candidate, clusterId } });
    }

    this.ctx.storage.sql.exec("DELETE FROM events WHERE time_ms < ?", nowMs - RETENTION_MS);

    if (messages.length > 0) this.broadcast(messages);
    this.broadcast([{ type: "heartbeat", ts: new Date(nowMs).toISOString() }]);

    const status: PollStatus = {
      at: new Date(nowMs).toISOString(),
      created,
      updated,
      polled: candidates.length,
      feeds: EQ_FEEDS.length,
      errors: feedErrors,
    };
    await this.ctx.storage.put("lastPoll", status);

    return { created, updated, polled: candidates.length };
  }

  /** Backs GET /api/v1/earthquakes/recent. */
  async getRecent(limit = 100, minMag: number | null = null): Promise<EarthquakeEvent[]> {
    void this.armAlarm();
    const rows = (
      minMag === null
        ? this.ctx.storage.sql.exec<EventRow>(
            "SELECT * FROM events ORDER BY time_ms DESC LIMIT ?",
            limit,
          )
        : this.ctx.storage.sql.exec<EventRow>(
            "SELECT * FROM events WHERE mag >= ? ORDER BY time_ms DESC LIMIT ?",
            minMag,
            limit,
          )
    ).toArray();
    return rows.map(rowToEvent);
  }

  /**
   * Descriptor for everything this DO serves — the three timestamps kept apart:
   * observedAt = origin time ของแผ่นดินไหวที่ใหม่ที่สุดที่เราถืออยู่,
   * publishedAt = เวลาที่ต้นทางแก้ไข/เผยแพร่ระเบียนล่าสุด (ฟิลด์ `updated` ของฟีด),
   * fetchedAt = เวลาที่ poll สำเร็จครั้งล่าสุด — null เมื่อยังไม่เคยสำเร็จเลย
   */
  private async layer(): Promise<HazardLayerDescriptor> {
    const poll = (await this.ctx.storage.get<PollStatus>("lastPoll")) ?? null;
    const row = this.ctx.storage.sql
      .exec<{ newest: number | null; published: number | null }>(
        "SELECT MAX(time_ms) AS newest, MAX(updated_ms) AS published FROM events",
      )
      .toArray()[0];
    return {
      id: "earthquake-events",
      epistemicClass: "observed",
      liveOrStatic: "live",
      observedAt: row?.newest ? new Date(row.newest).toISOString() : undefined,
      publishedAt: row?.published ? new Date(row.published).toISOString() : null,
      fetchedAt: poll?.at ?? null,
      staleAfterSeconds: 5 * 60,
      sourceIds: ["earthquakes"],
    };
  }

  /** Backs GET /api/v1/earthquakes/recent — events plus their descriptor. */
  async getRecentResponse(limit = 100, minMag: number | null = null): Promise<EarthquakeRecentResponse> {
    const events = await this.getRecent(limit, minMag);
    return { asOf: new Date().toISOString(), layer: await this.layer(), events };
  }

  /** Backs GET /api/v1/health — one SourceStatus per upstream feed. */
  async status(): Promise<SourceStatus[]> {
    const poll = (await this.ctx.storage.get<PollStatus>("lastPoll")) ?? null;
    const count =
      this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM events").toArray()[0]?.n ?? 0;
    const newest =
      this.ctx.storage.sql
        .exec<{ t: number | null }>("SELECT MAX(time_ms) AS t FROM events")
        .toArray()[0]?.t ?? null;
    const now = Date.now();
    const staleAfterSeconds = 5 * 60; // cron runs every minute
    // เรกคอร์ดที่บันทึกไว้ก่อนมีฟิลด์ feeds ให้ถือว่าเป็นชุดฟีดปัจจุบัน
    const feeds = poll?.feeds ?? EQ_FEEDS.length;
    const health = deriveSourceHealth({
      nowMs: now,
      fetchedAt: poll?.at ?? null,
      lastError: poll?.errors.length ? poll.errors.join("; ") : null,
      latestObservedAt: newest ? new Date(newest).toISOString() : null,
      staleAfterSeconds,
      /**
       * แผ่นดินไหวไม่มีคาบการตรวจวัด — `latestObservedAt` คือเวลาที่แผ่นดินไหว
       * "เกิด" วันที่ไม่มีแผ่นดินไหวคือวันที่ปกติ ไม่ใช่ฟีดค้าง จึงตัดสิน
       * `delayed` ไม่ได้เลย และการทำเป็นตัดสินคือการกุความล้มเหลวขึ้นมาเอง
       */
      observedLagSeconds: null,
      allFeedsFailed: (poll?.errors.length ?? 0) >= feeds,
    });
    const alarmAtMs = await this.ctx.storage.getAlarm();
    return [
      {
        id: "earthquakes",
        labelTh: SOURCES.earthquakes.nameTh,
        labelEn: SOURCES.earthquakes.nameEn,
        health,
        fetchedAt: poll?.at ?? null,
        latestObservedAt: newest ? new Date(newest).toISOString() : null,
        lastAttemptAt: poll?.at ?? null,
        lastError: poll?.errors.length ? poll.errors.join("; ") : null,
        detail: {
          events30d: count,
          wsClients: this.ctx.getWebSockets().length,
          lastCreated: poll?.created ?? null,
          lastUpdated: poll?.updated ?? null,
        },
        staleAfterSeconds,
        observedLagSeconds: null,
        nextAttemptAt: alarmAtMs === null ? null : new Date(alarmAtMs).toISOString(),
      },
    ];
  }

  private broadcast(messages: EqWsMessage[]) {
    const sockets = this.ctx.getWebSockets();
    for (const message of messages) {
      const payload = JSON.stringify(message);
      for (const ws of sockets) {
        try {
          ws.send(payload);
        } catch (err) {
          console.error(JSON.stringify({ level: "error", message: "ws send failed", error: String(err) }));
        }
      }
    }
  }

  /** Handles the WS upgrade for /api/v1/earthquakes/live. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected websocket upgrade", { status: 426 });
    }

    void this.armAlarm();
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);

    const rows = this.ctx.storage.sql
      .exec<EventRow>("SELECT * FROM events ORDER BY time_ms DESC LIMIT 200")
      .toArray();
    const snapshot: EqWsMessage = {
      type: "snapshot",
      asOf: new Date().toISOString(),
      layer: await this.layer(),
      events: rows.map(rowToEvent),
    };
    // Snapshot must be sent before any event.* message reaches this specific
    // socket — safe here because broadcast() only fires from pollAndBroadcast(),
    // which runs on the cron tick, never concurrently with this handler.
    server.send(JSON.stringify(snapshot));

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): Promise<void> {
    // Clients don't send meaningful messages today; reserved for future ping/pong.
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
  }
}
