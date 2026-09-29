import { DurableObject } from "cloudflare:workers";
import {
  SOURCES,
  type HazardLayerDescriptor,
  type RiverForecastResponse,
  type RiverForecastStation,
  type SourceStatus,
} from "@siahra/shared-types";
import { shortReason } from "../ingestion/errors.js";
import {
  HII_STATIONS,
  METADATA_FILES,
  fetchMetadataFile,
  fetchStationFile,
  metadataNameFor,
  type HiiStationDef,
  type MetadataName,
  type Validators,
} from "../ingestion/hiiFews.js";
import { META_TABLE_DDL, readMeta, writeMeta } from "./metaKv.js";
import { deriveSourceHealth } from "../sourceHealth.js";
import { errorText, logError, logInfo } from "../log.js";

/**
 * พยากรณ์ปริมาณน้ำท่า/ระดับน้ำของ FEWS (สสน.) — หนึ่ง instance ชื่อ `"primary"`
 * (ไฟล์ข้อความ 6 ไฟล์ + metadata 2 ไฟล์วันละครั้ง; ดู `ingestion/hiiFews.ts`)
 *
 * โครงเดียวกับ `StormTrackDO` ด้วยเหตุผลเดียวกัน (บิล 2026-08-18..23, devops go-with-constraints):
 *
 * 1. **แถวเดียว** `latest(id = 'all')` เก็บ `RiverForecastResponse` ที่แปลงแล้ว (อาเรย์กะทัดรัด)
 *    — เส้นทางต่อคำขอคือ `SELECT body FROM latest WHERE id = ?` คำสั่งเดียว ไม่อ่าน meta ไม่ดึงต้นทาง
 *    เขียนทับทุกรอบ (รวม 304 / body เหมือนเดิม: การยืนยันกับต้นทางสำเร็จ = `fetchedAt` ต้องขยับ)
 * 2. **ไม่มีตารางประวัติ ไม่มี DELETE/COUNT/MAX/ORDER BY** — ไม่มีอะไรให้สแกน
 * 3. **`status()` อ่าน meta ด้วย PK คีย์เดียว** ไม่ parse body ไม่ดึงต้นทาง
 * 4. **ดึงต้นทางใน `refresh()` เท่านั้น** ซึ่งถูกเรียกจาก `alarm()` / `ensureFresh()` (cron ทุกนาที)
 *    — `getForecast()`/`status()` ไม่ปลุกการดึงเด็ดขาด
 * 5. **หนึ่งรอบต่อชั่วโมง** (ไฟล์ต้นทางเปลี่ยนไม่ถี่กว่านี้): ทุกไฟล์ถามแบบมีเงื่อนไข (ETag /
 *    If-Modified-Since) รอบที่พังทั้งรอบลองใหม่ใน 5 นาที แล้วถอยหลังเป็น 10/20/40/60 นาที
 *
 * meta สามคีย์ (ทุกตัวอ่านด้วย PK): `lastAttemptAt` (ตัวกั้นของ cron — คีย์เล็กอ่านถูกที่สุด),
 * `state` (validator ต่อไฟล์ + สถานะ metadata + ตัวนับรอบพัง), `src:hii-fews` (สถานะที่ `status()` ใช้)
 */

const REFRESH_MS = 60 * 60 * 1000;
/** รอบที่ไม่มีไฟล์พยากรณ์ไหนสำเร็จเลยลองใหม่ใน 5 นาทีก่อน แล้วถอยหลังจนถึงรอบปกติ */
const RETRY_MS = 5 * 60 * 1000;
/** cron ตั้ง alarm ใหม่เมื่อหาย — ไม่ให้ยิงทันทีในวินาทีเดียวกัน */
const MIN_ARM_MS = 5_000;
/** ไม่มีรอบสำเร็จ 3 รอบติด = `stale` */
const STALE_AFTER_SECONDS = 3 * 3600;
/** metadata (เกณฑ์/ชื่อ/จังหวัด) เปลี่ยนนาน ๆ ครั้ง — วันละครั้งพอ */
const METADATA_REFRESH_MS = 24 * 60 * 60 * 1000;
const LATEST_ID = "all";
const LAST_ERROR_MAX = 300;
const SOURCE_ID = "hii-fews" as const;
const MODEL_NAME = "HII FEWS model output (model not named by the publisher)";

