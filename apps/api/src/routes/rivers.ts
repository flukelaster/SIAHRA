import * as cachePolicy from "../cachePolicy.js";
import { json } from "../router.js";
import type { AppEnv } from "../types.js";
import { errorText, logError } from "../log.js";

/**
 * GET /api/v1/rivers/north — ค่าตรวจวัดล่าสุด + 48 ชม. ย้อนหลังของสถานีบนเส้นทางน้ำเหนือ
 * (E16) ค่าที่ตรวจวัดแล้วเท่านั้น ไม่มีเวลาที่น้ำจะมาถึงหรือค่าล่วงหน้าใด ๆ
 *
 * งบต้นทุน (ข้อบังคับจาก devops):
 * - cache miss หนึ่งครั้ง = RPC **หนึ่งครั้ง** ไปที่ ObservationCacheDO (`northRoute()`)
 *   ซึ่งอ่านอย่างเดียวด้วย PK — ไม่ปลุกการดึงต้นทาง ไม่เรียก DO อื่น เขื่อนมาจาก
 *   `/api/v1/dams` ตัวเดิม
 * - แคชที่ขอบ (Cache API) 120 วิ เท่ากับ `max-age=120` ที่ประกาศให้เบราว์เซอร์ — คีย์คือ
 *   URL ที่ **ไม่มี query string** (คำขอที่มี query ถูกตอบ 400 ก่อนถึงแคช) จึงไม่มีทาง
 *   ใช้ `?t=` แตกแคชให้ไปถึง DO ได้
 * - ไม่มี log ต่อคำขอ นอกจากตอนล้มเหลว
 */
export async function handleNorthRoute(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (url.search !== "") {
    return json({ error: "This endpoint takes no query parameters" }, { status: 400 });
  }
  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}${url.pathname}`, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  try {
    const body = await env.OBSERVATION_CACHE.getByName("thaiwater").northRoute();
    const res = json(body, { cache: cachePolicy.history });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (err) {
    logError("north route failed", { error: errorText(err) });
    return json({ error: "River route data unavailable" }, { status: 503 });
  }
}
