/**
 * กลุ่มของชั้นข้อมูล + ชุดชั้นต่อหัวข้อ (redesign PR 3) — pure module ไม่มี React/DOM
 *
 * สี่กลุ่ม (ทุกคีย์ของ `MapLayers` อยู่ในกลุ่มเดียวเท่านั้น — คีย์ใหม่ที่ไม่ได้จัดกลุ่มเป็น error ของ tsc
 * ที่ `everyLayerGrouped` และเทสตรวจคีย์ขาด/ซ้ำซ้ำอีกชั้นตอนรัน):
 *   observed     — ของที่เครื่องมือ/ดาวเทียมวัดมา
 *   illustrative — ของที่เราคำนวณเอง (ป้าย "ภาพประกอบ")
 *   crowdsourced — รายงานที่ผู้ใช้ทั่วไปส่งมา ยังไม่มีใครตรวจสอบ (ป้าย "รายงานจากประชาชน — ยังไม่ได้ตรวจสอบ")
 *                  ไม่อยู่ใต้หัว observed เพราะจะขัดกับป้ายของมันเอง
 *   basemap      — แผนที่ฐาน/ข้อมูลอ้างอิง ชุดของหัวข้อ **ไม่แตะกลุ่มนี้เลย**
 *
 * ชุดของหัวข้อ (preset) ตั้งเฉพาะชั้น observed + illustrative:
 *   overview — ค่าเดียวกับ `DEFAULT_LAYERS` (อ่านจากแหล่งเดียวกัน ไม่คัดลอก)
 *   water    — สถานี · ฮาโล · Sentinel-1 + ความลึก · GISTDA + แผ่น 3 มิติ · แผ่นจำลองจากสถานี ·
 *              เส้นทางน้ำเหนือ · เขื่อน เปิด; เรดาร์ + พื้นที่ลุ่มต่ำ ปิด
 *   weather  — เรดาร์ · สถานี · ฮาโล เปิด; ชั้นอื่นปิด
 *   quake    — ปิดทุกชั้น
 *
 * กฎของชั้นที่ชุดของหัวข้อไม่แตะ (`OPT_IN_LAYERS`: `cctv`, `exposure` — เจ้าของตัดสินใจให้ปิดเป็นค่าเริ่มต้น —
 * และ `community` ที่เปิดเป็นค่าเริ่มต้นแต่เจ้าของตัดสินใจให้อยู่นอกชุดของหัวข้อเช่นกัน): ชุดของ
 * หัวข้อ **ไม่แตะเลย** ทั้งไม่เปิดและไม่ปิด — ค่ายังเป็นตามที่ผู้ใช้ตั้งไว้ (ไม่มีหัวข้อไหนเปิดกล้องหรือ
 * ชั้นที่เราคำนวณเองให้โดยที่ผู้ใช้ไม่ได้กด และไม่มีหัวข้อไหนปิดสิ่งที่ผู้ใช้เพิ่งเปิดเองทิ้ง) และเพราะชุด
 * ไม่แตะมัน การกดสวิตช์ของสองชั้นนี้จึง **ไม่** ทำให้เป็น "ปรับเองแล้ว" (เหมือนแผนที่ฐาน) — เปิดกล้องแล้ว
 * สลับหัวข้อ ชั้นอื่นยังเปลี่ยนตามหัวข้อ ส่วนกล้องคงตามที่ผู้ใช้ตั้ง
 *
 * สรุป: ชั้นใน `PRESET_LAYERS` เท่านั้นที่ชุดของหัวข้อตั้งค่า และเท่านั้นที่การกดเองทำให้เป็น "ปรับเองแล้ว"
 *
 * สถานะ "เดินตามหัวข้อ / ปรับเองแล้ว" (`LayerPresetState`) และสถานะตอนเปิดหน้า (`initialLayerState`) อยู่ใน
 * `defaultLayers.ts` บนเส้นทางของ entry; กฎในไฟล์นี้ (ชุดของหัวข้อ สวิตช์ คืนค่า) ถูก App.tsx โหลดแบบ lazy
 * ตอนผู้ใช้เปลี่ยนหัวข้อ และถูกเรียกตรง ๆ จากรายการชั้นข้อมูล (chunk ของ `panelViews`) — ไม่อยู่ใน entry
 *
 * ชั้นที่พึ่งกันยังมีความหมายเดิม: `floodDepth` มีผลเฉพาะเมื่อ `floodGfm` เปิด, `gistdaDepth`
 * เฉพาะเมื่อ `floodExtent` เปิด — ไฟล์นี้ตั้งแค่สวิตช์ ไม่ได้เปลี่ยนการวาด
 */
