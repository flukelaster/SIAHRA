import { describe, expect, it } from "vitest";
import {
  FLOOD_DEPTH_K,
  FLOOD_DEPTH_LEGEND_STOPS_M,
  FLOOD_DEPTH_REF_M,
  FLOOD_DEPTH_REF_MIX,
  depthToMix,
  floodCss,
  floodDepthCss,
  floodDepthLegendRamp,
  floodDepthMaxLabel,
  floodDepthStopLabel,
} from "./floodStyle";
import { LANGS } from "../i18n";

/**
 * สูตรไล่ระดับความลึกเป็นสัญญาระหว่าง shader กับ legend — ค่าใน legend ต้องมาจาก
 * ฟังก์ชันเดียวกัน และจุดอ้างอิง (3 ม. ≈ 0.9) ต้องเป็นจริงจากค่าที่คำนวณ ไม่ใช่
 * ตัวเลขที่พิมพ์ไว้แยกกันสองที่
 */
describe("floodStyle", () => {
  it("depthToMix: 0 → 0, 3 ม. ≈ 0.9, เพิ่มขึ้นเสมอ และไม่เกิน 1", () => {
    expect(depthToMix(0)).toBe(0);
    expect(depthToMix(-1)).toBe(0);
    expect(depthToMix(Number.NaN)).toBe(0);
    expect(depthToMix(FLOOD_DEPTH_REF_M)).toBeCloseTo(FLOOD_DEPTH_REF_MIX, 6);
    let prev = 0;
    for (let d = 0.1; d <= 12; d += 0.1) {
      const m = depthToMix(d);
      expect(m).toBeGreaterThan(prev);
      expect(m).toBeLessThan(1);
      prev = m;
    }
    expect(FLOOD_DEPTH_K).toBeGreaterThan(0);
  });

  it("ramp ของ legend ใช้จุดที่ประกาศไว้ และสีปลายสุดเปิด (≥)", () => {
    const ramp = floodDepthLegendRamp();
    expect(ramp.map((s) => s.depthM)).toEqual([...FLOOD_DEPTH_LEGEND_STOPS_M]);
    expect(ramp[0].css).toBe(floodCss("shallow"));
    expect(ramp[0].mix).toBe(0);
    expect(ramp.filter((s) => s.open).map((s) => s.depthM)).toEqual([3]);
    // สีที่ตำแหน่งใด ๆ มาจากสูตรเดียวกัน ไม่ใช่ตารางสีแยก
    for (const s of ramp) expect(s.css).toBe(floodDepthCss(s.depthM));
    // ลึกขึ้น = เข้มขึ้น (ช่อง R ของ CSS ลดลง)
    const reds = ramp.map((s) => Number(/rgb\((\d+),/.exec(s.css)?.[1]));
    for (let i = 1; i < reds.length; i++) expect(reds[i]).toBeLessThan(reds[i - 1]);
  });

  it.each(LANGS)("ป้ายใต้จุดบน ramp คือ 0 · 0.5 · 1 · 2 · ≥3 — 0.5 ไม่ถูกปัดเป็น 1 (%s)", (lang) => {
    const labels = floodDepthLegendRamp().map((s) => floodDepthStopLabel(lang, s));
    expect(labels).toEqual(["0", "0.5", "1", "2", "≥3"]);
    // ตัวเลขบนป้าย (ถอด "≥" ออก) ต้องเท่ากับจุดที่ประกาศไว้ทุกตัว
    expect(labels.map((l) => Number(l.replace("≥", "")))).toEqual([...FLOOD_DEPTH_LEGEND_STOPS_M]);
  });

  it.each(LANGS)("ความลึกสูงสุดแสดงทศนิยมหนึ่งตำแหน่ง: 725 ซม. → 7.3, 850 → 8.5, 300 → 3 (%s)", (lang) => {
    expect(floodDepthMaxLabel(lang, 725)).toBe("7.3");
    expect(floodDepthMaxLabel(lang, 850)).toBe("8.5");
    expect(floodDepthMaxLabel(lang, 300)).toBe("3");
    expect(floodDepthMaxLabel(lang, 4)).toBe("0");
  });
});
