import { env, exports as workerExports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HealthResponse, SourceId, SourceStatus } from "@siahra/shared-types";
import type { AppEnv } from "../src/types";

/**
 * E5.5 AC 2 — `/api/v1/health` ของ Worker ที่ยัง "เย็น" (ไม่เคยดึงต้นทางสำเร็จเลย)
 *
 * ข้อที่ต้องพิสูจน์คือกฎ data-honesty ข้อแรกสุด: **ไม่เคยดึงสำเร็จ ต้องรายงานว่า
 * ไม่เคย** — `fetchedAt: null` (ไม่ใช่เวลาปัจจุบัน) และ health เป็น `unknown`/`down`
 * ไม่ใช่ `ok` และ endpoint ต้องไม่ซ่อนต้นทางที่ยังไม่มีข้อมูลออกจากรายการ
 *
 * **ไฟล์นี้อยู่แยกเป็นไฟล์ของตัวเองโดยตั้งใจ** ด้วยสองเหตุผล:
 * 1. storage ของ Durable Object แยกกันข้ามไฟล์เทส แต่อยู่ยาวข้าม block ในไฟล์
 *    เดียวกัน (ดู vitest.config.ts) และ `handleHealth` เรียก DO ด้วย "ชื่อคงที่"
 *    (thaiwater / global / gistda / tmd) — เทสอื่นในไฟล์เดียวกันที่บังเอิญทำให้
 *    instance เหล่านั้นดึงข้อมูลสำเร็จ จะทำให้คำว่า "เย็น" หมดความหมายทันที
 * 2. ตัวนับ 429 ของ rateLimit อยู่ในหน่วยความจำของ isolate และโผล่ใน
 *    `api.rateLimited429LastHour` — เทส 429 จึงอยู่คนละไฟล์ (rateLimitResponse)
 *
 * ทุก fetch ถูกสตับให้ล้มเหลว: ถ้ามีโค้ดเส้นทางไหนแอบยิงต้นทางจริงระหว่างตอบ
 * /health เทสนี้จะยังผ่าน (down ก็ยอมรับตาม AC) แต่เครื่องที่รันเทสจะไม่ออกเน็ต
 */
const workerFetch = (url: string, init: RequestInit = {}) =>
  workerExports.default.fetch(new Request(url, init));

/** E10.3 จะเพิ่มแหล่งที่ห้า — เทียบเป็น "เซตย่อยที่ต้องมี" ไม่ใช่จำนวนที่ต้องเท่ากัน */
const REQUIRED: SourceId[] = ["thaiwater", "earthquakes", "gistda-flood", "tmd-radar"];

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("network disabled in this test");
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/v1/health เมื่อยังไม่เคยดึงต้นทางสำเร็จ", () => {
  it("รายงานทุกแหล่งที่ต้องมี พร้อม fetchedAt: null และ health ที่ไม่ใช่ ok", async () => {
    const res = await workerFetch("https://siahra-radar.co/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = (await res.json()) as HealthResponse;
    const ids = body.sources.map((s) => s.id);
    for (const id of REQUIRED) expect(ids).toContain(id);

    for (const id of REQUIRED) {
      const source = body.sources.find((s) => s.id === id)!;
      // ยังไม่เคยสำเร็จ = ไม่มีเวลาให้แสดง ห้ามเป็นสตริงเวลาใด ๆ ทั้งสิ้น
      expect(source.fetchedAt).toBeNull();
      expect(["unknown", "down"]).toContain(source.health);
      // ป้ายชื่อสองภาษาต้องมาพร้อมสถานะเสมอ ไม่งั้นแถบสถานะแสดงชื่อแหล่งไม่ได้
      expect(source.labelTh.length).toBeGreaterThan(0);
      expect(source.labelEn.length).toBeGreaterThan(0);
    }

    // ความเงียบไม่ใช่ความแข็งแรง: ok ต้องเป็น false และ worst ต้องไม่ใช่ ok
    expect(body.ok).toBe(false);
    expect(body.worst).not.toBe("ok");
    expect(Date.parse(body.serverTime)).toBeGreaterThan(0);
  });

  it("HEAD ตอบสถานะเดียวกันโดยไม่มี body", async () => {
    const res = await workerFetch("https://siahra-radar.co/api/v1/health", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });
});

