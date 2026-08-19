import { describe, expect, it } from "vitest";
import type { SourceStatus } from "@siahra/shared-types";
import { sourceLabel, statusLabel, tooltip } from "./sourceStatusText";
import { LANGS, translator } from "../../i18n";

const th = translator("th");
const en = translator("en");

/**
 * E4.4 AC 3 — ปลายทางของเรื่องนี้คือหน้าจอ ไม่ใช่ /health
 *
 * `RadarDO` ที่ข้ามเฟรมเสียจะนับไว้ใน `detail.skippedFrames` แต่แถบสถานะ **ไม่เคย
 * อ่าน detail** มันแสดงเฉพาะ `health` กับ `lastError` เทสนี้จึงตรึงข้อเท็จจริงนั้นไว้:
 * ถ้าวันหลังมีคนแก้ให้ RadarDO นับอย่างเดียวโดยไม่ตั้ง lastError ผู้ใช้จะไม่เห็นอะไรเลย
 * จนกว่าเฟรมที่ยังเก็บไว้จะเก่าจนกลายเป็น stale ไปเอง
 *
 * ค่าที่ใช้ที่นี่คือ SourceStatus ชุดเดียวกับที่ apps/api/test/upstreamShapeDurableObjects.test.ts
 * ยืนยันว่า RadarDO คืนออกมาจริงหลังรอบที่มีเฟรมถูกตัดกลาง
 */
const radarDegraded: SourceStatus = {
  id: "tmd-radar",
  labelTh: "เรดาร์ฝน (กรมอุตุนิยมวิทยา)",
  labelEn: "Weather radar composite (TMD)",
  health: "degraded",
  fetchedAt: "2026-08-19T09:32:57.771Z",
  latestObservedAt: "2026-08-19T09:15:00.000Z",
  lastAttemptAt: "2026-08-19T09:32:57.771Z",
  lastError: "radar frames skipped (1/2): zr0023.png (UpstreamShapeError: tmd-radar shape: frame.zr0023.png truncated PNG (no IEND chunk))",
  detail: { frames24h: 1, skippedFrames: 1 },
  staleAfterSeconds: 900,
  observedLagSeconds: 5400,
  nextAttemptAt: "2026-08-19T09:37:57.818Z",
};

describe("แถบสถานะกับต้นทางที่ข้ามเฟรมเสีย", () => {
  it("ป้ายบอกว่าบางแหล่งล้มเหลว และ tooltip พาชื่อเฟรมที่ถูกข้ามมาถึงผู้ใช้", () => {
    expect(statusLabel(radarDegraded, "th", th)).toBe("บางแหล่งล้มเหลว");
    const text = tooltip(radarDegraded, "th", th);
    expect(text).toContain("zr0023.png");
    expect(text).toContain("บางแหล่งล้มเหลว");
  });

  it("ภาษาอังกฤษก็ต้องพาข้อความผิดพลาดจากต้นทางมาถึงผู้ใช้เหมือนกัน", () => {
    expect(statusLabel(radarDegraded, "en", en)).toBe("Some upstreams failed");
    // lastError เป็นข้อความจริงจากระบบ ไม่ได้แปล — ต้องยังปรากฏครบ
    expect(tooltip(radarDegraded, "en", en)).toContain("zr0023.png");
  });

  it("ตัวนับใน detail อย่างเดียวไม่มีทางไปถึงหน้าจอ", () => {
    const counterOnly: SourceStatus = { ...radarDegraded, health: "ok", lastError: null };
    const text = tooltip(counterOnly, "th", th);
    expect(text).not.toContain("zr0023.png");
    expect(text).not.toContain("skippedFrames");
    expect(text).toContain("ปกติ");
  });
});

describe("ชื่อแหล่งข้อมูลมาจากทะเบียนกลาง ไม่ใช่ตารางคำแปลซ้อน", () => {
  it("ใช้ SOURCES[id].nameTh / nameEn เมื่อรู้จัก id นั้น", () => {
    expect(sourceLabel(radarDegraded, "th")).toBe("เรดาร์ฝน (กรมอุตุนิยมวิทยา)");
    expect(sourceLabel(radarDegraded, "en")).toBe("Weather radar composite (TMD)");
  });

  it.each(LANGS)("id ที่บันเดิลนี้ยังไม่รู้จัก ตกกลับไปใช้ป้ายที่ติดมากับข้อมูล (%s)", (lang) => {
    const unknown = { ...radarDegraded, id: "future-source" } as unknown as SourceStatus;
    expect(sourceLabel(unknown, lang)).toBe(lang === "th" ? unknown.labelTh : unknown.labelEn);
  });
});
