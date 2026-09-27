import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SOURCES } from "@siahra/shared-types";
import { LANGS, translator, type Lang } from "../../i18n";
import { ENABLED_CAMERA_SOURCES } from "../../lib/featureFlags";
import { LanguageContext } from "../../i18n/context";
import { FLOOD_DEPTH_LEGEND_STOPS_M, FLOOD_RGB, GISTDA_SHEET_RGB, STATION_SHEET_RGB } from "../../lib/floodStyle";
import { DEFAULT_LAYERS } from "../../lib/defaultLayers";
import { countLayersOn } from "../../lib/layerCount";
import { GROUP_LAYERS, layerGroupOf, type LayerGroup } from "../../lib/layerGroups";
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
  community: false,
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
  // redesign PR 3: ความลึก GFM ย้ายไปกลุ่มภาพประกอบ (หลังกลุ่มตรวจวัดจริงทั้งหมด) — ลำดับ "ดาวเทียมที่เห็นจริง
  // → ภาพประกอบ" ยังอยู่: Sentinel-1 → GISTDA ในกลุ่มตรวจวัดจริง แล้วความลึก → แผ่น GISTDA → แผ่นจำลองจากสถานี
  it("Sentinel-1 (GFM) → GISTDA → ความลึก → แผ่นจำลองจากสถานี", () => {
    const html = render("th", gfmState(null));
    const t = translator("th");
    const at = (k: Parameters<typeof t>[0]) => html.indexOf(t(k));
    expect(at("legend.layer.floodGfm")).toBeGreaterThan(-1);
    expect(at("legend.layer.floodGfm")).toBeLessThan(at("legend.layer.floodExtent"));
    expect(at("legend.layer.floodExtent")).toBeLessThan(at("legend.layer.floodDepth"));
    expect(at("legend.layer.floodDepth")).toBeLessThan(at("legend.layer.stationSheet"));
  });
});

/**
 * redesign PR 3 — รายการชั้นถูกจัดเป็นสามกลุ่ม: ทุกแถวต้องอยู่ในกลุ่มของมัน (`GROUP_LAYERS`) และทุกบรรทัดที่เคย
 * อยู่ใต้แถว (หมายเหตุ ความสด ข้อผิดพลาด หมายเหตุชั้นที่พึ่งกัน) ต้องยังอยู่ — เรนเดอร์สถานะที่ "เปิดทุกบรรทัด"
 * แล้วตรวจทีละคีย์ภายในกล่องของกลุ่มนั้น
 */
