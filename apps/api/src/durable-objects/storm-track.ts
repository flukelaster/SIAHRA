import { DurableObject } from "cloudflare:workers";
import {
  SOURCES,
  type HazardLayerDescriptor,
  type SourceStatus,
  type StormSourceId,
  type StormSourceState,
  type StormTrack,
  type StormsResponse,
} from "@siahra/shared-types";
import { shortReason } from "../ingestion/errors.js";
import { fetchGdacsRound } from "../ingestion/gdacsTc.js";
import { fetchJmaRound, type StormCore } from "../ingestion/jmaTyphoon.js";
import { nearestKmByProvince } from "../geo/stormDistance.js";
import { META_TABLE_DDL, readMeta, writeMeta } from "./metaKv.js";
import { deriveSourceHealth } from "../sourceHealth.js";
import { errorText, logInfo } from "../log.js";

/**
 * เส้นทางพายุหมุนเขตร้อน — หนึ่ง instance ชื่อ `"primary"` สองต้นทาง:
 * JMA (แปซิฟิกตะวันตก + ทะเลจีนใต้) และ GDACS (มหาสมุทรอินเดียเหนือเท่านั้น)
 *
 * โครงเดียวกับ `ForecastNwpDO` และด้วยเหตุผลเดียวกัน (บิล 2026-08-18..23):
 *
 * 1. **แถวเดียว** `latest(id = 'all')` เก็บ `StormsResponse` ทั้งก้อน — เส้นทางต่อคำขอ
 *    คือ `SELECT body FROM latest WHERE id = ?` คำสั่งเดียว ไม่อ่าน meta ไม่ดึงต้นทาง
 *    เพราะฉะนั้นสถานะของแต่ละต้นทาง (`sources`) ต้องอยู่ในบอดี้ด้วย และบอดี้จึง
 *    เปลี่ยนทุกรอบที่สำเร็จ (`lastSuccessAt` ขยับ) — เขียนทับรอบละครั้งเดียวเสมอ
 *    (≤ 48 แถว/วันในรอบปกติ) ไม่ทำ hash-skip: ความสดของ `fetchedAt` สำคัญกว่า
 * 2. **ไม่มีตารางประวัติ ไม่มี DELETE ตามอายุ** — ไม่มีอะไรให้สแกน
 * 3. **`status()` อ่าน meta ด้วย PK ล้วน** — สองคีย์ (`src:jma-typhoon`, `src:gdacs-tc`)
 *    แต่ละคีย์เป็น JSON ของต้นทางนั้น (จำนวนพายุคิดไว้แล้วตอน refresh)
 * 4. **ดึงต้นทางใน `refresh()` เท่านั้น** ซึ่งถูกเรียกจาก `alarm()`/`ensureFresh()`
 *    (cron) เท่านั้น — `getStorms()`/`status()` ไม่ปลุกการดึงเด็ดขาด
 *
 * **แยก meta ต่อต้นทาง**: GDACS ล่มต้องไม่ทำให้ JMA ดูล่ม และกลับกัน — ต้นทางที่พัง
 * คงพายุชุดเดิมของตัวเองไว้พร้อม `fetchedAt` เก่าของมัน ส่วนอีกต้นทางอัปเดตตามปกติ
 */

/** JMA ออกประกาศทุก 3–6 ชม. — 30 นาทีพอให้ทันโดยไม่รบกวนต้นทาง */
const REFRESH_MS = 30 * 60 * 1000;
/** รอบที่ **ทั้งสองต้นทาง** พังลองใหม่ใน 5 นาที (ต้นทางเดียวพัง = รอรอบปกติ 30 นาที) */
const RETRY_MS = 5 * 60 * 1000;
/** ไม่มีรอบสำเร็จ 3 ชม. = พลาดหกรอบติด ถือว่า `stale` */
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;
const LATEST_ID = "all";
const LAST_ERROR_MAX = 300;
const STORM_SOURCES: readonly StormSourceId[] = ["jma-typhoon", "gdacs-tc"];

interface LatestRow extends Record<string, SqlStorageValue> {
  body: string;
}

