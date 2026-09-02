import {
  SOURCES,
  worstHealth,
  type HealthResponse,
  type SourceId,
  type SourceStatus,
} from "@siahra/shared-types";
import { rejectedLastHour } from "../rateLimit.js";
import * as cachePolicy from "../cachePolicy.js";
import { json } from "../router.js";
import { deriveSourceHealth } from "../sourceHealth.js";
import type { AppEnv } from "../types.js";

/**
 * GET /api/v1/health — freshness of every upstream source, so the UI can put
 * "data is N minutes old / source down" next to the map instead of hiding
 * it. Each DO reports its own status; a DO that throws is reported as
 * "unknown" rather than failing the whole endpoint. The one source that is
 * not a DO (`copernicus-gfm`, ingested by a GitHub Actions job) is read from
 * a single R2 object the same way.
 */
export async function handleHealth(request: Request, env: AppEnv, _params: string[], ctx: ExecutionContext): Promise<Response> {
  /**
   * แคชที่ขอบ (Cache API) 15 วินาที — เท่ากับ `max-age=15` ที่ประกาศให้เบราว์เซอร์
   * อยู่แล้ว แต่เบราว์เซอร์ส่ง `cache: "no-store"` มา (ตั้งใจ: แถบสถานะห้ามโชว์
   * ของค้าง) และ Worker บน `/api/*` รันทุกคำขอ ดังนั้นถ้าไม่ใส่ไว้ตรงนี้ ทุกแท็บ
   * ที่เปิดค้างจะแตกเป็น 6 DO call ต่อนาทีต่อแท็บ — วัดจริง 2026-08-23: ~30k
   * คำขอ/วันคูณ 6 DO = DO requests เกินโควตา และ rows read หลักร้อยล้าน/วัน
   *
   * ความสดของข้อมูลไม่เสีย: สถานะทุกแหล่งขยับเป็นนาที (รอบสั้นสุดคือแผ่นดินไหว
   * 1 นาที) ของค้างสูงสุด 15 วิ จึงเล็กกว่าหนึ่งรอบของทุกแหล่ง และคำตอบที่ถูกแคช
   * ยังมี `serverTime` ของตอนที่คำนวณอยู่ในตัว — ไม่มี `fetchedAt` ไหนถูกประทับใหม่
   *
   * ใช้เฉพาะ GET/HEAD (router ส่ง HEAD มาเป็น GET อยู่แล้ว) และคีย์คือ URL ล้วน —
   * คำขอที่ผ่านกำแพง same-origin มาได้ทุกอันเห็นคำตอบเดียวกัน ไม่มีอะไรต่อผู้ใช้
   * ในคำตอบนี้ให้รั่ว
   */
  const cache = caches.default;
  const cacheKey = new Request(new URL(request.url).toString(), { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const collectors: Promise<SourceStatus[]>[] = [
    env.OBSERVATION_CACHE.getByName("thaiwater")
      .status()
      .then((s) => [s])
      .catch((err: unknown) => [unknownStatus("thaiwater", String(err))]),
    env.EARTHQUAKE_FEED.getByName("global")
      .status()
      .catch((err: unknown) => [unknownStatus("earthquakes", String(err))]),
    env.FLOOD_EXTENT.getByName("gistda")
      .status()
      .then((s) => [s])
      .catch((err: unknown) => [unknownStatus("gistda-flood", String(err))]),
    env.RADAR.getByName("tmd")
      .status()
      .then((s) => [s])
      .catch((err: unknown) => [unknownStatus("tmd-radar", String(err))]),
    // ชั้นที่เราคำนวณเอง (E10.3) — อยู่ใน DO เดียวกับค่าตรวจวัด เพราะมันคือ
    // ผลลัพธ์ของรอบ refresh เดียวกัน แต่รายงานเป็นแหล่งของตัวเอง: การเผยแพร่
    // ที่ล้มเหลวต้องมองเห็นได้ ไม่ใช่ถูกกลบไว้ใต้สถานะของ ThaiWater
    env.OBSERVATION_CACHE.getByName("thaiwater")
      .exposureStatus()
      .then((s) => [s])
      .catch((err: unknown) => [unknownStatus("exposure-illustrative", String(err))]),
    // พยากรณ์ NWP (E12.2) — คาบรายชั่วโมง จึงมีสถานะค้าง/ล่มของตัวเองแยกจาก
    // ฟีดเรดาร์ ทั้งที่เป็น TMD เหมือนกัน (คนละ API คนละกุญแจ คนละคาบ)
    // ชื่อ instance "primary" ไม่ใช่ "tmd" — ประวัติเต็ม (และทำไมการเปลี่ยนชื่อไม่ใช่
    // ตัวแก้ปัญหาจริง) อยู่ที่ index.ts บรรทัด scheduled task ของ tmd-nwp
    env.FORECAST_NWP.getByName("primary")
      .status()
      .then((s) => [s])
      .catch((err: unknown) => [unknownStatus("tmd-nwp", String(err))]),
    // ชั้น threshold/alert engine (E11.5) — DO ของตัวเอง วิ่งบนคนละคาบ (5 นาที)
    // จาก ObservationCacheDO เอง จึงมีสถานะที่ล่ม/ค้างแยกต่างหากจากทั้งสองแหล่งข้างต้น
    env.ALERT_ENGINE.getByName("primary")
      .status()
      .then((s) => [s])
      .catch((err: unknown) => [unknownStatus("alert-engine", String(err))]),
    // ฉากน้ำท่วม Copernicus GFM (E14.F3) — ไม่มี DO: job GitHub Actions เขียน
    // flood/gfm/health.json ลง R2 ทุก 6 ชม. อ่านใบเดียว (หนึ่ง get ไม่มี list/head) ใต้แคช
    // 15 วิของ endpoint นี้ = ≤ 4 Class B ops/นาที/colo
    gfmStatus(env).then((s) => [s]).catch((err: unknown) => [unknownStatus("copernicus-gfm", String(err))]),
  ];
  const sources = (await Promise.all(collectors)).flat();
  const body: HealthResponse = {
    ok: healthOk(sources),
    worst: worstHealth(sources.map((s) => s.health)),
    serverTime: new Date().toISOString(),
    sources,
    api: { rateLimited429LastHour: rejectedLastHour() },
  };
  const res = json(body, { cache: cachePolicy.health });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

/**
 * `ok` ของทั้ง endpoint — แยกออกมาเป็นฟังก์ชันเพื่อให้เทสยิงตรงได้ (สถานะบางแบบ
 * เช่น "ค้างพร้อม error" เกิดขึ้นไม่ได้ในเทสที่ตัดเน็ต จึงเคยหลุดรอด)
 *
 * เงื่อนไขนี้ตั้งใจให้ **แคบ** และมีเงื่อนไขซ้อนสองชั้น:
 * 1. สถานะต้องเป็น `ok` หรือ `delayed` เท่านั้น — `stale` ไม่นับว่า ok เพราะมัน
 *    แปลว่าไม่มีรอบดึงสำเร็จเกินงบเวลาของแหล่งนั้นเอง ส่วน `down`/`unknown`/
 *    `degraded` ยิ่งไม่ต้องพูดถึง (ความเงียบไม่ใช่ความแข็งแรง)
 * 2. ต้องไม่มี `lastError` ค้างอยู่ — กันไม่ให้ลำดับสาขาใน deriveSourceHealth
 *    เปลี่ยนไปทีหลังแล้วทำให้แหล่งที่กำลังพังกลับมารายงานว่า ok อีก
 */
export function healthOk(sources: readonly SourceStatus[]): boolean {
  return sources.every((s) => (s.health === "ok" || s.health === "delayed") && !s.lastError);
}

/** คีย์เดียวที่ `.github/workflows/gfm-ingest.yml` อัปโหลดหลังทุก run (apps/etl/gfm/gfm/cli.py write_health) */
const GFM_HEALTH_KEY = "flood/gfm/health.json";

/**
 * cron วิ่งทุก 6 ชม. — ไม่มี run สำเร็จเกินสองรอบ = `stale` (cron หาย/ล้มติดกัน) ตัวเลขนี้คือ
 * "ฝั่งเราไม่ได้ดึง" ไม่เกี่ยวกับอายุของภาพ: Sentinel-1 บินซ้ำทุก 6–12 วัน จึงตัดสิน `delayed`
 * จากเวลาบันทึกภาพไม่ได้ (observedLagSeconds null) — "ไม่มีภาพใหม่สัปดาห์นี้" ไม่ใช่ฟีดเสีย
 */
const GFM_STALE_AFTER_SECONDS = 43_200;

/** สตริงเวลา ISO ที่ parse ได้เท่านั้น — อย่างอื่น (หาย, null, ขยะ) คือ null ไม่ใช่ "ตอนนี้" */
function isoOrNull(v: unknown): string | null {
  return typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null;
}

function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

interface GfmStatusInput {
  fetchedAt: string | null;
  lastAttemptAt: string | null;
  latestObservedAt: string | null;
  lastError: string | null;
  detail: SourceStatus["detail"];
  /**
   * health.json หาย/อ่านไม่ออก = ไม่มีผลการดึงให้ตัดสินเลย → `unknown` (แบบเดียวกับ DO ที่ throw
   * ใน unknownStatus) ไม่ใช่ `down`: "ไม่มีรายงาน" ต่างจาก "รายงานว่าล้ม" ซึ่งบันไดใน
   * deriveSourceHealth ตัดสินจากเนื้อในของรายงานที่อ่านได้เท่านั้น
   */
  unreadable?: boolean;
}

function gfmStatusFrom(i: GfmStatusInput): SourceStatus {
  return {
    id: "copernicus-gfm",
    labelTh: SOURCES["copernicus-gfm"].nameTh,
    labelEn: SOURCES["copernicus-gfm"].nameEn,
    health: i.unreadable
      ? "unknown"
      : deriveSourceHealth({
          nowMs: Date.now(),
          fetchedAt: i.fetchedAt,
          lastError: i.lastError,
          latestObservedAt: i.latestObservedAt,
          staleAfterSeconds: GFM_STALE_AFTER_SECONDS,
          observedLagSeconds: null,
        }),
    fetchedAt: i.fetchedAt,
    latestObservedAt: i.latestObservedAt,
    lastAttemptAt: i.lastAttemptAt,
    lastError: i.lastError,
    detail: i.detail,
    staleAfterSeconds: GFM_STALE_AFTER_SECONDS,
    observedLagSeconds: null,
    // ตารางเวลาเป็นของ GitHub Actions (cron `17 */6 * * *`) ไม่ใช่ alarm ที่อ่านได้จากที่นี่ —
    // null คือ "ไม่รู้นัดถัดไป" ตามสัญญาของฟิลด์นี้ ไม่ใช่คำนวณช่องถัดไปมาสวม
    nextAttemptAt: null,
  };
}

/**
 * สถานะของ `copernicus-gfm` จาก `flood/gfm/health.json` ใบเดียว — **หนึ่ง** `HAZARD_BUCKET.get`
 * ต่อการคำนวณ /health หนึ่งครั้ง ไม่มี `list()`/`head()` ไม่มี DO
 *
 * `fetchedAt` = `lastSuccessAt` (run ที่ไม่มี error ครั้งล่าสุด) ไม่ใช่ `lastRunAt`: run ที่ล้มคือ
 * "พยายามแล้ว" (lastAttemptAt) ไม่ใช่ "ดึงสำเร็จ" — ไม่งั้นแหล่งที่ล้มติดกันสามวันจะดู `degraded`
 * สด ๆ ตลอดกาลแทนที่จะเป็น `down` object ที่หายหรืออ่านไม่ได้ = `unknown` พร้อม lastError ที่บอกคีย์
 */
async function gfmStatus(env: AppEnv): Promise<SourceStatus> {
  const empty = { fetchedAt: null, lastAttemptAt: null, latestObservedAt: null, detail: {}, unreadable: true };
  const object = await env.HAZARD_BUCKET.get(GFM_HEALTH_KEY);
  if (!object) {
    return gfmStatusFrom({
      ...empty,
      lastError: `R2 object ${GFM_HEALTH_KEY} not found — the gfm-ingest job has never uploaded a health report`,
    });
  }
  let raw: unknown;
  try {
    raw = await object.json();
  } catch (err) {
    return gfmStatusFrom({ ...empty, lastError: `R2 object ${GFM_HEALTH_KEY} is not valid JSON: ${String(err)}` });
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return gfmStatusFrom({ ...empty, lastError: `R2 object ${GFM_HEALTH_KEY} is not a JSON object` });
  }
  const h = raw as Record<string, unknown>;
  return gfmStatusFrom({
    fetchedAt: isoOrNull(h.lastSuccessAt),
    lastAttemptAt: isoOrNull(h.lastRunAt),
    latestObservedAt: isoOrNull(h.lastSceneObservedAt),
    lastError: typeof h.lastError === "string" && h.lastError !== "" ? h.lastError : null,
    detail: { itemsProcessed: numberOrNull(h.itemsProcessed), scenesWritten: numberOrNull(h.scenesWritten) },
  });
}

/** id ถูกบังคับเป็น SourceId เพื่อไม่ให้ /health โผล่ชื่อแหล่งที่ layer ไหนอ้างไม่ได้ */
function unknownStatus(id: SourceId, error: string): SourceStatus {
  return {
    id,
    labelTh: SOURCES[id].nameTh,
    labelEn: SOURCES[id].nameEn,
    health: "unknown",
    fetchedAt: null,
    latestObservedAt: null,
    lastAttemptAt: null,
    lastError: error,
    detail: {},
    staleAfterSeconds: 0,
    observedLagSeconds: null,
    // DO ตอบไม่ได้ จึงไม่รู้ว่ามีนัดลองใหม่หรือไม่ — null คือไม่รู้ ไม่ใช่เดา
    nextAttemptAt: null,
  };
}
