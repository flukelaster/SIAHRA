import * as cachePolicy from "../cachePolicy.js";
import { json } from "../router.js";
import type { AppEnv } from "../types.js";
import { errorText, logError } from "../log.js";

/** instance เดียวที่ cron, /health และเส้นทางนี้ใช้ร่วมกัน */
const HII_FORECAST_INSTANCE = "primary";

/**
 * GET /api/v1/rivers/forecast — พยากรณ์ปริมาณน้ำท่า/ระดับน้ำจากไฟล์ผลลัพธ์แบบจำลอง FEWS ของ สสน. (HII)
 * (คำขอเดียวทั้งลุ่ม ไม่ใช่ต่อจังหวัด) — ค่าเชิงกำหนดของแบบจำลองที่ผู้เผยแพร่ไม่ระบุชื่อ ไม่ใช่ความน่าจะเป็น
 *
 * **DO call เดียว บน instance คงที่เดียว** ซึ่งรัน SQL คำสั่งเดียว (`SELECT body FROM latest WHERE id = ?`)
 * — ไม่ปลุกการดึงต้นทาง รอบดึงถูกขับด้วย alarm รายชั่วโมงของ DO เอง ไม่มี R2/list/D1 บนเส้นทางนี้
 *
 * แคชที่ขอบ (Cache API) แบบเดียวกับ `/storms`: คีย์ = origin + pathname (route นี้ไม่รับ query ใด ๆ —
 * มี query = 400 ก่อนถึงแคช จึงแตกแคชด้วย `?x=<สุ่ม>` ไปถึง DO ไม่ได้), อายุตาม `s-maxage=300` ของนโยบาย
 * `riverForecast` และ **put เฉพาะคำตอบ 200 ที่ต้นทางเคยดึงสำเร็จแล้ว** — คำตอบ "ยังไม่เคยดึง" (cold start
 * หลัง deploy) เป็น `no-store` ไม่งั้นมันจะค้างที่ขอบ 5 นาทีทั้งที่ข้อมูลมาถึงแล้ว
 */
export async function handleRiverForecast(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (url.search !== "") {
    return json({ error: "This endpoint takes no query parameters" }, { status: 400 });
  }
  const cache = caches.default;
  const cacheKey = new Request(url.origin + url.pathname, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let body;
  try {
    body = await env.HII_FORECAST.getByName(HII_FORECAST_INSTANCE).getForecast();
  } catch (err) {
    logError("river forecast failed", { error: errorText(err) });
    return json({ error: "River forecast unavailable" }, { status: 503 });
  }
  const everFetched = body.source.lastSuccessAt !== null;
  const res = json(body, { cache: everFetched ? cachePolicy.riverForecast : cachePolicy.noStore });
  if (res.status === 200 && everFetched) ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