import type { MapLayers } from "../components/layout/Map3DCanvas";
import { DEFAULT_LAYERS, type LayerPresetState } from "./defaultLayers";
import type { TopicKey } from "./topics";

export type LayerKey = keyof MapLayers;
export type LayerGroup = "observed" | "illustrative" | "crowdsourced" | "basemap";

/**
 * สมาชิกของแต่ละกลุ่ม ตามลำดับกลุ่มในรายการชั้นข้อมูล (observed → illustrative → crowdsourced → basemap) — โมดูลนี้เป็น
 * chunk แยก (App.tsx โหลดด้วย `import()` ตอนเปลี่ยนหัวข้อ, chunk ของ panelViews/MapLegend import ตรง)
 * จึงเก็บเป็นรายการสั้น ๆ ชุดเดียว ไม่มีตารางซ้ำ
 */
export const GROUP_LAYERS = {
  observed: ["stations", "hazard", "radar", "floodGfm", "floodExtent", "northRoute", "dams", "cctv"],
  illustrative: ["stationSheet", "gistdaDepth", "floodDepth", "lowland", "exposure"],
  crowdsourced: ["community"],
  basemap: ["imagery", "buildings", "trees", "roads", "water", "sunlight", "localAuthorities"],
} as const satisfies Record<LayerGroup, readonly LayerKey[]>;

/**
 * ตัวกันตอน build: คีย์ของ `MapLayers` ที่ไม่อยู่ในกลุ่มใดทำให้ `Exclude<…>` ไม่ว่าง แล้ว `{}` ขาด property
 * ที่บังคับ = error ของ tsc ตรงนี้ (คีย์ซ้ำ/ขาดตอนรันตรวจซ้ำใน `layerGroups.test.ts`)
 */
type Grouped = (typeof GROUP_LAYERS)[LayerGroup][number];
const everyLayerGrouped: Record<Exclude<LayerKey, Grouped>, never> = {};
void everyLayerGrouped;

export const layerGroupOf = (key: LayerKey): LayerGroup =>
  (GROUP_LAYERS.observed as readonly LayerKey[]).includes(key)
    ? "observed"
    : (GROUP_LAYERS.illustrative as readonly LayerKey[]).includes(key)
      ? "illustrative"
      : (GROUP_LAYERS.crowdsourced as readonly LayerKey[]).includes(key)
        ? "crowdsourced"
        : "basemap";

/**
 * ชั้นที่ชุดของหัวข้อไม่แตะ (ดูหัวไฟล์) — `cctv`/`exposure` ต้องกดเปิดเอง; `community` เปิดเป็นค่าเริ่มต้นแต่
 * เจ้าของตัดสินใจให้อยู่นอกชุดของหัวข้อ (กลุ่ม crowdsourced ไม่อยู่ใน `PRESET_LAYERS` อยู่แล้ว — ใส่ไว้ที่นี่
 * ด้วยเพื่อให้กฎ "สวิตช์ไม่ทำให้เป็นปรับเองแล้ว" อ่านได้จากรายการเดียว)
 */
