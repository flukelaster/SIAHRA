import { describe, expect, it, vi } from "vitest";
import { fetchTmdEvents, TMD_MISSING_CREDENTIALS, tmdCredentials } from "../src/ingestion/tmd";

/**
 * คีย์ TMD เป็น secret (`wrangler secret put`) ไม่มี fallback ในโค้ดแล้ว — เทส
 * นี้ตรึงข้อความ degrade ไว้ตรง ๆ เพราะมันคือสิ่งที่โผล่เป็น `lastError` บน
 * /api/v1/health ให้ผู้ใช้เห็นว่าฟีด TMD ใช้ไม่ได้ ไม่ใช่หายไปเงียบ ๆ
 */
const bbox = { minLat: -2, maxLat: 29, minLon: 90, maxLon: 108 };

describe("tmdCredentials", () => {
  it("needs both halves of the pair", () => {
    expect(tmdCredentials({ TMD_UID: "u", TMD_UKEY: "k" })).toEqual({ uid: "u", ukey: "k" });
    expect(tmdCredentials({ TMD_UID: "u" })).toBeNull();
    expect(tmdCredentials({ TMD_UKEY: "k" })).toBeNull();
    expect(tmdCredentials({})).toBeNull();
  });

  it("treats an empty or whitespace-only secret as unset, and trims the rest", () => {
    expect(tmdCredentials({ TMD_UID: "", TMD_UKEY: "k" })).toBeNull();
    expect(tmdCredentials({ TMD_UID: "  ", TMD_UKEY: "k" })).toBeNull();
    expect(tmdCredentials({ TMD_UID: " u \n", TMD_UKEY: " k " })).toEqual({ uid: "u", ukey: "k" });
  });

  it("has no built-in fallback pair", () => {
    // ก่อนหน้านี้โค้ดเติมคีย์สาธารณะให้เองเมื่อไม่ได้ตั้งค่า — ต้องไม่กลับมาอีก
    expect(tmdCredentials({})).toBeNull();
  });
});

describe("fetchTmdEvents without credentials", () => {
  it("rejects with the exact message /health reports, without calling upstream", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(fetchTmdEvents(bbox, {})).rejects.toThrow(TMD_MISSING_CREDENTIALS);
    expect(TMD_MISSING_CREDENTIALS).toBe("TMD credentials not configured");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
