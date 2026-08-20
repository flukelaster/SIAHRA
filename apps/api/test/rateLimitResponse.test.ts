import { exports as workerExports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

/**
 * E5.5 AC 1 (ส่วน 429) — rate limit ที่ประกาศไว้ในตารางเส้นทางจริง ต้องออกมาเป็น
 * `429 + Retry-After` ผ่าน Worker entrypoint ไม่ใช่แค่ผ่านฟังก์ชัน `checkLimit`
 * (rateLimit.test.ts ทดสอบตัวถังโทเคนไว้แล้ว — ที่ยังไม่เคยพิสูจน์คือสายเชื่อม
 * ระหว่างถังกับ response ที่ผู้เรียกได้รับ)
 *
 * **ไฟล์แยกโดยตั้งใจ**: ถังโทเคนและตัวนับ 429 เก็บอยู่ในหน่วยความจำของ isolate
 * (`apps/api/src/rateLimit.ts`) ไม่ได้อยู่ใน storage ของ DO — การยิงจนเต็มโควตา
 * จึงค้างอยู่กับ isolate นั้นทั้งไฟล์ และตัวนับที่โดนบวกจะไปโผล่ที่
 * `api.rateLimited429LastHour` ของ /health ด้วย
 *
 * เส้นทางที่เลือกคือ `/api/v1/earthquakes/live` เพราะโควตาต่ำสุดในตาราง
 * (10/นาที + burst 5 = 15 ครั้ง) และ handler จบที่ 426 ก่อนแตะ Durable Object
 * หรือต้นทางใด ๆ — เทสนี้จึงวัด "ชั้น rate limit" ล้วน ๆ
 *
 * แต่ละ block ใช้ IP ของตัวเอง (clientKey อ่านจาก CF-Connecting-IP) เพื่อไม่ให้
 * ถังของ block ก่อนหน้าไหลมาเปลี่ยนผลของ block ถัดไป
 */
const CAPACITY = 15;

const call = (ip: string, url = "https://siahra-radar.co/api/v1/earthquakes/live") =>
  workerExports.default.fetch(new Request(url, { headers: { "CF-Connecting-IP": ip } }));

describe("rate limit ผ่าน Worker จริง", () => {
  it("ยิงเกินโควตาแล้วได้ 429 พร้อม Retry-After ที่เป็นวินาที ≥ 1", async () => {
    const ip = "203.0.113.10";
    for (let i = 0; i < CAPACITY; i++) {
      const res = await call(ip);
      // ทุกคำขอในโควตาต้องเดินถึง handler จริง (426 = ขาด Upgrade header)
      expect(res.status).toBe(426);
    }
    const limited = await call(ip);
    expect(limited.status).toBe(429);

    const retryAfter = limited.headers.get("Retry-After");
    expect(retryAfter).not.toBeNull();
    const seconds = Number(retryAfter);
    expect(Number.isInteger(seconds)).toBe(true);
    expect(seconds).toBeGreaterThanOrEqual(1);

    // body ต้องบอกเหตุผลเป็น JSON ไม่ใช่หน้า HTML ของแพลตฟอร์ม
    await expect(limited.json()).resolves.toMatchObject({
      error: "Too many requests",
      retryAfterSeconds: seconds,
    });
  });

  it("นับแยกต่อ client — ลูกค้าอีกรายไม่โดนลูกหลงจากคนที่ยิงจนเต็ม", async () => {
    const noisy = "203.0.113.20";
    for (let i = 0; i < CAPACITY + 1; i++) await call(noisy);
    expect((await call(noisy)).status).toBe(429);
    expect((await call("203.0.113.21")).status).toBe(426);
  });

  it("โควตาแยกตาม scope — เส้นทางที่โควตากว้างกว่ายังตอบปกติ", async () => {
    const ip = "203.0.113.30";
    for (let i = 0; i < CAPACITY + 1; i++) await call(ip);
    expect((await call(ip)).status).toBe(429);
    // /health ใช้ scope ของตัวเอง (300/นาที) จึงต้องไม่ถูกถังของ live ปิดไปด้วย
    const health = await workerExports.default.fetch(
      new Request("https://siahra-radar.co/api/v1/health", { headers: { "CF-Connecting-IP": ip } }),
    );
    expect(health.status).toBe(200);
  });
});