describe("MapLegend — กลุ่มชั้น: ไม่มีบรรทัดไหนหาย", () => {
  const LAYER_GROUPS = Object.keys(GROUP_LAYERS) as LayerGroup[];
  const LAYER_KEYS = Object.keys(ALL_OFF) as (keyof MapLayers)[];
  const ALL_ON = Object.fromEntries(Object.keys(ALL_OFF).map((k) => [k, true])) as unknown as MapLayers;
  const err = { raw: "E-42" };
  const descriptor = (id: string) => ({
    descriptor: {
      id,
      epistemicClass: "observed" as const,
      liveOrStatic: "live" as const,
      fetchedAt: "2026-09-27T00:00:00Z",
      sourceIds: [],
      methodologyUrl: "/methodology/x",
    },
    health: null,
  });
  const renderAll = (lang: Lang) =>
    renderToStaticMarkup(
      createElement(
        LanguageContext.Provider,
        { value: { lang, setLang: () => {}, t: translator(lang) } },
        createElement(MapLegend, {
          layers: ALL_ON,
          onToggle: () => {},
          descriptors: Object.fromEntries(LAYER_KEYS.map((k) => [k, descriptor(k)])),
          quality: "auto",
          qualityLevel: "balanced",
          onQualityChange: () => {},
          terrainIntegrity: "mismatch",
          buildingsError: "x",
          exposure: { run: null, noNewRun: false, apiUnreachable: true, noRunReason: null },
          floodGfm: { ...gfmState(725), fieldError: err, scene: null, loading: false, dimmed: true },
          gistdaDepth: {
            extent: "detected",
            dimmed: true,
            forecastHidden: true,
            sheet: { floodedCells: 10, boundaryCells: 2, notEstimatedCells: 1, maxDepthCm: 120, deferredToGfm: 1, cellSizeM: 83, pending: false, drawn: true, error: null },
          },
          stationSheet: {
            stations: 2, leaf: 1, pending: 0, budget: 1, failed: 0, overview: 0, overviewCellSizeM: 83, leafCellSizeM: 30,
            maskCellSizeM: 60, requests: { issued: 48, max: 48 }, drawn: true, workerError: "boom",
          },
          cameraErrors: Object.fromEntries(ENABLED_CAMERA_SOURCES.map((id) => [id, err])),
          layerLoadErrors: { stationSheet: err, northRoute: err, gistdaDepth: err, community: err },
          community: { fetched: true, error: err, hiddenCount: 3, shown: 2, total: 5 },
        }),
      ),
    ).replaceAll("&#x27;", "'").replaceAll("&quot;", '"');

  /** html ของกล่องกลุ่มแต่ละกลุ่ม (`data-layer-group`) */
  const sections = (html: string) =>
    Object.fromEntries(
      LAYER_GROUPS.map((g) => {
        const start = html.indexOf(`data-layer-group="${g}"`);
        const next = LAYER_GROUPS.map((o) => html.indexOf(`data-layer-group="${o}"`)).filter((i) => i > start);
        const end = next.length > 0 ? Math.min(...next) : html.length;
        return [g, start === -1 ? "" : html.slice(start, end)];
      }),
    ) as Record<LayerGroup, string>;

  /** บรรทัดที่ต้องอยู่ใต้แต่ละชั้น (นอกจากชื่อ/หมายเหตุ/บรรทัดความสดที่ทุกแถวมี) */
  const extraLines = (lang: Lang): Partial<Record<keyof MapLayers, string[]>> => {
    const t = translator(lang);
    const loadFailed = t("legend.layer.loadFailed", { error: "E-42" });
    return {
      lowland: [t("legend.integrity.mismatch")],
      exposure: [t("legend.exposure.integrity.mismatch"), t("legend.layer.exposure.inputs"), t("legend.exposure.apiDownNoRun")],
      buildings: [t("legend.layer.buildings.error")],
      floodGfm: [],
      floodDepth: [t("legend.floodDepth.scale"), t("legend.floodDepth.notEstimated"), t("legend.floodDepth.notEstimated.why")],
      gistdaDepth: [
        loadFailed,
        t("legend.gistdaDepth.summary", { n: "10", m: "83", max: "1.2" }),
        t("legend.gistdaDepth.forecastHidden"),
        t("legend.gistdaDepth.dimmed"),
        t("legend.gistdaDepth.method"),
      ],
      stationSheet: [loadFailed, t("legend.stationSheet.worker", { error: "boom" })],
      northRoute: [loadFailed],
      community: [
        loadFailed,
        t("legend.community.error", { error: "E-42" }),
        t("legend.community.hidden", { n: "3" }),
        t("legend.community.window", { shown: "2", total: "5" }),
      ],
      cctv: [
        t("legend.layer.cctv.video"),
        t("legend.layer.cctv.unverified"),
        ...ENABLED_CAMERA_SOURCES.map((id) =>
          t("legend.layer.cctv.error", { source: lang === "th" ? SOURCES[id].nameTh : SOURCES[id].nameEn, error: "E-42" }),
        ),
      ],
    };
  };

  it.each(LANGS)("ทุกชั้นอยู่ในกลุ่มของมัน พร้อมชื่อ หมายเหตุ บรรทัดความสด และบรรทัดข้อผิดพลาด/หมายเหตุเดิม (%s)", (lang) => {
    const t = translator(lang);
    const html = renderAll(lang);
    const byGroup = sections(html);
    const extra = extraLines(lang);
    for (const key of LAYER_KEYS) {
      if (key === "cctv" && ENABLED_CAMERA_SOURCES.length === 0) continue;
      const box = byGroup[layerGroupOf(key)];
      const label = t(`legend.layer.${key}` as Parameters<typeof t>[0]);
      expect(box, key).toContain(label);
      for (const other of LAYER_GROUPS.filter((g) => g !== layerGroupOf(key))) {
        expect(byGroup[other].includes(`>${label}<`), `${key} in ${other}`).toBe(false);
      }
      if (key !== "cctv") {
        expect(box, key).toContain(t(`legend.layer.${key}.note` as Parameters<typeof t>[0], { km: 25, radiusKm: 5 }));
      }
      for (const line of extra[key] ?? []) expect(box, `${key}: ${line}`).toContain(line);
    }
    // บรรทัดความสด (ป้ายชนิดความรู้ + ลิงก์วิธีคำนวณ) หนึ่งบรรทัดต่อแถว — ไม่มีแถวไหนหล่น
    const rows = LAYER_KEYS.filter((k) => k !== "cctv" || ENABLED_CAMERA_SOURCES.length > 0).length;
    expect(html.split(t("freshness.methodology")).length - 1).toBe(rows);
    // ข้อผิดพลาดของฉาก GFM ยังอยู่ (ไม่มีฉาก = บรรทัดหรี่/ข้อความของ FloodGfmDetails ตามสถานะ)
    expect(html).toContain(t("badge.observed"));
    expect(html).toContain(t("badge.illustrative"));
    expect(html).toContain(t("layers.group.basemap"));
    expect(html).toContain(t("badge.crowdsourced"));
  });

  it("ตัวเลขบนปุ่มชั้นข้อมูล (countLayersOn) = จำนวนสวิตช์ที่เปิดอยู่ในรายการที่จัดกลุ่มแล้ว", () => {
    const hidden: (keyof MapLayers)[] = ENABLED_CAMERA_SOURCES.length > 0 ? [] : ["cctv"];
    for (const layers of [DEFAULT_LAYERS, ALL_ON, { ...ALL_OFF, cctv: true, radar: true }]) {
      const html = renderToStaticMarkup(
        createElement(
          LanguageContext.Provider,
          { value: { lang: "th", setLang: () => {}, t: translator("th") } },
          createElement(MapLegend, {
            layers,
            onToggle: () => {},
            descriptors: {},
            quality: "auto",
            qualityLevel: "balanced",
            onQualityChange: () => {},
          }),
        ),
      );
      const checked = (html.match(/type="checkbox"[^>]*checked=""/g) ?? []).length;
      expect(checked).toBe(countLayersOn(layers, hidden));
    }
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
    expect(html).toContain(t("legend.layer.cctv.locationOnly"));
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

describe("MapLegend — รายงานจากประชาชน (crowdsourced)", () => {
  const renderCommunity = (
    lang: Lang,
    community: { fetched: boolean; error: { raw: string } | null; hiddenCount: number; shown: number; total: number },
    descriptors = {},
  ) =>
    renderToStaticMarkup(
      createElement(
        LanguageContext.Provider,
        { value: { lang, setLang: () => {}, t: translator(lang) } },
        createElement(MapLegend, {
          layers: { ...ALL_OFF, community: true },
          onToggle: () => {},
          descriptors,
          quality: "auto",
          qualityLevel: "balanced",
          onQualityChange: () => {},
          community,
        }),
      ),
    ).replaceAll("&#x27;", "'").replaceAll("&quot;", '"');

  it.each(LANGS)("อยู่ในกลุ่ม crowdsourced ของตัวเอง ไม่อยู่ใต้หัว observed และหมายเหตุบอกว่ายังไม่ได้ตรวจสอบ (%s)", (lang) => {
    const t = translator(lang);
    const html = renderCommunity(lang, { fetched: false, error: null, hiddenCount: 0, shown: 0, total: 0 });
    expect(layerGroupOf("community")).toBe("crowdsourced");
    const start = html.indexOf('data-layer-group="crowdsourced"');
    expect(start).toBeGreaterThan(-1);
    expect(html.slice(start)).toContain(t("legend.layer.community"));
    expect(html.slice(start)).toContain(t("badge.crowdsourced"));
    expect(html).toContain(t("legend.layer.community.note"));
  });

  it.each(LANGS)("ยังไม่เคยได้รายการ = ข้อความ 'ยังไม่เคยได้รับ' ไม่ใช่เวลาใด ๆ (%s)", (lang) => {
    const t = translator(lang);
    const html = renderCommunity(lang, { fetched: false, error: null, hiddenCount: 0, shown: 0, total: 0 });
    expect(html).toContain(t("freshness.missing.crowdsourced"));
    expect(html).not.toContain(t("time.justNow"));
  });

  it.each(LANGS)("ล้มเหลวก่อนเคยได้รายการ = บอกว่าไม่ได้แปลว่าไม่มีรายงาน (%s)", (lang) => {
    const t = translator(lang);
    const html = renderCommunity(lang, { fetched: false, error: { raw: "HTTP 503" }, hiddenCount: 0, shown: 0, total: 0 });
    expect(html).toContain(t("legend.community.errorNoData", { error: "HTTP 503" }));
  });

  it.each(LANGS)("ไม่มีรายงานที่ถูกซ่อน/นอกหน้าต่าง = ไม่มีบรรทัดเหล่านั้น (%s)", (lang) => {
    const t = translator(lang);
    const html = renderCommunity(lang, { fetched: true, error: null, hiddenCount: 0, shown: 4, total: 4 });
    expect(html).not.toContain(t("legend.community.hidden", { n: "0" }));
    expect(html).not.toContain(t("freshness.missing.crowdsourced"));
  });
});
