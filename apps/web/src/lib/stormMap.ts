/**
 * คณิตของแผนที่ 2 มิติในแผงพายุ (`components/hazard/StormMap.tsx`) — pure ทั้งไฟล์
 * ไม่มี DOM ไม่มี React จึงเทสได้ตรง ๆ (`stormMap.test.ts`)
 *
 *   - ภาพฉายแบบ equirectangular: x = (lon − lon0)·cos φ0, y = lat — φ0 คือละติจูดกลาง
 *     ของกรอบที่แสดง ระยะตะวันออก–ตะวันตกจึงไม่ถูกยืดเกินจริงที่ละติจูดนั้น
 *   - แปลงกิโลเมตรเป็นองศาพร้อมแก้ด้วย cos(lat) — วงกลม 70 % ของ JMA ที่รัศมีเป็น กม.
 *     จึงกลายเป็นวงรีในองศา (กว้างในแนวลองจิจูดมากกว่าเมื่อขึ้นเหนือ) ก่อนฉายลงจอ
 *     คอมโพเนนต์วาดเป็น `<ellipse>` ไม่ใช่ `<circle>` ด้วยเหตุนี้
 *   - กรอบที่แสดงคำนวณจากเนื้อหาจริง (ทุกจุดของเส้นทาง + ขอบวงกลม + กรวย GDACS +
 *     ประเทศไทย) — ไม่ตัดจุดใดทิ้งเงียบ ๆ ถ้าเนื้อหาเลยขอบแผนที่ฐาน (lon 80–150 /
 *     lat −5–35) กรอบก็ขยายตาม และ `beyondBasemap` บอกให้แผงเขียนหมายเหตุ
 *
 * ทุกอย่างที่นี่เป็นเรขาคณิตล้วน ไม่มีตัวเลขใดของพายุถูกคำนวณขึ้นใหม่
 */

import type { StormTrack } from "@siahra/shared-types";

/** สีของพายุแต่ละลูก (ตามลำดับในคำตอบ) — แผนที่และการ์ดในแผงใช้สีเดียวกัน */
export const STORM_COLORS = ["#f472b6", "#38bdf8", "#facc15", "#a78bfa", "#34d399"] as const;
export const stormColor = (i: number): string => STORM_COLORS[i % STORM_COLORS.length];

/** กิโลเมตรต่อหนึ่งองศาละติจูด (ทรงกลมรัศมีเฉลี่ย 6371 กม.) */
export const KM_PER_DEG_LAT = 111.195;

export interface LonLat {
  lon: number;
  lat: number;
}

