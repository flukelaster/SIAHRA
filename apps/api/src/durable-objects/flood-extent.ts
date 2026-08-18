import { DurableObject } from "cloudflare:workers";
import type {
  FloodExtentFeature,
  FloodExtentProvinceSummary,
  FloodExtentResponse,
  FloodExtentSummaryResponse,
  HazardLayerDescriptor,
  SourceStatus,
} from "@siahra/shared-types";
import { fetchGistdaFloodExtent, type FetchOptions } from "../ingestion/gistda.js";
import { keys as archiveKeys, putJsonGz } from "../archive.js";

/** GISTDA re-interprets scenes irregularly; half-hourly polling is plenty. */
const REFRESH_MS = 30 * 60 * 1000;
/** ล้มครั้งแรกรอเท่านี้ แล้วคูณสองไปเรื่อย ๆ จนถึงเพดาน — ต้นทางล่มทั้งวันจะได้ไม่โดนยิง 288 ครั้ง */
const RETRY_BASE_MS = 5 * 60 * 1000;
const RETRY_MAX_MS = 30 * 60 * 1000;
/** No successful pull for this long => stale (the scene itself may be older). */
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;
/** Polygons that vanish from the scene are kept this long as history. */
const HISTORY_MS = 30 * 24 * 60 * 60 * 1000;
/** DO ที่ยังไม่เคยมีข้อมูลเลย รอผลรอบแรกได้แค่นี้ ที่เหลือปล่อยวิ่งต่อเบื้องหลัง */
const COLD_START_WAIT_MS = 3_000;
/**
 * งานที่ค้างอยู่หลังตอบ request มีเวลาจำกัด (~30 วิ) — ทุกการ refresh ที่เกิดจาก
 * request (cold start และ refresh เมื่อของเก่าหมดอายุ) จึงยิงครั้งเดียวไม่ retry
 * เพื่อให้ refresh() ได้บันทึก lastError/backoff ทัน ไม่ถูกตัดกลางคัน
 * ส่วน alarm ไม่มีข้อจำกัดนี้ จึงใช้ retry เต็มชุด
 */
const REQUEST_PATH_FETCH = { attempts: 1, timeoutMs: 20_000 };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface FeatureRow extends Record<string, SqlStorageValue> {
  id: string;
  province_code: string | null;
  geom: string;
  props: string;
  first_seen_ms: number;
  last_seen_ms: number;
}

interface MetaRow extends Record<string, SqlStorageValue> {
  value: string;
}

/**
 * Cache + change tracker for the GISTDA flood-extent scene. Because the
 * upstream features carry no timestamp, this DO records when each polygon
 * was first and last observed in a successful pull; a scene that fails to
 * load keeps the previous set and marks the source stale rather than
 * showing an empty map that could be misread as "no flooding".
 */
