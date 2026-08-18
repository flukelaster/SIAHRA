import { json } from "../router.js";
import type { AppEnv } from "../types.js";

/**
 * คำตอบ "ยังไม่เคยดึงสำเร็จ" อาจเกิดตอน cold start ที่ refresh ยังวิ่งอยู่ —
 * ห้ามให้มันค้างในแคชนานจนผู้ใช้เห็น "ต้นทางไม่ตอบสนอง" ทั้งที่ข้อมูลมาแล้ว
 */
function freshnessCache(retrievedAt: string | null): string {
  return retrievedAt ? "public, max-age=300, s-maxage=600" : "no-store";
}

/** GET /api/v1/provinces/{NN}/flood-extent — GISTDA satellite flood polygons for one province. */
export async function handleProvinceFloodExtent(province: string, env: AppEnv): Promise<Response> {
  const stub = env.FLOOD_EXTENT.getByName("gistda");
  try {
    const data = await stub.getProvince(province);
    return json(data, { cacheControl: freshnessCache(data.retrievedAt) });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", message: "flood extent request failed", error: String(err) }));
    return json({ error: "Flood extent unavailable" }, { status: 503 });
  }
}

/** GET /api/v1/flood-extent/summary — per-province totals of the current scene. */
export async function handleFloodExtentSummary(_req: Request, env: AppEnv): Promise<Response> {
  const stub = env.FLOOD_EXTENT.getByName("gistda");
  try {
    const data = await stub.getSummary();
    return json(data, { cacheControl: freshnessCache(data.retrievedAt) });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", message: "flood summary request failed", error: String(err) }));
    return json({ error: "Flood extent unavailable" }, { status: 503 });
  }
}
