import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { FloodSceneIndex, FloodSceneIndexEntry } from "@siahra/shared-types";
import type { FloodExtentState } from "../../hooks/useFloodExtent";
import type { FloodSceneState } from "../../hooks/useFloodScene";
import type { FloodScenesState } from "../../hooks/useFloodScenes";
import { LANGS, translator, type Lang } from "../../i18n";
import { LanguageContext } from "../../i18n/context";
import { sceneAtIso } from "../../lib/floodEvents";
import { formatDateTime, formatFullDateTime } from "../../lib/time";
import { FloodScenesCard } from "./FloodScenesCard";

/**
 * เรนเดอร์แผงฉาก GFM จริงด้วย react-dom/server แล้วอ่านข้อความที่ผู้ใช้เห็น —
 * สี่สถานะของฉาก (ถามไม่ได้ / จังหวัดไม่มีฉาก / ไม่มีภาพในหน้าต่าง / มีฉาก) ต้องเป็น
 * คนละประโยค ป้ายระยะห่างต้องขึ้นเฉพาะตอนเลือกเวลาเองและภาพเก่ากว่าเวลานั้น และ
 * ตัวเลขทศนิยมต้องไม่ถูกปัดเป็นจำนวนเต็ม (F4 เคยโดน)
 */
const entry = (sceneId: string, observedAt: string, km2: number, extra: Partial<FloodSceneIndexEntry> = {}): FloodSceneIndexEntry => ({
  sceneId,
  observedAt,
  publishedAt: null,
  orbit: null,
  floodedCells: km2 > 0 ? 100 : 0,
  excludedCells: 0,
  observedCells: 1000,
  floodedAreaKm2: km2,
  maxDepthCm: null,
  medianDepthCm: null,
  depthEstimatedFraction: 0,
  gfmItemIds: [],
  ...extra,
});

const layer = (epistemicClass: "observed" | "illustrative") => ({
  id: epistemicClass,
  epistemicClass,
  liveOrStatic: "live" as const,
  fetchedAt: null,
  sourceIds: [],
});

const S_2024 = entry("20240913T112151-AS020M", "2024-09-13T11:21:51Z", 131.7452, {
  publishedAt: "2024-11-06T14:19:47Z",
  maxDepthCm: 850,
  medianDepthCm: 13,
  depthEstimatedFraction: 0.9881,
});
const S_0829 = entry("20260829T112054-AS020M", "2026-08-29T11:20:54Z", 26.5386, { maxDepthCm: 800, medianDepthCm: 0 });
const S_0831 = entry("20260831T231435-AS020M", "2026-08-31T23:14:35Z", 94.6571, { maxDepthCm: 725, medianDepthCm: 0, depthEstimatedFraction: 0.8437 });
const S_DRY = entry("20260817T231400-AS020M", "2026-08-17T23:14:00Z", 0);

const index: FloodSceneIndex = {
  provinceCode: "57",
  grid: { width: 2, height: 2, cellSizeM: 30, originEasting: 0, originNorthing: 0, utmZone: "32647" },
  layers: { extent: layer("observed"), depth: layer("illustrative") },
  generatedAt: "2026-09-01T00:00:00Z",
  scenes: [S_0831, S_0829, S_DRY, S_2024],
};

const scenesOk: FloodScenesState = { index, missing: false, loading: false, error: null };
const extentIdle: FloodExtentState = { data: null, loading: false, error: null };

const sceneState = (scene: FloodSceneIndexEntry | null, latestBefore: FloodSceneIndexEntry | null, reason: FloodSceneState["reason"]): FloodSceneState => ({
  scene,
  latestBefore,
  field: null,
  loading: false,
  error: null,
  reason,
});

function render(
  lang: Lang,
  props: { scenes?: FloodScenesState; scene: FloodSceneState; atIso: string | null; onSelectAt?: (iso: string | null) => void },
): string {
  return renderToStaticMarkup(
    createElement(
      LanguageContext.Provider,
      { value: { lang, setLang: () => {}, t: translator(lang) } },
      createElement(FloodScenesCard, {
        provinceCode: "57",
        scenes: props.scenes ?? scenesOk,
        scene: props.scene,
        floodExtent: extentIdle,
        atIso: props.atIso,
        onSelectAt: props.onSelectAt ?? (() => {}),
      }),
    ),
  );
}

