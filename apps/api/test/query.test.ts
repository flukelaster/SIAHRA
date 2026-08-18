import { describe, expect, it } from "vitest";
import { parseQuery } from "../src/query";

/**
 * เทสของตัวตรวจ input ร่วม (E4.5) — ข้อสำคัญคือค่าที่พังต้องได้ 400 พร้อมชื่อ
 * พารามิเตอร์ ไม่ใช่ NaN ไหลไปถึง Durable Object แล้วกลายเป็น 500 และ `limit`
 * ต้องถูกหนีบไม่ให้เกินเพดาน
 */
const url = (qs: string) => new URL(`https://siahra-radar.co/api/v1/x${qs}`);

describe("parseQuery", () => {
  it("คืนค่า null เมื่อไม่ได้ส่งพารามิเตอร์ที่เป็นตัวเลือก", () => {
    const q = parseQuery(url(""), { province: { type: "province" }, at: { type: "isoInstant" } });
    expect(q).toEqual({ ok: true, value: { province: null, at: null } });
  });

  it("ปฏิเสธรหัสจังหวัดที่ไม่ใช่เลขสองหลัก", () => {
    const q = parseQuery(url("?province=5"), { province: { type: "province" } });
    expect(q.ok).toBe(false);
    if (!q.ok) expect(q.param).toBe("province");
  });

  it("ปฏิเสธ at ที่ไม่ใช่ ISO-8601 (400 ไม่ใช่ 500)", () => {
    const bad = parseQuery(url("?at=yesterday"), { at: { type: "isoInstant" } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("ISO-8601");

    const good = parseQuery(url("?at=2026-08-18T09:00:00Z"), { at: { type: "isoInstant" } });
    expect(good).toMatchObject({ ok: true, value: { at: "2026-08-18T09:00:00Z" } });
  });

  it("หนีบ limit ไว้ที่เพดาน 500 และพื้น 1", () => {
    const spec = { limit: { type: "int", min: 1, max: 500, fallback: 100 } } as const;
    expect(parseQuery(url("?limit=99999"), spec)).toMatchObject({ value: { limit: 500 } });
    expect(parseQuery(url("?limit=0"), spec)).toMatchObject({ value: { limit: 1 } });
    expect(parseQuery(url("?limit=-5"), spec)).toMatchObject({ value: { limit: 1 } });
    expect(parseQuery(url("?limit=12.7"), spec)).toMatchObject({ value: { limit: 13 } });
    expect(parseQuery(url(""), spec)).toMatchObject({ value: { limit: 100 } });
  });

  it("ปฏิเสธตัวเลขที่แปลงไม่ได้ แทนที่จะเงียบ ๆ ใช้ค่า default", () => {
    const q = parseQuery(url("?hours=soon"), { hours: { type: "int", min: 1, max: 720, fallback: 3 } });
    expect(q.ok).toBe(false);
    if (!q.ok) expect(q.param).toBe("hours");
  });

  it("float ที่ไม่ส่งมาเป็น null ส่งมาเป็นตัวเลข และส่งขยะเป็น error", () => {
    const spec = { minMag: { type: "float" } } as const;
    expect(parseQuery(url(""), spec)).toMatchObject({ value: { minMag: null } });
    expect(parseQuery(url("?minMag=4.5"), spec)).toMatchObject({ value: { minMag: 4.5 } });
    expect(parseQuery(url("?minMag=big"), spec).ok).toBe(false);
  });

  it("รายงานพารามิเตอร์ตัวแรกที่พัง", () => {
    const q = parseQuery(url("?province=xx&at=nope"), {
      province: { type: "province" },
      at: { type: "isoInstant" },
    });
    expect(q.ok).toBe(false);
    if (!q.ok) expect(q.param).toBe("province");
  });
});
