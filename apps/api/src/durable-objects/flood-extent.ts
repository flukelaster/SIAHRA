import { DurableObject } from "cloudflare:workers";
import {
  PROVINCE_CODES,
  SOURCES,
  type FloodAcquisition,
  type FloodExtentFeature,
  type FloodExtentProvinceSummary,
  type FloodExtentResponse,
  type FloodExtentSummaryResponse,
  type HazardLayerDescriptor,
  type SourceStatus,
} from "@siahra/shared-types";
import {
  GISTDA_FLOOD_WINDOW,
  GistdaAuthError,
  GistdaBudgetError,
  fetchGistdaProvince,
  gistdaApiKey,
  redactKey,
  type FetchOptions,
  type GistdaProvincePull,
} from "../ingestion/gistda.js";
import { getJsonGz, gunzip, gzip, keys as archiveKeys } from "../archive.js";
import { deriveSourceHealth } from "../sourceHealth.js";
import { PROVINCE_RINGS } from "../geo/provinceRings.js";
import { logError, logInfo, logWarn } from "../log.js";
import { META_TABLE_DDL, readMeta, writeMeta } from "./metaKv.js";

/** GISTDA ออกผลใหม่ไม่เป็นเวลา — ครึ่งชั่วโมงต่อรอบพอ (devops constraint 2: ≥ 30 นาที) */
const REFRESH_MS = 30 * 60 * 1000;
/** ล้มครั้งแรกรอเท่านี้ แล้วคูณสองไปเรื่อย ๆ จนถึงเพดาน — ต้นทางล่มทั้งวันจะได้ไม่โดนยิง 288 ครั้ง */
const RETRY_BASE_MS = 5 * 60 * 1000;
const RETRY_MAX_MS = 30 * 60 * 1000;
/** No successful pull for this long => stale (the imagery itself may be older — see observedAt). */
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;
/**
 * ต้นทางล่มทั้งระบบ (เน็ต/5xx ทุกคำขอ) ห้ามลาก 77 จังหวัด × retry × timeout 25 วิ จนเกิน
 * เพดานเวลาของ alarm — ล้มติดกันเท่านี้จังหวัดถือว่าต้นทางล่ม หยุดรอบ
 */
const CONSECUTIVE_FAILURES_ABORT = 3;
/** งบเวลาของหนึ่งรอบ (alarm มีเพดาน wall-clock 15 นาที) — เกินแล้วหยุด ที่เหลือนับเป็น "ข้าม" */
const REFRESH_BUDGET_MS = 10 * 60 * 1000;
/**
 * ชื่อจังหวัดของสรุป — จากทะเบียน 77 จังหวัดที่ ETL bake ไว้ (`data/provinceRings.json`)
 * ไม่ใช่ `pv_tn` ของต้นทาง: จังหวัดที่ต้นทางตอบ 0 เซลล์ไม่มี feature ให้อ่านชื่อ และ `pv_tn`
 * มีคำนำหน้า "จ." ซึ่งจะปนรูปแบบกันในรายการเดียว
 */
const PROVINCE_NAME_TH = new Map(PROVINCE_RINGS.map((p) => [p.code, p.nameTh]));
/** DO ที่ยังไม่เคยลองดึงเลย: ปลุก alarm รอบแรกเร็ว ๆ — แต่ยังเป็น alarm ไม่ใช่เส้นทางคำขอ */
const FIRST_ALARM_DELAY_MS = 1_000;

/**
 * ไฟล์ archive ที่อ่านจาก R2 (คำขอ `?at=` และ live หลัง DO ถูก evict) แคชไว้ในหน่วยความจำ
 * ของ DO instance เป็นไบต์ gzip — ไฟล์เขียนแล้วไม่แก้ จึงไม่มีทางค้าง; TTL มีไว้แค่คืนหน่วยความจำ
 * คุมด้วยจำนวนไบต์ (devops constraint 8): 77 จังหวัดรวมกันวัดได้ ~4.3 MB ต่อรอบ จึงเก็บได้
 * หลายรอบโดยไม่ thrash ห้ามเขียนลง SQLite (rows written คิดเงิน และไม่มีอะไรต้องรอดข้าม eviction)
 */
const SCENE_CACHE_TTL_MS = 60 * 60 * 1000;
const SCENE_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const SCENE_CACHE_MAX_ENTRIES = 256;

const GISTDA_METHODOLOGY_URL = "https://opendata.gistda.or.th/dataset/floodcheck";

interface ProvinceSceneRow extends Record<string, SqlStorageValue> {
  r2_key: string;
  retrieved_ms: number;
  feature_count: number;
  content_hash: string;
}

interface LegacySceneRow extends Record<string, SqlStorageValue> {
  r2_key: string;
  retrieved_ms: number;
}