export const OPT_IN_LAYERS: readonly LayerKey[] = ["cctv", "exposure", "community"];

/** ชั้นที่ชุดของหัวข้อตั้งค่าให้ = observed + illustrative ยกเว้นชั้นที่ต้องกดเปิดเอง */
export const PRESET_LAYERS: readonly LayerKey[] = [...GROUP_LAYERS.observed, ...GROUP_LAYERS.illustrative].filter(
  (k) => !OPT_IN_LAYERS.includes(k),
);

/** ชั้นที่ "เปิด" ในชุดของหัวข้อ — ชั้นใน `PRESET_LAYERS` ที่ไม่อยู่ในรายการ = ปิด */
const PRESET_ON: Record<Exclude<TopicKey, "overview">, readonly LayerKey[]> = {
  // น้ำ = ทุกชั้นในชุด ยกเว้นเรดาร์ฝนกับพื้นที่ลุ่มต่ำ
  water: PRESET_LAYERS.filter((k) => k !== "radar" && k !== "lowland"),
  weather: ["radar", "stations", "hazard"],
  quake: [],
};

/** ค่าของชั้นหนึ่งในชุดของหัวข้อ (เฉพาะชั้นใน `PRESET_LAYERS`) — ภาพรวม = `DEFAULT_LAYERS` */
export function presetValue(topic: TopicKey, key: LayerKey): boolean {
  return topic === "overview" ? DEFAULT_LAYERS[key] : PRESET_ON[topic].includes(key);
}

/** ชั้นตรงกับชุดของหัวข้อไหม — เทียบเฉพาะ `PRESET_LAYERS` (แผนที่ฐาน/ชั้นกดเปิดเองไม่นับ) */
export function matchesPreset(layers: MapLayers, topic: TopicKey): boolean {
  return PRESET_LAYERS.every((k) => layers[k] === presetValue(topic, k));
}

/** ตั้งชุดของหัวข้อลงบนชั้นเดิม — ไม่มีอะไรเปลี่ยน = คืนอ็อบเจ็กต์เดิม (ไม่กระเพื่อม permalink/แผนที่) */
export function applyPreset(layers: MapLayers, topic: TopicKey): MapLayers {
  if (matchesPreset(layers, topic)) return layers;
  const next = { ...layers };
  for (const k of PRESET_LAYERS) next[k] = presetValue(topic, k);
  return next;
}

/** ผู้ใช้เปลี่ยนหัวข้อ: เดินตามอยู่ = ตั้งชุดของหัวข้อใหม่; ปรับเองแล้ว = ไม่แตะชั้นเลย */
export function nextLayersOnTopicChange(state: LayerPresetState, topic: TopicKey): LayerPresetState {
  if (!state.following) return state;
  const layers = applyPreset(state.layers, topic);
  return layers === state.layers ? state : { layers, following: true };
}

/**
 * ผู้ใช้กดสวิตช์ของชั้นหนึ่ง: ชั้นที่ชุดของหัวข้อตั้งค่า (`PRESET_LAYERS`) = ปรับเองแล้ว; แผนที่ฐาน และชั้น
 * ที่ชุดไม่แตะ (`cctv`/`exposure`/`community`) = ยังเดินตามหัวข้อเหมือนเดิม
 */
export function applyToggle(state: LayerPresetState, key: LayerKey, value: boolean): LayerPresetState {
  if (state.layers[key] === value) return state;
  return {
    layers: { ...state.layers, [key]: value },
    following: state.following && !PRESET_LAYERS.includes(key),
  };
}

/** "คืนค่าเป็นชุดของหัวข้อ" — ตั้งชุดของหัวข้อปัจจุบันแล้วกลับไปเดินตามหัวข้อ */
export function resetToTopic(state: LayerPresetState, topic: TopicKey): LayerPresetState {
  const layers = applyPreset(state.layers, topic);
  return layers === state.layers && state.following ? state : { layers, following: true };
}
