import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LANGS, translator, type Lang } from "../../i18n";
import { LanguageContext } from "../../i18n/context";
import { FLOOD_DEPTH_LEGEND_STOPS_M } from "../../lib/floodStyle";
import { MapLegend, type FloodGfmLegendState } from "./MapLegend";
import type { MapLayers } from "./Map3DCanvas";

/**
 * เรนเดอร์ legend จริงด้วย react-dom/server (ไม่ต้องมี DOM) แล้วอ่านข้อความที่ผู้ใช้
 * เห็น — ป้ายใต้ ramp ความลึกกับบรรทัด "ลึกสุด" เคยถูก `formatNumber` ปัดเป็นจำนวน
 * เต็ม (0.5 → "1", 7.25 → "7") ทั้งที่โค้ดตั้งใจให้มีทศนิยมหนึ่งตำแหน่ง
 */
const ALL_OFF: MapLayers = {
  imagery: false,
  lowland: false,
  exposure: false,
  hazard: false,
  stations: false,
  buildings: false,
  roads: false,
  water: false,
  floodExtent: false,
  floodGfm: true,
  floodDepth: true,
  dams: false,
  cctv: false,
  radar: false,
  sunlight: false,
  trees: false,
  localAuthorities: false,
  stationSheet: false,
  northRoute: false,
};

function gfmState(maxDepthCm: number | null): FloodGfmLegendState {
  return {
    scene: null,
    latestBefore: null,
    reason: null,
    missing: false,
    loading: false,
    indexError: null,
    fieldError: null,
    summary: { floodedCells: 1000, depthEstimatedCells: 800, maxDepthCm },
    dimmed: false,
  };
}

function render(lang: Lang, floodGfm: FloodGfmLegendState): string {
  return renderToStaticMarkup(
    createElement(
      LanguageContext.Provider,
      { value: { lang, setLang: () => {}, t: translator(lang) } },
      createElement(MapLegend, {
        layers: ALL_OFF,
        onToggle: () => {},
        descriptors: {},
        quality: "auto",
        qualityLevel: "balanced",
        onQualityChange: () => {},
        floodGfm,
      }),
    ),
  );
}

/** ข้อความในทุก <span> ที่มีคลาส `tabular-nums` — คือป้ายใต้จุดบน ramp เท่านั้น */
function stopLabels(html: string): string[] {
  return [...html.matchAll(/tabular-nums[^>]*>([^<]*)</g)].map((m) => m[1]);
}

describe("MapLegend — แถวความลึกน้ำโดยประมาณ", () => {
  it.each(LANGS)("ป้ายบน ramp ที่เรนเดอร์จริงเท่ากับ FLOOD_DEPTH_LEGEND_STOPS_M (%s)", (lang) => {
    const labels = stopLabels(render(lang, gfmState(null)));
    expect(labels).toEqual(["0", "0.5", "1", "2", "≥3"]);
    expect(labels.map((l) => Number(l.replace("≥", "")))).toEqual([...FLOOD_DEPTH_LEGEND_STOPS_M]);
  });

  it.each(LANGS)("ลึกสุด 725 ซม. → 7.3 ม. และ 850 → 8.5 ไม่ใช่ 7 กับ 9 (%s)", (lang) => {
    const t = translator(lang);
    expect(render(lang, gfmState(725))).toContain(t("legend.floodDepth.estimated", { pct: 80, max: "7.3" }));
    expect(render(lang, gfmState(850))).toContain(t("legend.floodDepth.estimated", { pct: 80, max: "8.5" }));
    expect(render(lang, gfmState(725))).not.toContain(t("legend.floodDepth.estimated", { pct: 80, max: "7" }));
  });
});

describe("MapLegend — แผ่นน้ำจำลองจากสถานี: ความละเอียดต่อสถานี (C3)", () => {
  const info = {
    stations: 5,
    leaf: 3,
    pending: 0,
    budget: 2,
    failed: 0,
    overview: 0,
    overviewCellSizeM: 83,
    leafCellSizeM: 30,
    maskCellSizeM: 60,
    requests: { issued: 48, max: 48 },
    drawn: true,
    workerError: null as string | null,
  };
  const renderSheet = (lang: Lang, on: boolean, over: Partial<typeof info> = {}) =>
    renderToStaticMarkup(
      createElement(
        LanguageContext.Provider,
        { value: { lang, setLang: () => {}, t: translator(lang) } },
        createElement(MapLegend, {
          layers: { ...ALL_OFF, stationSheet: on },
          onToggle: () => {},
          descriptors: {},
          quality: "auto",
          qualityLevel: "balanced",
          onQualityChange: () => {},
          stationSheet: { ...info, ...over },
        }),
      ),
    );

  it.each(LANGS)("งบไทล์ 30 ม. หมด = บอกจำนวนสถานีที่คงอยู่บนกริดภาพรวม + 48/48 — ไม่ลดความละเอียดเงียบ ๆ (%s)", (lang) => {
    // react-dom/server เข้ารหัส ' เป็น &#x27; — ถอดกลับก่อนเทียบข้อความ
    const html = renderSheet(lang, true).replaceAll("&#x27;", "'");
    const t = translator(lang);
    expect(html).toContain(t("legend.stationSheet.resolution", { leafM: "30", leaf: 3, ovM: "83", ov: 2 }));
    expect(html).toContain(t("legend.stationSheet.budget", { leafM: "30", ovM: "83", n: 2, issued: 48, max: 48 }));
    expect(html).toContain("48/48");
    expect(html).toContain(t("legend.stationSheet.mask", { m: "60" }));
  });

  it.each(LANGS)("worker ล้ม = บอกเหตุ แม้ไม่มีสถานีเหลือในงาน (ไม่เงียบ) (%s)", (lang) => {
    const html = renderSheet(lang, true, { stations: 0, leaf: 0, budget: 0, workerError: "boom" });
    expect(html).toContain(translator(lang)("legend.stationSheet.worker", { error: "boom" }));
  });

  it.each(LANGS)("หมายเหตุของชั้นบอกว่าไม่ได้จำลองคันกั้นน้ำ/การสูบน้ำ (เติมแบบอ่างน้ำ) (%s)", (lang) => {
    const html = renderSheet(lang, true).replaceAll("&#x27;", "'");
    expect(html).toContain(lang === "th" ? "ไม่ได้จำลองคันกั้นน้ำ" : "flood walls and pumping are not modelled");
  });

  it("ชั้นปิด = ไม่มีบรรทัดความละเอียด", () => {
    expect(renderSheet("th", false)).not.toContain("48/48");
  });
});

describe("MapLegend — ลำดับแถว: ดาวเทียมที่เห็นจริงมาก่อน", () => {
  it("Sentinel-1 (GFM) → ความลึก → GISTDA → แผ่นจำลองจากสถานี", () => {
    const html = render("th", gfmState(null));
    const t = translator("th");
    const at = (k: Parameters<typeof t>[0]) => html.indexOf(t(k));
    expect(at("legend.layer.floodGfm")).toBeGreaterThan(-1);
    expect(at("legend.layer.floodGfm")).toBeLessThan(at("legend.layer.floodDepth"));
    expect(at("legend.layer.floodDepth")).toBeLessThan(at("legend.layer.floodExtent"));
    expect(at("legend.layer.floodExtent")).toBeLessThan(at("legend.layer.stationSheet"));
  });
});
