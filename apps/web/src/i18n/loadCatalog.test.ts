import { describe, expect, it, vi } from "vitest";

/**
 * แคตตาล็อกอังกฤษเป็น chunk แยก — vitestSetup.ts โหลดไว้ให้ทุกไฟล์แล้ว เทสนี้จึงดึง
 * `i18n/index` ชุดใหม่ (resetModules) เพื่อดูสถานะก่อนโหลดจริง
 */
describe("loadCatalog", () => {
  it("ไทยพร้อมเสมอ อังกฤษพร้อมหลังโหลด และโหลดซ้ำได้ไม่พัง", async () => {
    vi.resetModules();
    const i18n = await import("./index");
    expect(i18n.hasCatalog("th")).toBe(true);
    expect(i18n.hasCatalog("en")).toBe(false);
    // ยังไม่โหลด: ได้ข้อความไทย ไม่ใช่ undefined / คีย์ดิบ
    expect(i18n.translate("en", "common.close")).toBe("ปิด");
    expect(() => i18n.catalogFor("en")).toThrow(/not loaded/);

    await Promise.all([i18n.loadCatalog("en"), i18n.loadCatalog("en")]);
    await i18n.loadCatalog("en");
    expect(i18n.hasCatalog("en")).toBe(true);
    expect(i18n.translate("en", "common.close")).toBe("Close");
    expect(i18n.translate("th", "common.close")).toBe("ปิด");
  });
});
