import { describe, expect, it } from "vitest";
import type { MapLayers } from "../components/layout/Map3DCanvas";
import { DEFAULT_LAYERS, initialLayerState } from "./defaultLayers";
import {
  GROUP_LAYERS,
  OPT_IN_LAYERS,
  PRESET_LAYERS,
  applyPreset,
  applyToggle,
  matchesPreset,
  nextLayersOnTopicChange,
  presetValue,
  resetToTopic,
  layerGroupOf,
  type LayerGroup,
  type LayerKey,
} from "./layerGroups";
import { layerPresetStatus } from "./layerPresetStatus";
import { parsePermalink, serialisePermalink } from "./permalink";
import { TOPIC_KEYS } from "./topics";

/**
 * ชุดคีย์อ้างอิงจากอ็อบเจ็กต์ที่มีชนิด `Record<keyof MapLayers, true>` — คีย์ใหม่ใน `MapLayers` ที่ไม่ได้
 * เติมที่นี่เป็น error ของ tsc (เทสแดงตั้งแต่ขั้น type-check) แล้วเทสข้างล่างเทียบกับกลุ่มอีกชั้น
 */
const EVERY_KEY: Record<keyof MapLayers, true> = {
  imagery: true,
  lowland: true,
  exposure: true,
  hazard: true,
  stations: true,
  buildings: true,
  roads: true,
  water: true,
  floodExtent: true,
  floodGfm: true,
  floodDepth: true,
  dams: true,
  cctv: true,
  radar: true,
  sunlight: true,
  trees: true,
  localAuthorities: true,
  stationSheet: true,
  gistdaDepth: true,
  northRoute: true,
};
const ALL = Object.keys(EVERY_KEY).sort();

const LAYER_GROUPS = Object.keys(GROUP_LAYERS) as LayerGroup[];
const groupOf = (g: LayerGroup) => [...GROUP_LAYERS[g]].sort() as LayerKey[];
const withOn = (on: readonly LayerKey[]): MapLayers =>
  Object.fromEntries(ALL.map((k) => [k, on.includes(k as LayerKey)])) as unknown as MapLayers;
const onKeys = (l: MapLayers) => (Object.keys(l) as LayerKey[]).filter((k) => l[k]).sort();

describe("layerGroups — ทุกชั้นอยู่ในกลุ่มเดียว", () => {
  it("กลุ่มครอบคลุมทุกคีย์ของ MapLayers และ DEFAULT_LAYERS พอดี ไม่ขาด ไม่ซ้ำ", () => {
    const flat = LAYER_GROUPS.flatMap((g) => groupOf(g));
    expect(flat.slice().sort()).toEqual(ALL);
    expect(new Set(flat).size).toBe(flat.length);
    expect(Object.keys(DEFAULT_LAYERS).sort()).toEqual(ALL);
    for (const g of LAYER_GROUPS) for (const k of GROUP_LAYERS[g]) expect(layerGroupOf(k), k).toBe(g);
    expect(LAYER_GROUPS).toEqual(["observed", "illustrative", "basemap"]);
  });

  it("สมาชิกของแต่ละกลุ่มตามที่ตกลงไว้", () => {
    expect(groupOf("observed")).toEqual(
      ["stations", "hazard", "radar", "floodGfm", "floodExtent", "northRoute", "dams", "cctv"].sort(),
    );
    expect(groupOf("illustrative")).toEqual(["stationSheet", "gistdaDepth", "floodDepth", "lowland", "exposure"].sort());
    expect(groupOf("basemap")).toEqual(
      ["imagery", "buildings", "trees", "roads", "water", "sunlight", "localAuthorities"].sort(),
    );
  });

  it("DEFAULT_LAYERS คงเดิม: เปิด 18 จาก 20 ชั้น (ปิดเฉพาะ exposure กับ cctv)", () => {
    expect(ALL.filter((k) => !DEFAULT_LAYERS[k as LayerKey]).sort()).toEqual(["cctv", "exposure"]);
  });
});

