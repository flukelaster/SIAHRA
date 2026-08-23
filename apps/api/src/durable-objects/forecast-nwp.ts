import { DurableObject } from "cloudflare:workers";
import {
  SOURCES,
  type ForecastAvailabilityResponse,
  type HazardLayerDescriptor,
  type ProvinceForecastBatch,
  type ProvinceForecastResponse,
  type SourceStatus,
} from "@siahra/shared-types";
import { shortReason } from "../ingestion/errors.js";
import {
  DAILY_DURATION_D,
  HOURLY_DURATION_H,
  NWP_REGIONS,
  TMD_NWP_MISSING_TOKEN,
  fetchDailyAvailability,
  fetchRegionForecast,
  nwpToken,
  type NwpQuota,
} from "../ingestion/tmdNwp.js";
import { META_TABLE_DDL, readMeta, writeMeta } from "./metaKv.js";
import { deriveSourceHealth } from "../sourceHealth.js";
import { errorText, logInfo, logWarn } from "../log.js";

/**
 * ผลพยากรณ์เชิงกำหนดของ TMD (NWP) — หนึ่ง instance ชื่อ `"tmd"`
 *
 * **โครงเก็บข้อมูลคือหัวใจของงานนี้ ไม่ใช่รายละเอียด** บิล Durable Objects
 * 2026-08-18..23 (72.38B rows read) เกิดจากคำสั่งที่สแกนทั้งตารางบนเส้นทางที่ถูก
 * เรียกบ่อย โครงนี้จึงถูกออกแบบให้ "ไม่มีอะไรให้สแกน" ตั้งแต่แรก:
 *
 * 1. **หนึ่งแถวต่อหนึ่งจังหวัด** เก็บทั้ง batch เป็น JSON ใน `body` — ไม่ใช่หนึ่ง
 *    แถวต่อหนึ่งขั้นพยากรณ์ ซึ่งจะเป็น 77×55 = 4,235 การเขียนต่อรอบ (แย่กว่า 55 เท่า)
 * 2. **ไม่มีตารางประวัติ และไม่มี `DELETE` ตามอายุที่ไหนเลย** เก็บเฉพาะรอบล่าสุด
 *    ด้วย `INSERT … ON CONFLICT(province_code) DO UPDATE` เมื่อไม่มีอะไรให้ตัดทิ้ง
 *    ก็ไม่มีคำสั่งตัดทิ้งที่จะสแกน
 * 3. **`status()` อ่านจาก `meta` อย่างเดียว** ทุกตัวเลขที่มันรายงานถูกคำนวณไว้แล้ว
 *    บนเส้นทาง refresh (รายชั่วโมง) ไม่มี `COUNT(*)`/`MAX()` — นั่นคือบั๊กที่ #54 แก้
 * 4. **เส้นทางต่อคำขอคือ PK lookup เดี่ยว ๆ** และ *ไม่* เรียก `ensureFresh()`
 *    ต่างจาก `RadarDO` โดยตั้งใจ: การดึงต้นทางถูกขับด้วย cron/alarm เท่านั้น
 *
 * งบที่คิดไว้: 77 แถว/ชม. × 720 = 55,440 rows written ต่อรอบบิล (0.11% ของ 50M)
 * และหนึ่ง PK lookup ต่อคำขอ
 */

/** รายชั่วโมง — ต้นทางเองอัปเดตเป็นรอบ ๆ การดึงถี่กว่านี้ไม่ได้ค่าใหม่ */
const REFRESH_MS = 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
/**
 * เพดานของ "รอบดึงที่สำเร็จ" — รีเฟรชรายชั่วโมง ลองใหม่ทุก 5 นาทีเมื่อพลาด
 * เงียบเกิน 3 ชม. = พลาดสามรอบเต็มติดกัน ถือว่า `stale`
 */
const FETCH_STALE_AFTER_MS = 3 * 60 * 60 * 1000;

interface LatestRow extends Record<string, SqlStorageValue> {
  body: string;
}

