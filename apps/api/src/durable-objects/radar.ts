import { DurableObject } from "cloudflare:workers";
import type { RadarFramesResponse, SourceStatus } from "@siahra/shared-types";
import {
  RADAR_BOUNDS,
  RADAR_SIZE,
  fetchRadarFrame,
  fetchRadarIndex,
} from "../ingestion/tmdRadar.js";

const REFRESH_MS = 5 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const STALE_AFTER_MS = 90 * 60 * 1000;
/** Frames older than this are dropped from R2 and the index. */
const RETENTION_MS = 24 * 60 * 60 * 1000;
const R2_PREFIX = "radar/tmd-composite/";

interface FrameRow extends Record<string, SqlStorageValue> {
  ts_ms: number;
  key: string;
}
interface MetaRow extends Record<string, SqlStorageValue> {
  value: string;
}

/**
 * Keeps a rolling archive of TMD radar composite frames. Because the source
 * overwrites its 24 slots in place, every poll re-reads the slot→time index
 * and copies any new frame into R2 keyed by its timestamp — so a frame is
 * never mislabelled and history survives past 6 hours.
 */
export class RadarDO extends DurableObject<Env> {
  private inflight: Promise<boolean> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS frames (ts_ms INTEGER PRIMARY KEY, key TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      `);
    });
  }

  private readMeta(key: string): string | null {
    return this.ctx.storage.sql.exec<MetaRow>("SELECT value FROM meta WHERE key = ?", key).toArray()[0]?.value ?? null;
  }
  private writeMeta(key: string, value: string | null): void {
    if (value === null) this.ctx.storage.sql.exec("DELETE FROM meta WHERE key = ?", key);
    else
      this.ctx.storage.sql.exec(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        key,
        value,
      );
  }

  private async armAlarm(delay = REFRESH_MS): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing !== null && existing > Date.now()) return;
    await this.ctx.storage.setAlarm(Date.now() + delay);
  }

  async alarm(): Promise<void> {
    const ok = await this.refreshOnce();
    await this.armAlarm(ok ? REFRESH_MS : RETRY_MS);
  }

  async ensureFresh(): Promise<void> {
    const f = this.readMeta("fetchedAt");
    if (!f || Date.now() - Date.parse(f) > REFRESH_MS) await this.refreshOnce();
    await this.armAlarm();
  }

  private refreshOnce(): Promise<boolean> {
    if (!this.inflight) {
      this.inflight = this.refresh().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async refresh(): Promise<boolean> {
    const nowMs = Date.now();
    this.writeMeta("lastAttemptAt", new Date(nowMs).toISOString());
    let slots;
    try {
      slots = await fetchRadarIndex();
    } catch (err) {
      this.writeMeta("lastError", String(err).slice(0, 200));
      return false;
    }
    let added = 0;
    for (const slot of slots) {
      const have = this.ctx.storage.sql.exec<FrameRow>("SELECT key FROM frames WHERE ts_ms = ?", slot.tsMs).toArray()[0];
      if (have) continue;
      try {
        const png = await fetchRadarFrame(slot.file);
        const key = `${R2_PREFIX}${new Date(slot.tsMs).toISOString().replace(/[:.]/g, "-")}.png`;
        await this.env.HAZARD_BUCKET.put(key, png, { httpMetadata: { contentType: "image/png" } });
        this.ctx.storage.sql.exec("INSERT OR REPLACE INTO frames (ts_ms, key) VALUES (?, ?)", slot.tsMs, key);
        added++;
      } catch (err) {
        console.error(JSON.stringify({ level: "warn", message: "radar frame fetch failed", file: slot.file, error: String(err) }));
      }
    }
    // Prune old frames from both the index and R2.
    const old = this.ctx.storage.sql
      .exec<FrameRow>("SELECT ts_ms, key FROM frames WHERE ts_ms < ?", nowMs - RETENTION_MS)
      .toArray();
    for (const row of old) {
      await this.env.HAZARD_BUCKET.delete(row.key).catch(() => undefined);
      this.ctx.storage.sql.exec("DELETE FROM frames WHERE ts_ms = ?", row.ts_ms);
    }
    this.writeMeta("fetchedAt", new Date(nowMs).toISOString());
    this.writeMeta("lastError", null);
    if (added > 0) console.log(JSON.stringify({ level: "info", message: "radar frames added", added }));
    return true;
  }

  /** Frames within the last `hours`, oldest first. */
  async getFrames(hours: number): Promise<RadarFramesResponse> {
    await this.ensureFresh();
    const nowMs = Date.now();
    const rows = this.ctx.storage.sql
      .exec<FrameRow>("SELECT ts_ms, key FROM frames WHERE ts_ms >= ? ORDER BY ts_ms ASC", nowMs - hours * 3600 * 1000)
      .toArray();
    const fetchedAt = this.readMeta("fetchedAt");
    const newest = rows.length ? new Date(rows[rows.length - 1].ts_ms).toISOString() : undefined;
    return {
      layer: {
        id: "tmd-radar-composite",
        epistemicClass: "observed",
        liveOrStatic: "live",
        observedAt: newest,
        fetchedAt: fetchedAt ?? new Date(nowMs).toISOString(),
        staleAfterSeconds: STALE_AFTER_MS / 1000,
        sourceIds: ["tmd-radar"],
      },
      bounds: RADAR_BOUNDS,
      widthPx: RADAR_SIZE.widthPx,
      heightPx: RADAR_SIZE.heightPx,
      fetchedAt,
      frames: rows.map((r) => ({
        t: new Date(r.ts_ms).toISOString(),
        url: `/api/v1/radar/frame/${r.ts_ms}.png`,
      })),
    };
  }

  /** R2 key for a frame timestamp, or null. */
  async frameKey(tsMs: number): Promise<string | null> {
    return this.ctx.storage.sql.exec<FrameRow>("SELECT key FROM frames WHERE ts_ms = ?", tsMs).toArray()[0]?.key ?? null;
  }

  async status(): Promise<SourceStatus> {
    const fetchedAt = this.readMeta("fetchedAt");
    const lastError = this.readMeta("lastError");
    const newest = this.ctx.storage.sql.exec<{ t: number | null }>("SELECT MAX(ts_ms) AS t FROM frames").toArray()[0]?.t ?? null;
    const count = this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM frames").toArray()[0]?.n ?? 0;
    const age = newest ? Date.now() - newest : Infinity;
    const health = !fetchedAt ? (lastError ? "down" : "unknown") : age > STALE_AFTER_MS ? "stale" : lastError ? "degraded" : "ok";
    return {
      id: "tmd-radar",
      labelTh: "เรดาร์ฝน (กรมอุตุนิยมวิทยา)",
      health,
      fetchedAt,
      latestObservedAt: newest ? new Date(newest).toISOString() : null,
      lastAttemptAt: this.readMeta("lastAttemptAt"),
      lastError,
      detail: { frames24h: count },
      staleAfterSeconds: STALE_AFTER_MS / 1000,
    };
  }
}
