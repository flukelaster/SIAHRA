import { useMemo } from "react";
import type {
  AoiProvenance,
  AoiProvenanceLayer,
  HazardLayerDescriptor,
  HealthResponse,
  SourceHealth,
  SourceId,
} from "@siahra/shared-types";
import type { MapLayers } from "../components/layout/Map3DCanvas";
import { STATIC_LAYER_DESCRIPTORS } from "../data/staticLayerDescriptors";
import type { DamsState } from "./useDams";
import type { FloodExposureState } from "./useFloodExposure";
import type { FloodExtentState } from "./useFloodExtent";
import type { FloodSceneState } from "./useFloodScene";
import type { FloodScenesState } from "./useFloodScenes";
import type { ObservationsState } from "./useObservations";
import type { RadarState } from "./useRadar";

export interface LayerDescriptorEntry {
  descriptor: HazardLayerDescriptor;
  /**
   * สถานะแหล่งข้อมูลที่แย่ที่สุดในบรรดา `sourceIds` ของชั้นนี้ (จาก /api/v1/health)
   * null = ชั้นนี้ไม่ได้ผูกกับแหล่งข้อมูลสดใด ๆ หรือยังไม่ได้ค่า health มา
   */
  health: SourceHealth | null;
}

export type LayerDescriptors = Partial<Record<keyof MapLayers, LayerDescriptorEntry>>;

/**
 * ชั้นใน legend ที่เติมเวลาได้จาก `manifest.provenance.sources` (E9.1)
 *
 * มีเฉพาะชั้น **static-reference** เท่านั้น:
 * - `imagery` ไม่อยู่ที่นี่เพราะไม่มี artefact ในชุดข้อมูล (Esri/EOX เป็น tile
 *   service ที่ดึงสดรายไทล์) จึงไม่มีเวลาให้จด และยังคงเป็น null ตามความจริง
 * - `lowland` ไม่อยู่ที่นี่เช่นกัน แม้จะคำนวณจาก DEM: มันเป็นชั้น *illustrative*
 *   ที่เบราว์เซอร์คำนวณตอนเปิดแผนที่ ไม่ได้ "ดึง" มาเมื่อไหร่ การเอาเวลา build
 *   ของ terrain มาใส่เป็น `fetchedAt` จะทำให้อ่านว่า "ดึงข้อมูลเมื่อ N วันก่อน"
 *   ซึ่งไม่จริง — ข้อความเดิม ("คำนวณจากภูมิประเทศ...") ตรงกว่า
 */
const PROVENANCE_LAYER_FOR: Partial<Record<keyof MapLayers, AoiProvenanceLayer>> = {
  roads: "roads",
  water: "water",
  buildings: "buildings",
  trees: "trees",
};

/**
 * เติม `fetchedAt`/`publishedAt` ของชั้นคงที่จากที่มาที่ manifest บันทึกไว้
 *
 * ไม่มี entry ใน manifest = ไม่แตะ descriptor เลย → `fetchedAt` ยังเป็น null
 * และ legend แสดงว่า "ไม่ได้บันทึกเวลาที่ดึงข้อมูล" ซึ่งเป็นความจริง ห้ามเดา
 * ด้วย `manifest.version`, `generatedAt` หรือเวลาปัจจุบัน
 */
function withProvenance(
  key: keyof MapLayers,
  descriptor: HazardLayerDescriptor,
  provenance: AoiProvenance | null,
): HazardLayerDescriptor {
  const layer = PROVENANCE_LAYER_FOR[key];
  const entry = layer ? provenance?.sources?.[layer] : undefined;
  if (!entry) return descriptor;
  return {
    ...descriptor,
    fetchedAt: entry.builtAt,
    // ต้นทางที่ไม่ได้ประกาศเวลาเผยแพร่ (WorldCover/Copernicus) คงค่าเดิม = null
    publishedAt: entry.publishedAt ?? descriptor.publishedAt ?? null,
  };
}