/** รูปของไฟล์ `archive/flood/<iso>.json.gz` ที่ DO รุ่น WFS เขียนไว้ (ก่อน E16.PR0) */
interface LegacyArchivedScene {
  retrievedAt: string;
  features: {
    id: string;
    properties: {
      tambonTh?: string | null;
      amphoeTh?: string | null;
      provinceTh?: string | null;
      provinceCode?: string | null;
      floodAreaRai?: number | null;
    };
    geometry: FloodExtentFeature["geometry"];
  }[];
}

/** สถานะต่อจังหวัดของรอบที่สำเร็จล่าสุด — meta แถวเดียว (`provinceState`) เขียนครั้งเดียวต่อรอบ */
interface ProvinceState {
  summary: FloodExtentProvinceSummary;
  /** SHA-1 ของส่วนเนื้อหา (ทุกอย่างยกเว้น retrievedAt/layer) — "" = archive ของเนื้อหานี้ยังไม่สำเร็จ */
  hash: string;
  publishedAt: string | null;
}
type ProvinceStateMap = Record<string, ProvinceState>;

/** เนื้อหาต่อจังหวัดที่อยู่ในหน่วยความจำ — gzip ไว้ทั้งคำตอบ (ข้อความไทยใน JS กินสองไบต์/ตัว) */
interface LiveProvince {
  gz: ArrayBuffer;
  retrievedMs: number;
  hash: string;
  /** h3 → firstSeenAt; null = โหลดมาจาก R2 ตอน evict ยังไม่เคยแตกดู (refresh จะแตกเองเมื่อต้องใช้) */
  firstSeen: Map<string, string> | null;
}

/** RPC: คำตอบที่ serialise + gzip ไว้แล้ว — ฝั่ง route แค่คลาย stream ไม่ parse/stringify feature */
export interface FloodBody {
  gz: ArrayBuffer;
  retrievedAt: string | null;
}

/**
 * คีย์ที่คั่นส่วน "เนื้อหา" กับ "ท้าย" ของคำตอบ: ทุกอย่างก่อนหน้าคือเนื้อหาที่ hash
 * ส่วนท้าย (`retrievedAt` + `layer`) เปลี่ยนทุกรอบ ไม่มี feature ไหนมีคีย์ชื่อนี้
 * (property ของ feature: firstSeenAt/observedAt/publishedAt) จึงหาด้วย lastIndexOf ได้แน่นอน
 */
const TAIL_MARKER = ',"retrievedAt":';

const sha1Hex = async (text: string): Promise<string> => {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
};

const bytesOf = async (obj: R2ObjectBody): Promise<ArrayBuffer> => obj.arrayBuffer();

const newest = (a: string | null, b: string | null): string | null => (a === null ? b : b === null ? a : a > b ? a : b);

/**
 * Cache + change tracker for the GISTDA flood extent (E16.PR0 — API gateway, H3 cells).
 *
 * The upstream pull runs **only** in `alarm()`: 77 provinces one after another,
 * paged by offset, one province in memory at a time. Each province's answer is
 * serialised and gzip'd once per refresh and held in memory; it is archived to
 * R2 (plus one PK row for `?at=`) only when its content hash changed. A request
 * reads at most one meta row and one PK row and never touches the upstream.
 * A province that fails keeps its previous answer (with its own older
 * `retrievedAt`) — never an empty map that could be misread as "no flooding".
 */