/** สถานะของหนึ่งต้นทาง เก็บเป็น JSON ใต้คีย์ `src:<id>` ของตาราง meta */
interface SourceMeta {
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  /** จำนวนพายุของต้นทางนี้ในบอดี้ล่าสุด — ให้ `status()` ไม่ต้องนับแถว */
  storms: number;
  /** เวลาตำแหน่งวิเคราะห์ใหม่สุดของต้นทางนี้ (null = ไม่มีพายุ/ไม่มีเวลา) */
  latestObservedAt: string | null;
}

const EMPTY_META: SourceMeta = { lastSuccessAt: null, lastAttemptAt: null, lastError: null, storms: 0, latestObservedAt: null };

const cap = (s: string) => (s.length <= LAST_ERROR_MAX ? s : `${s.slice(0, LAST_ERROR_MAX - 1)}…`);

/** เวลาที่เก่ากว่า (ไม่อ้างความสดเกินจริง) — null เฉพาะเมื่อทั้งสองเป็น null */
function olderOf(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

/**
 * descriptor สามชั้นของคำตอบ — คิดจากสถานะต้นทางและพายุที่อยู่ในบอดี้เท่านั้น
 *
 * - `track` = `forecast`: ประกาศเส้นทางของหน่วยงานที่สาม (JMA / JTWC ผ่าน GDACS) เป็นค่า
 *   เชิงกำหนด ไม่มีความน่าจะเป็น `forecast.issuedAt` = เวลาออกประกาศ **ที่ทุกพายุมีร่วมกัน**
 *   เท่านั้น ต่างกัน/มีลูกที่ไม่มี = null — ค่าจริงรายลูกอยู่ที่ `StormTrack.advisoryIssuedAt`
 *   (ห้ามเติมจาก fetchedAt และห้ามเอา `datemodified` ของ GDACS มาสวม)
 * - `circle` = `probabilistic` — **การใช้ชั้นนี้ครั้งแรกของโปรเจกต์**: รัศมีวงกลมคือข้อความ
 *   เชิงความน่าจะเป็นที่ JMA ประกาศเอง ("ศูนย์กลางพายุจะอยู่ในวงนี้ด้วยความน่าจะเป็น 70 %")
 *   เราไม่ได้คำนวณความน่าจะเป็นใด ๆ เลย แค่ส่งต่อรัศมีที่ JMA ให้มา ถ้าจัดเป็น `forecast`
 *   จะเป็นการลบความหมายเชิงความน่าจะเป็นที่ต้นทางตั้งใจสื่อทิ้ง
 * - `past` = `observed`: ตำแหน่งที่ต้นทางวิเคราะห์แล้ว (best-track/analysis)
 *
 * `fetchedAt` ของชั้นที่มาจากสองต้นทาง = เวลาที่ **เก่ากว่า** (ไม่ประกาศความสดเกินจริง)
 * สถานะแยกต่อต้นทางอยู่ใน `sources`
 */
function layersFor(storms: StormTrack[], jma: SourceMeta, gdacs: SourceMeta): StormsResponse["layers"] {
  const issued = storms.map((s) => s.advisoryIssuedAt);
  const commonIssuedAt =
    issued.length > 0 && issued.every((t) => t !== null && t === issued[0]) ? issued[0]! : null;
  // ระยะพยากรณ์ **นับจากที่ต้นทางส่งมาจริง**: ตำแหน่งวิเคราะห์ล่าสุด → ตำแหน่งพยากรณ์ไกลสุด
  // ไม่มีพายุ/ไม่มีจุดพยากรณ์ = 0 ชม. (ไม่มีอะไรถูกพยากรณ์ ไม่ใช่ค่าที่เราตั้ง)
  let horizonHours = 0;
  for (const s of storms) {
    const base = Date.parse(s.past[s.past.length - 1]?.observedAt ?? "");
    const end = Date.parse(s.forecast[s.forecast.length - 1]?.validAt ?? "");
    if (Number.isFinite(base) && Number.isFinite(end) && end > base) {
      horizonHours = Math.max(horizonHours, Math.round((end - base) / 3_600_000));
    }
  }
  const both = olderOf(jma.lastSuccessAt, gdacs.lastSuccessAt);
  const staleAfterSeconds = STALE_AFTER_MS / 1000;
  const track: HazardLayerDescriptor = {
    id: "storm-track-forecast",
    epistemicClass: "forecast",
    liveOrStatic: "live",
    // เวลาเผยแพร่รายประกาศอยู่ที่ `advisoryIssuedAt` ของแต่ละพายุ — ชั้นรวมสองต้นทาง
    // ไม่มีเวลาเผยแพร่เดียวที่จริงสำหรับทุกลูก
    publishedAt: null,
    fetchedAt: both,
    staleAfterSeconds,
    sourceIds: ["jma-typhoon", "gdacs-tc"],
    forecast: {
      modelName: "JMA (RSMC Tokyo) tropical cyclone advisory · JTWC warning via GDACS",
      // ประกาศของนักพยากรณ์ ไม่ใช่ผลแบบจำลองกริด — ไม่มีความละเอียดกริดให้อ้าง
      resolutionKm: null,
      horizonHours,
      issuedAt: commonIssuedAt,
    },
  };
  const circle: HazardLayerDescriptor = {
    id: "storm-jma-probability-circle",
    epistemicClass: "probabilistic",
    liveOrStatic: "live",
    publishedAt: null,
    fetchedAt: jma.lastSuccessAt,
    staleAfterSeconds,
    sourceIds: ["jma-typhoon"],
  };
  const past: HazardLayerDescriptor = {
    id: "storm-past-track",
    epistemicClass: "observed",
    liveOrStatic: "live",
    publishedAt: null,
    fetchedAt: both,
    staleAfterSeconds,
    sourceIds: ["jma-typhoon", "gdacs-tc"],
  };
  return { track, circle, past };
}

function sourceState(id: StormSourceId, m: SourceMeta): StormSourceState {
  return { id, lastSuccessAt: m.lastSuccessAt, lastAttemptAt: m.lastAttemptAt, lastError: m.lastError };
}

/** คำตอบตอนยังไม่เคยมีรอบใดเลย — ทุกเวลาเป็น null ไม่ใช่ "ตอนนี้" */
function coldResponse(lastError: string | null = null): StormsResponse {
  const meta = { ...EMPTY_META, lastError };
  return {
    storms: [],
    layers: layersFor([], meta, meta),
    sources: STORM_SOURCES.map((id) => sourceState(id, meta)),
  };
}

function newestObservedAt(storms: readonly StormTrack[]): string | null {
  let best: string | null = null;
  for (const s of storms) {
    for (const p of s.past) {
      if (p.observedAt && (best === null || Date.parse(p.observedAt) > Date.parse(best))) best = p.observedAt;
    }
  }
  return best;
}

export class StormTrackDO extends DurableObject<Env> {
  private inflight: Promise<boolean> | null = null;

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

  /** ตั้ง alarm เฉพาะเมื่อยังไม่มีนัดในอนาคต — ไม่เลื่อนนัดที่มีอยู่ */
  private async armAlarm(delay = REFRESH_MS): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing !== null && existing > Date.now()) return;
    await this.ctx.storage.setAlarm(Date.now() + delay);
  }

  async alarm(): Promise<void> {
    const anyOk = await this.refreshOnce();
    await this.armAlarm(anyOk ? REFRESH_MS : RETRY_MS);
  }

  /**
   * เรียกจาก cron ทุกนาที — ตัวกั้นเดียวกับ `ForecastNwpDO.ensureFresh()`:
   * รอบที่ไม่มีต้นทางไหนสำเร็จไม่เขียน `fetchedAt` ระดับรอบ ถ้าไม่กั้นด้วย
   * `lastAttemptAt` (เขียนตอนเริ่มทุกรอบ) cron จะยิงต้นทางใหม่ทุกนาที
   */
  async ensureFresh(): Promise<void> {
    const f = readMeta(this.sql, "fetchedAt");
    if (!f || Date.now() - Date.parse(f) > REFRESH_MS) {
      const attempted = Date.parse(readMeta(this.sql, "lastAttemptAt") ?? "");
      if (Number.isFinite(attempted) && Date.now() - attempted < RETRY_MS) {
        await this.armAlarm();
        return;
      }
      await this.refreshOnce();
    }
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

  private readSourceMeta(id: StormSourceId): SourceMeta {
    const raw = readMeta(this.sql, `src:${id}`);
    if (!raw) return { ...EMPTY_META };
    try {
      const m = JSON.parse(raw) as Partial<SourceMeta>;
      return {
        lastSuccessAt: typeof m.lastSuccessAt === "string" ? m.lastSuccessAt : null,
        lastAttemptAt: typeof m.lastAttemptAt === "string" ? m.lastAttemptAt : null,
        lastError: typeof m.lastError === "string" ? m.lastError : null,
        storms: typeof m.storms === "number" ? m.storms : 0,
        latestObservedAt: typeof m.latestObservedAt === "string" ? m.latestObservedAt : null,
      };
    } catch {
      return { ...EMPTY_META, lastError: `meta src:${id} unreadable` };
    }
  }

  /** บอดี้ที่เก็บไว้ — `null` = ยังไม่มีแถว หรืออ่านไม่ออก (ผู้เรียกตัดสินเองว่าจะรายงานอย่างไร) */
  private readLatest(): { body: StormsResponse | null; unreadable: boolean } {
    const row = this.sql.exec<LatestRow>("SELECT body FROM latest WHERE id = ?", LATEST_ID).toArray()[0];
    if (!row) return { body: null, unreadable: false };
    try {
      return { body: JSON.parse(row.body) as StormsResponse, unreadable: false };
    } catch {
      return { body: null, unreadable: true };
    }
  }

  /**
   * หนึ่งรอบ: JMA กับ GDACS ขนานกัน (`allSettled`) — ต้นทางหนึ่งพัง/ค้างไม่ขวางอีกต้นทาง
   *
   * ต่อต้นทาง:
   * - **รายการพัง / schema เปลี่ยน / ล่ม** → คงพายุชุดเดิมของต้นทางนั้นไว้ทั้งหมด (พร้อม
   *   `fetchedAt` เก่า) `lastSuccessAt` ไม่ขยับ `lastError` บอกสาเหตุ → /health เห็นว่าพัง
   * - **รายการได้ แต่บางลูกพัง** → ลูกที่ได้อัปเดต ลูกที่พังคงสำเนาเดิม (ถ้ามี) ต้นทางนับว่า
   *   ถามสำเร็จ แต่ `lastError` ไม่ว่าง → `degraded`
   * - **รายการว่าง** → ไม่มีพายุจริง (`storms` ของต้นทางนั้นว่าง, `lastSuccessAt` ขยับ)
   *
   * `nearestKmByProvince` คิดที่นี่ครั้งเดียวต่อพายุที่ได้ใหม่ในรอบนี้ ไม่มี log ในลูปใด —
   * หนึ่งบรรทัดต่อรอบท้ายฟังก์ชัน
   */
  private async refresh(): Promise<boolean> {
    const nowMs = Date.now();
    const roundAt = new Date(nowMs).toISOString();
    writeMeta(this.sql, "lastAttemptAt", roundAt);

    const previous = this.readLatest().body;
    const prevStorms = previous?.storms ?? [];
    const [jmaResult, gdacsResult] = await Promise.allSettled([fetchJmaRound(), fetchGdacsRound(nowMs)]);

    const merged: StormTrack[] = [];
    const metas = {} as Record<StormSourceId, SourceMeta>;
    const outcome: Record<string, string> = {};
    for (const [id, result] of [
      ["jma-typhoon", jmaResult],
      ["gdacs-tc", gdacsResult],
    ] as const) {
      const before = this.readSourceMeta(id);
      const mine = prevStorms.filter((s) => s.source === id);
      let storms: StormTrack[];
      let meta: SourceMeta;
      if (result.status === "rejected") {
        storms = mine;
        meta = { ...before, lastAttemptAt: roundAt, lastError: cap(`${id} round failed: ${shortReason(result.reason)}`) };
        outcome[id] = "failed";
      } else {
        const fresh = result.value.storms.map((core) => this.complete(core, roundAt));
        const retained = mine.filter((s) => result.value.failedIds.includes(s.id));
        storms = [...fresh, ...retained];
        meta = {
          ...before,
          lastSuccessAt: roundAt,
          lastAttemptAt: roundAt,
          lastError: result.value.failures.length === 0 ? null : cap(`${id}: ${result.value.failures.join(" | ")}`),
        };
        outcome[id] = result.value.failures.length === 0 ? "ok" : "partial";
      }
      meta.storms = storms.length;
      meta.latestObservedAt = newestObservedAt(storms);
      metas[id] = meta;
      merged.push(...storms);
    }

    const body: StormsResponse = {
      storms: merged,
      layers: layersFor(merged, metas["jma-typhoon"], metas["gdacs-tc"]),
      sources: STORM_SOURCES.map((id) => sourceState(id, metas[id])),
    };
    // เขียนแถวเดียว รอบละครั้ง — ไม่เคยเขียนต่อพายุ/ต่อต้นทาง/ต่อจังหวัด
    this.sql.exec(
      "INSERT INTO latest (id, body) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body",
      LATEST_ID,
      JSON.stringify(body),
    );
    for (const id of STORM_SOURCES) writeMeta(this.sql, `src:${id}`, JSON.stringify(metas[id]));

    const anyOk = jmaResult.status === "fulfilled" || gdacsResult.status === "fulfilled";
    if (anyOk) writeMeta(this.sql, "fetchedAt", roundAt);
    logInfo("storm-track refreshed", {
      jma: outcome["jma-typhoon"],
      gdacs: outcome["gdacs-tc"],
      storms: merged.length,
      ...(jmaResult.status === "rejected" ? { jmaError: errorText(jmaResult.reason, 120) } : {}),
      ...(gdacsResult.status === "rejected" ? { gdacsError: errorText(gdacsResult.reason, 120) } : {}),
    });
    return anyOk;
  }

  /** เติมส่วนที่เราเป็นคนคิด: ระยะถึงทุกจังหวัด (ครั้งเดียวต่อพายุต่อรอบ) และเวลาที่ดึงสำเร็จ */
  private complete(core: StormCore, fetchedAt: string): StormTrack {
    const latest = core.past[core.past.length - 1];
    const points = [
      ...(latest ? [{ lat: latest.lat, lon: latest.lon, radiusKm: null }] : []),
      ...core.forecast.map((f) => ({ lat: f.lat, lon: f.lon, radiusKm: f.circleRadiusKm })),
    ];
    return { ...core, nearestKmByProvince: nearestKmByProvince(points), fetchedAt };
  }

  /**
   * `GET /api/v1/storms` — **SQL คำสั่งเดียว** (PK lookup ของแถวเดียว) ไม่อ่าน meta
   * ไม่ดึงต้นทาง ยังไม่มีแถว = คำตอบ "ยังไม่เคยดึง" (ทุกเวลาเป็น null)
   */
  async getStorms(): Promise<StormsResponse> {
    const { body, unreadable } = this.readLatest();
    if (body) return body;
    // แถวพังต้องไม่ถูกรายงานเป็น "ยังไม่เคยดึง" เงียบ ๆ — บอกไว้ใน lastError ของทุกต้นทาง
    return coldResponse(unreadable ? "stored storm body unreadable — will be rewritten next round" : null);
  }

  /**
   * สองแถวสถานะ (JMA, GDACS) — อ่าน meta ด้วย PK ล้วน (`src:<id>` สองคีย์) ไม่มี COUNT/MAX
   * `observedLagSeconds: null`: พายุเกิดไม่เป็นคาบ ไม่มีพายุ ≠ ฟีดเสีย
   */
  async status(): Promise<SourceStatus[]> {
    const alarmAtMs = await this.ctx.storage.getAlarm();
    const nextAttemptAt = alarmAtMs === null ? null : new Date(alarmAtMs).toISOString();
    return STORM_SOURCES.map((id) => {
      const m = this.readSourceMeta(id);
      return {
        id,
        labelTh: SOURCES[id].nameTh,
        labelEn: SOURCES[id].nameEn,
        health: deriveSourceHealth({
          nowMs: Date.now(),
          fetchedAt: m.lastSuccessAt,
          lastError: m.lastError,
          latestObservedAt: m.latestObservedAt,
          staleAfterSeconds: STALE_AFTER_MS / 1000,
          observedLagSeconds: null,
        }),
        fetchedAt: m.lastSuccessAt,
        latestObservedAt: m.latestObservedAt,
        lastAttemptAt: m.lastAttemptAt,
        lastError: m.lastError,
        detail: { storms: m.storms },
        staleAfterSeconds: STALE_AFTER_MS / 1000,
        observedLagSeconds: null,
        nextAttemptAt,
      };
    });
  }
}
