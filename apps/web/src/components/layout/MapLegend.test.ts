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
  radar: false,
  sunlight: false,
  trees: false,
  localAuthorities: false,
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