describe("FloodScenesCard — ฉากที่กำลังแสดง", () => {
  it.each(LANGS)("ฉากสด: sceneId, เวลาบันทึกภาพ, 'ต้นทางไม่ระบุ' เมื่อ publishedAt null, ตร.กม. และความลึกทศนิยมหนึ่งตำแหน่ง (%s)", (lang) => {
    const t = translator(lang);
    const html = render(lang, { scene: sceneState(S_0831, S_0831, null), atIso: null });
    expect(html).toContain(S_0831.sceneId);
    expect(html).toContain(formatFullDateTime(lang, S_0831.observedAt));
    expect(html).toContain(t("floodScenes.publishedAt.unknown"));
    // 94.6571 → "94.7" ไม่ใช่ "95"; 725 ซม. → "7.3 ม."; มัธยฐาน 0 → "0.0"/"0" ไม่ใช่ "—"
    expect(html).toContain(t("floodScenes.area.value", { km2: "94.7" }));
    expect(html).toContain(`7.3 ${t("unit.m")}`);
    expect(html).toContain(`84${t("unit.percent")}`);
    // ดูสด → ไม่มีป้ายระยะห่าง
    expect(html).not.toContain(t("floodScenes.gap.why"));
  });

  it.each(LANGS)("เลือกเวลาเองแล้วภาพเก่ากว่า → ป้าย 'ภาพล่าสุดก่อนเวลาที่เลือก: 3 วัน 4 ชม.' + ประโยคย้ำว่าไม่ใช่สภาพ ณ เวลานั้น (%s)", (lang) => {
    const t = translator(lang);
    const html = render(lang, { scene: sceneState(S_0831, S_0831, null), atIso: "2026-09-04T03:20:00Z" });
    expect(html).toContain(t("floodScenes.gap", { duration: t("floodScenes.gap.days", { d: 3, h: 4 }) }));
    expect(html).toContain(t("floodScenes.gap.why"));
  });

  it("เลือกฉากผ่าน sceneAtIso (ห่างไม่ถึง 10 นาที) → ไม่มีป้ายระยะห่าง", () => {
    const t = translator("th");
    const html = render("th", { scene: sceneState(S_0831, S_0831, null), atIso: sceneAtIso(S_0831) });
    expect(html).not.toContain(t("floodScenes.gap.why"));
  });

  it.each(LANGS)("ไม่มีภาพในหน้าต่าง 14 วัน → ประโยคเดียวกับ legend + ภาพล่าสุดก่อนหน้านั้น + ปุ่มกระโดด (%s)", (lang) => {
    const t = translator(lang);
    const html = render(lang, { scene: sceneState(null, S_2024, "no-scene-in-window"), atIso: "2024-10-13T00:00:00Z" });
    expect(html).toContain(t("legend.floodGfm.noSceneInWindow", { days: 14 }));
    expect(html).toContain(t("legend.floodGfm.latestBefore", { time: formatFullDateTime(lang, S_2024.observedAt) }));
    expect(html).toContain(t("floodScenes.jumpToLatest"));
  });

  it.each(LANGS)("ดัชนี 404 → 'ยังไม่มีฉากของจังหวัดนี้' ไม่ใช่ 'ไม่มีน้ำท่วม' และไม่มีรายการรอบบิน (%s)", (lang) => {
    const t = translator(lang);
    const html = render(lang, {
      scenes: { index: null, missing: true, loading: false, error: null },
      scene: sceneState(null, null, null),
      atIso: null,
    });
    expect(html).toContain(t("legend.floodGfm.noScenesForProvince"));
    expect(html).not.toContain(t("legend.floodGfm.dry"));
    expect(html).not.toContain(t("floodScenes.section.passes"));
  });

  it("ดึงดัชนีไม่ได้ → บอกว่าถามไม่ได้ ไม่พูดถึงสถานะของฉาก", () => {
    const t = translator("th");
    const html = render("th", {
      scenes: { index: null, missing: false, loading: false, error: { raw: "HTTP 500" } },
      scene: sceneState(null, null, null),
      atIso: null,
    });
    expect(html).toContain(t("legend.floodGfm.indexError", { error: "HTTP 500" }));
    expect(html).not.toContain(t("legend.floodGfm.noScenesForProvince"));
  });
});

describe("FloodScenesCard — รอบบินและเหตุการณ์", () => {
  it.each(LANGS)("รอบบินทุกฉากอยู่ในรายการ (ฉากแห้งด้วย) ใหม่สุดก่อน และฉากที่แสดงถูกทำเครื่องหมาย (%s)", (lang) => {
    const t = translator(lang);
    const html = render(lang, { scene: sceneState(S_0831, S_0831, null), atIso: null });
    const order = [S_0831, S_0829, S_DRY, S_2024].map((s) => html.indexOf(formatFullDateTime(lang, s.observedAt)));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain(t("floodScenes.dry"));
    expect(html).toContain('aria-current="true"');
    expect(html).toContain(t("floodScenes.km2", { km2: "26.5" }));
  });

  it.each(LANGS)("เหตุการณ์: 2024 (131.7) ก่อน ส.ค. 2026 (94.7, 2 รอบบิน) ฉากแห้งไม่อยู่ในเหตุการณ์ (%s)", (lang) => {
    const t = translator(lang);
    const html = render(lang, { scene: sceneState(S_0831, S_0831, null), atIso: null });
    const peak2024 = t("floodScenes.event.peak", { km2: "131.7", time: formatDateTime(lang, S_2024.observedAt) });
    const peak2026 = t("floodScenes.event.peak", { km2: "94.7", time: formatDateTime(lang, S_0831.observedAt) });
    expect(html.indexOf(peak2024)).toBeGreaterThan(0);
    expect(html.indexOf(peak2026)).toBeGreaterThan(html.indexOf(peak2024));
    expect(html).toContain(t("floodScenes.event.scenes", { n: 2 }));
    expect(html).toContain(t("floodScenes.event.scenes.one"));
    expect(html).toContain(t("floodScenes.events.note"));
  });

  it("ไม่มีรอบบินที่ท่วมเลย → บอกว่าไม่มีในรายการ (ตามภาพที่มี)", () => {
    const t = translator("th");
    const dryOnly: FloodScenesState = { ...scenesOk, index: { ...index, scenes: [S_DRY] } };
    const html = render("th", { scenes: dryOnly, scene: sceneState(S_DRY, S_DRY, null), atIso: null });
    expect(html).toContain(t("floodScenes.events.none"));
  });
});
