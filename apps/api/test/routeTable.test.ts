import { exports as workerExports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { routes } from "../src/index";

/**
 * เทสระดับตารางเส้นทาง (E5.2 + E4.5) — ยิงผ่าน entrypoint จริงเฉพาะเส้นทางที่จบ
 * ก่อนแตะ Durable Object หรือ upstream: 404 ของเส้นทางที่ถูกถอด และ 400 ของ
 * input ที่ตรวจแล้วไม่ผ่านตั้งแต่ก่อนเรียก DO
 */
const workerFetch = (url: string, init: RequestInit = {}) =>
  workerExports.default.fetch(new Request(url, init));

describe("/hazards/latest ถูกถอดออกแล้ว (E5.2)", () => {
  it("ตอบ 404 เป็น JSON ไม่ใช่ 405 หรือ HTML", async () => {
    const res = await workerFetch("https://example.com/api/v1/provinces/10/hazards/latest");
    expect(res.status).toBe(404);
    expect(res.headers.get("Allow")).toBeNull();
    await expect(res.json()).resolves.toMatchObject({ error: "Not found" });
  });

  it("ไม่กระทบเส้นทาง provinces ตัวอื่นในตาราง", () => {
    // เช็คที่ตาราง route ตรง ๆ แทนการยิงคำขอจริง — ยิงจริงเคยแตะ FloodExtentDO
    // ซึ่งบน cold start ไปเรียก fetch ต้นทาง GISTDA จริงด้วย (ไม่ได้ mock ในเทส
    // นี้) แม้ ensureFresh() จะไม่รอเกิน COLD_START_WAIT_MS (3s) แต่ overhead
    // ของ DO cold init + network บน CI runner ที่โหลดสูงเคยดันเวลารวมเกิน
    // testTimeout ค่าเริ่มต้นของ vitest (5s) ไปได้ — ที่ต้องยืนยันจริง ๆ คือ
    // เส้นทางยังอยู่ในตาราง ไม่ใช่ต้นทางตอบอะไรมา จึงเช็คตรงนี้แทน ไม่ต้องพึ่ง DO/network เลย
    const match = routes.find(
      (r) => r.method === "GET" && r.pattern.test("/api/v1/provinces/10/flood-extent"),
    );
    expect(match).toBeDefined();
  });
});

describe("input validation (E4.5)", () => {
  it("at ที่พังตอบ 400 ไม่ใช่ 500", async () => {
    const res = await workerFetch("https://example.com/api/v1/observations?at=yesterday");
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("ISO-8601") });
  });

  it("at ที่พังบน archive/snapshot ก็ตอบ 400 เช่นกัน", async () => {
    const res = await workerFetch("https://example.com/api/v1/archive/snapshot?at=%20");
    expect(res.status).toBe(400);
  });

  it("province ที่ผิดรูปตอบ 400 พร้อมบอกรูปแบบที่ถูก", async () => {
    const res = await workerFetch("https://example.com/api/v1/observations?province=abc");
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("two digits") });
  });

  it("ทุกเส้นทางประกาศ rate limit ของตัวเอง ไม่พึ่ง DEFAULT_LIMIT", () => {
    const implicit = routes.filter((r) => r.limit === undefined).map((r) => r.pattern.source);
    expect(implicit).toEqual([]);
    for (const r of routes) expect(r.limit?.perMinute).toBeGreaterThan(0);
  });
});
