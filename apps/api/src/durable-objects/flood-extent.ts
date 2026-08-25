import { DurableObject } from "cloudflare:workers";
import {
  SOURCES,
  type FloodExtentFeature,
  type FloodExtentProvinceSummary,
  type FloodExtentResponse,
  type FloodExtentSummaryResponse,
  type HazardLayerDescriptor,
  type SourceStatus,
} from "@siahra/shared-types";
import { fetchGistdaFloodExtent, type FetchOptions } from "../ingestion/gistda.js";
import { getJsonGz, keys as archiveKeys, putJsonGz } from "../archive.js";
import { deriveSourceHealth } from "../sourceHealth.js";
import { errorText, logError, logInfo, logWarn } from "../log.js";
import { META_TABLE_DDL, readMeta, writeMeta } from "./metaKv.js";

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

/**
 * ฉากที่อ่านจาก R2 (คำขอ `?at=` เก่ากว่า HISTORY_MS) แคชไว้ในหน่วยความจำของ DO
 * instance — ไฟล์ archive เขียนแล้วไม่แก้ จึงไม่มีทางค้าง; TTL มีไว้แค่คืนหน่วยความจำ
 * ห้ามเขียนลง SQLite (rows written คิดเงิน และไม่มีอะไรที่ต้องอยู่รอดข้าม eviction)
 */
const SCENE_CACHE_TTL_MS = 60 * 60 * 1000;
const SCENE_CACHE_MAX = 8;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface FeatureRow extends Record<string, SqlStorageValue> {
  id: string;
  province_code: string | null;
  geom: string;
  props: string;
  first_seen_ms: number;
  last_seen_ms: number;
}

interface SceneRow extends Record<string, SqlStorageValue> {
  r2_key: string;
  retrieved_ms: number;
  feature_count: number;
}

