/**
 * ฟังก์ชันล้วนที่ `buildLocalAuthorityExposure.ts` ใช้คำนวณ (E11.3) — แยกออกจาก
 * ขั้นแตะดิสก์/spawn process โดยตั้งใจ (แพตเทิร์นเดียวกับ `buildLocalAuthorities.ts`)
 * เพื่อให้ทดสอบด้วย fixture เล็ก ๆ ได้โดยไม่ต้องมีไฟล์ raster/pbf จริง
 */

// ─────────────────────────────────────────────────────────────────────────────
// AAIGrid (Arc/Info ASCII Grid) — ผลลัพธ์ของ `gdal_translate -of AAIGrid`
// ─────────────────────────────────────────────────────────────────────────────

const AAI_HEADER_KEYS = new Set([
  "ncols",
  "nrows",
  "xllcorner",
  "yllcorner",
  "xllcenter",
  "yllcenter",
  "cellsize",
  "dx",
  "dy",
  "nodata_value",
]);

export interface AaiGridSum {
  /** ผลรวมค่าพิกเซลที่ถือว่าถูกต้อง (ประชากรต่อพิกเซลของ WorldPop) */
  sum: number;
  validPixelCount: number;
  /** พิกเซลที่ข้าม เพราะเป็นค่าลบ (ประชากรเป็นลบไม่ได้จริง) หรือชน NODATA_value */
  skippedCount: number;
  ncols: number;
  nrows: number;
  nodataValue: number | null;
}

/**
 * รวมค่าพิกเซลของไฟล์ AAIGrid ที่ถูกต้อง — ข้ามค่าลบเสมอ (ประชากรไม่มีทางติดลบ
 * จึงทนต่อ NODATA sentinel ไม่ว่าต้นทางจะประกาศเป็นค่าอะไร) และข้ามค่าที่ตรงกับ
 * `NODATA_value` ที่ประกาศไว้ในหัวไฟล์ (ถ้ามี) — parse หัวไฟล์ตามคีย์ ไม่ใช่นับบรรทัด
 * เพราะจำนวนบรรทัดหัวไฟล์ต่างกันได้ (5 หรือ 6 บรรทัด ขึ้นกับว่ามี NODATA_value ไหม)
 */
export function sumAaiGridPopulation(text: string): AaiGridSum {
  const lines = text.split(/\r?\n/);
  const header: Record<string, string> = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    const parts = line.split(/\s+/);
    const key = parts[0]?.toLowerCase();
    if (key && AAI_HEADER_KEYS.has(key) && parts.length >= 2) {
      header[key] = parts[1];
      continue;
    }
    break;
  }

  const ncols = Number(header.ncols ?? "0");
  const nrows = Number(header.nrows ?? "0");
  const nodataValue = header.nodata_value !== undefined ? Number(header.nodata_value) : null;

  let sum = 0;
  let validPixelCount = 0;
  let skippedCount = 0;
  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    for (const tok of line.split(/\s+/)) {
      const v = Number(tok);
      if (!Number.isFinite(v)) continue;
      if (v < 0 || (nodataValue !== null && v === nodataValue)) {
        skippedCount++;
        continue;
      }
      sum += v;
      validPixelCount++;
    }
  }
  return { sum, validPixelCount, skippedCount, ncols, nrows, nodataValue };
}

// ─────────────────────────────────────────────────────────────────────────────
// เรขาคณิต GeoJSON — flatten ring / จุดตัวแทน / หาว่าจุดตกในรูปหลายเหลี่ยมไหม
// ─────────────────────────────────────────────────────────────────────────────

export type GeoJsonGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] }
  | { type: string; coordinates: unknown };

/** วงทุกวง (นอก+รู) เป็นอาเรย์แบน [lon,lat,lon,lat,...] — ใช้กับ even-odd rule */
export function geometryToFlatRings(geometry: GeoJsonGeometry): number[][] {
  const rings: number[][] = [];
  const flatten = (ring: number[][]) => {
    const flat: number[] = [];
    for (const [lon, lat] of ring) flat.push(lon, lat);
    rings.push(flat);
  };
  if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates as number[][][]) flatten(ring);
  } else if (geometry.type === "MultiPolygon") {
    for (const poly of geometry.coordinates as number[][][][]) for (const ring of poly) flatten(ring);
  }
  return rings;
}