export class FloodExtentDO extends DurableObject<Env> {
  private inflight: Promise<boolean> | null = null;
  private live = new Map<string, LiveProvince>();
  /** ดู SCENE_CACHE_*: คีย์ → gzip ที่อ่านจาก R2; Map รักษาลำดับการใส่ จึง evict ตัวแรกได้ */
  private sceneCache = new Map<string, { expiresMs: number; gz: ArrayBuffer; retrievedAt: string }>();
  private sceneCacheBytes = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        -- E16.PR0: ตารางต่อ polygon ของรุ่น WFS ไม่ถูกเขียนหรืออ่านอีกแล้ว (devops constraint 3)
        DROP TABLE IF EXISTS flood_features;
        -- E14.F1 (รุ่น WFS): หนึ่งแถวต่อฉากที่ archive ลง R2 — ไม่มีการเขียนใหม่ เหลือไว้ให้
        -- ?at= ย้อนไปก่อนวันเปลี่ยนต้นทาง (ช่องว่าง 2026-09-10..cutover ยังมองเห็นได้)
        CREATE TABLE IF NOT EXISTS flood_scenes (
          retrieved_ms INTEGER PRIMARY KEY,
          r2_key TEXT NOT NULL,
          feature_count INTEGER NOT NULL
        );
        -- E16.PR0: หนึ่งแถวต่อ (จังหวัด, รอบที่เนื้อหาเปลี่ยน) — ≤ 77 แถวต่อรอบ เฉพาะจังหวัดที่
        -- hash เปลี่ยน; ?at= หาด้วย PK (province_code, retrieved_ms) ไม่สแกน ไม่มี retention
        CREATE TABLE IF NOT EXISTS flood_province_scenes (
          province_code TEXT NOT NULL,
          retrieved_ms INTEGER NOT NULL,
          r2_key TEXT NOT NULL,
          feature_count INTEGER NOT NULL,
          content_hash TEXT NOT NULL,
          PRIMARY KEY (province_code, retrieved_ms)
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
    // นาฬิกาปลุกอาจถูกตั้งไว้เร็วกว่าคิว backoff — ห้ามยิงก่อนกำหนด
    const wait = this.nextAttemptMs() - Date.now();
    if (wait > 0) {
      await this.ctx.storage.setAlarm(Date.now() + wait);
      return;
    }
    let ok = false;
    try {
      ok = await this.refreshOnce();
    } catch (err) {
      // refresh() จับ error ของต้นทางเองทั้งหมด — ที่หลุดมาถึงนี่คือบั๊กฝั่งเรา ห้ามปล่อยให้
      // runtime retry alarm ทันที (จะกลายเป็นยิงต้นทางถี่กว่า REFRESH_MS)
      this.recordFailure(`flood refresh crashed (${err instanceof Error ? err.name : "error"})`);
    }
    await this.ctx.storage.setAlarm(Date.now() + (ok ? REFRESH_MS : this.backoffMs(this.failureCount())));
  }