interface LatestRow extends Record<string, SqlStorageValue> {
  body: string;
}

/** สถานะต้นทาง — เก็บใต้ `src:hii-fews` ให้ `status()` ไม่ต้อง parse body */
interface SourceMeta {
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  stationsOk: number;
  /** `Last-Modified` ที่เก่าที่สุดของไฟล์ที่ถืออยู่ — อ่านความนิ่งของต้นทางได้ (ต้นทางหยุดอัปเดต ≠ เราดึงไม่ได้) */
  oldestPublishedAt: string | null;
}

const EMPTY_SOURCE: SourceMeta = {
  lastSuccessAt: null,
  lastAttemptAt: null,
  lastError: null,
  stationsOk: 0,
  oldestPublishedAt: null,
};

/** validator ต่อไฟล์ + สถานะ metadata — คีย์ `state` ก้อนเดียว */
interface HiiState {
  /** key = รหัส HII ของสถานี */
  files: Record<string, Validators>;
  metadata: Partial<Record<MetadataName, Validators>>;
  /** ยืนยัน/ดึง metadata สำเร็จล่าสุด (ทั้งสองไฟล์) */
  metadataFetchedAt: string | null;
  metadataAttemptedAt: string | null;
  metadataError: string | null;
  /** จำนวนรอบพังทั้งรอบติดกัน (ไว้ถอยหลัง) */
  failures: number;
}

const EMPTY_STATE: HiiState = {
  files: {},
  metadata: {},
  metadataFetchedAt: null,
  metadataAttemptedAt: null,
  metadataError: null,
  failures: 0,
};

const cap = (s: string) => (s.length <= LAST_ERROR_MAX ? s : `${s.slice(0, LAST_ERROR_MAX - 1)}…`);

