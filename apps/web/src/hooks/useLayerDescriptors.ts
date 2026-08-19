import { useMemo } from "react";
import type { HazardLayerDescriptor, HealthResponse, SourceHealth, SourceId } from "@siahra/shared-types";
import type { MapLayers } from "../components/layout/Map3DCanvas";
import { STATIC_LAYER_DESCRIPTORS } from "../data/staticLayerDescriptors";
import type { DamsState } from "./useDams";
import type { FloodExtentState } from "./useFloodExtent";
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

/** เรียงจากดีสุดไปแย่สุด — ชั้นหนึ่งอาจใช้หลายแหล่ง จึงรายงานอันที่แย่ที่สุด */
const HEALTH_ORDER: SourceHealth[] = ["ok", "delayed", "stale", "degraded", "down", "unknown"];

function worstHealth(ids: readonly SourceId[], health: HealthResponse | null): SourceHealth | null {
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
  health: HealthResponse | null;
}): LayerDescriptors {
  const { observations, radar, floodExtent, dams, health } = input;
  const obsLayer = observations.data?.layer;
  const radarLayer = radar.data?.layer;
  const floodLayer = floodExtent.data?.layer;
  const damsLayer = dams.data?.layer;

  return useMemo(() => {
    const out: LayerDescriptors = {};
    const put = (key: keyof MapLayers, descriptor: HazardLayerDescriptor | undefined) => {
      if (!descriptor) return;
      out[key] = { descriptor, health: worstHealth(descriptor.sourceIds, health) };
    };

    for (const [key, descriptor] of Object.entries(STATIC_LAYER_DESCRIPTORS)) {
      put(key as keyof MapLayers, descriptor);
    }
    // สถานีตรวจวัดกับรัศมีรอบสถานีมาจาก payload เดียวกันของ ThaiWater
    put("stations", obsLayer);
    put("hazard", obsLayer);
    put("radar", radarLayer);
    put("floodExtent", floodLayer);
    put("dams", damsLayer);
    return out;
  }, [obsLayer, radarLayer, floodLayer, damsLayer, health]);
}