  /**
   * เรียกทุกนาทีจาก cron (index.ts) — **ไม่ยิงต้นทางเอง** มีหน้าที่แค่ทำให้มี alarm
   * อยู่เสมอ (devops constraint 1) รอบถัดไปห่างจากรอบก่อนอย่างน้อย REFRESH_MS
   * หรือตามคิว backoff ถ้ารอบก่อนล้ม
   */
  async ensureFresh(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) !== null) return;
    const now = Date.now();
    const lastAttempt = this.readMeta("lastAttemptAt");
    let at: number;
    if (lastAttempt === null) at = now + FIRST_ALARM_DELAY_MS;
    else if (this.failureCount() > 0) at = this.nextAttemptMs();
    else at = Date.parse(lastAttempt) + REFRESH_MS;
    await this.ctx.storage.setAlarm(Math.max(at, now + FIRST_ALARM_DELAY_MS));
  }

  private refreshOnce(options?: FetchOptions): Promise<boolean> {
    if (!this.inflight) {
      this.inflight = this.refresh(options).finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  /** บันทึกรอบที่ล้มทั้งรอบ + คิว backoff — ข้อความต้องไม่มี body ของต้นทางหรือกุญแจ */
  private recordFailure(message: string): void {
    // นับ backoff จากเวลาที่ "ล้มจริง" ไม่ใช่เวลาที่เริ่มยิง
    const failedAtMs = Date.now();
    const failures = this.failureCount() + 1;
    const waitMs = this.backoffMs(failures);
    this.writeMeta("lastError", message.slice(0, 300));
    this.writeMeta("failureCount", String(failures));
    this.writeMeta("nextAttemptAt", new Date(failedAtMs + waitMs).toISOString());
    logError("gistda flood refresh failed", {
      error: message.slice(0, 300),
      consecutiveFailures: failures,
      retryInSeconds: Math.round(waitMs / 1000),
    });
  }

  private provinceState(): ProvinceStateMap {
    const raw = this.readMeta("provinceState");
    if (!raw) return {};
    try {
      return JSON.parse(raw) as ProvinceStateMap;
    } catch {
      return {};
    }
  }

  /** แถวล่าสุดของจังหวัดที่ ≤ atMs — PK (province_code, retrieved_ms) ไม่สแกน */
  private provinceSceneAtOrBefore(provinceCode: string, atMs: number): ProvinceSceneRow | null {
    return (
      this.ctx.storage.sql
        .exec<ProvinceSceneRow>(
          "SELECT r2_key, retrieved_ms, feature_count, content_hash FROM flood_province_scenes WHERE province_code = ? AND retrieved_ms <= ? ORDER BY retrieved_ms DESC LIMIT 1",
          provinceCode,
          atMs,
        )
        .toArray()[0] ?? null
    );
  }

  /** ฉาก WFS เดิมที่ดึงมา "ก่อนหรือตรง" atMs — ค้นด้วย PK (rowid) ไม่สแกน */
  private legacySceneAtOrBefore(atMs: number): LegacySceneRow | null {
    return (
      this.ctx.storage.sql
        .exec<LegacySceneRow>(
          "SELECT r2_key, retrieved_ms FROM flood_scenes WHERE retrieved_ms <= ? ORDER BY retrieved_ms DESC LIMIT 1",
          atMs,
        )
        .toArray()[0] ?? null
    );
  }

  /**
   * รอบก่อนหน้าของจังหวัดนี้ (สำหรับ firstSeenAt + hash) — จากหน่วยความจำก่อน
   * ถ้าถูก evict มา: แถวล่าสุด + ไฟล์ R2 ของมัน (เฉพาะหลัง evict ไม่ใช่ทุกรอบ)
   */
  private async previousFor(provinceCode: string): Promise<{ hash: string | null; firstSeen: Map<string, string> }> {
    const live = this.live.get(provinceCode);
    if (live?.firstSeen) return { hash: live.hash, firstSeen: live.firstSeen };
    const row = this.provinceSceneAtOrBefore(provinceCode, Number.MAX_SAFE_INTEGER);
    if (!row) return { hash: null, firstSeen: new Map() };
    let gz = live?.gz ?? null;
    if (!gz) {
      const obj = await this.env.HAZARD_BUCKET.get(row.r2_key);
      gz = obj ? await bytesOf(obj) : null;
    }
    // ไบต์หาย = ไม่รู้ว่ารอบก่อนเห็นอะไร → ถือเป็นรอบแรก และบังคับ archive ใหม่ (hash null)
    if (!gz) return { hash: null, firstSeen: new Map() };
    const body = JSON.parse(await gunzip(new Response(gz).body!)) as FloodExtentResponse;
    const firstSeen = new Map<string, string>();
    for (const f of body.features) {
      if (f.properties.h3 && f.properties.firstSeenAt) firstSeen.set(f.properties.h3, f.properties.firstSeenAt);
    }
    return { hash: row.content_hash, firstSeen };
  }

  private async refresh(options?: FetchOptions): Promise<boolean> {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    this.writeMeta("lastAttemptAt", nowIso);
    const key = gistdaApiKey(this.env);
    if (!key) {
      // ไม่มีกุญแจ = ไม่ยิงต้นทางเลย และต้องไม่ถูกอ่านว่า "ไม่มีน้ำท่วม"
      this.recordFailure("GISTDA_API_KEY not configured — no request sent to GISTDA");
      return false;
    }

    const prevState = this.provinceState();
    const nextState: ProvinceStateMap = { ...prevState };
    const failed: string[] = [];
    const archiveFailed: string[] = [];
    let okCount = 0;
    let cells = 0;
    let bodyGzBytes = 0;
    let archived = 0;
    let archivedGzBytes = 0;

    // งบเวลาถูกส่งลงไปถึงระดับหน้า/attempt (ไม่ใช่แค่ก่อนแต่ละจังหวัด) — จังหวัดที่มีหลายหน้า
    // หรือ retry + timeout 25 วิ ห้ามลากรอบเลยเพดาน alarm จน setAlarm/commitState ไม่ถูกเรียก
    const deadlineMs = nowMs + REFRESH_BUDGET_MS;
    const fetchOptions: FetchOptions = { ...options, deadlineMs };
    let consecutiveFailures = 0;
    for (const [index, code] of PROVINCE_CODES.entries()) {
      if (consecutiveFailures >= CONSECUTIVE_FAILURES_ABORT || Date.now() >= deadlineMs) {
        const reason = consecutiveFailures >= CONSECUTIVE_FAILURES_ABORT ? "upstream failing" : "time budget";
        failed.push(`${PROVINCE_CODES.slice(index).join(",")}: skipped (${reason})`);
        break;
      }
      let pull: GistdaProvincePull;
      try {
        pull = await fetchGistdaProvince(code, key, fetchOptions);
        consecutiveFailures = 0;
      } catch (err) {
        if (err instanceof GistdaBudgetError) {
          // หมดงบกลางจังหวัด: หน้าที่ได้มาแล้วของจังหวัดนี้ถูกทิ้ง (ไม่ครบ = ห้ามใช้) จังหวัดนี้และ
          // ที่เหลือคงคำตอบเดิม แล้วจบรอบตามปกติ — commitState + setAlarm ยังถูกเรียก
          failed.push(`${PROVINCE_CODES.slice(index).join(",")}: skipped (time budget)`);
          break;
        }
        consecutiveFailures++;
        if (err instanceof GistdaAuthError) {
          // กุญแจถูกปฏิเสธ: ยิงอีก 76 จังหวัดก็ได้ผลเดิม — หยุดทั้งรอบ
          // จังหวัดที่ได้มาแล้วก่อนหน้านี้ในรอบเดียวกันยังเป็นข้อมูลจริง — บันทึกก่อน แล้วค่อยให้
          // recordFailure ทับ lastError/คิว backoff (ลำดับกลับกันจะลบ backoff ทิ้ง)
          if (okCount > 0) this.commitState(nextState, nowIso, [...failed, `${code}: key rejected`]);
          this.recordFailure(`${err.message} — refresh aborted at province ${code}`);
          return false;
        }
        failed.push(`${code}: ${redactKey(err instanceof Error ? err.message : String(err), key).slice(0, 80)}`);
        continue;
      }
      const prev = await this.previousFor(code);
      const built = await this.buildProvince(pull, prev.firstSeen, nowIso);
      bodyGzBytes += built.gz.byteLength;
      cells += pull.matched;
      let hash = built.hash;
      if (built.hash !== prev.hash) {
        const r2Key = archiveKeys.floodV2(nowIso, code);
        try {
          await this.env.HAZARD_BUCKET.put(r2Key, built.gz, {
            httpMetadata: { contentType: "application/json", contentEncoding: "gzip" },
          });
          this.ctx.storage.sql.exec(
            "INSERT OR REPLACE INTO flood_province_scenes (province_code, retrieved_ms, r2_key, feature_count, content_hash) VALUES (?, ?, ?, ?, ?)",
            code,
            nowMs,
            r2Key,
            pull.features.length,
            built.hash,
          );
          archived++;
          archivedGzBytes += built.gz.byteLength;
        } catch {
          // ไม่มีแถว = ?at= ไม่ชี้ไปหาไบต์ที่ไม่มีอยู่ — hash "" บังคับให้รอบหน้าลองใหม่
          archiveFailed.push(code);
          hash = "";
        }
      }
      this.live.set(code, { gz: built.gz, retrievedMs: nowMs, hash, firstSeen: built.firstSeen });
      nextState[code] = { summary: built.summary, hash, publishedAt: built.publishedAt };
      okCount++;
    }

    if (okCount === 0) {
      this.recordFailure(`GISTDA API: no province pulled — ${failed.slice(0, 6).join(" | ")}`);
      return false;
    }
    this.commitState(nextState, nowIso, failed);
    logInfo("gistda flood refreshed", {
      window: GISTDA_FLOOD_WINDOW,
      provincesOk: okCount,
      provincesFailed: failed.length,
      cells,
      bodyGzBytes,
      archived,
      archivedGzBytes,
    });
    if (failed.length > 0 || archiveFailed.length > 0) {
      logWarn("gistda flood partial refresh", {
        failed: failed.join(" | ").slice(0, 600),
        archiveFailed: archiveFailed.join(","),
      });
    }
    return true;
  }

  /** เขียนผลของรอบ (สำเร็จอย่างน้อยหนึ่งจังหวัด) — meta ไม่กี่แถว ครั้งเดียวต่อรอบ */
  private commitState(state: ProvinceStateMap, nowIso: string, failed: string[]): void {
    // "14: HTTP 503" หรือ "57,58,…: skipped (…)" → รหัสจังหวัดทุกตัว
    const failedCodes = failed.flatMap((f) => f.slice(0, f.indexOf(":")).split(","));
    const entries = Object.values(state).map((s) => ({
      ...s.summary,
      provinceTh: PROVINCE_NAME_TH.get(s.summary.provinceCode) ?? s.summary.provinceTh,
    }));
    const latestObservedAt = entries.reduce<string | null>((acc, s) => newest(acc, s.observedAt), null);
    const latestPublishedAt = Object.values(state).reduce<string | null>((acc, s) => newest(acc, s.publishedAt), null);
    const summary: FloodExtentSummaryResponse = {
      layer: this.layer(nowIso, latestObservedAt, latestPublishedAt),
      retrievedAt: nowIso,
      window: GISTDA_FLOOD_WINDOW,
      totalFeatures: entries.reduce((a, s) => a + s.cellCount, 0),
      provinces: entries.sort((a, b) => b.floodAreaM2 - a.floodAreaM2 || a.provinceCode.localeCompare(b.provinceCode)),
      failedProvinces: failedCodes,
    };
    this.writeMeta("provinceState", JSON.stringify(state));
    this.writeMeta("summaryBody", JSON.stringify(summary));
    this.writeMeta("retrievedAt", nowIso);
    this.writeMeta("latestObservedAt", latestObservedAt);
    this.writeMeta("featureCount", String(summary.totalFeatures));
    this.writeMeta("provincesFailed", String(failedCodes.length));
    this.writeMeta("publishedAt", null);
    this.writeMeta("sceneHash", null);
    if (failed.length > 0) {
      // ได้บางจังหวัด = degraded ไม่ใช่ down — ชื่อจังหวัดที่ล้มอยู่ใน lastError ครบ
      this.writeMeta("lastError", `GISTDA API failed for ${failedCodes.length} province(s): ${failed.join(" | ")}`.slice(0, 300));
    } else {
      this.writeMeta("lastError", null);
    }
    this.writeMeta("failureCount", null);
    this.writeMeta("nextAttemptAt", null);
  }

  /** ประกอบคำตอบของหนึ่งจังหวัดครั้งเดียวต่อรอบ: firstSeenAt จากรอบก่อน, hash ของเนื้อหา, gzip */
  private async buildProvince(
    pull: GistdaProvincePull,
    prevFirstSeen: Map<string, string>,
    nowIso: string,
  ): Promise<{
    gz: ArrayBuffer;
    hash: string;
    firstSeen: Map<string, string>;
    summary: FloodExtentProvinceSummary;
    publishedAt: string | null;
  }> {
    const firstSeen = new Map<string, string>();
    const acquisitions = new Map<string, FloodAcquisition>();
    const tambons = new Set<string>();
    let observedAt: string | null = null;
    let publishedAt: string | null = null;
    let provinceTh: string | null = null;
    let areaM2 = 0;
    const features: FloodExtentFeature[] = pull.features.map((f) => {
      const p = f.properties;
      const seen = (p.h3 && prevFirstSeen.get(p.h3)) || nowIso;
      if (p.h3) firstSeen.set(p.h3, seen);
      for (const a of p.acquisitions) acquisitions.set(`${a.sensor}|${a.acquiredAt}`, a);
      if (p.tambonCode) tambons.add(p.tambonCode);
      observedAt = newest(observedAt, p.observedAt);
      publishedAt = newest(publishedAt, p.publishedAt);
      provinceTh ??= p.provinceTh;
      areaM2 += p.floodAreaM2 ?? 0;
      return { type: "Feature", id: f.id, properties: { ...p, firstSeenAt: seen }, geometry: f.geometry };
    });
    const acqList = [...acquisitions.values()].sort((a, b) => (a.acquiredAt < b.acquiredAt ? 1 : a.acquiredAt > b.acquiredAt ? -1 : 0));
    const content =
      `{"provinceCode":${JSON.stringify(pull.provinceCode)},"granularity":"h3-cell","matched":${pull.matched}` +
      `,"acquisitions":${JSON.stringify(acqList)},"observedAt":${JSON.stringify(observedAt)}` +
      `,"features":${JSON.stringify(features)}`;
    const hash = await sha1Hex(content);
    const gz = await gzip(content + this.tail(nowIso, observedAt, publishedAt));
    return {
      gz,
      hash,
      firstSeen,
      publishedAt,
      summary: {
        provinceCode: pull.provinceCode,
        provinceTh,
        cellCount: pull.matched,
        tambonCount: tambons.size,
        floodAreaM2: Math.round(areaM2),
        observedAt,
        retrievedAt: nowIso,
      },
    };
  }

  /** ส่วนท้ายของคำตอบ — ขึ้นต้นด้วย TAIL_MARKER เสมอ */
  private tail(retrievedAt: string, observedAt: string | null, publishedAt: string | null): string {
    return `${TAIL_MARKER}${JSON.stringify(retrievedAt)},"layer":${JSON.stringify(this.layer(retrievedAt, observedAt, publishedAt))}}`;
  }

  private layer(retrievedAt: string | null, observedAt: string | null = null, publishedAt: string | null = null): HazardLayerDescriptor {
    return {
      id: "gistda-flood-extent",
      epistemicClass: "observed",
      liveOrStatic: "live",
      // เวลาบันทึกภาพใหม่สุดจาก file_name (อ่านเป็น +07:00) — ไม่มีภาพ = ไม่ใส่ ห้ามเดา
      ...(observedAt ? { observedAt } : {}),
      // `_createdAt` ใหม่สุดของต้นทาง = เวลาที่ GISTDA สร้างระเบียนนั้นจริง ไม่ใช่เวลาที่เราดึง
      publishedAt,
      fetchedAt: retrievedAt,
      staleAfterSeconds: STALE_AFTER_MS / 1000,
      methodologyUrl: GISTDA_METHODOLOGY_URL,
      sourceIds: ["gistda-flood"],
    };
  }

  /** คำตอบว่างสำหรับ "ยังไม่เคยดึงสำเร็จ" / "ไม่มีฉากที่เก็บไว้" — ห้ามอ่านเป็น "ไม่มีน้ำท่วม" */
  private async emptyBody(provinceCode: string, reason?: "no-archived-scene"): Promise<FloodBody> {
    const body: FloodExtentResponse = {
      layer: this.layer(null),
      retrievedAt: null,
      provinceCode,
      granularity: "h3-cell",
      matched: null,
      acquisitions: [],
      observedAt: null,
      features: [],
      ...(reason ? { reason } : {}),
    };
    return { gz: await gzip(JSON.stringify(body)), retrievedAt: null };
  }

  /**
   * คำตอบของหนึ่งจังหวัดเป็น gzip ที่ประกอบไว้แล้ว. `atMs` null → รอบล่าสุด (live):
   * จากหน่วยความจำ ถ้าถูก evict จาก R2 (meta 1 แถว + PK 1 แถว + get 1 ครั้ง แล้วเก็บในหน่วยความจำ)
   * `atMs` → คำตอบที่ครอบเวลานั้น (ใหม่: PK ต่อจังหวัด, เก่า: ฉาก WFS) — ไม่แตะต้นทางเลย
   */
  async getProvinceBody(provinceCode: string, atMs: number | null = null): Promise<FloodBody> {
    if (atMs !== null && Number.isFinite(atMs)) return this.getProvinceAt(provinceCode, atMs);
    const live = this.live.get(provinceCode);
    if (live) return { gz: live.gz, retrievedAt: new Date(live.retrievedMs).toISOString() };
    return this.restoreLive(provinceCode);
  }

  /**
   * DO ถูก evict (deploy/ย้ายเครื่อง): ไฟล์ R2 ล่าสุดของจังหวัดมีเนื้อหาเดียวกับรอบที่สำเร็จ
   * ล่าสุด **ก็ต่อเมื่อ** hash ตรงกับ provinceState — ถ้าตรง ต่อท้ายด้วย retrievedAt ของรอบนั้น
   * ถ้าไม่ตรง (archive รอบหลังล้ม) เสิร์ฟไฟล์ตามที่เป็นพร้อม retrievedAt เก่าของมันเอง
   */
  private async restoreLive(provinceCode: string): Promise<FloodBody> {
    const row = this.provinceSceneAtOrBefore(provinceCode, Number.MAX_SAFE_INTEGER);
    if (!row) return this.emptyBody(provinceCode);
    const obj = await this.env.HAZARD_BUCKET.get(row.r2_key);
    if (!obj) return this.emptyBody(provinceCode);
    let gz = await bytesOf(obj);
    let retrievedMs = row.retrieved_ms;
    const state = this.provinceState()[provinceCode];
    if (state && state.hash === row.content_hash && Date.parse(state.summary.retrievedAt) > row.retrieved_ms) {
      const text = await gunzip(new Response(gz).body!);
      const cut = text.lastIndexOf(TAIL_MARKER);
      if (cut > 0) {
        gz = await gzip(text.slice(0, cut) + this.tail(state.summary.retrievedAt, state.summary.observedAt, state.publishedAt));
        retrievedMs = Date.parse(state.summary.retrievedAt);
      }
    }
    this.live.set(provinceCode, { gz, retrievedMs, hash: row.content_hash, firstSeen: null });
    return { gz, retrievedAt: new Date(retrievedMs).toISOString() };
  }

  private async getProvinceAt(provinceCode: string, atMs: number): Promise<FloodBody> {
    const row = this.provinceSceneAtOrBefore(provinceCode, atMs);
    if (row) {
      const hit = await this.cachedR2(row.r2_key, async () => {
        const obj = await this.env.HAZARD_BUCKET.get(row.r2_key);
        return obj ? { gz: await bytesOf(obj), retrievedAt: new Date(row.retrieved_ms).toISOString() } : null;
      });
      // แถวมีแต่ไฟล์ไม่มี = put ตอนนั้นล้ม — ไม่มีคำตอบให้ดูจริง ๆ
      return hit ?? this.emptyBody(provinceCode, "no-archived-scene");
    }
    // ก่อนรอบแรกของ API ใหม่: ฉาก WFS เดิม (retrievedAt เก่าของมันเองทำให้ช่องว่างมองเห็นได้)
    const legacy = this.legacySceneAtOrBefore(atMs);
    if (!legacy) return this.emptyBody(provinceCode, "no-archived-scene");
    const hit = await this.cachedR2(`${legacy.r2_key}#${provinceCode}`, async () => {
      const scene = await getJsonGz<LegacyArchivedScene>(this.env.HAZARD_BUCKET, legacy.r2_key);
      return scene ? { gz: await gzip(JSON.stringify(this.fromLegacy(scene, provinceCode))), retrievedAt: scene.retrievedAt } : null;
    });
    return hit ?? this.emptyBody(provinceCode, "no-archived-scene");
  }

  /** ฉาก WFS → รูปใหม่: ไม่มี h3/ภาพ/firstSeen (archive เดิมไม่ได้บันทึก) — null ไม่ใช่ค่าที่แต่งขึ้น */
  private fromLegacy(scene: LegacyArchivedScene, provinceCode: string): FloodExtentResponse {
    const features: FloodExtentFeature[] = scene.features
      .filter((f) => f.properties.provinceCode === provinceCode)
      .map((f) => ({
        type: "Feature",
        id: f.id,
        properties: {
          h3: null,
          provinceCode: f.properties.provinceCode ?? null,
          provinceTh: f.properties.provinceTh ?? null,
          amphoeCode: null,
          amphoeTh: f.properties.amphoeTh ?? null,
          tambonCode: null,
          tambonTh: f.properties.tambonTh ?? null,
          floodAreaM2: typeof f.properties.floodAreaRai === "number" ? f.properties.floodAreaRai * 1600 : null,
          acquisitions: [],
          observedAt: null,
          publishedAt: null,
          firstSeenAt: null,
        },
        geometry: f.geometry,
      }));
    return {
      layer: this.layer(scene.retrievedAt),
      retrievedAt: scene.retrievedAt,
      provinceCode,
      granularity: "tambon",
      matched: null,
      acquisitions: [],
      observedAt: null,
      features,
    };
  }

  /** อ่านจาก R2 ครั้งเดียวต่อคีย์ต่อชั่วโมง (ดู SCENE_CACHE_*) */
  private async cachedR2(
    cacheKey: string,
    load: () => Promise<{ gz: ArrayBuffer; retrievedAt: string } | null>,
  ): Promise<FloodBody | null> {
    const now = Date.now();
    const hit = this.sceneCache.get(cacheKey);
    if (hit && hit.expiresMs > now) return { gz: hit.gz, retrievedAt: hit.retrievedAt };
    if (hit) {
      this.sceneCache.delete(cacheKey);
      this.sceneCacheBytes -= hit.gz.byteLength;
    }
    const loaded = await load();
    if (!loaded) return null;
    while (
      this.sceneCache.size > 0 &&
      (this.sceneCache.size >= SCENE_CACHE_MAX_ENTRIES || this.sceneCacheBytes + loaded.gz.byteLength > SCENE_CACHE_MAX_BYTES)
    ) {
      const [oldestKey, oldest] = this.sceneCache.entries().next().value as [string, { gz: ArrayBuffer }];
      this.sceneCache.delete(oldestKey);
      this.sceneCacheBytes -= oldest.gz.byteLength;
    }
    this.sceneCache.set(cacheKey, { expiresMs: now + SCENE_CACHE_TTL_MS, ...loaded });
    this.sceneCacheBytes += loaded.gz.byteLength;
    return loaded;
  }

  /** สรุปรายจังหวัด — meta แถวเดียวที่ serialise ไว้ตอน refresh (devops constraint 4) */
  async getSummaryBody(): Promise<{ body: string; retrievedAt: string | null }> {
    const body = this.readMeta("summaryBody");
    if (body) return { body, retrievedAt: this.readMeta("retrievedAt") };
    const empty: FloodExtentSummaryResponse = {
      layer: this.layer(null),
      retrievedAt: null,
      window: GISTDA_FLOOD_WINDOW,
      totalFeatures: 0,
      provinces: [],
      failedProvinces: [],
    };
    return { body: JSON.stringify(empty), retrievedAt: null };
  }

  /** เรียกต่อการคำนวณ /health — อ่าน meta เท่านั้น ไม่นับเซลล์ (devops constraint 4) */
  async status(): Promise<SourceStatus> {
    const retrievedAt = this.readMeta("retrievedAt");
    const lastError = this.readMeta("lastError");
    const latestObservedAt = this.readMeta("latestObservedAt");
    const health = deriveSourceHealth({
      nowMs: Date.now(),
      fetchedAt: retrievedAt,
      lastError,
      latestObservedAt,
      staleAfterSeconds: STALE_AFTER_MS / 1000,
      // ดาวเทียมผ่านซ้ำไม่เป็นคาบ (Sentinel-1/RADARSAT-2 ต่างวงโคจร) — ไม่มีคาบตรวจวัดที่
      // คาดหมายได้ให้เทียบ ตัดสิน `delayed` ไม่ได้ ห้ามเดาเป็นตัวเลขใด ๆ
      observedLagSeconds: null,
    });
    /**
     * นัดลองใหม่ต้องอ่านจาก alarm จริง แต่ alarm อาจถูกตั้งไว้ "เร็วกว่า" กำแพง backoff
     * (nextAttemptAt) ได้ — เวลาที่จะมีการ "พยายามดึงจริง" คือค่าที่ช้ากว่าของสองตัว
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
      latestObservedAt,
      lastAttemptAt: this.readMeta("lastAttemptAt"),
      lastError,
      detail: {
        features: Number(this.readMeta("featureCount") ?? "0"),
        provincesFailed: Number(this.readMeta("provincesFailed") ?? "0"),
        window: GISTDA_FLOOD_WINDOW,
        consecutiveFailures: this.failureCount(),
      },
      staleAfterSeconds: STALE_AFTER_MS / 1000,
      observedLagSeconds: null,
      nextAttemptAt: attemptAtMs === null ? null : new Date(attemptAtMs).toISOString(),
    };
  }
}