export interface GeoBounds {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/** ขอบเขตของแผนที่ฐาน `public/geo/region-outline.json` (ตรงกับ `REGION_BBOX` ของสคริปต์ ETL) */
export const BASEMAP_BOUNDS: GeoBounds = { minLon: 80, minLat: -5, maxLon: 150, maxLat: 35 };

/** กรอบของประเทศไทย (ปัดออกเล็กน้อย) — อยู่ในกรอบที่แสดงเสมอ ผู้ใช้ต้องเห็นว่าพายุอยู่ห่างแค่ไหน */
export const THAILAND_BOUNDS: GeoBounds = { minLon: 97.3, minLat: 5.6, maxLon: 105.7, maxLat: 20.5 };

/**
 * รัศมี (กม.) ที่จุดศูนย์กลางละติจูด `lat` → ครึ่งแกนเป็นองศา
 * `dLon` แก้ด้วย cos(lat) (เส้นลองจิจูดบีบเข้าหากันเมื่อขึ้นเหนือ) — ใกล้ขั้วโลกตัด cos
 * ไว้ที่ 0.01 กันหารศูนย์ (แอ่งที่แสดงไม่เคยถึง แต่ฟังก์ชันต้องไม่คืน Infinity)
 */
export function kmToDegrees(km: number, lat: number): { dLat: number; dLon: number } {
  const cos = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const dLat = km / KM_PER_DEG_LAT;
  return { dLat, dLon: dLat / cos };
}

export interface Projection {
  width: number;
  height: number;
  bounds: GeoBounds;
  /** lon/lat → พิกัด SVG (y ลงล่าง) */
  project: (lon: number, lat: number) => { x: number; y: number };
  /** รัศมี กม. ที่ (lon, lat) → ครึ่งแกนของวงรีบนจอ (px) */
  radiusPx: (km: number, lat: number) => { rx: number; ry: number };
}

/**
 * ภาพฉาย equirectangular ของ `bounds` ลงกว้าง `width` px — ความสูงตามสัดส่วนจริง
 * (หลังคูณ cos φ0) ผู้เรียกควรใช้ `fitBounds` ก่อนเพื่อคุมสัดส่วนภาพไม่ให้แบนหรือสูงเกิน
 */
export function createProjection(bounds: GeoBounds, width: number): Projection {
  const midLat = (bounds.minLat + bounds.maxLat) / 2;
  const k = Math.cos((midLat * Math.PI) / 180);
  const spanX = Math.max(1e-6, (bounds.maxLon - bounds.minLon) * k);
  const spanY = Math.max(1e-6, bounds.maxLat - bounds.minLat);
  const scale = width / spanX;
  const height = spanY * scale;
  return {
    width,
    height,
    bounds,
    project: (lon, lat) => ({
      x: (lon - bounds.minLon) * k * scale,
      y: (bounds.maxLat - lat) * scale,
    }),
    radiusPx: (km, lat) => {
      const { dLat, dLon } = kmToDegrees(km, lat);
      return { rx: dLon * k * scale, ry: dLat * scale };
    },
  };
}

/** กรอบของชุดจุด + วงกลม (กม.) — null เมื่อไม่มีจุดเลย */
export function boundsOf(points: readonly (LonLat & { radiusKm?: number | null })[]): GeoBounds | null {
  if (points.length === 0) return null;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const p of points) {
    const r = p.radiusKm && p.radiusKm > 0 ? kmToDegrees(p.radiusKm, p.lat) : { dLat: 0, dLon: 0 };
    minLon = Math.min(minLon, p.lon - r.dLon);
    maxLon = Math.max(maxLon, p.lon + r.dLon);
    minLat = Math.min(minLat, p.lat - r.dLat);
    maxLat = Math.max(maxLat, p.lat + r.dLat);
  }
  return { minLon, minLat, maxLon, maxLat };
}

export function unionBounds(...bs: (GeoBounds | null | undefined)[]): GeoBounds | null {
  const real = bs.filter((b): b is GeoBounds => !!b);
  if (real.length === 0) return null;
  return {
    minLon: Math.min(...real.map((b) => b.minLon)),
    minLat: Math.min(...real.map((b) => b.minLat)),
    maxLon: Math.max(...real.map((b) => b.maxLon)),
    maxLat: Math.max(...real.map((b) => b.maxLat)),
  };
}

export interface FitOptions {
  /** ขอบเผื่อรอบเนื้อหา เป็นสัดส่วนของช่วง (ค่าเริ่ม 0.08) */
  padFraction?: number;
  /** ช่วงต่ำสุด (องศา) ของแต่ละแกน — กันซูมเข้าจนประเทศไทยเต็มจอ */
  minSpanDeg?: number;
  /** สัดส่วน สูง/กว้าง บนจอ (หลังคูณ cos φ0) ที่ยอมให้ — นอกช่วงนี้ขยายด้านที่สั้นกว่า */
  minAspect?: number;
  maxAspect?: number;
}

/**
 * กรอบที่แสดง = เนื้อหาทั้งหมด + ประเทศไทย + ขอบเผื่อ แล้วขยายด้านที่สั้นให้สัดส่วน
 * อยู่ในช่วง — **ขยายเท่านั้น ไม่เคยหด** จุดใดที่อยู่ในเนื้อหาจึงไม่มีวันตกขอบ
 */