/** even–odd rule เดียวกับ `buildLocalAuthorityBoundaries.ts`'s `pointInRings` */
export function pointInRings(lon: number, lat: number, rings: number[][]): boolean {
  let inside = false;
  for (const ring of rings) {
    const n = ring.length / 2;
    if (n < 3) continue;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = ring[i * 2];
      const yi = ring[i * 2 + 1];
      const xj = ring[j * 2];
      const yj = ring[j * 2 + 1];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

export function pointInPolygon(lon: number, lat: number, geometry: GeoJsonGeometry): boolean {
  return pointInRings(lon, lat, geometryToFlatRings(geometry));
}

/** จุดศูนย์กลางแบบเฉลี่ยจุด (vertex-average) ของวงนอกวงแรก — เพียงพอสำหรับนับ footprint */
export function polygonVertexCentroid(geometry: GeoJsonGeometry): [number, number] | null {
  const ring =
    geometry.type === "Polygon"
      ? (geometry.coordinates as number[][][])[0]
      : geometry.type === "MultiPolygon"
        ? (geometry.coordinates as number[][][][])[0]?.[0]
        : null;
  if (!ring || ring.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const [lon, lat] of ring) {
    x += lon;
    y += lat;
  }
  return [x / ring.length, y / ring.length];
}

/** bbox ของเรขาคณิต ใช้กัดรูปโครงจังหวัดจาก union ของ authority ทั้งหมดในจังหวัด */
export function geometryBbox(geometry: GeoJsonGeometry): {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
} {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  const visit = (coords: unknown): void => {
    if (Array.isArray(coords) && typeof coords[0] === "number") {
      const [lon, lat] = coords as [number, number];
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    if (Array.isArray(coords)) for (const c of coords) visit(c);
  };
  visit(geometry.coordinates);
  return { minLon, minLat, maxLon, maxLat };
}

// ─────────────────────────────────────────────────────────────────────────────
// ถนน — ความยาวจริง (haversine) และการจัดกลุ่มตาม highway class ดิบ
// ─────────────────────────────────────────────────────────────────────────────

const EARTH_RADIUS_KM = 6371.0088;

export function haversineKm(a: [number, number], b: [number, number]): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** ความยาวรวมของเส้น (LineString coords) เป็นกิโลเมตร */
export function lineLengthKm(coords: readonly (readonly [number, number])[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineKm(coords[i - 1] as [number, number], coords[i] as [number, number]);
  }
  return total;
}

/** จัดกลุ่มความยาวถนนตามค่า `highway=*` ดิบที่พบจริง — ไม่ตั้งหมวดตายตัว */
export function groupRoadLengthByClass(
  entries: readonly { highwayClass: string; km: number }[],
): Record<string, number> {
  const byClass: Record<string, number> = {};
  for (const e of entries) {
    byClass[e.highwayClass] = (byClass[e.highwayClass] ?? 0) + e.km;
  }
  return byClass;
}

// ─────────────────────────────────────────────────────────────────────────────
// สถานพยาบาล/โรงเรียน/สถานีดับเพลิง — ตัดจุดที่ซ้ำกับรูปหลายเหลี่ยมประเภทเดียวกัน
// ─────────────────────────────────────────────────────────────────────────────

export interface CandidateFacility {
  osmId: string;
  nameTh: string | null;
  lat: number;
  lon: number;
}

/**
 * ตัดจุด (node) ที่ตกอยู่ในรูปหลายเหลี่ยมประเภทเดียวกันออก — กันนับซ้ำเมื่อ OSM มี
 * ทั้ง node ของสิ่งอำนวยความสะดวกและอาคาร/พื้นที่ที่แท็กประเภทเดียวกันทับกันอยู่
 * (พบจริงในข้อมูล — โรงพยาบาล/โรงเรียนหลายแห่งถูกแมปเป็นทั้งจุดและพื้นที่)
 */
export function dedupeFacilityNodes(
  nodePoints: readonly CandidateFacility[],
  polygonGeometries: readonly GeoJsonGeometry[],
): CandidateFacility[] {
  if (polygonGeometries.length === 0) return [...nodePoints];
  const polygonRings = polygonGeometries.map(geometryToFlatRings);
  return nodePoints.filter((p) => !polygonRings.some((rings) => pointInRings(p.lon, p.lat, rings)));
}

/** `perThousandPop` — null เมื่อประชากรเป็น 0/ไม่มี ไม่ใช่ค่าอัตราส่วนที่แต่งขึ้น */
export function buildingsPerThousandPop(buildingCount: number, population: number): number | null {
  if (!(population > 0)) return null;
  return (buildingCount / population) * 1000;
}