/**
 * descriptor ของหนึ่งชุด — สองชุดมี `horizonHours` ไม่เท่ากัน (48 กับ 168) จึงต้อง
 * เป็นคนละ descriptor ดูเหตุผลเต็มใน `packages/shared-types/src/forecast.ts`
 *
 * - `issuedAt: null` เสมอ — ต้นทางไม่เผยแพร่เวลารอบรันของแบบจำลอง (วัดจริงทั้ง
 *   บอดี้และ header) ห้ามเติมจาก `fetchedAt`
 * - `resolutionKm: null` — API ไม่ส่ง metadata ของกริดมาเลย และหน้าเอกสารที่มี
 *   ตัวเลขนั้นเป็นหน้าเดียวกับที่ผิดเรื่องคีย์ response จึงยังไม่ถือว่าตรวจสอบแล้ว
 * - ไม่มี `observedAt` — พยากรณ์ไม่ได้ตรวจวัดอะไร valid time ของมันอยู่ในอนาคต
 * - `horizonHours` **นับจากขั้นที่ต้นทางส่งมาจริง** ไม่ใช่จากค่า `duration` ที่เราขอ
 *   สองอย่างนี้ตรงกันเมื่อต้นทางตอบเต็ม (วัดจริง 2026-08-23: `duration=6` ได้ 6 ขั้น
 *   ต่อจังหวัด `duration=48` ได้ 48 ขั้น) แต่ถ้าวันหนึ่งต้นทางตัดสั้นลง การประกาศ
 *   ตามคำขอจะกลายเป็นการอ้างระยะที่ข้อมูลไปไม่ถึง — ตระกูลเดียวกับการเติม
 *   `issuedAt` จาก `fetchedAt` ยังไม่เคยดึงสำเร็จ (`batch === null`) จึงเป็นกรณีเดียว
 *   ที่ใช้ค่าที่เราขอ เพราะยังไม่มีคำตอบของต้นทางให้นับ
 */
function layerFor(kind: "hourly" | "daily", fetchedAt: string | null, horizonHours: number): HazardLayerDescriptor {
  return {
    id: kind === "hourly" ? "tmd-nwp-hourly" : "tmd-nwp-daily",
    epistemicClass: "forecast",
    liveOrStatic: "live",
    publishedAt: null,
    fetchedAt,
    staleAfterSeconds: FETCH_STALE_AFTER_MS / 1000,
    sourceIds: ["tmd-nwp"],
    forecast: {
      // ต้นทางไม่ได้ตั้งชื่อแบบจำลองไว้ใน API — เรียกตามชื่อผลิตภัณฑ์/endpoint ที่เรียกจริง
      modelName: kind === "hourly" ? "TMD NWP API (nwpapi v1) — รายชั่วโมง" : "TMD NWP API (nwpapi v1) — รายวัน",
      resolutionKm: null,
      horizonHours,
      issuedAt: null,
    },
  };
}

