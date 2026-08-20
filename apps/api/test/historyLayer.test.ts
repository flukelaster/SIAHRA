import { exports as workerExports } from "cloudflare:workers";
import type { HazardLayerDescriptor, WaterLevelHistoryResponse } from "@siahra/shared-types";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * /api/v1/stations/{id}/history ต้องยิงต้นทางรายสถานี จึงตอบ 503 ตามจริงเมื่อ
 * ThaiWater ล่ม (ดูเทสสัญญาใน contract.test.ts) — ไฟล์นี้จึงจำลอง "ต้นทางตอบ
 * สำเร็จแต่ไม่มีจุดข้อมูล" เพื่อตรวจ layer descriptor ของ route นี้ให้ครบ
 * (storage ของ Durable Object แยกกันต่อไฟล์เทส จึงไม่ชนกับไฟล์อื่น)
 */
afterEach(() => {
  vi.restoreAllMocks();
});

describe("/api/v1/stations/{id}/history", () => {
  it("ส่ง layer descriptor ที่ชี้ไปยัง source \"thaiwater\"", async () => {
    // ต้องสร้าง Response ใหม่ทุกครั้ง — body stream ที่สร้างใน DO ตัวหนึ่ง
    // ใช้ข้าม DO ไม่ได้ (ข้อจำกัดของ workerd)
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ data: { graph_data: [] } }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    const res = await workerExports.default.fetch(
      new Request("https://siahra-radar.co/api/v1/stations/1/history?hours=24"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as WaterLevelHistoryResponse;
    const layer = body.layer as HazardLayerDescriptor;
    expect(layer.sourceIds).toEqual(["thaiwater"]);
    expect(layer.epistemicClass).toBe("observed");
    expect(layer.liveOrStatic).toBe("live");
    // ThaiWater ไม่มีเวลาเผยแพร่ของชุดข้อมูล → null เสมอ ไม่ใช่เวลาที่เราดึง
    expect(layer.publishedAt ?? null).toBeNull();
    if (layer.fetchedAt !== null) expect(Number.isFinite(Date.parse(layer.fetchedAt))).toBe(true);
  }, 15_000);
});