/**
 * E14.F3 — `copernicus-gfm` ไม่มี Durable Object: job GitHub Actions เขียน `flood/gfm/health.json`
 * ลง R2 แล้ว /health อ่านใบนั้นใบเดียว เทสนี้ seed binding R2 ของ workerd โดยตรง
 *
 * คำตอบของ /health ถูกแคชที่ขอบ 15 วิด้วย URL เต็ม — แต่ละเคสจึงใช้ `?t=` ของตัวเอง
 * เวลาใน fixture คิดจากนาฬิกาจริง ณ ตอนเทส (ไม่ freeze): สิ่งที่วัดคือ "ระยะห่างจากตอนนี้" ไม่ใช่
 * instant คงที่ จึงไม่มีวันหมดอายุตามปฏิทิน (docs/testing.md)
 */
const appEnv = env as unknown as AppEnv;
const GFM_KEY = "flood/gfm/health.json";
const HOUR = 3600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString().replace(/\.\d{3}Z$/, "Z");

async function gfmSource(tag: string): Promise<SourceStatus> {
  const res = await workerFetch(`https://siahra-radar.co/api/v1/health?t=gfm-${tag}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as HealthResponse;
  const src = body.sources.find((s) => s.id === "copernicus-gfm");
  expect(src, "copernicus-gfm ต้องอยู่ใน /health เสมอ (แหล่ง live)").toBeDefined();
  return src!;
}

describe("copernicus-gfm ใน GET /api/v1/health (อ่าน flood/gfm/health.json จาก R2)", () => {
  afterEach(async () => {
    await appEnv.HAZARD_BUCKET.delete(GFM_KEY);
  });

  it("ไม่มี object → unknown, fetchedAt null, lastError ระบุคีย์ที่หาย", async () => {
    await appEnv.HAZARD_BUCKET.delete(GFM_KEY);
    const s = await gfmSource("missing");
    expect(s.health).toBe("unknown");
    expect(s.fetchedAt).toBeNull();
    expect(s.latestObservedAt).toBeNull();
    expect(s.lastAttemptAt).toBeNull();
    expect(s.lastError).toContain(GFM_KEY);
    expect(s.staleAfterSeconds).toBe(43_200);
    expect(s.observedLagSeconds).toBeNull();
    expect(s.nextAttemptAt).toBeNull();
    expect(s.labelTh.length).toBeGreaterThan(0);
  });

  it("run สำเร็จเมื่อชั่วโมงก่อน → ok; fetchedAt = lastSuccessAt, latestObservedAt = ฉากล่าสุด, detail มีตัวนับ", async () => {
    const at = ago(1 * HOUR);
    await appEnv.HAZARD_BUCKET.put(
      GFM_KEY,
      JSON.stringify({
        lastRunAt: at,
        lastSuccessAt: at,
        lastSceneObservedAt: "2024-09-13T11:21:51Z",
        lastError: null,
        itemsProcessed: 10,
        scenesWritten: 1,
      }),
    );
    const s = await gfmSource("ok");
    expect(s.health).toBe("ok");
    expect(s.fetchedAt).toBe(at);
    expect(s.lastAttemptAt).toBe(at);
    // ภาพเก่าเป็นปีก็ยัง ok: Sentinel-1 ไม่มีคาบที่ตัดสิน delayed ได้ (observedLagSeconds null)
    expect(s.latestObservedAt).toBe("2024-09-13T11:21:51Z");
    expect(s.lastError).toBeNull();
    expect(s.detail).toEqual({ itemsProcessed: 10, scenesWritten: 1 });
  });

  it("run ล่าสุดล้ม → degraded; fetchedAt ยังเป็น lastSuccessAt ก่อนหน้า ไม่ใช่ lastRunAt ของรอบที่ล้ม", async () => {
    const success = ago(7 * HOUR);
    const attempt = ago(1 * HOUR);
    await appEnv.HAZARD_BUCKET.put(
      GFM_KEY,
      JSON.stringify({
        lastRunAt: attempt,
        lastSuccessAt: success,
        lastSceneObservedAt: "2024-09-13T11:21:51Z",
        lastError: "57/20240913T112151-AS020M: RasterioIOError: HTTP 503",
        itemsProcessed: 4,
        scenesWritten: 0,
      }),
    );
    const s = await gfmSource("failed");
    expect(s.health).toBe("degraded");
    expect(s.fetchedAt).toBe(success);
    expect(s.lastAttemptAt).toBe(attempt);
    expect(s.lastError).toContain("RasterioIOError");
  });

  it("ล้มติดกันจนไม่มีรอบสำเร็จเกิน 12 ชม. → down (ไม่ใช่แค่ stale)", async () => {
    await appEnv.HAZARD_BUCKET.put(
      GFM_KEY,
      JSON.stringify({
        lastRunAt: ago(1 * HOUR),
        lastSuccessAt: ago(20 * HOUR),
        lastSceneObservedAt: "2024-09-13T11:21:51Z",
        lastError: "search: TimeoutError: stac.eodc.eu",
        itemsProcessed: 0,
        scenesWritten: 0,
      }),
    );
    expect((await gfmSource("down")).health).toBe("down");
  });

  it("ไม่มีรอบสำเร็จมา 13 ชม. และไม่มี error (cron ไม่ยิง) → stale", async () => {
    const at = ago(13 * HOUR);
    await appEnv.HAZARD_BUCKET.put(
      GFM_KEY,
      JSON.stringify({ lastRunAt: at, lastSuccessAt: at, lastSceneObservedAt: null, lastError: null, itemsProcessed: 0, scenesWritten: 0 }),
    );
    const s = await gfmSource("stale");
    expect(s.health).toBe("stale");
    expect(s.fetchedAt).toBe(at);
    expect(s.latestObservedAt).toBeNull();
  });

  it("ไม่เคยสำเร็จเลย (lastSuccessAt null) แต่มี error → down พร้อม fetchedAt null", async () => {
    await appEnv.HAZARD_BUCKET.put(
      GFM_KEY,
      JSON.stringify({ lastRunAt: ago(1 * HOUR), lastSuccessAt: null, lastSceneObservedAt: null, lastError: "search: x", itemsProcessed: 0, scenesWritten: 0 }),
    );
    const s = await gfmSource("never");
    expect(s.health).toBe("down");
    expect(s.fetchedAt).toBeNull();
    expect(s.lastAttemptAt).not.toBeNull();
  });

  it("object ที่ไม่ใช่ JSON → unknown พร้อม lastError ระบุคีย์ (ไม่ใช่ 500 ทั้ง endpoint)", async () => {
    await appEnv.HAZARD_BUCKET.put(GFM_KEY, "{not json");
    const s = await gfmSource("garbage");
    expect(s.health).toBe("unknown");
    expect(s.fetchedAt).toBeNull();
    expect(s.lastError).toContain(GFM_KEY);
  });

  it("เวลาที่ไม่ใช่ ISO ใน health.json ไม่ถูกส่งต่อ (null ไม่ใช่สตริงขยะหรือ now)", async () => {
    await appEnv.HAZARD_BUCKET.put(
      GFM_KEY,
      JSON.stringify({ lastRunAt: "now", lastSuccessAt: "", lastSceneObservedAt: 12345, lastError: "", itemsProcessed: "10", scenesWritten: null }),
    );
    const s = await gfmSource("shape");
    expect(s.fetchedAt).toBeNull();
    expect(s.lastAttemptAt).toBeNull();
    expect(s.latestObservedAt).toBeNull();
    expect(s.lastError).toBeNull();
    expect(s.health).toBe("unknown");
    expect(s.detail).toEqual({ itemsProcessed: null, scenesWritten: null });
  });
});
