import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SOURCES } from "@siahra/shared-types";
import { LANGS, translator, type Lang } from "../../i18n";
import { ENABLED_CAMERA_SOURCES } from "../../lib/featureFlags";
import { LanguageContext } from "../../i18n/context";
import { FLOOD_DEPTH_LEGEND_STOPS_M, FLOOD_RGB, GISTDA_SHEET_RGB, STATION_SHEET_RGB } from "../../lib/floodStyle";
import { MapLegend, type FloodGfmLegendState, type GistdaDepthLegendState } from "./MapLegend";
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
  gistdaDepth: false,
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

describe("MapLegend — แผ่นน้ำ GISTDA 3 มิติ (E16 B-2)", () => {
  const sheet = {
    floodedCells: 3500,
    boundaryCells: 900,
    notEstimatedCells: 0,
    maxDepthCm: 240,
    deferredToGfm: 0,
    cellSizeM: 83,
    pending: false,
    drawn: true,
    error: null as string | null,
  };
  const base: GistdaDepthLegendState = { extent: "detected", dimmed: false, forecastHidden: false, sheet };
  const renderG = (lang: Lang, state: Partial<GistdaDepthLegendState>, layers: Partial<MapLayers> = {}) =>
    renderToStaticMarkup(
      createElement(
        LanguageContext.Provider,
        { value: { lang, setLang: () => {}, t: translator(lang) } },
        createElement(MapLegend, {
          layers: { ...ALL_OFF, floodExtent: true, gistdaDepth: true, ...layers },
          onToggle: () => {},
          descriptors: {},
          quality: "auto",
          qualityLevel: "balanced",
          onQualityChange: () => {},
          gistdaDepth: { ...base, ...state },
        }),
      ),
    ).replaceAll("&#x27;", "'");

  it.each(LANGS)("หมายเหตุบอกทั้งสองส่วน: ขอบเขตตรวจวัดจริง · ความลึกภาพประกอบ + ข้อสมมติ 'แห้ง' (%s)", (lang) => {
    const html = renderG(lang, {});
    const t = translator(lang);
    expect(html).toContain(t("legend.layer.gistdaDepth.note"));
    expect(html).toContain(t("legend.gistdaDepth.method"));
    expect(html).toContain(t("legend.gistdaDepth.summary", { n: "3,500", m: "83", max: "2.4" }));
  });

  it("ข้อความบังคับของหมายเหตุ (ภาษาไทย) ตรงตามที่ตกลง", () => {
    expect(translator("th")("legend.layer.gistdaDepth.note")).toBe(
      "ขอบเขตน้ำจากภาพดาวเทียม GISTDA (ตรวจวัดจริง) · ความลึกโดยประมาณ (FwDET จาก DEM — ภาพประกอบ)",
    );
  });

  it.each(LANGS)("ไม่มีเซลล์ = บอกว่า GISTDA ไม่พบ ต่างจากยังดึงไม่ได้/ไม่มีภาพที่เก็บไว้ (%s)", (lang) => {
    const t = translator(lang);
    expect(renderG(lang, { extent: "none-detected", sheet: null })).toContain(t("legend.gistdaDepth.noneDetected"));
    expect(renderG(lang, { extent: "never-fetched", sheet: null })).toContain(t("legend.gistdaDepth.neverFetched"));
    expect(renderG(lang, { extent: "no-archived-scene", sheet: null })).toContain(t("legend.gistdaDepth.noArchivedScene"));
    expect(renderG(lang, { extent: "never-fetched", sheet: null })).not.toContain(t("legend.gistdaDepth.noneDetected"));
  });

  it.each(LANGS)("ไม่มีขอบน้ำ = 'ไม่ได้ประมาณ' ไม่ใช่ 0 ม.; หรี่/ซ่อนตอนพยากรณ์ บอกเหตุ (%s)", (lang) => {
    const t = translator(lang);
    expect(renderG(lang, { sheet: { ...sheet, boundaryCells: 0, maxDepthCm: null, notEstimatedCells: 3500 } })).toContain(
      t("legend.gistdaDepth.noBoundary", { n: "3,500" }),
    );
    expect(renderG(lang, { dimmed: true })).toContain(t("legend.gistdaDepth.dimmed"));
    expect(renderG(lang, { forecastHidden: true })).toContain(t("legend.gistdaDepth.forecastHidden"));
    expect(renderG(lang, {}, { floodExtent: false })).toContain(t("legend.gistdaDepth.needsExtent"));
  });

  it.each(LANGS)("โหลดโค้ดของชั้นไม่สำเร็จ → บรรทัดแดงใต้แถว (MapInfo.layerLoadErrors.gistdaDepth) ไม่หายเงียบ (%s)", (lang) => {
    const t = translator(lang);
    const html = renderToStaticMarkup(
      createElement(
        LanguageContext.Provider,
        { value: { lang, setLang: () => {}, t } },
        createElement(MapLegend, {
          layers: { ...ALL_OFF, floodExtent: true, gistdaDepth: true },
          onToggle: () => {},
          descriptors: {},
          quality: "auto",
          qualityLevel: "balanced",
          onQualityChange: () => {},
          gistdaDepth: { ...base, sheet: null },
          layerLoadErrors: { gistdaDepth: { raw: "chunk 404" } },
        }),
      ),
    ).replaceAll("&#x27;", "'");
    expect(html).toContain(t("legend.layer.loadFailed", { error: "chunk 404" }));
  });

  it("แถวอยู่ต่อจาก GISTDA และก่อนแผ่นจำลองจากสถานี", () => {
    const html = renderG("th", {});
    const t = translator("th");
    const at = (k: Parameters<typeof t>[0]) => html.indexOf(t(k));
    expect(at("legend.layer.floodExtent")).toBeLessThan(at("legend.layer.gistdaDepth"));
    expect(at("legend.layer.gistdaDepth")).toBeLessThan(at("legend.layer.stationSheet"));
  });
});