/** เวลาที่เก่ากว่า (ไม่อ้างความสดเกินจริง) — null เฉพาะเมื่อทั้งสองเป็น null */
function olderOf(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

function emptyStation(d: HiiStationDef): RiverForecastStation {
  return {
    code: d.code,
    hiiCode: d.hiiCode,
    kind: d.kind,
    unit: d.unit,
    nameTh: null,
    province: null,
    thresholds: null,
    series: [],
    publishedAt: null,
    fetchedAt: null,
    lastError: null,
  };
}

/**
 * descriptor ของคำตอบ — คิดจากสถานีในบอดี้เท่านั้น
 *
 * - `forecast` (ผลของแบบจำลองเชิงกำหนดของบุคคลที่สาม): ผู้เผยแพร่ไม่ระบุชื่อแบบจำลอง จึงบอกตรง ๆ ใน
 *   `modelName`; ไม่บอกความละเอียดกริด (`null`) และไม่บอกรอบรัน (`issuedAt` **null เสมอ** —
 *   `Last-Modified` คือเวลาเขียนไฟล์ ซึ่งอยู่ใน `publishedAt` ไม่ใช่รอบรัน และห้ามเติมจาก fetchedAt)
 * - `publishedAt` = `Last-Modified` ที่เก่าที่สุดของไฟล์ที่ถือชุดค่าอยู่ (ไม่อ้างความสดเกินจริง)
 * - `horizonHours` = จุดสุดท้ายของชุดลบ `publishedAt` ของ **ไฟล์เดียวกัน** เอาค่าน้อยสุดในบรรดาสถานี
 *   (ทุกสถานีไปถึงอย่างน้อยเท่านี้) — ไม่มีสถานีที่คำนวณได้ = null ไม่ใช่ 0
 * - `fetchedAt` = รอบล่าสุดที่มีไฟล์สำเร็จอย่างน้อยหนึ่งไฟล์; ความสดรายไฟล์อยู่ที่ `stations[].fetchedAt`
 */
function layerFor(stations: readonly RiverForecastStation[], lastSuccessAt: string | null): HazardLayerDescriptor {
  let publishedAt: string | null = null;
  let horizon: number | null = null;
  for (const s of stations) {
    if (s.series.length === 0) continue;
    publishedAt = olderOf(publishedAt, s.publishedAt);
    const pub = s.publishedAt === null ? NaN : Date.parse(s.publishedAt);
    const lastT = s.series[s.series.length - 1]![0];
    if (Number.isFinite(pub) && lastT > pub) {
      const h = Math.round((lastT - pub) / 3_600_000);
      horizon = horizon === null ? h : Math.min(horizon, h);
    }
  }
  return {
    id: "river-forecast-hii-fews",
    epistemicClass: "forecast",
    liveOrStatic: "live",
    publishedAt,
    fetchedAt: lastSuccessAt,
    staleAfterSeconds: STALE_AFTER_SECONDS,
    sourceIds: [SOURCE_ID],
    forecast: {
      modelName: MODEL_NAME,
      resolutionKm: null,
      horizonHours: horizon,
      issuedAt: null,
    },
  };
}

/** คำตอบตอนยังไม่เคยมีรอบใดเลย — ทุกเวลาเป็น null ไม่ใช่ "ตอนนี้" */
function coldResponse(lastError: string | null = null): RiverForecastResponse {
  const stations = HII_STATIONS.map(emptyStation);
  return {
    layer: layerFor(stations, null),
    stations,
    source: { id: SOURCE_ID, lastSuccessAt: null, lastAttemptAt: null, lastError },
    thresholdsFetchedAt: null,
    thresholdsLastError: null,
  };
}

/** บอดี้ที่เก็บไว้ต้องรูปร่างถูกพอจะใช้เป็น "ชุดเดิม" ต่อ — ไม่งั้นถือว่าไม่มี */
function isStationShape(v: unknown): v is RiverForecastStation {
  const s = v as Partial<RiverForecastStation> | null;
  return !!s && typeof s.hiiCode === "string" && Array.isArray(s.series);
}

export class HiiForecastDO extends DurableObject<Env> {
  private inflight: Promise<number> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS latest (id TEXT PRIMARY KEY, body TEXT NOT NULL);
        ${META_TABLE_DDL}
      `);
    });
  }

  private get sql(): SqlStorage {
    return this.ctx.storage.sql;
  }

  /**
   * ปลายทางของ alarm: รอบเสร็จแล้วตั้งนัดถัดไปตรงตามผลรอบ (ทับนัดที่ cron อาจตั้งไว้ระหว่างรอบวิ่ง)
   * รอบที่ **โยนข้อยกเว้น** (SQL พัง — การดึงต้นทางถูก allSettled ไว้แล้ว) ก็ยังต้องนัดต่อ
   */
  async alarm(): Promise<void> {
    const delay = await this.refreshOnce();
    await this.ctx.storage.setAlarm(Date.now() + delay);
  }

  /**
   * เรียกจาก cron ทุกนาที — **ห้ามชนกับ alarm** (StormTrackDO ปล่อยให้ cron ชนะแล้ว alarm ยิงซ้ำ):
   *
   * - รอบกำลังวิ่งอยู่ในอินสแตนซ์นี้ → ไม่ทำอะไร
   * - ไม่เคยลองเลย หรือลองล่าสุดเก่ากว่า 2 × REFRESH_MS (สายโซ่ alarm หายไป) → เริ่มรอบเอง
   *   แล้วนัดต่อ
   * - มี alarm นัดในอนาคตอยู่แล้ว → ไม่ทำอะไร (alarm เป็นเจ้าของรอบ)
   * - ไม่มีนัดแต่ลองมาไม่ถึง 2 ชั่วโมง → แค่ตั้งนัดคืนตามจังหวะเดิม (ไม่ยิงต้นทางจาก cron)
   *
   * ต้นทุนต่อนาที: `getAlarm()` + อ่าน meta `lastAttemptAt` ด้วย PK (แถวเดียว) ไม่มีการเขียน
   */
  async ensureFresh(): Promise<void> {
    if (this.inflight) return;
    const now = Date.now();
    const attempted = Date.parse(readMeta(this.sql, "lastAttemptAt") ?? "");
    if (!Number.isFinite(attempted) || now - attempted > 2 * REFRESH_MS) {
      const delay = await this.refreshOnce();
      await this.ctx.storage.setAlarm(Date.now() + delay);
      return;
    }
    const alarmAt = await this.ctx.storage.getAlarm();
    if (alarmAt !== null && alarmAt > now) return;
    await this.ctx.storage.setAlarm(now + Math.max(attempted + REFRESH_MS - now, MIN_ARM_MS));
  }

  /** คืนระยะรอถึงรอบถัดไป (ms) — ไม่โยน */
  private refreshOnce(): Promise<number> {
    if (!this.inflight) {
      this.inflight = this.refresh()
        .catch((err: unknown) => {
          logError("hii-forecast refresh threw", { error: errorText(err, 200) });
          return RETRY_MS;
        })
        .finally(() => {
          this.inflight = null;
        });
    }
    return this.inflight;
  }

  private readState(): HiiState {
    const raw = readMeta(this.sql, "state");
    if (!raw) return { ...EMPTY_STATE, files: {}, metadata: {} };
    try {
      const m = JSON.parse(raw) as Partial<HiiState>;
      return {
        files: m.files && typeof m.files === "object" ? m.files : {},
        metadata: m.metadata && typeof m.metadata === "object" ? m.metadata : {},
        metadataFetchedAt: typeof m.metadataFetchedAt === "string" ? m.metadataFetchedAt : null,
        metadataAttemptedAt: typeof m.metadataAttemptedAt === "string" ? m.metadataAttemptedAt : null,
        metadataError: typeof m.metadataError === "string" ? m.metadataError : null,
        failures: typeof m.failures === "number" ? m.failures : 0,
      };
    } catch {
      // validator หายไม่ทำให้พัง — รอบนี้แค่ยิงแบบไม่มีเงื่อนไข (ได้ 200 เต็ม)
      return { ...EMPTY_STATE, files: {}, metadata: {} };
    }
  }

  private readSourceMeta(): SourceMeta {
    const raw = readMeta(this.sql, `src:${SOURCE_ID}`);
    if (!raw) return { ...EMPTY_SOURCE };
    try {
      const m = JSON.parse(raw) as Partial<SourceMeta>;
      return {
        lastSuccessAt: typeof m.lastSuccessAt === "string" ? m.lastSuccessAt : null,
        lastAttemptAt: typeof m.lastAttemptAt === "string" ? m.lastAttemptAt : null,
        lastError: typeof m.lastError === "string" ? m.lastError : null,
        stationsOk: typeof m.stationsOk === "number" ? m.stationsOk : 0,
        oldestPublishedAt: typeof m.oldestPublishedAt === "string" ? m.oldestPublishedAt : null,
      };
    } catch {
      return { ...EMPTY_SOURCE, lastError: `meta src:${SOURCE_ID} unreadable` };
    }
  }

  /** บอดี้ที่เก็บไว้ — `null` = ยังไม่มีแถว หรืออ่านไม่ออก (ผู้เรียกตัดสินเองว่าจะรายงานอย่างไร) */
  private readLatest(): { body: RiverForecastResponse | null; unreadable: boolean } {
    const row = this.sql.exec<LatestRow>("SELECT body FROM latest WHERE id = ?", LATEST_ID).toArray()[0];
    if (!row) return { body: null, unreadable: false };
    try {
      const body = JSON.parse(row.body) as RiverForecastResponse;
      if (!body || !Array.isArray(body.stations)) return { body: null, unreadable: true };
      return { body, unreadable: false };
    } catch {
      return { body: null, unreadable: true };
    }
  }

  /**
   * หนึ่งรอบ — ไฟล์พยากรณ์ 6 ไฟล์ขนานกัน (`allSettled`, ต่อไฟล์ ≤ 10 วิ) แล้ว metadata ≤ 2 ไฟล์
   * (เมื่อครบ 24 ชม. และมีไฟล์พยากรณ์ตอบอย่างน้อยหนึ่งไฟล์) → ทั้งรอบ ≤ 20 วิ ต่ำกว่างบ 70 วิ
   *
   * ต่อไฟล์:
   * - **200 แปลงได้** → ชุดใหม่ + `Last-Modified` ใหม่ + validator ใหม่
   * - **304** → ชุดเดิม + `publishedAt` เดิม (304 ไม่ส่ง Last-Modified ซ้ำ) แต่ `fetchedAt` ขยับ:
   *   ยืนยันกับต้นทางแล้วว่ายังตรง
   * - **พัง/ผิดรูป** → ชุดเดิมอยู่ครบพร้อม `fetchedAt` เก่าของมัน, `lastError` บอกสาเหตุ,
   *   validator เดิมไม่ขยับ (ไม่งั้นรอบหน้า 304 จะตรึงไฟล์เสียไว้) — ไม่มีวันปล่อยให้ชุดว่าง
   * - แนบ validator เฉพาะไฟล์ที่เรา **ถือชุดค่าอยู่จริง** (ไม่งั้น 304 แล้วไม่มีอะไรให้เก็บ)
   *
   * ไม่มี log ในลูปใด — หนึ่งบรรทัดต่อรอบท้ายฟังก์ชัน
   */
  private async refresh(): Promise<number> {
    const nowMs = Date.now();
    const roundAt = new Date(nowMs).toISOString();
    writeMeta(this.sql, "lastAttemptAt", roundAt);

    const previous = this.readLatest().body;
    const prevByCode = new Map<string, RiverForecastStation>();
    for (const s of previous?.stations ?? []) if (isStationShape(s)) prevByCode.set(s.hiiCode, s);
    const state = this.readState();
    const sourceBefore = this.readSourceMeta();

    const results = await Promise.allSettled(
      HII_STATIONS.map((d) => {
        const held = prevByCode.get(d.hiiCode);
        return fetchStationFile(d, held && held.series.length > 0 ? (state.files[d.hiiCode] ?? null) : null);
      }),
    );
    const anyOk = results.some((r) => r.status === "fulfilled");

    // metadata: ครบ 24 ชม. (หรือยังไม่เคยได้) และต้นทางตอบอยู่ — ล้มเหลวไม่ทำให้รอบพยากรณ์ล้ม
    // และไม่ถี่กว่ารอบ (≥ 5 นาทีเสมอ): ลองอีกทีในรอบถัดไปเท่านั้น
    const metaAge = state.metadataFetchedAt === null ? Infinity : nowMs - Date.parse(state.metadataFetchedAt);
    const metaDue = anyOk && !(metaAge < METADATA_REFRESH_MS);
    const metaResults = metaDue
      ? await Promise.allSettled(
          // validator แนบเฉพาะเมื่อมีบอดี้เดิมให้เก็บเกณฑ์ไว้ — บอดี้หาย/อ่านไม่ออกแล้ว 304 จะไม่มีอะไรมาเติมชื่อ/เกณฑ์
          // และ `metadataFetchedAt` จะขยับทั้งที่ทุกสถานียัง null (ค้างเงียบ ๆ จนไฟล์ต้นทางเปลี่ยน)
          METADATA_FILES.map((name) => fetchMetadataFile(name, previous !== null ? (state.metadata[name] ?? null) : null)),
        )
      : [];

    // ── ประกอบสถานี ──
    let updated = 0;
    let verified = 0;
    let failed = 0;
    const stations = HII_STATIONS.map((d, i): RiverForecastStation => {
      const base = prevByCode.get(d.hiiCode) ?? emptyStation(d);
      const r = results[i]!;
      if (r.status === "rejected") {
        failed++;
        return { ...base, lastError: cap(`${d.hiiCode}: ${shortReason(r.reason)}`) };
      }
      if (r.value.kind === "verified") {
        verified++;
        return { ...base, fetchedAt: roundAt, lastError: null };
      }
      updated++;
      state.files[d.hiiCode] = r.value.validators;
      return {
        ...base,
        series: r.value.series,
        publishedAt: r.value.publishedAt,
        fetchedAt: roundAt,
        lastError: r.value.skipped > 0 ? `${d.hiiCode}: ${r.value.skipped} unreadable row(s) skipped` : null,
      };
    });

    // ── metadata ──
    let metadataOutcome: "skipped" | "ok" | "failed" = "skipped";
    if (metaDue) {
      const errors: string[] = [];
      METADATA_FILES.forEach((name, i) => {
        const r = metaResults[i]!;
        if (r.status === "rejected") {
          errors.push(cap(`${name}: ${shortReason(r.reason)}`));
          return;
        }
        if (r.value.kind === "updated") {
          state.metadata[name] = r.value.validators;
          for (const st of stations) {
            if (metadataNameFor(st.kind) !== name) continue;
            const m = r.value.byCode.get(st.hiiCode);
            st.nameTh = m?.nameTh ?? null;
            st.province = m?.province ?? null;
            st.thresholds = m?.thresholds ?? null;
          }
        }
      });
      state.metadataAttemptedAt = roundAt;
      state.metadataError = errors.length === 0 ? null : cap(errors.join(" | "));
      if (errors.length === 0) state.metadataFetchedAt = roundAt;
      metadataOutcome = errors.length === 0 ? "ok" : "failed";
    }

    // ── สถานะต้นทาง + บอดี้ ──
    const lastSuccessAt = anyOk ? roundAt : sourceBefore.lastSuccessAt;
    const errors = stations.map((s) => s.lastError).filter((e): e is string => e !== null);
    const lastError = errors.length === 0 ? null : cap(errors.join(" | "));
    let oldestPublishedAt: string | null = null;
    for (const s of stations) if (s.series.length > 0) oldestPublishedAt = olderOf(oldestPublishedAt, s.publishedAt);
    const sourceMeta: SourceMeta = {
      lastSuccessAt,
      lastAttemptAt: roundAt,
      lastError,
      stationsOk: stations.filter((s) => s.fetchedAt === roundAt && s.lastError === null).length,
      oldestPublishedAt,
    };
    state.failures = anyOk ? 0 : state.failures + 1;

    const body: RiverForecastResponse = {
      layer: layerFor(stations, lastSuccessAt),
      stations,
      source: { id: SOURCE_ID, lastSuccessAt, lastAttemptAt: roundAt, lastError },
      thresholdsFetchedAt: state.metadataFetchedAt,
      thresholdsLastError: state.metadataError,
    };
    // เขียนแถวเดียวรอบละครั้ง — ไม่เคยเขียนต่อสถานี/ต่อไฟล์ ไม่ข้ามเมื่อเนื้อหาเหมือนเดิม (fetchedAt ต้องจริง)
    this.sql.exec(
      "INSERT INTO latest (id, body) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body",
      LATEST_ID,
      JSON.stringify(body),
    );
    writeMeta(this.sql, "state", JSON.stringify(state));
    writeMeta(this.sql, `src:${SOURCE_ID}`, JSON.stringify(sourceMeta));

    logInfo("hii-forecast refreshed", {
      updated,
      verified,
      failed,
      metadata: metadataOutcome,
      ...(lastError !== null ? { error: lastError.slice(0, 120) } : {}),
    });
    return anyOk ? REFRESH_MS : Math.min(RETRY_MS * 2 ** (state.failures - 1), REFRESH_MS);
  }

  /**
   * `GET /api/v1/rivers/forecast` — **SQL คำสั่งเดียว** (PK lookup ของแถวเดียว) ไม่อ่าน meta
   * ไม่ดึงต้นทาง ยังไม่มีแถว = คำตอบ "ยังไม่เคยดึง" (ทุกเวลาเป็น null, ชุดค่าว่าง)
   */
  async getForecast(): Promise<RiverForecastResponse> {
    const { body, unreadable } = this.readLatest();
    if (body) return body;
    // แถวพังต้องไม่ถูกรายงานเป็น "ยังไม่เคยดึง" เงียบ ๆ
    return coldResponse(unreadable ? "stored forecast body unreadable — will be rewritten next round" : null);
  }

  /**
   * หนึ่งแถวสถานะ — อ่าน meta คีย์เดียวด้วย PK ไม่ parse body ไม่นับแถว
   * `latestObservedAt: null` (ไม่มีค่าตรวจวัดในมือ — จุดของชุดพยากรณ์เป็นอนาคตได้) และ
   * `observedLagSeconds: null` (ไม่มีคาบตรวจวัดให้ตัดสิน `delayed`)
   */
  async status(): Promise<SourceStatus> {
    const alarmAtMs = await this.ctx.storage.getAlarm();
    const m = this.readSourceMeta();
    return {
      id: SOURCE_ID,
      labelTh: SOURCES[SOURCE_ID].nameTh,
      labelEn: SOURCES[SOURCE_ID].nameEn,
      health: deriveSourceHealth({
        nowMs: Date.now(),
        fetchedAt: m.lastSuccessAt,
        lastError: m.lastError,
        latestObservedAt: null,
        staleAfterSeconds: STALE_AFTER_SECONDS,
        observedLagSeconds: null,
      }),
      fetchedAt: m.lastSuccessAt,
      latestObservedAt: null,
      lastAttemptAt: m.lastAttemptAt,
      lastError: m.lastError,
      detail: { stations: HII_STATIONS.length, stationsOk: m.stationsOk, oldestPublishedAt: m.oldestPublishedAt },
      staleAfterSeconds: STALE_AFTER_SECONDS,
      observedLagSeconds: null,
      nextAttemptAt: alarmAtMs === null ? null : new Date(alarmAtMs).toISOString(),
    };
  }
}
