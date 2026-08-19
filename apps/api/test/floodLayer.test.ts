import { exports as workerExports } from "cloudflare:workers";
import type { FloodExtentSummaryResponse } from "@siahra/shared-types";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * เคส "ต้นทางตอบสำเร็จ" ของ GISTDA: fetchedAt ต้องเป็นเวลาจริง แต่ publishedAt
 * ต้องยังเป็น null — ต่อให้ GeoServer แนบ `timeStamp` มา เพราะนั่นคือเวลาที่มัน
 * สร้าง response ไม่ใช่เวลาที่ฉากน้ำท่วมถูกเผยแพร่ (วัดจริง 2026-08-19: ค่าเดิน
 * ตามนาฬิกาของคำขอทั้งที่ข้อมูลเหมือนกันทุกไบต์ จน publishedAt ล้ำ fetchedAt ได้)
 *
 * storage ของ Durable Object แยกกันต่อไฟล์เทส จึงเริ่มจาก DO ที่ยังไม่มีข้อมูล
 */
afterEach(() => {
  vi.restoreAllMocks();
});

const SCENE = {
  type: "FeatureCollection",
  timeStamp: "2999-01-01T00:00:00.000Z",
  totalFeatures: 1,
  features: [
    {
      type: "Feature",
      id: "FloodArea_Poly.1",
      properties: { PV_IDN: 50, TB_IDN: 1, flood_area: 12.5, house: 3, lat: 18.8, long: 98.98 },
      geometry: {
        type: "Polygon",
        coordinates: [[[98.9, 18.7], [99.0, 18.7], [99.0, 18.8], [98.9, 18.8], [98.9, 18.7]]],
      },
    },
  ],
};

describe("/api/v1/flood-extent/summary เมื่อต้นทางตอบสำเร็จ", () => {
  it("fetchedAt เป็นเวลาจริง แต่ publishedAt ยังเป็น null", async () => {
    // Response ใหม่ทุกครั้ง: body stream ที่สร้างใน DO ตัวหนึ่งใช้ข้าม DO ไม่ได้
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify(SCENE), { headers: { "Content-Type": "application/json" } }),
    );
    const res = await workerExports.default.fetch(
      new Request("https://siahra-radar.co/api/v1/flood-extent/summary"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as FloodExtentSummaryResponse;
    expect(body.layer.sourceIds).toEqual(["gistda-flood"]);
    expect(body.layer.fetchedAt).not.toBeNull();
    expect(Number.isFinite(Date.parse(body.layer.fetchedAt as string))).toBe(true);
    expect(body.layer.publishedAt ?? null).toBeNull();
  }, 20_000);
});
