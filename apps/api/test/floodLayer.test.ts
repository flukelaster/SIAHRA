import { exports as workerExports } from "cloudflare:workers";
import type { FloodExtentSummaryResponse } from "@siahra/shared-types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TEST_GISTDA_KEY, gistdaCell, runFloodAlarm, serveGistda, setGistdaKey } from "./helpers/gistdaApi";
// โหลดกราฟโมดูลของ Worker (src/index.ts + JSON ใน src/data ~4 MB) ตั้งแต่ตอน collect ไฟล์ —
// `exports.default` import มันแบบ lazy ตอนถูกเรียกครั้งแรก ซึ่งกินเวลา 5 วิของเทสแรกไป
// 2–4.6 วิเมื่อไฟล์เทสรันขนานกัน (CI เคย timeout ที่นี่) แบบเดียวกับ routeTable.test.ts
import "../src/index";

/**
 * เคส "ต้นทางตอบสำเร็จ" ของ GISTDA (E16.PR0): fetchedAt ต้องเป็นเวลาจริงของรอบ alarm,
 * `publishedAt` = `_createdAt` ใหม่สุดของต้นทาง (เวลาที่ GISTDA สร้างระเบียนจริง) — **ไม่ใช่**
 * `timeStamp` ของซอง ซึ่งยังเป็นเวลาที่สร้าง response (เดินตามนาฬิกาของคำขอ) และ
 * ต้องไม่ใหม่กว่า fetchedAt; `observedAt` = ภาพใหม่สุดจาก `file_name`
 *
 * storage ของ Durable Object แยกกันต่อไฟล์เทส จึงเริ่มจาก DO ที่ยังไม่มีข้อมูล
 */
afterEach(() => {
  vi.restoreAllMocks();
  setGistdaKey(undefined);
});

describe("/api/v1/flood-extent/summary เมื่อต้นทางตอบสำเร็จ", () => {
  it("fetchedAt เป็นเวลาจริง, publishedAt มาจาก _createdAt ไม่ใช่ timeStamp ของซอง", async () => {
    setGistdaKey(TEST_GISTDA_KEY);
    serveGistda({
      "50": [gistdaCell({ h3: "89650000001ffff", province: "50", createdAt: "2026-09-26T06:22:30.668Z", fileName: "S1C_20260923_1812" })],
    });
    await runFloodAlarm();
    const res = await workerExports.default.fetch(new Request("https://siahra-radar.co/api/v1/flood-extent/summary"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as FloodExtentSummaryResponse;
    expect(body.layer.sourceIds).toEqual(["gistda-flood"]);
    expect(body.layer.epistemicClass).toBe("observed");
    expect(body.layer.fetchedAt).not.toBeNull();
    expect(Number.isFinite(Date.parse(body.layer.fetchedAt as string))).toBe(true);
    expect(body.layer.publishedAt).toBe("2026-09-26T06:22:30.668Z");
    expect(Date.parse(body.layer.publishedAt!)).toBeLessThanOrEqual(Date.parse(body.layer.fetchedAt!));
    expect(body.layer.observedAt).toBe("2026-09-23T11:12:00.000Z");
    expect(body.provinces.find((p) => p.provinceCode === "50")).toMatchObject({ cellCount: 1 });
  }, 20_000);
});