export function fitBounds(content: GeoBounds | null, opts: FitOptions = {}): GeoBounds {
  const pad = opts.padFraction ?? 0.08;
  const minSpan = opts.minSpanDeg ?? 12;
  const minAspect = opts.minAspect ?? 0.55;
  const maxAspect = opts.maxAspect ?? 1.1;
  const b = unionBounds(content, THAILAND_BOUNDS) as GeoBounds;

  let lonSpan = Math.max(minSpan, b.maxLon - b.minLon);
  let latSpan = Math.max(minSpan, b.maxLat - b.minLat);
  lonSpan *= 1 + 2 * pad;
  latSpan *= 1 + 2 * pad;
  const cx = (b.minLon + b.maxLon) / 2;
  const cy = (b.minLat + b.maxLat) / 2;

  const k = Math.cos((cy * Math.PI) / 180);
  const aspect = latSpan / (lonSpan * k);
  if (aspect < minAspect) latSpan = minAspect * lonSpan * k;
  else if (aspect > maxAspect) lonSpan = latSpan / (maxAspect * k);

  return {
    minLon: cx - lonSpan / 2,
    maxLon: cx + lonSpan / 2,
    minLat: cy - latSpan / 2,
    maxLat: cy + latSpan / 2,
  };
}

/**
 * เนื้อหา (ไม่ใช่ขอบเผื่อ) เลยขอบแผนที่ฐานไหม — ส่วนที่เลยไม่มีเส้นชายฝั่ง แผงต้องบอก
 * ไม่ใช่ปล่อยให้อ่านเป็นทะเลเปล่า
 */
export function beyondBasemap(content: GeoBounds | null): boolean {
  if (!content) return false;
  return (
    content.minLon < BASEMAP_BOUNDS.minLon ||
    content.maxLon > BASEMAP_BOUNDS.maxLon ||
    content.minLat < BASEMAP_BOUNDS.minLat ||
    content.maxLat > BASEMAP_BOUNDS.maxLat
  );
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

/** เส้นหลายจุดเป็นคำสั่ง path ของ SVG — น้อยกว่า 2 จุด = "" (ไม่มีเส้นให้ลาก) */
export function polylinePath(points: readonly LonLat[], proj: Projection): string {
  if (points.length < 2) return "";
  return points
    .map((p, i) => {
      const { x, y } = proj.project(p.lon, p.lat);
      return `${i === 0 ? "M" : "L"}${fmt(x)},${fmt(y)}`;
    })
    .join(" ");
}

/** วงของรูปหลายเหลี่ยม GeoJSON ([lon, lat][]) เป็น path ปิด — ใช้ร่วมกับ fill-rule evenodd สำหรับรู */
export function ringsPath(rings: readonly (readonly number[])[][], proj: Projection): string {
  const parts: string[] = [];
  for (const ring of rings) {
    if (ring.length < 3) continue;
    parts.push(
      `${ring
        .map((c, i) => {
          const { x, y } = proj.project(c[0], c[1]);
          return `${i === 0 ? "M" : "L"}${fmt(x)},${fmt(y)}`;
        })
        .join(" ")} Z`,
    );
  }
  return parts.join(" ");
}

/** Polygon/MultiPolygon → รายการวงแบนเดียว (สำหรับ `ringsPath` และ `boundsOf`) */
export function geometryRings(
  g: { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] } | null | undefined,
): number[][][] {
  if (!g) return [];
  return g.type === "Polygon" ? g.coordinates : g.coordinates.flat();
}

export function ringsBounds(rings: readonly (readonly number[])[][]): GeoBounds | null {
  return boundsOf(rings.flatMap((r) => r.map((c) => ({ lon: c[0], lat: c[1] }))));
}

export interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedLabel {
  /** ดัชนีของจุดที่ป้ายนี้เป็นของ */
  index: number;
  /** true = วางข้อความเต็ม (ลำดับ + เวลา) ได้ · false = เหลือแค่ลำดับ (ตารางมีเวลาของลำดับนั้น) */
  full: boolean;
  /** ตำแหน่ง baseline ของข้อความ */
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  /** กล่องที่ป้ายนี้จองไว้ (ส่งต่อเป็น `taken` ให้ป้ายชุดถัดไปได้) */
  box: LabelBox;
  /** ป้ายถูกย้ายห่างจากจุด — คอมโพเนนต์ลากเส้นนำจาก (anchor) ไปที่ป้าย */
  leader: boolean;
}

