import * as cachePolicy from "../cachePolicy.js";
import { json } from "../router.js";
import type { AppEnv } from "../types.js";
import { errorText, logError } from "../log.js";

/** instance เดียวที่ cron, /health และเส้นทางนี้ใช้ร่วมกัน */
const STORM_INSTANCE = "primary";

/**
 * GET /api/v1/storms — เส้นทางพายุทั้งภูมิภาค (คำขอเดียวทั้งประเทศ ไม่ใช่ต่อจังหวัด)
 *
 * **DO call เดียว บน instance คงที่เดียว** ซึ่งรัน SQL คำสั่งเดียว
 * (`SELECT body FROM latest WHERE id = ?`) — ไม่ปลุกการดึงต้นทาง รอบดึงถูกขับด้วย
 * cron/alarm ทุก 30 นาทีเท่านั้น
 *
 * แคชที่ขอบ (Cache API) แบบเดียวกับ `/health`: คีย์คือ URL ล้วนของ GET, อายุตาม
 * `s-maxage=300` ของนโยบาย `storms` และ **put เฉพาะคำตอบ 200 ที่มีต้นทางเคยดึงสำเร็จ
 * แล้วอย่างน้อยหนึ่งแห่ง** — คำตอบ "ยังไม่เคยดึง" (cold start หลัง deploy) เป็น
 * `no-store` แบบเดียวกับ `cachePolicy.floodExtent(null)` ไม่งั้นมันจะค้างที่ขอบ 5 นาที
 * ทั้งที่ข้อมูลมาถึงแล้ว
 */
export async function handleStorms(
  request: Request,
  env: AppEnv,
  _params: string[],
  ctx: ExecutionContext,
): Promise<Response> {
  const cache = caches.default;
  // คีย์ = origin + pathname เท่านั้น — route นี้ไม่รับ query ใด ๆ ถ้าใส่ query
  // ลงคีย์ด้วย `?x=<สุ่ม>` จะข้าม edge cache ได้ทุกครั้ง (1 DO call ต่อคำขอ)
  const url = new URL(request.url);
  const cacheKey = new Request(url.origin + url.pathname, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let body;
  try {
    body = await env.STORM_TRACK.getByName(STORM_INSTANCE).getStorms();
  } catch (err) {
    logError("storms failed", { error: errorText(err) });
    return json({ error: "Storm tracks unavailable" }, { status: 503 });
  }
  const everFetched = body.sources.some((s) => s.lastSuccessAt !== null);
  const res = json(body, { cache: everFetched ? cachePolicy.storms : cachePolicy.noStore });
  if (res.status === 200 && everFetched) ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