export class FloodExtentDO extends DurableObject<Env> {
  private inflight: Promise<boolean> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS flood_features (
          id TEXT PRIMARY KEY,
          province_code TEXT,
          geom TEXT NOT NULL,
          props TEXT NOT NULL,
          first_seen_ms INTEGER NOT NULL,
          last_seen_ms INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_flood_province ON flood_features(province_code);
        CREATE INDEX IF NOT EXISTS idx_flood_last_seen ON flood_features(last_seen_ms);
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      `);
    });
  }

  private readMeta(key: string): string | null {
    return (
      this.ctx.storage.sql.exec<MetaRow>("SELECT value FROM meta WHERE key = ?", key).toArray()[0]
        ?.value ?? null
    );
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

  private retrievedMs(): number | null {
    const v = this.readMeta("retrievedAt");
    return v ? Date.parse(v) : null;
  }

  private async armAlarm(delay = REFRESH_MS): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing !== null && existing > Date.now()) return;
    await this.ctx.storage.setAlarm(Date.now() + delay);
  }

  /**
   * ตั้งปลุกที่เวลาหนึ่ง โดย "เลื่อนให้เร็วขึ้นได้" ต่างจาก armAlarm ที่ยอมให้
   * alarm เดิมชนะเสมอ — จำเป็นเมื่อ refresh ที่ปล่อยไว้เบื้องหลังล้มทีหลัง
   * แล้วคิว backoff (5–20 นาที) มาก่อน alarm 30 นาทีที่ตั้งไว้ตอนยังไม่รู้ผล
   */
  private async armAlarmAt(whenMs: number): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing !== null && existing > Date.now() && existing <= whenMs) return;
    await this.ctx.storage.setAlarm(Math.max(whenMs, Date.now() + 1_000));
  }

  /** ระยะรอครั้งถัดไปเมื่อล้มติดกัน n ครั้ง: 5m, 10m, 20m, 30m… (+jitter) */
  private backoffMs(failures: number): number {
    const base = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, failures - 1));
    return Math.min(RETRY_MAX_MS, Math.round(base * (0.85 + Math.random() * 0.3)));
  }

  private failureCount(): number {
    return Number(this.readMeta("failureCount") ?? "0");
  }

  /** เวลาที่เร็วที่สุดที่จะยิงต้นทางได้อีกครั้ง (0 = ได้เลย) */
  private nextAttemptMs(): number {
    const v = this.readMeta("nextAttemptAt");
    return v ? Date.parse(v) : 0;
  }

  async alarm(): Promise<void> {
    // นาฬิกาปลุกอาจถูกตั้งไว้เร็วกว่าคิว backoff (เช่นตอน cold start) — ห้ามยิงก่อนกำหนด
    const wait = this.nextAttemptMs() - Date.now();
    if (wait > 0) {
      await this.ctx.storage.setAlarm(Date.now() + wait);
      return;
    }
    const ok = await this.refreshOnce();
    await this.armAlarm(ok ? REFRESH_MS : this.backoffMs(this.failureCount()));
  }

  /**
   * Non-blocking: การอ่านของผู้ใช้ต้องไม่ไปรอ (หรือไปกระตุ้น) ต้นทางที่ล่มอยู่
   * — เสิร์ฟของที่ cache ไว้ แล้วให้ alarm เป็นเจ้าของการ refresh
   * ยกเว้น cold start (ยังไม่เคยลองเลย) ที่รอผลรอบแรกเพื่อไม่ให้หน้าจอว่าง
   */
  async ensureFresh(): Promise<void> {
    const neverAttempted = this.readMeta("lastAttemptAt") === null;
    const r = this.retrievedMs();
    const due = r === null || Date.now() - r > REFRESH_MS;
    const allowed = Date.now() >= this.nextAttemptMs();
    if (neverAttempted) {
      const first = this.refreshOnce(REQUEST_PATH_FETCH);
      this.ctx.waitUntil(first);
      await Promise.race([first, sleep(COLD_START_WAIT_MS)]);
    } else if (due && allowed) {
      this.ctx.waitUntil(this.refreshOnce(REQUEST_PATH_FETCH));
    }
    await this.armAlarm(this.retrievedMs() === null ? this.backoffMs(this.failureCount()) : REFRESH_MS);
  }

  private refreshOnce(options?: FetchOptions): Promise<boolean> {
    if (!this.inflight) {
      this.inflight = this.refresh(options).finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async refresh(options?: FetchOptions): Promise<boolean> {
    const nowMs = Date.now();
    this.writeMeta("lastAttemptAt", new Date(nowMs).toISOString());
    let features;
    try {
      features = await fetchGistdaFloodExtent(options);
    } catch (err) {
      const failures = this.failureCount() + 1;
      const waitMs = this.backoffMs(failures);
      this.writeMeta("lastError", String(err).slice(0, 300));
      this.writeMeta("failureCount", String(failures));
      this.writeMeta("nextAttemptAt", new Date(nowMs + waitMs).toISOString());
      console.error(
        JSON.stringify({
          level: "error",
          message: "gistda flood fetch failed",
          error: String(err),
          consecutiveFailures: failures,
          retryInSeconds: Math.round(waitMs / 1000),
        }),
      );
      await this.armAlarmAt(nowMs + waitMs);
      return false;
    }
    // Upsert: new ids get first_seen = now, known ids just bump last_seen.
    for (const f of features) {
      this.ctx.storage.sql.exec(
        `INSERT INTO flood_features (id, province_code, geom, props, first_seen_ms, last_seen_ms)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET last_seen_ms = excluded.last_seen_ms, props = excluded.props`,
        f.id,
        f.provinceCode,
        JSON.stringify(f.geometry),
        JSON.stringify(f.props),
        nowMs,
        nowMs,
      );
    }
    this.ctx.storage.sql.exec("DELETE FROM flood_features WHERE last_seen_ms < ?", nowMs - HISTORY_MS);
    // Archive the scene when its feature set changed (id set hash).
    const sceneHash = await (async () => {
      const ids = features.map((f) => f.id).sort().join("|");
      const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(ids));
      return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
    })();
    if (this.readMeta("sceneHash") !== sceneHash) {
      this.ctx.waitUntil(
        putJsonGz(this.env.HAZARD_BUCKET, archiveKeys.flood(new Date(nowMs).toISOString()), {
          retrievedAt: new Date(nowMs).toISOString(),
          featureCount: features.length,
          features: features.map((f) => ({ type: "Feature", id: f.id, properties: f.props, geometry: f.geometry })),
        }).catch((err: unknown) =>
          console.error(JSON.stringify({ level: "warn", message: "flood archive failed", error: String(err) })),
        ),
      );
      this.writeMeta("sceneHash", sceneHash);
    }
    this.writeMeta("retrievedAt", new Date(nowMs).toISOString());
    this.writeMeta("lastError", null);
    this.writeMeta("failureCount", null);
    this.writeMeta("nextAttemptAt", null);
    this.writeMeta("featureCount", String(features.length));
    await this.armAlarmAt(nowMs + REFRESH_MS);
    console.log(
      JSON.stringify({ level: "info", message: "gistda flood refreshed", features: features.length }),
    );
    return true;
  }

  private layer(retrievedAt: string | null): HazardLayerDescriptor {
    return {
      id: "gistda-flood-extent",
      epistemicClass: "observed",
      liveOrStatic: "live",
      fetchedAt: retrievedAt,
      staleAfterSeconds: STALE_AFTER_MS / 1000,
      methodologyUrl: "https://opendata.gistda.or.th/dataset/floodcheck",
      sourceIds: ["gistda-wfs-flooding_vis"],
    };
  }

  private rowToFeature(r: FeatureRow): FloodExtentFeature {
    return {
      type: "Feature",
      id: r.id,
      properties: {
        ...(JSON.parse(r.props) as Omit<FloodExtentFeature["properties"], "firstSeenAt" | "lastSeenAt">),
        firstSeenAt: new Date(r.first_seen_ms).toISOString(),
        lastSeenAt: new Date(r.last_seen_ms).toISOString(),
      },
      geometry: JSON.parse(r.geom) as FloodExtentFeature["geometry"],
    };
  }

  /** Features present in the most recent successful scene, for one province. */
  async getProvince(provinceCode: string): Promise<FloodExtentResponse> {
    await this.ensureFresh();
    const retrievedAt = this.readMeta("retrievedAt");
    const r = this.retrievedMs();
    const rows = r
      ? this.ctx.storage.sql
          .exec<FeatureRow>(
            "SELECT * FROM flood_features WHERE province_code = ? AND last_seen_ms >= ?",
            provinceCode,
            r,
          )
          .toArray()
      : [];
    return {
      layer: this.layer(retrievedAt),
      retrievedAt,
      provinceCode,
      features: rows.map((row) => this.rowToFeature(row)),
    };
  }

  async getSummary(): Promise<FloodExtentSummaryResponse> {
    await this.ensureFresh();
    const retrievedAt = this.readMeta("retrievedAt");
    const r = this.retrievedMs();
    const rows = r
      ? this.ctx.storage.sql
          .exec<FeatureRow>("SELECT * FROM flood_features WHERE last_seen_ms >= ?", r)
          .toArray()
      : [];
    const byProvince = new Map<string, FloodExtentProvinceSummary>();
    for (const row of rows) {
      const f = this.rowToFeature(row);
      const code = f.properties.provinceCode ?? "??";
      const acc = byProvince.get(code) ?? {
        provinceCode: code,
        provinceTh: f.properties.provinceTh,
        tambonCount: 0,
        floodAreaRai: 0,
        houses: 0,
      };
      acc.tambonCount++;
      acc.floodAreaRai += f.properties.floodAreaRai ?? 0;
      acc.houses += f.properties.houses ?? 0;
      byProvince.set(code, acc);
    }
    return {
      layer: this.layer(retrievedAt),
      retrievedAt,
      totalFeatures: rows.length,
      provinces: [...byProvince.values()].sort((a, b) => b.floodAreaRai - a.floodAreaRai),
    };
  }

  async status(): Promise<SourceStatus> {
    const retrievedAt = this.readMeta("retrievedAt");
    const lastError = this.readMeta("lastError");
    const age = retrievedAt ? Date.now() - Date.parse(retrievedAt) : Infinity;
    const health = !retrievedAt
      ? lastError
        ? "down"
        : "unknown"
      : age > STALE_AFTER_MS
        ? "stale"
        : lastError
          ? "degraded"
          : "ok";
    return {
      id: "gistda-flood",
      labelTh: "น้ำท่วมจากภาพดาวเทียม (GISTDA)",
      health,
      fetchedAt: retrievedAt,
      latestObservedAt: null,
      lastAttemptAt: this.readMeta("lastAttemptAt"),
      lastError,
      detail: {
        features: Number(this.readMeta("featureCount") ?? "0"),
        consecutiveFailures: this.failureCount(),
        nextAttemptAt: this.readMeta("nextAttemptAt"),
      },
      staleAfterSeconds: STALE_AFTER_MS / 1000,
    };
  }
}