export class ForecastNwpDO extends DurableObject<Env> {
  private inflight: Promise<boolean> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS latest (province_code TEXT PRIMARY KEY, body TEXT NOT NULL);
        ${META_TABLE_DDL}
      `);
    });
  }

  private get sql(): SqlStorage {
    return this.ctx.storage.sql;
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

  /**
   * เรียกจาก cron เท่านั้น — เส้นทางคำขอของผู้ใช้ไม่แตะต้นทาง
   *
   * cron เดินทุกนาที (`crons: ["* * * * *"]`) และ `scheduledTick` ไม่มีตัวคุมจังหวะ
   * รายงาน ดังนั้นเงื่อนไข "ครบชั่วโมงหรือยัง" อย่างเดียวไม่พอ: รอบที่ **พังทั้งรอบ**
   * ไม่เขียน `fetchedAt` เลย (โดยตั้งใจ — ห้ามอ้างว่าดึงสำเร็จ) ค่าเดิมจึงค้างเก่าอยู่
   * แล้ว cron จะสั่งยิงต้นทางใหม่ทั้ง 12 คำขอ *ทุกนาที* ซึ่งลบล้าง backoff 5 นาที
   * ของ `alarm()` ทิ้งไปทั้งหมด และกลายเป็นการถล่มต้นทางที่กำลังมีปัญหาอยู่
   *
   * จึงกั้นด้วย `lastAttemptAt` (เขียนทุกรอบไม่ว่าสำเร็จหรือไม่) ให้เว้นอย่างน้อย
   * `RETRY_MS` เท่ากับที่ `alarm()` ตั้งไว้ — cron เป็นเพียงตาข่ายกันอะลาร์มหาย
   * ไม่ใช่ตัวกำหนดจังหวะแทน
   *
   * `RadarDO` มีโค้ดตรงนี้เหมือนกันแต่**ไม่ต้องแก้**: `RETRY_MS` ของมันคือ 60 วินาที
   * ซึ่งเท่ากับช่วงที่ cron เดินอยู่แล้ว จึงไม่มีการเร่งเกิน ต่างจากที่นี่ที่ 5 นาที
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

  /**
   * หนึ่งรอบ = 6 ภาค × (hourly + daily) + availability หนึ่งครั้ง
   *
   * ความล้มเหลวบางส่วนต้องเสื่อมอย่างซื่อสัตย์: ภาคที่พังจะ **ไม่ถูกเขียนทับ**
   * ข้อมูลรอบก่อนของมันจึงยังอยู่พร้อม `batch.fetchedAt` เดิมของตัวเอง (นี่คือ
   * เหตุผลที่ `fetchedAt` อยู่ในแถว ไม่ใช่ใน meta ตัวเดียวสำหรับทุกจังหวัด —
   * ไม่งั้นจังหวัดของภาคที่พังจะถูกประทับเวลาใหม่ทั้งที่ค่ายังเป็นของเก่า)
   * และรอบที่พังทั้งหมดจะไม่แตะ `fetchedAt` เลย
   */
  private async refresh(): Promise<boolean> {
    const nowMs = Date.now();
    const roundAt = new Date(nowMs).toISOString();
    writeMeta(this.sql, "lastAttemptAt", roundAt);

    const token = nwpToken(this.env);
    if (!token) {
      // ไม่ได้ "ถามแล้วต้นทางเงียบ" แต่เป็น "เราไม่มีกุญแจจะถาม" — ต้องพูดตามนั้น
      writeMeta(this.sql, "lastError", TMD_NWP_MISSING_TOKEN);
      logWarn("tmd-nwp refresh skipped", { reason: TMD_NWP_MISSING_TOKEN });
      return false;
    }

    const batchId = roundAt;
    const failures: string[] = [];
    /** นับแยกจาก `failures` เพราะ "ทั้งรอบพัง" ตัดสินจากภาคที่ถามไม่สำเร็จเท่านั้น */
    let regionsFailed = 0;
    const unknownGeocodes = new Set<string>();
    const codes = new Set(this.storedCodes());
    let quota: NwpQuota = { datapointRemaining: null, rateLimitRemaining: null };
    let written = 0;

    for (const region of NWP_REGIONS) {
      try {
        // ทั้งคู่ต้องสำเร็จถึงจะเขียนภาคนี้ — batch ที่มีแต่ชุดเดียวจะทำให้อีกชุด
        // กลายเป็นอาเรย์ว่าง ซึ่งอ่านได้ว่า "แบบจำลองบอกว่าไม่มีอะไร" คนละเรื่องกับ
        // "เราดึงชุดนั้นไม่สำเร็จ" — เก็บของเก่าไว้ทั้งก้อนซื่อสัตย์กว่า
        const [hourly, daily] = await Promise.all([
          fetchRegionForecast("hourly", region, token),
          fetchRegionForecast("daily", region, token),
        ]);
        quota = hourly.quota.datapointRemaining !== null ? hourly.quota : daily.quota;
        for (const code of [...hourly.unknownGeocodes, ...daily.unknownGeocodes]) unknownGeocodes.add(code);
        for (const [code, hourlySeries] of hourly.byProvince) {
          const dailySeries = daily.byProvince.get(code);
          if (!dailySeries) {
            failures.push(`${region}/${code}: daily series missing`);
            continue;
          }
          const batch: ProvinceForecastBatch = {
            provinceCode: code,
            batchId,
            fetchedAt: roundAt,
            queryPoint: hourlySeries.queryPoint,
            hourly: hourlySeries.steps,
            daily: dailySeries.steps,
          };
          this.sql.exec(
            "INSERT INTO latest (province_code, body) VALUES (?, ?) ON CONFLICT(province_code) DO UPDATE SET body = excluded.body",
            code,
            JSON.stringify(batch),
          );
          codes.add(code);
          written++;
        }
      } catch (err) {
        regionsFailed++;
        failures.push(`${region}: ${shortReason(err)}`);
        logWarn("tmd-nwp region failed", { region, error: errorText(err) });
      }
    }

    if (regionsFailed === NWP_REGIONS.length) {
      // ไม่แตะ `fetchedAt` และไม่แตะแถวใด ๆ — ของเดิมที่ยังอ่านออกต้องอยู่ต่อ
      writeMeta(this.sql, "lastError", `TMD NWP round failed: ${failures.join("; ")}`.slice(0, 300));
      writeMeta(this.sql, "regionsFailed", failures.join("; ").slice(0, 300));
      writeMeta(this.sql, "regionsOk", "0");
      // รอบนี้ไม่ได้เขียนอะไรเลย — ตัวเลขของรอบก่อนต้องไม่ค้างอยู่ใน status()
      writeMeta(this.sql, "writtenLastRound", "0");
      return false;
    }

    try {
      const window = await fetchDailyAvailability(token);
      writeMeta(this.sql, "availabilityMin", window.min);
      writeMeta(this.sql, "availabilityMax", window.max);
      writeMeta(this.sql, "availabilityFetchedAt", roundAt);
    } catch (err) {
      // อ่านช่วงข้อมูลไม่ได้ = ไม่รู้ว่าต้นทางมีถึงวันไหน ห้ามคงค่าเก่าแบบเงียบ ๆ
      // จึงคงค่าเก่าไว้ (พร้อม `availabilityFetchedAt` เดิมของมัน) แล้วรายงานออกมา
      failures.push(`availability: ${shortReason(err)}`);
      logWarn("tmd-nwp availability failed", { error: errorText(err) });
    }

    if (unknownGeocodes.size > 0) {
      failures.push(`unknown geocodes: ${[...unknownGeocodes].join(",")}`);
    }
    writeMeta(this.sql, "fetchedAt", roundAt);
    writeMeta(this.sql, "batchId", batchId);
    writeMeta(this.sql, "provinceCodes", JSON.stringify([...codes]));
    writeMeta(this.sql, "provinceCount", String(codes.size));
    writeMeta(this.sql, "writtenLastRound", String(written));
    writeMeta(this.sql, "regionsOk", String(NWP_REGIONS.length - regionsFailed));
    writeMeta(this.sql, "regionsFailed", failures.length === 0 ? null : failures.join("; ").slice(0, 300));
    writeMeta(this.sql, "unknownGeocodes", unknownGeocodes.size === 0 ? null : [...unknownGeocodes].join(","));
    writeMeta(this.sql, "datapointRemaining", quota.datapointRemaining === null ? null : String(quota.datapointRemaining));
    writeMeta(this.sql, "rateLimitRemaining", quota.rateLimitRemaining === null ? null : String(quota.rateLimitRemaining));
    writeMeta(this.sql, "lastError", failures.length === 0 ? null : failures.join("; ").slice(0, 300));
    logInfo("tmd-nwp refreshed", { written, provinces: codes.size, failures: failures.length });
    return true;
  }

  /** รายชื่อจังหวัดที่มีข้อมูลอยู่ อ่านจาก meta ไม่ใช่จากการนับแถว */
  private storedCodes(): string[] {
    const raw = readMeta(this.sql, "provinceCodes");
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === "string") : [];
    } catch {
      return [];
    }
  }

  /**
   * หนึ่ง PK lookup ต่อคำขอ — ไม่มีการดึงต้นทาง ไม่มี aggregate
   *
   * `layers.*.fetchedAt` มาจาก **แถวของจังหวัดนั้น** ไม่ใช่ meta ตัวกลาง: จังหวัด
   * ที่ภาคของมันพลาดรอบล่าสุดต้องแสดงเวลาเก่าของตัวเอง ไม่ใช่เวลาของรอบที่จังหวัด
   * อื่นสำเร็จ
   */
  async getProvince(provinceCode: string): Promise<ProvinceForecastResponse> {
    const row = this.sql.exec<LatestRow>("SELECT body FROM latest WHERE province_code = ?", provinceCode).toArray()[0];
    let batch: ProvinceForecastBatch | null = null;
    if (row) {
      try {
        batch = JSON.parse(row.body) as ProvinceForecastBatch;
      } catch (err) {
        logWarn("tmd-nwp stored batch unreadable", { provinceCode, error: errorText(err) });
      }
    }
    const fetchedAt = batch?.fetchedAt ?? null;
    // หนึ่งขั้นรายชั่วโมง = 1 ชม. หนึ่งขั้นรายวัน = 24 ชม. (ตามหน่วยที่ประกาศไว้ใน ForecastStep)
    const hourlyHorizon = batch ? batch.hourly.length : HOURLY_DURATION_H;
    const dailyHorizon = batch ? batch.daily.length * 24 : DAILY_DURATION_D * 24;
    return {
      layers: {
        hourly: layerFor("hourly", fetchedAt, hourlyHorizon),
        daily: layerFor("daily", fetchedAt, dailyHorizon),
      },
      batch,
    };
  }

  /** ช่วงวันที่ต้นทางประกาศ อ่านจาก `meta` ล้วน */
  async availability(): Promise<ForecastAvailabilityResponse> {
    const min = readMeta(this.sql, "availabilityMin");
    const max = readMeta(this.sql, "availabilityMax");
    return {
      daily: min && max ? { min, max } : null,
      fetchedAt: readMeta(this.sql, "availabilityFetchedAt"),
    };
  }

  /**
   * ทุกค่าที่นี่มาจาก `meta` ล้วน ๆ — ห้ามมี `COUNT(*)`/`MAX()` ในเมทอดนี้
   * (`/health` ถูกเรียกนาทีละครั้งต่อแท็บ นั่นคือรูปแบบที่พาไปถึง 72B rows read)
   *
   * `observedLagSeconds: null` และ `latestObservedAt: null` โดยตั้งใจ: พยากรณ์ไม่มี
   * "เวลาตรวจวัด" ให้เทียบเลย valid time ของมันอยู่ในอนาคต การยัดเวลาอนาคตลงช่อง
   * `latestObservedAt` จะเป็นการอ้างว่าเราวัดอนาคตได้ และการตั้ง lag เป็นตัวเลข
   * ทั้งที่ไม่มีค่าตรวจวัดจะทำให้ `deriveSourceHealth` ตอบ `degraded` ตลอดกาล
   */
  async status(): Promise<SourceStatus> {
    const fetchedAt = readMeta(this.sql, "fetchedAt");
    const lastError = readMeta(this.sql, "lastError");
    const availabilityMin = readMeta(this.sql, "availabilityMin");
    const availabilityMax = readMeta(this.sql, "availabilityMax");
    const alarmAtMs = await this.ctx.storage.getAlarm();
    return {
      id: "tmd-nwp",
      labelTh: SOURCES["tmd-nwp"].nameTh,
      labelEn: SOURCES["tmd-nwp"].nameEn,
      health: deriveSourceHealth({
        nowMs: Date.now(),
        fetchedAt,
        lastError,
        latestObservedAt: null,
        staleAfterSeconds: FETCH_STALE_AFTER_MS / 1000,
        observedLagSeconds: null,
      }),
      fetchedAt,
      latestObservedAt: null,
      lastAttemptAt: readMeta(this.sql, "lastAttemptAt"),
      lastError,
      detail: {
        provinces: Number(readMeta(this.sql, "provinceCount") ?? "0"),
        writtenLastRound: Number(readMeta(this.sql, "writtenLastRound") ?? "0"),
        regionsOk: Number(readMeta(this.sql, "regionsOk") ?? "0"),
        // ภาคที่ถามไม่สำเร็จต้องมีชื่ออยู่ตรงนี้ ไม่ใช่หายไปเฉย ๆ
        regionsFailed: readMeta(this.sql, "regionsFailed"),
        unknownGeocodes: readMeta(this.sql, "unknownGeocodes"),
        dailyAvailability: availabilityMin && availabilityMax ? `${availabilityMin}..${availabilityMax}` : null,
        batchId: readMeta(this.sql, "batchId"),
        datapointRemaining: numberOrNull(readMeta(this.sql, "datapointRemaining")),
        rateLimitRemaining: numberOrNull(readMeta(this.sql, "rateLimitRemaining")),
      },
      staleAfterSeconds: FETCH_STALE_AFTER_MS / 1000,
      observedLagSeconds: null,
      nextAttemptAt: alarmAtMs === null ? null : new Date(alarmAtMs).toISOString(),
    };
  }
}

function numberOrNull(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
