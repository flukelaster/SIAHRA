import { exports as workerExports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HealthResponse, SourceId } from "@siahra/shared-types";

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