describe("layerGroups — ชุดของหัวข้อ", () => {
  it("ชุดตั้งเฉพาะชั้น observed + illustrative ที่ไม่ใช่ชั้นกดเปิดเอง", () => {
    expect(PRESET_LAYERS.slice().sort()).toEqual(
      [...groupOf("observed"), ...groupOf("illustrative")].filter((k) => !OPT_IN_LAYERS.includes(k)).sort(),
    );
    expect(OPT_IN_LAYERS.slice().sort()).toEqual(["cctv", "exposure"]);
  });

  it("ภาพรวม = ค่าของ DEFAULT_LAYERS", () => {
    for (const k of PRESET_LAYERS) expect(presetValue("overview", k)).toBe(DEFAULT_LAYERS[k]);
  });

  const expectOn = (topic: (typeof TOPIC_KEYS)[number], on: string[]) => {
    const got = PRESET_LAYERS.filter((k) => presetValue(topic, k)).sort();
    expect(got).toEqual(on.slice().sort());
  };
  it("น้ำ: สถานี ฮาโล GFM+ความลึก GISTDA+แผ่น แผ่นจำลอง เส้นทางน้ำเหนือ เขื่อน เปิด; เรดาร์ ลุ่มต่ำ ปิด", () => {
    expectOn("water", ["stations", "hazard", "floodGfm", "floodDepth", "floodExtent", "gistdaDepth", "stationSheet", "northRoute", "dams"]);
    expect(presetValue("water", "radar")).toBe(false);
    expect(presetValue("water", "lowland")).toBe(false);
  });
  it("ฝนและพายุ: เรดาร์ สถานี ฮาโล เปิด ที่เหลือปิด", () => {
    expectOn("weather", ["radar", "stations", "hazard"]);
  });
  it("แผ่นดินไหว: ปิดทุกชั้น", () => {
    expectOn("quake", []);
  });

  it.each(TOPIC_KEYS)("ไม่แตะแผนที่ฐาน และไม่แตะ cctv/exposure ทั้งเปิดและปิด (%s)", (topic) => {
    for (const start of [withOn([]), withOn(ALL as LayerKey[])]) {
      const next = applyPreset(start, topic);
      for (const k of [...groupOf("basemap"), ...OPT_IN_LAYERS]) expect(next[k]).toBe(start[k]);
    }
  });

  it("ไม่มีหัวข้อไหนเปิด cctv หรือ exposure ให้", () => {
    for (const topic of TOPIC_KEYS) {
      const next = applyPreset(withOn([]), topic);
      expect(next.cctv).toBe(false);
      expect(next.exposure).toBe(false);
    }
  });

  it("applyPreset ที่ไม่เปลี่ยนอะไรคืนอ็อบเจ็กต์เดิม", () => {
    expect(applyPreset(DEFAULT_LAYERS, "overview")).toBe(DEFAULT_LAYERS);
    expect(matchesPreset(DEFAULT_LAYERS, "overview")).toBe(true);
    expect(matchesPreset(DEFAULT_LAYERS, "water")).toBe(false);
  });
});

