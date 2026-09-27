import type { RadarFramesResponse, RadarGeoreference, RadarProjection } from "@siahra/shared-types";

/**
 * การแปลง lat/lon → ตำแหน่งในภาพเรดาร์ TMD — โค้ด GLSL ใน `scene/terrainMaterial.ts`
 * เขียนสูตรเดียวกันนี้ซ้ำ (ต้องแก้คู่กัน) ส่วนไฟล์นี้มีไว้ให้เทสสูตรได้โดยไม่ต้องมี GPU
 *
 * แถวของภาพนับ **จากบน** (0 = ขอบ maxLat) ให้ตรงกับเทกซ์เจอร์ที่อัปโหลดด้วย
 * `flipY = false` ทั้งสองเส้นทาง (ImageBitmap และ TextureLoader สำรอง)
 * - web-mercator: แถวเป็นเชิงเส้นใน `ln(tan(π/4 + φ/2))` (TMD วาดภาพนี้เป็น
 *   MapLibre image source ซึ่งยืดภาพเชิงเส้นใน Web Mercator)
 * - equirectangular: แถวเป็นเชิงเส้นใน latitude (ภาพรุ่นเดิมก่อน 2026-09-02)
 */
export function mercatorY(latDeg: number): number {
  return Math.log(Math.tan(Math.PI / 4 + (latDeg * Math.PI) / 360));
}

/** เศษส่วนแถวจากขอบบน (0..1 = อยู่ในภาพ) */
export function radarRowFromTop(latDeg: number, bounds: RadarGeoreference["bounds"], projection: RadarProjection): number {
  if (projection === "web-mercator") {
    const top = mercatorY(bounds.maxLat);
    return (top - mercatorY(latDeg)) / (top - mercatorY(bounds.minLat));
  }
  return (bounds.maxLat - latDeg) / (bounds.maxLat - bounds.minLat);
}

/** เศษส่วนคอลัมน์จากขอบซ้าย — เชิงเส้นใน longitude ทั้งสอง projection */
export function radarColFromLeft(lonDeg: number, bounds: RadarGeoreference["bounds"]): number {
  return (lonDeg - bounds.minLon) / (bounds.maxLon - bounds.minLon);
}

/**
 * ขนาดที่ถอดรหัสลง GPU: ย่อให้จำนวนพิกเซลไม่เกินภาพรุ่นเดิม 1173×1668 (≈1.96 MP,
 * ≈7.8 MB RGBA ต่อเฟรม) เพราะภาพ 1800×2644 เต็มขนาด ≈19 MB ต่อเฟรม × 8 เฟรม
 * ≈152 MB — ภาพเล็กกว่านี้ไม่ขยาย, aspect คงเดิมภายในการปัดเศษหนึ่งพิกเซล
 * (การสุ่มเทกซ์เจอร์ใช้ uv 0..1 ทั้งแผ่น การปัดเศษจึงไม่ขยับตำแหน่งบนพื้น)
 */
export const RADAR_DECODE_MAX_PIXELS = 1173 * 1668;

export function radarDecodeSize(widthPx: number, heightPx: number): { width: number; height: number } {
  const pixels = widthPx * heightPx;
  if (pixels <= RADAR_DECODE_MAX_PIXELS) return { width: widthPx, height: heightPx };
  const scale = Math.sqrt(RADAR_DECODE_MAX_PIXELS / pixels);
  return { width: Math.floor(widthPx * scale), height: Math.floor(heightPx * scale) };
}

const PROJECTIONS: readonly RadarProjection[] = ["equirectangular", "web-mercator"];

function finite(...values: unknown[]): boolean {
  return values.every((v) => typeof v === "number" && Number.isFinite(v));
}

function validGeoreference(g: unknown): g is RadarGeoreference {
  if (!g || typeof g !== "object") return false;
  const r = g as Partial<RadarGeoreference>;
  const b = r.bounds;
  return (
    PROJECTIONS.includes(r.projection as RadarProjection) &&
    !!b &&
    finite(b.minLon, b.minLat, b.maxLon, b.maxLat, r.widthPx, r.heightPx)
  );
}

/**
 * georeference ของเฟรมหนึ่ง — **ห้ามโยน**: bundle เว็บนี้ต้องวาดได้กับ payload ของ API
 * ที่ deploy อยู่จริง รวมถึง API รุ่นก่อน (ถูก rollback) ที่ยังไม่มี `georeferences`
 * และ `frame.projection` (docs/ops.md)
 * - เฟรมไม่มี `projection` (API รุ่นก่อน) → ใช้ช่องเดิม `bounds/widthPx/heightPx`
 *   เป็น equirectangular ซึ่งคือความหมายของ API รุ่นนั้นพอดี
 * - เฟรมมี `projection` ที่มีอยู่ใน `georeferences` → ใช้ตัวนั้น
 * - เฟรมมี `projection` ที่ไม่รู้จัก หรือ georeference ที่อ้างถึงใช้ไม่ได้ → `null`
 *   (ข้ามเฟรม) เพราะภาพที่ไม่รู้ว่าวางลงพื้นอย่างไรห้ามถูกวาดด้วยกรอบที่เดาเอา
 * - ช่องเดิมก็ไม่มี/ไม่ใช่ตัวเลข → `null` (ข้ามเฟรม ไม่โยน)
 */
export function frameGeoreference(data: unknown, projection: unknown): RadarGeoreference | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Partial<RadarFramesResponseLike>;
  if (projection === undefined || projection === null) {
    const b = d.bounds;
    if (!b || !finite(b.minLon, b.minLat, b.maxLon, b.maxLat, d.widthPx, d.heightPx)) return null;
    return {
      projection: "equirectangular",
      bounds: { minLon: b.minLon, minLat: b.minLat, maxLon: b.maxLon, maxLat: b.maxLat },
      widthPx: d.widthPx as number,
      heightPx: d.heightPx as number,
      basis: "legacy API response without georeferences (equirectangular box)",
    };
  }
  if (typeof projection !== "string" || !PROJECTIONS.includes(projection as RadarProjection)) return null;
  const g = d.georeferences?.[projection as RadarProjection];
  return validGeoreference(g) && g.projection === projection ? g : null;
}

type RadarFramesResponseLike = Pick<RadarFramesResponse, "georeferences" | "bounds" | "widthPx" | "heightPx">;

export interface SelectedRadarFrame {
  t: string;
  tMs: number;
  url: string;
  geo: RadarGeoreference;
}

/** เฟรมล่าสุดไม่เกิน `max` เฟรมที่รู้ georeference — เฟรมที่ไม่รู้ถูกข้าม ไม่โยน */
export function selectRadarFrames(data: RadarFramesResponse, max: number): SelectedRadarFrame[] {
  const frames: unknown[] = Array.isArray(data?.frames) ? data.frames : [];
  const out: SelectedRadarFrame[] = [];
  for (const raw of frames) {
    if (!raw || typeof raw !== "object") continue;
    const f = raw as Partial<RadarFramesResponse["frames"][number]>;
    if (typeof f.t !== "string" || typeof f.url !== "string") continue;
    const geo = frameGeoreference(data, f.projection);
    if (!geo) continue;
    out.push({ t: f.t, tMs: Date.parse(f.t), url: f.url, geo });
  }
  return out.slice(-max);
}
