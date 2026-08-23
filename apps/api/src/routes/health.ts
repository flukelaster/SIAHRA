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
import type { AppEnv } from "../types.js";

/**
 * GET /api/v1/health — freshness of every upstream source, so the UI can put
 * "data is N minutes old / source down" next to the map instead of hiding
 * it. Each DO reports its own status; a DO that throws is reported as
 * "unknown" rather than failing the whole endpoint.
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
    // ชั้น threshold/alert engine (E11.5) — DO ของตัวเอง วิ่งบนคนละคาบ (5 นาที)
    // จาก ObservationCacheDO เอง จึงมีสถานะที่ล่ม/ค้างแยกต่างหากจากทั้งสองแหล่งข้างต้น
    env.ALERT_ENGINE.getByName("primary")
      .status()
      .then((s) => [s])
      .catch((err: unknown) => [unknownStatus("alert-engine", String(err))]),
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