/** รูปของไฟล์ `archive/flood/<iso>.json.gz` ที่ refresh() เขียน (properties ไม่มี first/lastSeen) */
interface ArchivedScene {
  retrievedAt: string;
  featureCount: number;
  features: {
    type: "Feature";
    id: string;
    properties: Omit<FloodExtentFeature["properties"], "firstSeenAt" | "lastSeenAt">;
    geometry: FloodExtentFeature["geometry"];
  }[];
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
  /** ดู SCENE_CACHE_*: r2Key → ฉากที่ parse แล้ว; Map รักษาลำดับการใส่ จึง evict ตัวแรกได้ */
  private sceneCache = new Map<string, { expiresMs: number; scene: ArchivedScene }>();

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
        -- E14.F1: หนึ่งแถวต่อฉากที่ archive ลง R2 (เฉพาะรอบที่ sceneHash เปลี่ยน) เพื่อให้
        -- คำขอ ?at= ย้อนหลังหาคีย์ R2 ได้ด้วย PK เดียว ไม่ต้อง list() — ไม่มี retention:
        -- ~1 แถว/ฉาก ไม่กี่ร้อยแถวต่อปี และเริ่มบันทึกจากวันที่ deploy (ไม่ backfill)
        CREATE TABLE IF NOT EXISTS flood_scenes (
          retrieved_ms INTEGER PRIMARY KEY,
          r2_key TEXT NOT NULL,
          feature_count INTEGER NOT NULL
        );
        ${META_TABLE_DDL}
      `);
    });
  }

  private readMeta(key: string): string | null {
    return readMeta(this.ctx.storage.sql, key);
  }

  private writeMeta(key: string, value: string | null): void {
    writeMeta(this.ctx.storage.sql, key, value);
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
    let scene;
    try {
      scene = await fetchGistdaFloodExtent(options);
    } catch (err) {
      // นับ backoff จากเวลาที่ "ล้มจริง" ไม่ใช่เวลาที่เริ่มยิง ไม่งั้นเวลาที่ใช้
      // ระหว่างรอ (ต้นทางค้าง/retry) จะไปกินโควตาการรอจนลองใหม่เร็วกว่าที่ตั้งไว้
      const failedAtMs = Date.now();
      const failures = this.failureCount() + 1;
      const waitMs = this.backoffMs(failures);
      this.writeMeta("lastError", String(err).slice(0, 300));
      this.writeMeta("failureCount", String(failures));
      this.writeMeta("nextAttemptAt", new Date(failedAtMs + waitMs).toISOString());
      logError("gistda flood fetch failed", {
        error: errorText(err),
        consecutiveFailures: failures,
        retryInSeconds: Math.round(waitMs / 1000),
      });
      await this.armAlarmAt(failedAtMs + waitMs);
      return false;
    }
    const features = scene.features;
    // GISTDA ไม่ได้เผยแพร่ "เวลาที่เผยแพร่ฉาก" มาด้วยเลย (ดูเหตุผลที่วัดไว้ใน
    // ingestion/gistda.ts) — เขียนทับด้วย null เพื่อลบแถว meta ที่เคยเก็บค่าผิดไว้
    this.writeMeta("publishedAt", scene.publishedAt);
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
    // ตาราง flood_scenes ยังว่าง (DO ที่รันอยู่ก่อน F1 มี sceneHash เดิมค้าง จึงไม่มีทาง
    // "เปลี่ยน" จนกว่า GISTDA จะออกฉากใหม่) → บันทึกฉากปัจจุบันเป็นจุดเริ่มของเส้นเวลา
    // ค้นด้วย PK หนึ่งครั้งต่อรอบ refresh 30 นาที ไม่ใช่ต่อคำขอ
    const bootstrap = this.sceneAtOrBefore(nowMs) === null;
    if (bootstrap || this.readMeta("sceneHash") !== sceneHash) {
      const retrievedIso = new Date(nowMs).toISOString();
      const r2Key = archiveKeys.flood(retrievedIso);
      // บันทึกคีย์ก่อนที่ put จะจบ — ถ้า put ล้ม การอ่านย้อนหลังจะเจอ "ไม่มีฉาก" (ไบต์หาย)
      // ซึ่งตรงกับความจริงมากกว่าการไม่มีแถวเลย และไม่ต้องรอ R2 บนเส้นทาง refresh
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO flood_scenes (retrieved_ms, r2_key, feature_count) VALUES (?, ?, ?)",
        nowMs,
        r2Key,
        features.length,
      );
      this.ctx.waitUntil(
        putJsonGz(this.env.HAZARD_BUCKET, r2Key, {
          retrievedAt: retrievedIso,
          featureCount: features.length,
          features: features.map((f) => ({ type: "Feature", id: f.id, properties: f.props, geometry: f.geometry })),
        } satisfies ArchivedScene).catch((err: unknown) =>
          logWarn("flood archive failed", { error: errorText(err) }),
        ),
      );
      this.writeMeta("sceneHash", sceneHash);
    }
    this.writeMeta("retrievedAt", new Date(nowMs).toISOString());
    this.writeMeta("lastError", null);
    this.writeMeta("failureCount", null);
    this.writeMeta("nextAttemptAt", null);
    this.writeMeta("featureCount", String(features.length));
    // สำเร็จแล้วต้อง "ทับ" alarm ชั่วคราว/backoff ที่ตั้งไว้ตอนยังไม่รู้ผล
    // ไม่งั้นจะไปยิงต้นทางซ้ำใน 5 นาทีทั้งที่เพิ่งได้ข้อมูลสดมา
    await this.ctx.storage.setAlarm(Date.now() + REFRESH_MS);
    logInfo("gistda flood refreshed", { features: features.length });
    return true;
  }

  private layer(retrievedAt: string | null): HazardLayerDescriptor {
    return {
      id: "gistda-flood-extent",
      epistemicClass: "observed",
      liveOrStatic: "live",
      // อ่านค่าจาก meta ไม่ได้ เพราะ DO ที่รันอยู่ก่อนแก้อาจยังมีค่าเก่าค้างจนกว่า
      // จะรีเฟรชรอบถัดไป — ต้นทางไม่มีเวลาเผยแพร่ ก็ต้องเป็น null ตั้งแต่วินาทีแรก
      publishedAt: null,
      fetchedAt: retrievedAt,
      staleAfterSeconds: STALE_AFTER_MS / 1000,
      methodologyUrl: "https://opendata.gistda.or.th/dataset/floodcheck",
      sourceIds: ["gistda-flood"],
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

  /**
   * Features for one province. `atMs` null → the most recent successful scene
   * (live). With `atMs`: the scene that covered that instant — from the hot
   * table while inside HISTORY_MS, from the R2 archive beyond it. A historical
   * read never touches the upstream: nothing about the past gets fresher.
   */
  async getProvince(provinceCode: string, atMs: number | null = null): Promise<FloodExtentResponse> {
    if (atMs !== null && Number.isFinite(atMs)) return this.getProvinceAt(provinceCode, atMs);
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

  /** ฉากล่าสุดที่ดึงมา "ก่อนหรือตรง" atMs — ค้นด้วย PK (rowid) ไม่สแกน */
  private sceneAtOrBefore(atMs: number): SceneRow | null {
    return (
      this.ctx.storage.sql
        .exec<SceneRow>(
          "SELECT r2_key, retrieved_ms, feature_count FROM flood_scenes WHERE retrieved_ms <= ? ORDER BY retrieved_ms DESC LIMIT 1",
          atMs,
        )
        .toArray()[0] ?? null
    );
  }

  private noArchivedScene(provinceCode: string): FloodExtentResponse {
    // features ว่างเพราะ "ไม่มีการสังเกต" ไม่ใช่ "ไม่มีน้ำท่วม" — reason บอกฝั่งเว็บให้พูดอย่างนั้น
    return { layer: this.layer(null), retrievedAt: null, provinceCode, features: [], reason: "no-archived-scene" };
  }

  private async getProvinceAt(provinceCode: string, atMs: number): Promise<FloodExtentResponse> {
    const scene = this.sceneAtOrBefore(atMs);
    if (!scene) return this.noArchivedScene(provinceCode);
    const retrievedAt = new Date(scene.retrieved_ms).toISOString();
    if (Date.now() - atMs <= HISTORY_MS) {
      // ตาราง hot ยังมีทุก polygon ที่เห็นในช่วงนี้ (retention 30 วันนับจาก last_seen)
      // — ค้นด้วย idx_flood_province แล้วให้ช่วง first/last_seen กรองต่อ (ต่อจังหวัดมีไม่กี่สิบแถว)
      // เทียบที่ "เวลาของฉาก" ไม่ใช่ atMs: polygon อยู่ในฉากนั้นก็ต่อเมื่อช่วงที่เห็นมันครอบ
      // เวลาที่ดึงฉาก — ส่วน last_seen ถูกประทับตอน refresh จึงสั้นกว่า atMs ที่อยู่หลังรอบ
      // ล่าสุดเสมอ (ไม่งั้น at = เมื่อ 1 นาทีก่อน จะได้ศูนย์ทั้งที่ live มี 44 polygon)
      const rows = this.ctx.storage.sql
        .exec<FeatureRow>(
          "SELECT * FROM flood_features WHERE province_code = ? AND first_seen_ms <= ? AND last_seen_ms >= ?",
          provinceCode,
          scene.retrieved_ms,
          scene.retrieved_ms,
        )
        .toArray();
      return { layer: this.layer(retrievedAt), retrievedAt, provinceCode, features: rows.map((row) => this.rowToFeature(row)) };
    }
    const archived = await this.archivedScene(scene.r2_key);
    // แถวมีแต่ไฟล์ไม่มี = put ตอนนั้นล้ม (refresh() log ไว้แล้ว) — ไม่มีฉากให้ดูจริง ๆ
    if (!archived) return this.noArchivedScene(provinceCode);
    return {
      layer: this.layer(archived.retrievedAt),
      retrievedAt: archived.retrievedAt,
      provinceCode,
      features: archived.features
        .filter((f) => f.properties.provinceCode === provinceCode)
        .map((f) => ({ ...f, properties: { ...f.properties, firstSeenAt: null, lastSeenAt: null } })),
    };
  }

  /** อ่านฉากจาก R2 ครั้งเดียวต่อคีย์ต่อชั่วโมง (ดู SCENE_CACHE_*) */
  private async archivedScene(r2Key: string): Promise<ArchivedScene | null> {
    const now = Date.now();
    const hit = this.sceneCache.get(r2Key);
    if (hit && hit.expiresMs > now) return hit.scene;
    if (hit) this.sceneCache.delete(r2Key);
    const scene = await getJsonGz<ArchivedScene>(this.env.HAZARD_BUCKET, r2Key);
    if (!scene) return null;
    while (this.sceneCache.size >= SCENE_CACHE_MAX) {
      const oldest = this.sceneCache.keys().next().value;
      if (oldest === undefined) break;
      this.sceneCache.delete(oldest);
    }
    this.sceneCache.set(r2Key, { expiresMs: now + SCENE_CACHE_TTL_MS, scene });
    return scene;
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
    const health = deriveSourceHealth({
      nowMs: Date.now(),
      fetchedAt: retrievedAt,
      lastError,
      latestObservedAt: null,
      staleAfterSeconds: STALE_AFTER_MS / 1000,
      // GISTDA ไม่ส่งเวลาถ่ายภาพ/เวลาตรวจวัดมากับฉากน้ำท่วมเลย (E3.2) จึงไม่มี
      // คาบตรวจวัดให้เทียบ — ตัดสิน `delayed` ไม่ได้ ห้ามเดาเป็นตัวเลขใด ๆ
      observedLagSeconds: null,
    });
    /**
     * นัดลองใหม่ต้องอ่านจาก alarm จริง แต่ alarm ของ DO นี้อาจถูกตั้งไว้ "เร็วกว่า"
     * กำแพง backoff (nextAttemptAt) ได้ — รอบที่ตื่นก่อนกำหนดจะไม่ยิงต้นทาง แค่
     * ตั้งนาฬิกาใหม่ ดังนั้นเวลาที่จะมีการ "พยายามดึงจริง" คือค่าที่ช้ากว่าของสองตัว
     * ไม่มี alarm = ไม่มีนัดหมาย → null (ห้ามเดาจากคาบรีเฟรช)
     */
    const alarmAtMs = await this.ctx.storage.getAlarm();
    const attemptAtMs = alarmAtMs === null ? null : Math.max(alarmAtMs, this.nextAttemptMs());
    return {
      id: "gistda-flood",
      labelTh: SOURCES["gistda-flood"].nameTh,
      labelEn: SOURCES["gistda-flood"].nameEn,
      health,
      fetchedAt: retrievedAt,
      latestObservedAt: null,
      lastAttemptAt: this.readMeta("lastAttemptAt"),
      lastError,
      detail: {
        features: Number(this.readMeta("featureCount") ?? "0"),
        consecutiveFailures: this.failureCount(),
      },
      staleAfterSeconds: STALE_AFTER_MS / 1000,
      observedLagSeconds: null,
      nextAttemptAt: attemptAtMs === null ? null : new Date(attemptAtMs).toISOString(),
    };
  }
}
