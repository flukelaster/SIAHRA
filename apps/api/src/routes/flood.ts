import { parseQuery } from "../query.js";
import * as cachePolicy from "../cachePolicy.js";
import { json } from "../router.js";
import type { AppEnv } from "../types.js";
import { errorText, logError } from "../log.js";

/**
 * คำตอบที่ DO serialise + gzip ไว้แล้ว → Response ธรรมดา: คลาย gzip เป็น stream ที่นี่
 * (ไม่มี JSON.parse/stringify ของ feature ต่อคำขอ) แล้วปล่อยให้ Cloudflare บีบอัดตาม
 * `Accept-Encoding` ของผู้ขอเอง — `res.json()` ในเทสและ `caches.default` จึงเห็นคำตอบปกติ
 */
export function gzJsonResponse(gz: ArrayBuffer, cache: cachePolicy.CachePolicy): Response {
  const body = new Response(gz).body!.pipeThrough(new DecompressionStream("gzip"));
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": cache.value },
  });
}

/**
 * GET /api/v1/provinces/{NN}/flood-extent[?at=<iso>] — GISTDA satellite flood
 * cells for one province; `at` (E14.F1) answers from the pull that covered
 * that instant instead of the latest one, validated the same way as
 * /observations so a bad value is a 400, never a NaN in the Durable Object.
 *
 * Live (ไม่มี `at`) ผ่าน `caches.default` ≤ 300 วิ คีย์คือ URL เต็ม — เฉพาะเมื่อ
 * `retrievedAt` ไม่เป็น null (devops constraint 11) แบบเดียวกับ routes/health.ts:
 * คำตอบ "ยังไม่เคยดึงสำเร็จ" ห้ามค้างในแคช เพราะ alarm รอบแรกอาจจบในไม่กี่วินาที
 */
export async function handleProvinceFloodExtent(
  province: string,
  request: Request,
  env: AppEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const q = parseQuery(url, { at: { type: "isoInstant" } });
  if (!q.ok) return json({ error: q.error }, { status: 400 });
  const atMs = q.value.at ? Date.parse(q.value.at) : null;
  const live = atMs === null;
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: "GET" });
  if (live) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }
  const stub = env.FLOOD_EXTENT.getByName("gistda");
  try {
    const data = await stub.getProvinceBody(province, atMs);
    const res = gzJsonResponse(data.gz, cachePolicy.floodExtent(data.retrievedAt, !live));
    if (live && data.retrievedAt) ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (err) {
    logError("flood extent request failed", { error: errorText(err) });
    return json({ error: "Flood extent unavailable" }, { status: 503 });
  }
}

/**
 * GET /api/v1/flood-extent/summary — per-province totals of the latest pull (one meta row).
 * ผ่าน `caches.default` ≤ 300 วิ แบบเดียวกับ live ของรายจังหวัด — เฉพาะเมื่อ `retrievedAt`
 * ไม่เป็น null (คำตอบ "ยังไม่เคยดึงสำเร็จ" ห้ามค้างในแคช)
 */
export async function handleFloodExtentSummary(
  request: Request,
  env: AppEnv,
  _params: string[],
  ctx: ExecutionContext,
): Promise<Response> {
  const cache = caches.default;
  // route นี้ไม่อ่าน query เลย — คีย์ตัด query ทิ้ง กัน `?x=1,2,3…` แตกแคชเป็นคำขอ DO
  const url = new URL(request.url);
  const cacheKey = new Request(`${url.origin}${url.pathname}`, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  const stub = env.FLOOD_EXTENT.getByName("gistda");
  try {
    const data = await stub.getSummaryBody();
    const res = new Response(data.body, {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": cachePolicy.floodExtent(data.retrievedAt).value },
    });
    if (data.retrievedAt) ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (err) {
    logError("flood summary request failed", { error: errorText(err) });
    return json({ error: "Flood extent unavailable" }, { status: 503 });
  }
}