describe("layerGroups — เดินตามหัวข้อ / ปรับเอง", () => {
  it("ไม่มี ?layers= → DEFAULT_LAYERS และเดินตามหัวข้อ (ไม่ใช้ชุดของหัวข้อตอนเริ่ม)", () => {
    const s = initialLayerState(null);
    expect(s.layers).toBe(DEFAULT_LAYERS);
    expect(s.following).toBe(true);
  });

  it("มี ?layers= → ชั้นตามลิงก์พอดี และเริ่มแบบปรับเองแล้ว", () => {
    const s = initialLayerState(["imagery", "radar", "cctv"]);
    expect(onKeys(s.layers)).toEqual(["cctv", "imagery", "radar"]);
    expect(s.following).toBe(false);
    // หัวข้อเปลี่ยนก็ไม่แตะ
    expect(nextLayersOnTopicChange(s, "water")).toBe(s);
  });

  it("ลิงก์ที่มี ?layers= เปิดแล้วเขียนกลับเป็นลิงก์เดิมทุกตัวอักษร", () => {
    // รูปที่ `serialisePermalink` เขียนเองอยู่แล้ว (URLSearchParams เข้ารหัส "," เป็น %2C)
    const search = "?p=10&layers=imagery%2Clowland%2Chazard%2Cstations%2Cradar";
    const s = initialLayerState(parsePermalink(search).layers);
    expect(
      serialisePermalink({
        provinceCode: "10",
        pose: null,
        exaggeration: 1,
        layers: { ...s.layers },
        defaultLayers: { ...DEFAULT_LAYERS },
        atIso: null,
        forecastAtIso: null,
        lang: "th",
      }),
    ).toBe(search);
  });

  it("เดินตามหัวข้อ: เปลี่ยนหัวข้อ = ตั้งชุดของหัวข้อนั้น", () => {
    let s = initialLayerState(null);
    s = nextLayersOnTopicChange(s, "weather");
    expect(s.following).toBe(true);
    expect(onKeys(s.layers).filter((k) => PRESET_LAYERS.includes(k))).toEqual(["hazard", "radar", "stations"]);
    // แผนที่ฐานยังเปิดตามเดิม
    for (const k of groupOf("basemap")) expect(s.layers[k]).toBe(true);
    s = nextLayersOnTopicChange(s, "quake");
    expect(PRESET_LAYERS.some((k) => s.layers[k])).toBe(false);
    s = nextLayersOnTopicChange(s, "overview");
    expect(s.layers).toEqual(DEFAULT_LAYERS);
  });

  it("สลับชั้นที่ชุดของหัวข้อตั้งค่า = ปรับเองแล้ว หัวข้อเปลี่ยนก็ไม่แตะชั้นอีก", () => {
    expect(PRESET_LAYERS).toHaveLength(11);
    for (const key of PRESET_LAYERS) {
      const start = initialLayerState(null);
      const s = applyToggle(start, key, !start.layers[key]);
      expect(s.following, key).toBe(false);
      expect(nextLayersOnTopicChange(s, "quake")).toBe(s);
    }
  });

  it("สลับชั้นแผนที่ฐานไม่ทำให้เป็นปรับเอง", () => {
    for (const key of groupOf("basemap")) {
      const s = applyToggle(initialLayerState(null), key, false);
      expect(s.following, key).toBe(true);
      expect(s.layers[key]).toBe(false);
      // หัวข้อถัดไปยังตั้งชุด และไม่คืนค่าแผนที่ฐานที่ผู้ใช้ปิดไว้
      const next = nextLayersOnTopicChange(s, "quake");
      expect(next.layers[key]).toBe(false);
      expect(next.layers.stations).toBe(false);
    }
  });

  it.each(["cctv", "exposure"] as const)("สลับ %s (ชั้นกดเปิดเอง ชุดไม่แตะ) ไม่ทำให้เป็นปรับเอง — ทั้งเปิดและปิด", (key) => {
    // เปิด ขณะเดินตามหัวข้อ → ยังเดินตาม
    let s = applyToggle(initialLayerState(null), key, true);
    expect(s.following).toBe(true);
    expect(s.layers[key]).toBe(true);
    // เปลี่ยนหัวข้อ → ชุดยังถูกตั้งให้ชั้นอื่น ส่วนชั้นนี้คงตามที่ผู้ใช้ตั้ง
    s = nextLayersOnTopicChange(s, "weather");
    expect(s.following).toBe(true);
    expect(onKeys(s.layers).filter((k) => PRESET_LAYERS.includes(k))).toEqual(["hazard", "radar", "stations"]);
    expect(s.layers[key]).toBe(true);
    s = nextLayersOnTopicChange(s, "quake");
    expect(PRESET_LAYERS.some((k) => s.layers[k])).toBe(false);
    expect(s.layers[key]).toBe(true);
    // ปิด ขณะเดินตามหัวข้อ → ยังเดินตาม และหัวข้อถัดไปไม่เปิดกลับ
    s = applyToggle(s, key, false);
    expect(s.following).toBe(true);
    s = nextLayersOnTopicChange(s, "water");
    expect(s.layers[key]).toBe(false);
    expect(s.layers.floodGfm).toBe(true);
    expect(s.layers.radar).toBe(false);
  });

  it("สลับเป็นค่าเดิม = ไม่มีอะไรเปลี่ยน", () => {
    const s = initialLayerState(null);
    expect(applyToggle(s, "radar", true)).toBe(s);
  });

  it("คืนค่าเป็นชุดของหัวข้อ = ตั้งชุดของหัวข้อปัจจุบันและกลับไปเดินตาม", () => {
    let s = applyToggle(nextLayersOnTopicChange(initialLayerState(null), "water"), "radar", true);
    expect(s.following).toBe(false);
    expect(layerPresetStatus(s, "water")).toBe("custom");
    s = resetToTopic(s, "water");
    expect(s.following).toBe(true);
    expect(s.layers.radar).toBe(false);
    expect(layerPresetStatus(s, "water")).toBe("following");
    // เดินตามต่อ
    s = nextLayersOnTopicChange(s, "weather");
    expect(s.layers.radar).toBe(true);
    expect(s.layers.floodGfm).toBe(false);
  });

  it("คืนค่าไม่แตะ cctv/exposure ที่ผู้ใช้เปิดไว้", () => {
    let s = applyToggle(initialLayerState(null), "cctv", true);
    s = applyToggle(s, "exposure", true);
    s = resetToTopic(s, "quake");
    expect(s.layers.cctv).toBe(true);
    expect(s.layers.exposure).toBe(true);
    expect(s.following).toBe(true);
  });

  it("หลังเปิดหน้าบนหัวข้อที่ไม่ใช่ภาพรวม: เดินตามอยู่แต่ยังไม่ใช่ชุดของหัวข้อนั้น (pending)", () => {
    const s = initialLayerState(null);
    expect(layerPresetStatus(s, "overview")).toBe("following");
    expect(layerPresetStatus(s, "water")).toBe("pending");
    expect(resetToTopic(resetToTopic(s, "water"), "water")).toEqual(resetToTopic(s, "water"));
  });

  it("เปลี่ยนหัวข้อแต่ชุดเท่าเดิม = คืนสถานะเดิม (ไม่กระเพื่อม)", () => {
    const s = initialLayerState(null);
    expect(nextLayersOnTopicChange(s, "overview")).toBe(s);
  });
});