const overlaps = (a: LabelBox, b: LabelBox) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** ทิศที่ลอง ตามลำดับความชอบ: ขวา ซ้าย ขวาบน ซ้ายล่าง บน ล่าง ขวาล่าง ซ้ายบน */
const DIRS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [1, -1],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, 1],
  [-1, -1],
];
/** ระยะจากจุด (px) — วงแรกติดจุด วงถัดไปห่างออกไปพร้อมเส้นนำ */
const RINGS = [5, 13, 23, 35] as const;

/**
 * วางป้ายแบบ greedy: ลองแปดทิศรอบจุด ทีละวงระยะ ข้อความเต็มก่อน แล้วค่อยลดเหลือแค่ลำดับ —
 * ป้ายห้ามทับป้ายที่วางไปแล้ว กล่องใน `taken` (จุดบนแผนที่ ชื่อพายุ) และห้ามตกขอบ
 * ป้ายที่ต้องย้ายออกจากวงแรกได้ `leader: true` (มีเส้นนำกลับไปที่จุด) ถ้าไม่มีที่ว่างเลย
 * ยังวางลำดับไว้ทางขวา (ทับได้) — ทุกจุดมีป้ายเสมอ และตารางในแผงมีเวลาของทุกลำดับครบ
 */
export function placeLabels(
  anchors: readonly { x: number; y: number; fullWidth: number; shortWidth: number }[],
  size: { width: number; height: number },
  lineHeight = 10,
  taken: readonly LabelBox[] = [],
): PlacedLabel[] {
  const placed: LabelBox[] = [...taken];
  const out: PlacedLabel[] = [];
  const boxAt = (x: number, y: number, w: number, anchor: PlacedLabel["anchor"]): LabelBox => ({
    x: anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2,
    y: y - lineHeight + 2,
    w,
    h: lineHeight,
  });
  const fits = (b: LabelBox) =>
    b.x >= 0 && b.x + b.w <= size.width && b.y >= 0 && b.y + b.h <= size.height && !placed.some((p) => overlaps(p, b));

  anchors.forEach((a, index) => {
    for (const full of [true, false]) {
      const w = full ? a.fullWidth : a.shortWidth;
      for (const r of RINGS) {
        for (const [dx, dy] of DIRS) {
          const anchor: PlacedLabel["anchor"] = dx > 0 ? "start" : dx < 0 ? "end" : "middle";
          // baseline: ข้อความสูงราว lineHeight — เลื่อนให้กึ่งกลางข้อความอยู่ในแนวทิศที่ลอง
          const x = a.x + dx * r;
          const y = a.y + dy * r + (dy > 0 ? lineHeight - 2 : dy < 0 ? 0 : lineHeight / 2 - 1);
          const box = boxAt(x, y, w, anchor);
          if (!fits(box)) continue;
          placed.push(box);
          out.push({ index, full, x, y, anchor, box, leader: r !== RINGS[0] });
          return;
        }
      }
    }
    const box = boxAt(a.x + RINGS[0], a.y + 3, a.shortWidth, "start");
    placed.push(box);
    out.push({ index, full: false, x: a.x + RINGS[0], y: a.y + 3, anchor: "start", box, leader: false });
  });
  return out;
}

/** เนื้อหาทั้งหมดของพายุ (จุดทุกจุด + ขอบวงกลม 70 % + กรวย GDACS) — ไม่มีจุดไหนถูกตัดทิ้ง */
export function stormContentBounds(storms: readonly StormTrack[]): GeoBounds | null {
  return unionBounds(
    ...storms.map((s) =>
      unionBounds(
        boundsOf(s.past),
        boundsOf(s.forecast.map((f) => ({ lon: f.lon, lat: f.lat, radiusKm: f.circleRadiusKm }))),
        ringsBounds(geometryRings(s.gdacsCone)),
      ),
    ),
  );
}
