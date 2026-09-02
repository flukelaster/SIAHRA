import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FloodFieldClass } from "@siahra/shared-types";
import { LANGS, translator } from "../../i18n";
import { gfmConfidence } from "../../scene/floodField";
import type { FloodCellPick } from "../../scene/picking";
import { GfmCellBlock } from "./InfoPopup";

/**
 * บล็อกเซลล์ Copernicus GFM ใน popup (E14.F5): บรรทัด "ความเชื่อมั่นของการจำแนกภาพ"
 * ต้องขึ้นเฉพาะเซลล์ที่ GFM จำแนกจริง — เซลล์ที่ SAR มองไม่เห็น (EXCLUDED, 88% ของ
 * ฟิลด์เชียงรายจริง) หรือไม่มีภาพ (NO_OBSERVATION) ห้ามมี "11/100" ใต้ประโยค
 * "ไม่มีการจำแนก"
 */
const C = FloodFieldClass;

const cell = (cls: number, likelihood: number | null, depthCm: number | null = null): FloodCellPick => ({
  cls,
  depthCm,
  likelihood,
  sceneId: "20260831T231435-AS020M",
  observedAt: "2026-08-31T23:14:35Z",
});

describe("gfmConfidence", () => {
  it("ท่วม / ท่วมไม่ได้ประมาณความลึก / แห้ง → ค่าที่แสดงได้เมื่อมี", () => {
    expect(gfmConfidence(cell(C.FLOODED, 87, 120))).toBe(87);
    expect(gfmConfidence(cell(C.FLOODED_DEPTH_NOT_ESTIMATED, 60))).toBe(60);
    expect(gfmConfidence(cell(C.DRY, 95))).toBe(95);
    // ไม่มีค่า (255 ในไฟล์ → null) → ไม่แสดงแม้เป็นคลาสที่จำแนก
    expect(gfmConfidence(cell(C.FLOODED, null, 120))).toBeNull();
    expect(gfmConfidence(cell(C.DRY, null))).toBeNull();
  });

  it("EXCLUDED / NO_OBSERVATION / น้ำอ้างอิง → null แม้ไฟล์จะมีค่าติดมา", () => {
    expect(gfmConfidence(cell(C.EXCLUDED, 11))).toBeNull();
    expect(gfmConfidence(cell(C.NO_OBSERVATION, 11))).toBeNull();
    expect(gfmConfidence(cell(C.REFERENCE_WATER, 99))).toBeNull();
  });
});

describe("GfmCellBlock", () => {
  it.each(LANGS)("เซลล์ EXCLUDED ที่มี likelihood ติดมา → ประโยค 'ไม่มีการจำแนก' โดยไม่มีบรรทัดความเชื่อมั่น (%s)", (lang) => {
    const t = translator(lang);
    const html = renderToStaticMarkup(createElement(GfmCellBlock, { cell: cell(C.EXCLUDED, 11), lang, t }));
    expect(html).toContain(t("popup.gfm.excluded"));
    expect(html).not.toContain(t("popup.gfm.confidence", { n: 11 }));
    const none = renderToStaticMarkup(createElement(GfmCellBlock, { cell: cell(C.NO_OBSERVATION, 11), lang, t }));
    expect(none).toContain(t("popup.gfm.noObservation"));
    expect(none).not.toContain(t("popup.gfm.confidence", { n: 11 }));
  });

  it.each(LANGS)("เซลล์ที่จำแนกแล้ว → มีบรรทัดความเชื่อมั่น + เวลาบันทึกภาพของฉากเสมอ (%s)", (lang) => {
    const t = translator(lang);
    const flooded = renderToStaticMarkup(createElement(GfmCellBlock, { cell: cell(C.FLOODED, 87, 120), lang, t }));
    expect(flooded).toContain(t("popup.gfm.confidence", { n: 87 }));
    expect(flooded).toContain("20260831T231435-AS020M");
    const notEst = renderToStaticMarkup(createElement(GfmCellBlock, { cell: cell(C.FLOODED_DEPTH_NOT_ESTIMATED, 60), lang, t }));
    expect(notEst).toContain(t("popup.gfm.notEstimated"));
    expect(notEst).toContain(t("popup.gfm.confidence", { n: 60 }));
    const dry = renderToStaticMarkup(createElement(GfmCellBlock, { cell: cell(C.DRY, 95), lang, t }));
    expect(dry).toContain(t("popup.gfm.dry"));
    expect(dry).toContain(t("popup.gfm.confidence", { n: 95 }));
  });
});