/**
 * ชั้น GFM สองชั้น (E14.F4): descriptor มาจาก `index.json` ที่ job เขียน (server-
 * authored) แต่เวลาที่มันบรรยายคือ **ฉากใหม่สุดในดัชนี** — ส่วนที่ผู้ใช้เห็นบนแผนที่
 * อาจเป็นฉากอื่น (เส้นเวลาถูกเลื่อนย้อนหลัง) `observedAt` ที่ legend แสดงจึงต้องเป็น
 * เวลาบันทึกภาพของฉากที่ *กำลังแสดง* (และ `publishedAt` ของฉากนั้น สำหรับชั้น
 * extent) ไม่ใช่ของฉากใหม่สุด และไม่ใช่ `fetchedAt` ซึ่งเป็นเวลาที่ job ดึง
 *
 * ไม่มีฉากในหน้าต่าง 14 วัน: ตัด `observedAt`/`publishedAt` ออก — ห้ามอวดเวลาของ
 * ฉากที่ไม่ได้วาด `FloodGfmDetails` ใน MapLegend เป็นคนบอกว่า "ภาพล่าสุดก่อนหน้านั้น"
 * คือเมื่อไหร่ ส่วน `fetchedAt` (job ดึงดัชนีสำเร็จเมื่อไหร่) คงไว้ตามจริง
 */
function withShownScene(
  descriptor: HazardLayerDescriptor,
  shown: FloodSceneState["scene"],
  noSceneInWindow: boolean,
  isExtent: boolean,
): HazardLayerDescriptor {
  if (shown) {
    return isExtent
      ? { ...descriptor, observedAt: shown.observedAt, publishedAt: shown.publishedAt }
      : { ...descriptor, observedAt: shown.observedAt };
  }
  if (!noSceneInWindow) return descriptor;
  const stripped: HazardLayerDescriptor = { ...descriptor, publishedAt: null };
  delete stripped.observedAt;
  return stripped;
}

/** เรียงจากดีสุดไปแย่สุด — ชั้นหนึ่งอาจใช้หลายแหล่ง จึงรายงานอันที่แย่ที่สุด */
const HEALTH_ORDER: SourceHealth[] = ["ok", "delayed", "stale", "degraded", "down", "unknown"];

/** เรียงจากดีสุดไปแย่สุด — ชั้นหนึ่งอาจใช้หลายแหล่ง จึงรายงานอันที่แย่ที่สุด
 *
 * Exported for reuse outside this hook (e.g. `hooks/useLocalAuthorityImpact.ts`,
 * `hooks/useAffectedAuthorities.ts`): any card that renders a `HazardLayerDescriptor`
 * needs the same "worst of its `sourceIds`" join against `/api/v1/health`, and
 * copying this loop a second time would let the two drift. `null` here means
 * "no `sourceIds` matched a live entry in `/health`" — e.g. a purely
 * static-reference source like `dla`/`osm`/`worldpop` that has no live feed and
 * therefore no health row by design; callers must render that as "no live
 * source to check", never as a green "ok" dot. */
export function worstHealth(ids: readonly SourceId[], health: HealthResponse | null): SourceHealth | null {
  if (!health) return null;
  let worst: SourceHealth | null = null;
  for (const id of ids) {
    const s = health.sources.find((x) => x.id === id);
    if (!s) continue; // แหล่งข้อมูลคงที่ (ETL) ไม่มีสถานะใน /health ตามนิยาม
    const rank = HEALTH_ORDER.indexOf(s.health);
    if (worst === null || rank > HEALTH_ORDER.indexOf(worst)) worst = s.health;
  }
  return worst;
}

