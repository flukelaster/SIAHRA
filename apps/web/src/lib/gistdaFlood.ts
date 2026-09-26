import type { FloodAcquisition, FloodExtentFeature, FloodExtentResponse } from "@siahra/shared-types";

/**
 * ตรรกะล้วนของชั้น GISTDA (E16.PR0) — ต้นทางใหม่ส่งเป็นเซลล์ H3 res-9 (~0.1 km²) ต่อจังหวัด
 * หลายพันเซลล์ การ์ด/ป้ายบนแผนที่จึงรวมเป็นรายตำบลก่อนแสดง (อันดับ "20 เซลล์ใหญ่สุด" ไม่มีความหมาย)
 */

/** 1 ไร่ = 1,600 m² — ต้นทางให้พื้นที่เป็น m² (`f_area`) */
export const SQM_PER_RAI = 1600;

export const m2ToRai = (m2: number): number => m2 / SQM_PER_RAI;

/**
 * ชื่อดาวเทียมจากรหัสที่ GISTDA ใส่ใน `file_name` — รหัสที่ไม่รู้จักแสดงตามที่ต้นทางเขียน
 * ไม่เดาชื่อให้
 */
export function sensorLabel(code: string): string {
  const s1 = /^S1([A-D])$/i.exec(code);
  if (s1) return `Sentinel-1${s1[1]!.toUpperCase()}`;
  if (/^rd2$/i.test(code)) return "RADARSAT-2";
  if (/^rcm\d?$/i.test(code)) return "RADARSAT Constellation";
  return code;
}

export type Bbox = [minX: number, minY: number, maxX: number, maxY: number];

const bboxCache = new WeakMap<FloodExtentFeature, Bbox | null>();

/** กรอบของ outer ring ทุกชิ้น — null เมื่อรูปทรงว่าง (เซลล์ที่ยุบหายตอนปัดพิกัด); แคชต่อ object */
export function featureBbox(f: FloodExtentFeature): Bbox | null {
  const hit = bboxCache.get(f);
  if (hit !== undefined) return hit;
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polys) {
    for (const pt of poly[0] ?? []) {
      const [x, y] = pt as [number, number];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const box: Bbox | null = minX <= maxX ? [minX, minY, maxX, maxY] : null;
  bboxCache.set(f, box);
  return box;
}

export const bboxContains = (b: Bbox, lon: number, lat: number): boolean =>
  lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];

export interface TambonFloodGroup {
  key: string;
  tambonTh: string | null;
  amphoeTh: string | null;
  cells: number;
  areaM2: number;
  /** ภาพใหม่สุดของเซลล์ในตำบลนี้ — null เมื่อไม่มีเซลล์ไหนบอก */
  observedAt: string | null;
  /** เวลาที่ระบบเราเห็นเซลล์แรกของตำบลนี้ — null เมื่อไม่รู้ (ฉาก WFS เดิม) */
  firstSeenAt: string | null;
  /** จุดกึ่งกลางถ่วงด้วยพื้นที่ของกรอบเซลล์ — null เมื่อทุกเซลล์ไม่มีรูปทรง */
  lon: number | null;
  lat: number | null;
}

/** รวมเซลล์เป็นรายตำบล เรียงพื้นที่มากสุดก่อน (ฉาก WFS เดิมมีหนึ่ง polygon ต่อตำบลอยู่แล้ว) */
export function groupByTambon(features: readonly FloodExtentFeature[]): TambonFloodGroup[] {
  const groups = new Map<string, TambonFloodGroup & { wx: number; wy: number; w: number }>();
  for (const f of features) {
    const p = f.properties;
    const key = p.tambonCode ?? `${p.amphoeTh ?? ""}|${p.tambonTh ?? f.id}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        tambonTh: p.tambonTh,
        amphoeTh: p.amphoeTh,
        cells: 0,
        areaM2: 0,
        observedAt: null,
        firstSeenAt: null,
        lon: null,
        lat: null,
        wx: 0,
        wy: 0,
        w: 0,
      };
      groups.set(key, g);
    }
    g.cells++;
    const area = p.floodAreaM2 ?? 0;
    g.areaM2 += area;
    if (p.observedAt && (g.observedAt === null || p.observedAt > g.observedAt)) g.observedAt = p.observedAt;
    if (p.firstSeenAt && (g.firstSeenAt === null || p.firstSeenAt < g.firstSeenAt)) g.firstSeenAt = p.firstSeenAt;
    const box = featureBbox(f);
    if (box) {
      const w = area > 0 ? area : 1;
      g.wx += ((box[0] + box[2]) / 2) * w;
      g.wy += ((box[1] + box[3]) / 2) * w;
      g.w += w;
    }
  }
  return [...groups.values()]
    .map(({ wx, wy, w, ...g }) => ({ ...g, lon: w > 0 ? wx / w : null, lat: w > 0 ? wy / w : null }))
    .sort((a, b) => b.areaM2 - a.areaM2);
}

/**
 * สถานะของคำตอบหนึ่งจังหวัด — แยก "ถามแล้วต้นทางตอบว่าไม่พบเซลล์" ออกจาก
 * "ยังไม่เคยถามสำเร็จ" และ "ไม่มีฉากที่เก็บไว้ ณ เวลานั้น" (AGENTS.md: ห้ามอ้างสภาพต้นทางที่ไม่ได้ probe)
 */
export type GistdaExtentState = "loading" | "no-archived-scene" | "never-fetched" | "none-detected" | "detected";

export function gistdaExtentState(data: FloodExtentResponse | null): GistdaExtentState {
  if (!data) return "loading";
  if (data.reason === "no-archived-scene") return "no-archived-scene";
  if (!data.retrievedAt) return "never-fetched";
  return data.features.length === 0 && (data.matched ?? 0) === 0 ? "none-detected" : "detected";
}

/** ภาพที่ใช้ในคำตอบนี้ ใหม่สุดก่อน — ใช้ของ response ถ้ามี ไม่งั้นรวมจาก feature */
export function responseAcquisitions(data: FloodExtentResponse | null): FloodAcquisition[] {
  if (!data) return [];
  if (data.acquisitions?.length) return data.acquisitions;
  const seen = new Map<string, FloodAcquisition>();
  for (const f of data.features) for (const a of f.properties.acquisitions ?? []) seen.set(`${a.sensor}|${a.acquiredAt}`, a);
  return [...seen.values()].sort((a, b) => (a.acquiredAt < b.acquiredAt ? 1 : a.acquiredAt > b.acquiredAt ? -1 : 0));
}
