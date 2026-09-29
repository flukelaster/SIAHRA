import * as cachePolicy from "../cachePolicy.js";
import { json } from "../router.js";
import type { AppEnv } from "../types.js";
import { errorText, logError } from "../log.js";
import { BASINS_STALE_AFTER_SECONDS, coldBasinsResponse } from "../basins/build.js";

/** instance เดียวที่ cron, /health และเส้นทางอื่นของ ThaiWater ใช้ร่วมกัน (ดู `routes/rivers.ts`) */
const OBSERVATION_INSTANCE = "thaiwater";

/**
 * GET /api/v1/basins — สถานีวัดระดับน้ำและเขื่อนจัดกลุ่มตามป้ายลุ่มน้ำของ ThaiWater (`basinNameTh`) ทั้งประเทศ
 * คำขอเดียว ค่าที่ต้นทางรายงานตามที่รับมา — ไม่มีลำดับต้นน้ำ→ปลายน้ำ ไม่มีเวลาที่น้ำจะมาถึง ไม่มีค่าล่วงหน้า
 *
 * งบต้นทุน (ข้อบังคับจาก devops):
 * - cache miss = DO call **เดียว** (`getBasins()`) ซึ่งรัน SQL คำสั่งเดียวด้วย PK แล้วคืนสตริงที่เก็บไว้ — ไม่สแกนตาราง
 *   สถานี/เขื่อนต่อคำขอ ไม่ปลุกการดึงต้นทาง (แถวถูกสร้างบนรอบ refresh ของ DO; ถ้ายังไม่มีแถวแต่ตารางถือข้อมูลที่ดึงแล้ว DO
 *   สร้างให้เองไม่เกิน 1 ครั้ง/10 นาที — ตัวจับเวลาอยู่ใน DO ไม่ใช่ที่นี่) ไม่มี R2/D1
 * - บอดี้ที่เก็บไว้ถูกส่งต่อ **ตามที่เป็น** (ไม่ parse แล้ว stringify ~300 KB ต่อคำขอ) จึงไม่ผ่าน `json()`
 * - แคชที่ขอบ (Cache API) คีย์ = origin + pathname; route ไม่รับ query ใด ๆ — มี query = 400 **ก่อน** `cache.match`
 *   จึงแตกแคชด้วย `?x=<สุ่ม>` ไปถึง DO ไม่ได้ และ **put เฉพาะคำตอบที่แถวมีอยู่แล้ว** (= เคยดึงระดับน้ำสำเร็จ);
 *   คำตอบ "ยังไม่มีแถว" เป็น `no-store` ไม่งั้นมันค้างที่ขอบ 5 นาทีทั้งที่ข้อมูลมาถึงแล้ว
 */
export async function handleBasins(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (url.search !== "") {
    return json({ error: "This endpoint takes no query parameters" }, { status: 400 });
  }
  const cache = caches.default;
  const cacheKey = new Request(url.origin + url.pathname, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let stored: { body: string | null; lastError: string | null };
  try {
    stored = await env.OBSERVATION_CACHE.getByName(OBSERVATION_INSTANCE).getBasins();
  } catch (err) {
    logError("basins failed", { error: errorText(err) });
    return json({ error: "Basin view unavailable" }, { status: 503 });
  }
  if (stored.body === null) {
    // ไม่มีแถว: `fetchedAt` null ทุกที่ — ไม่ใช่ "ไม่มีลุ่มน้ำ". `lastError` null = ตารางไม่เคยได้ระดับน้ำจริง ("ยังไม่เคยดึง");
    // ไม่ใช่ null = ตารางถือข้อมูลแต่สร้างมุมมองไม่ได้ → ไปเป็น `buildError` (เว็บห้ามแสดง "ยังไม่เคยดึง" คู่กัน)
    return json(coldBasinsResponse(BASINS_STALE_AFTER_SECONDS, stored.lastError), { cache: cachePolicy.noStore });
  }
  const res = new Response(stored.body, {
    headers: { "Content-Type": "application/json", "Cache-Control": cachePolicy.basins.value },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
