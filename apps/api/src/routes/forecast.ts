import { isProvinceCode } from "@siahra/shared-types";
import * as cachePolicy from "../cachePolicy.js";
import { json } from "../router.js";
import type { AppEnv } from "../types.js";
import { errorText, logError } from "../log.js";

/**
 * เส้นทางของผลพยากรณ์ TMD NWP (E12.2)
 *
 * ทั้งสองเส้นทางอ่านจาก Durable Object อย่างเดียว **ไม่ปลุกการดึงต้นทาง**
 * (ต่างจาก `/radar/frames` ที่เรียก `ensureFresh()`) — รอบดึงถูกขับด้วย cron
 * รายชั่วโมงเท่านั้น เพื่อให้เส้นทางต่อคำขอเป็นการอ่านแถวเดียวด้วย primary key
 * จริง ๆ ตามงบ rows read ที่ตั้งไว้
 *
 * ยังไม่เคยดึงสำเร็จ = `batch: null` พร้อม `layers.*.fetchedAt: null` และตอบ 200
 * ไม่ใช่ 503: จังหวัดนั้นมีอยู่จริง คำตอบที่ถูกต้องคือ "เรายังไม่เคยได้รับผลพยากรณ์"
 * ซึ่งเป็นข้อมูลที่ UI ต้องแสดง ไม่ใช่ความล้มเหลวของ endpoint
 */

const NWP_INSTANCE = "tmd";

/** GET /api/v1/provinces/{NN}/forecast */
export async function handleProvinceForecast(province: string, env: AppEnv): Promise<Response> {
  // รูปถูก (สองหลัก) แต่ไม่ใช่รหัสจังหวัดจริง = ไม่มีทรัพยากรนี้ → 404
  if (!isProvinceCode(province)) {
    return json({ error: `Unknown province code "${province}"` }, { status: 404 });
  }
  try {
    const body = await env.FORECAST_NWP.getByName(NWP_INSTANCE).getProvince(province);
    return json(body, { cache: cachePolicy.observations });
  } catch (err) {
    logError("province forecast failed", { province, error: errorText(err) });
    return json({ error: "Forecast unavailable" }, { status: 503 });
  }
}

/**
 * GET /api/v1/forecast/availability — ช่วงวันที่ TMD ประกาศว่ามีผลพยากรณ์รายวันให้
 * อ่านจาก `meta` ล้วน ๆ พร้อม `fetchedAt` ของตัวมันเอง (null = ไม่เคยอ่านสำเร็จ)
 */
export async function handleForecastAvailability(env: AppEnv): Promise<Response> {
  try {
    const body = await env.FORECAST_NWP.getByName(NWP_INSTANCE).availability();
    return json(body, { cache: cachePolicy.observations });
  } catch (err) {
    logError("forecast availability failed", { error: errorText(err) });
    return json({ error: "Forecast unavailable" }, { status: 503 });
  }
}