/**
 * รวม `HazardLayerDescriptor` ของทุกชั้นที่ legend แสดง ไว้ที่เดียว
 *
 * - ชั้นที่มาจาก API อ่าน `.layer` ที่ backend ประกาศไว้ตรง ๆ (ห้ามประกอบเอง
 *   ฝั่ง web ไม่งั้นเวลาที่แสดงจะเป็นเวลาของ client ไม่ใช่เวลาที่ดึงจริง)
 * - ชั้นคงที่/ชั้นที่คำนวณฝั่ง client อ่านจาก `data/staticLayerDescriptors.ts`
 *
 * ไม่มีการคำนวณ "อายุ" ที่นี่ — อายุเกิดตอนเรนเดอร์ใน MapLegend เท่านั้น
 */
export function useLayerDescriptors(input: {
  observations: ObservationsState;
  radar: RadarState;
  floodExtent: FloodExtentState;
  dams: DamsState;
  /** run ล่าสุดของชั้นการเผชิญน้ำ (E10.4) — descriptor มาจาก `run.layer` ตรง ๆ */
  exposure: FloodExposureState;
  /** ดัชนีฉาก GFM ของจังหวัด (E14.F4) — descriptor สองชั้นอยู่ใน `index.layers` */
  floodScenes: FloodScenesState;
  /** ฉาก GFM ที่กำลังแสดง — ตัวกำหนด `observedAt` ที่ legend เห็น (ดู withShownScene) */
  floodScene: FloodSceneState;
  health: HealthResponse | null;
  /** `manifest.provenance` ของจังหวัดที่กำลังแสดง — null = manifest ก่อน E9.1 */
  provenance: AoiProvenance | null;
}): LayerDescriptors {
  const { observations, radar, floodExtent, dams, exposure, floodScenes, floodScene, health, provenance } = input;
  const obsLayer = observations.data?.layer;
  const radarLayer = radar.data?.layer;
  const floodLayer = floodExtent.data?.layer;
  const damsLayer = dams.data?.layer;
  // ห้ามประกอบ descriptor ของชั้นนี้เอง: `epistemicClass: "illustrative"`,
  // `methodologyUrl` และ `fetchedAt` ถูกประกาศไว้ใน run ที่ api เผยแพร่ (E10.2/E10.3)
  // การเขียนใหม่ฝั่งเว็บจะทำให้ป้ายกับเวลาบน legend เลิกตรงกับ artefact ที่อ้างอิงได้
  const exposureLayer = exposure.data?.layer;
  // E14.F4 — สองชั้นจาก index.json (observed extent + illustrative depth) ห้ามประกอบเอง
  // ฝั่งเว็บเช่นกัน: `methodologyUrl`, `staleAfterSeconds`, `fetchedAt` ถูกประกาศโดย job
  const floodIndexLayers = floodScenes.index?.layers;
  const shownScene = floodScene.scene;
  const noSceneInWindow = floodScene.reason === "no-scene-in-window";

  return useMemo(() => {
    const out: LayerDescriptors = {};
    const put = (key: keyof MapLayers, descriptor: HazardLayerDescriptor | undefined) => {
      if (!descriptor) return;
      out[key] = { descriptor, health: worstHealth(descriptor.sourceIds, health) };
    };

    for (const [key, descriptor] of Object.entries(STATIC_LAYER_DESCRIPTORS)) {
      put(key as keyof MapLayers, withProvenance(key as keyof MapLayers, descriptor, provenance));
    }
    // สถานีตรวจวัดกับรัศมีรอบสถานีมาจาก payload เดียวกันของ ThaiWater
    put("stations", obsLayer);
    put("hazard", obsLayer);
    put("radar", radarLayer);
    put("floodExtent", floodLayer);
    put("dams", damsLayer);
    put("exposure", exposureLayer);
    if (floodIndexLayers) {
      put("floodGfm", withShownScene(floodIndexLayers.extent, shownScene, noSceneInWindow, true));
      put("floodDepth", withShownScene(floodIndexLayers.depth, shownScene, noSceneInWindow, false));
    }
    return out;
  }, [
    obsLayer,
    radarLayer,
    floodLayer,
    damsLayer,
    exposureLayer,
    floodIndexLayers,
    shownScene,
    noSceneInWindow,
    health,
    provenance,
  ]);
}
