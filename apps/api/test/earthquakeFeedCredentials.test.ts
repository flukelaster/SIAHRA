import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EarthquakeFeedDO } from "../src/durable-objects/earthquake-feed";

/**
 * ทั้ง worktree นี้และ production ที่ยังไม่ได้ `wrangler secret put` มีสภาพ
 * เดียวกัน: ไม่มี TMD_UID/TMD_UKEY เทสนี้จึงยืนยันสิ่งที่ /api/v1/health ต้อง
 * รายงานในสภาพนั้น — earthquakes เป็น `degraded` พร้อม lastError ที่อ่านรู้เรื่อง
 * ส่วน USGS/EMSC ยังเข้าคลังตามปกติ (poll ทั้งก้อนต้องไม่ throw)
 *
 * วิธี mock: สตับ global fetch ตรง ๆ ไม่ใช่ `fetchMock` — pool 0.22 ไม่ export
 * `fetchMock` จาก "cloudflare:test" อีกแล้ว (ไม่มีใน types/cloudflare-test.d.ts
 * และไม่มีใน dist) เหลือแต่ชนิด MockAgent ที่ไม่มีตัวจริงให้ใช้ ; สตับ global
 * ใช้ได้เพราะ main worker กับ Durable Object รันในไอโซเลตเดียวกับเทส (ตามที่
 * types ของ pool ระบุไว้เอง) — calledHosts จึงเห็นทุกคำขอที่ DO ยิงออกไป
 * USGS/EMSC ตอบ payload ว่างเปล่า ส่วน host อื่น (รวม data.tmd.go.th) โยน error
 * ทันที ถ้าโค้ดเผลอยิงไปหา TMD ทั้งที่ไม่มีคีย์ เทสนี้จะเห็นจาก calledHosts
 */
const emptyFeatureCollection = JSON.stringify({ type: "FeatureCollection", features: [] });
const calledHosts: string[] = [];

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calledHosts.push(url.host);
    if (url.host === "earthquake.usgs.gov" || url.host === "www.seismicportal.eu") {
      return new Response(emptyFeatureCollection, { headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected upstream call to ${url.host}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("earthquake feed with no TMD secret", () => {
  it("degrades only the TMD leg and reports it verbatim on /health", async () => {
    expect(env.TMD_UID ?? "").toBe("");
    expect(env.TMD_UKEY ?? "").toBe("");

    const stub = env.EARTHQUAKE_FEED.getByName("no-tmd-credentials");
    await runInDurableObject(stub, async (instance: EarthquakeFeedDO) => {
      // ต้องไม่ throw — ฟีดที่เหลือต้องเดินต่อได้
      await instance.pollAndBroadcast();
      const [status] = await instance.status();
      expect(status.id).toBe("earthquakes");
      expect(status.health).toBe("degraded");
      expect(status.lastError).toBe("TMD credentials not configured");
      expect(status.fetchedAt).not.toBeNull();
      // ไม่มีคีย์ = ไม่ยิงไปหา TMD เลย (ไม่ใช่ยิงแล้วโดนปฏิเสธ)
      expect(calledHosts).not.toContain("data.tmd.go.th");
      expect(calledHosts).toContain("earthquake.usgs.gov");
    });
  });
});