describe("สามแผ่นน้ำแยกสีกันได้ (E16 B-2)", () => {
  it("ปลายตื้น/ลึกของ GFM · GISTDA · แผ่นจำลองจากสถานี ต่างกันทุกคู่ และ GISTDA ไม่ใช่ม่วงของชั้นภาพประกอบ", () => {
    const sets = [FLOOD_RGB, GISTDA_SHEET_RGB, STATION_SHEET_RGB];
    for (const end of ["shallow", "deep"] as const) {
      const css = sets.map((p) => p[end].join(","));
      expect(new Set(css).size).toBe(3);
    }
    // ม่วง = R และ B สูงกว่า G ชัดเจน (ILLUSTRATIVE_RGB / EXPOSURE_RGB) — ปลายทั้งสองของแผ่น GISTDA ต้องไม่ใช่
    for (const [r, g, b] of [GISTDA_SHEET_RGB.shallow, GISTDA_SHEET_RGB.deep]) expect(r > g && b > g).toBe(false);
  });
});

describe("MapLegend — แถวกล้อง CCTV (E15.3: N แหล่ง)", () => {
  const renderCctv = (lang: Lang, cameraErrors?: Parameters<typeof MapLegend>[0]["cameraErrors"]) =>
    renderToStaticMarkup(
      createElement(
        LanguageContext.Provider,
        { value: { lang, setLang: () => {}, t: translator(lang) } },
        createElement(MapLegend, {
          layers: { ...ALL_OFF, cctv: true },
          onToggle: () => {},
          descriptors: {},
          quality: "auto",
          qualityLevel: "balanced",
          onQualityChange: () => {},
          cameraErrors,
        }),
      ),
    ).replaceAll("&#x27;", "'");

  it.each(LANGS)("ป้ายทั่วไป + หมายเหตุระบุชื่อทุกแหล่งที่เปิดอยู่ (จาก SOURCES ไม่ใช่คีย์ต่อแหล่ง) (%s)", (lang) => {
    const html = renderCctv(lang);
    const t = translator(lang);
    expect(html).toContain(t("legend.layer.cctv"));
    for (const id of ENABLED_CAMERA_SOURCES) expect(html).toContain(lang === "th" ? SOURCES[id].nameTh : SOURCES[id].nameEn);
    expect(html).toContain(t("legend.layer.cctv.unverified"));
    expect(html).toContain(t("legend.layer.cctv.video"));
    expect(html).toContain(t("legend.layer.cctv.still"));
  });

  it.each(LANGS)("โหลดบัญชีของแหล่งหนึ่งไม่ได้ = บรรทัดแดงที่ระบุชื่อแหล่งนั้น แหล่งอื่นไม่ถูกพูดถึง (%s)", (lang) => {
    const html = renderCctv(lang, { "itic-cctv": { raw: "HTTP 404" } });
    const t = translator(lang);
    const itic = lang === "th" ? SOURCES["itic-cctv"].nameTh : SOURCES["itic-cctv"].nameEn;
    const dwr = lang === "th" ? SOURCES["dwr-cctv"].nameTh : SOURCES["dwr-cctv"].nameEn;
    expect(html).toContain(t("legend.layer.cctv.error", { source: itic, error: "HTTP 404" }));
    expect(html).not.toContain(t("legend.layer.cctv.error", { source: dwr, error: "HTTP 404" }));
  });
});
