/**
 * สร้าง `apps/web/public/geo/region-outline.json` — เส้นขอบประเทศของภูมิภาค (แผนที่ฐาน
 * 2 มิติของแผงพายุ ชั้นข้อมูลพายุ v1) จาก Natural Earth 1:50m Admin-0 countries
 *
 *   npx -y tsx@4 src/build-region-outline.ts            (จาก apps/etl — สคริปต์ `tsx` ของ npm ยังพังอยู่)
 *   npm run build:region-outline -w apps/etl            (ตัวเดียวกัน เมื่อ tsx กลับมาอยู่ใน lockfile)
 *   … -- --input /path/to/ne_50m_admin_0_countries.geojson   (ใช้ไฟล์ที่ดาวน์โหลดไว้แล้ว)
 *
 * ขั้นตอน:
 *   1. ดาวน์โหลด GeoJSON ของ Natural Earth ที่ **ตรึงรุ่นไว้** (tag v5.1.2 ของ
 *      nvkelso/natural-earth-vector) แล้วตรวจ sha256 — ไม่ตรง = ยกเลิก ไม่เขียนไฟล์
 *   2. ตัดเฉพาะกรอบ lon 80–150 / lat −5–35 (`bboxClip`) — ครอบอ่าวเบงกอล ทะเลอันดามัน
 *      ทะเลจีนใต้ และแปซิฟิกตะวันตก ซึ่งเป็นสองแอ่งที่แผงพายุแสดง (NIO + WNP)
 *   3. ลดจุด (`simplify`) + ปัดพิกัดเหลือ 2 ตำแหน่ง (~1 กม.) — ไทยใช้ค่าความคลาดเคลื่อน
 *      ครึ่งหนึ่งเพราะเป็นประเทศที่แผนที่เน้น
 *   4. ทิ้ง property ของ Natural Earth ทั้งหมด (~170 ฟิลด์) เหลือ `{iso, name, thailand}`
 *
 * นี่คือ **แผนที่ฐานเพื่อการอ้างอิงตำแหน่ง** ไม่ใช่ชั้นข้อมูลภัย จึงไม่มี
 * `HazardLayerDescriptor` — แผงพายุแสดงเครดิต Natural Earth ไว้ใต้แผนที่แทน
 *
 * ฟังก์ชันล้วนถูก export ให้ `build-region-outline.test.ts` ส่วน `main()` รันเฉพาะตอน
 * สั่งสคริปต์นี้ตรง ๆ ไม่ใช่ตอนถูก import
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bboxClip, simplify, truncate } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";

export const NE_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson";
/** sha256 ของไฟล์ข้างบน วัดเมื่อ 2026-09-26 (ตรงกับ `master` ณ วันนั้นทุกไบต์) */
export const NE_SHA256 = "3e458fc036ad0a66411f2c1e6cac49c5d7bfb81cb1123bc513b22511a2b7fdeb";

/** [minLon, minLat, maxLon, maxLat] */
export const REGION_BBOX: [number, number, number, number] = [80, -5, 150, 35];
/** เพดานขนาดไฟล์ผลลัพธ์ (ไบต์) — ไฟล์นี้ถูก track ใน git และถูกโหลดทุกครั้งที่เปิดแผงพายุ */
export const MAX_BYTES = 150 * 1024;
const TOLERANCE_DEG = 0.05;
const PRECISION = 2;

const OUT_PATH = path.resolve(import.meta.dirname, "../../web/public/geo/region-outline.json");

export interface RegionOutlineProps {
  /** ADM0_A3 ของ Natural Earth (เช่น "THA") */
  iso: string;
  name: string;
  thailand: boolean;
}

export interface RegionOutline {
  type: "FeatureCollection";
  bbox: [number, number, number, number];
  source: { name: string; url: string; sha256: string; license: string; builtAt: string };
  features: Feature<Polygon | MultiPolygon, RegionOutlineProps>[];
}

interface NeFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: Polygon | MultiPolygon | null;
}

/** วงที่เหลือน้อยกว่า 4 จุด (ปิดวง) หลังตัดกรอบ = เส้นเสื่อม ทิ้ง */
function cleanRings(rings: Position[][]): Position[][] {
  return rings.filter((r) => r.length >= 4);
}

/** ตัดกรอบ + ทำความสะอาด — null เมื่อไม่เหลืออะไรในกรอบเลย */
export function clipToRegion(
  geometry: Polygon | MultiPolygon,
  bbox: [number, number, number, number] = REGION_BBOX,
): Polygon | MultiPolygon | null {
  // bboxClip ประกาศชนิดคืนรวม LineString ไว้ด้วย แต่ input เป็นรูปหลายเหลี่ยมจึงได้รูปหลายเหลี่ยมกลับเสมอ
  const clipped = bboxClip({ type: "Feature", properties: {}, geometry } as Feature<Polygon | MultiPolygon>, bbox)
    .geometry as Polygon | MultiPolygon;
  if (clipped.type === "Polygon") {
    const rings = cleanRings(clipped.coordinates);
    return rings.length > 0 ? { type: "Polygon", coordinates: rings } : null;
  }
  const polys = clipped.coordinates.map(cleanRings).filter((p) => p.length > 0);
  if (polys.length === 0) return null;
  return polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
}

/** รหัสประเทศของ Natural Earth — ADM0_A3 ก่อน (ISO_A3 ของบางประเทศเป็น "-99") */
export function isoOf(props: Record<string, unknown>): string {
  const a3 = props.ADM0_A3;
  if (typeof a3 === "string" && a3 !== "-99") return a3;
  const iso = props.ISO_A3;
  return typeof iso === "string" ? iso : "";
}

export function buildRegionOutline(
  input: { features: NeFeature[] },
  builtAt: string,
  toleranceDeg: number = TOLERANCE_DEG,
): RegionOutline {
  const features: RegionOutline["features"] = [];
  for (const f of input.features) {
    if (!f.geometry) continue;
    const clipped = clipToRegion(f.geometry);
    if (!clipped) continue;
    const iso = isoOf(f.properties);
    const thailand = iso === "THA";
    const tol = thailand ? toleranceDeg / 2 : toleranceDeg;
    const feat: Feature<Polygon | MultiPolygon, RegionOutlineProps> = {
      type: "Feature",
      properties: {
        iso,
        name: String(f.properties.NAME_EN ?? f.properties.NAME ?? f.properties.ADMIN ?? iso),
        thailand,
      },
      geometry: clipped,
    };
    const simplified = simplify(feat, { tolerance: tol, highQuality: true, mutate: false });
    const rounded = truncate(simplified, { precision: PRECISION, coordinates: 2, mutate: true });
    const geometry = rounded.geometry.type === "Polygon"
      ? cleanPolygon(rounded.geometry.coordinates)
      : cleanMulti(rounded.geometry.coordinates);
    if (!geometry) continue;
    features.push({ type: "Feature", properties: feat.properties, geometry });
  }
  // เรียงตามรหัสประเทศให้ diff ของไฟล์ที่ track นิ่งข้ามการ build
  features.sort((a, b) => a.properties.iso.localeCompare(b.properties.iso));
  return {
    type: "FeatureCollection",
    bbox: REGION_BBOX,
    source: {
      name: "Natural Earth 1:50m Cultural Vectors — Admin 0 Countries (v5.1.2)",
      url: NE_URL,
      sha256: NE_SHA256,
      license: "Public domain (Natural Earth, https://www.naturalearthdata.com/about/terms-of-use/)",
      builtAt,
    },
    features,
  };
}

/** ตัดจุดซ้ำติดกัน (เกิดจากการปัดพิกัด) แล้วทิ้งวงที่เสื่อม */
function dedupeRing(ring: Position[]): Position[] {
  const out: Position[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
}
function cleanPolygon(rings: Position[][]): Polygon | null {
  const r = cleanRings(rings.map(dedupeRing));
  return r.length > 0 ? { type: "Polygon", coordinates: r } : null;
}
function cleanMulti(polys: Position[][][]): Polygon | MultiPolygon | null {
  const p = polys.map((rings) => cleanRings(rings.map(dedupeRing))).filter((x) => x.length > 0);
  if (p.length === 0) return null;
  return p.length === 1 ? { type: "Polygon", coordinates: p[0] } : { type: "MultiPolygon", coordinates: p };
}

export function sha256Hex(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function main(): Promise<void> {
  const inputIdx = process.argv.indexOf("--input");
  let raw: Buffer;
  if (inputIdx !== -1 && process.argv[inputIdx + 1]) {
    raw = readFileSync(process.argv[inputIdx + 1]);
    console.log(`read ${process.argv[inputIdx + 1]} (${raw.length} bytes)`);
  } else {
    const res = await fetch(NE_URL);
    if (!res.ok) throw new Error(`GET ${NE_URL}: HTTP ${res.status}`);
    raw = Buffer.from(await res.arrayBuffer());
    console.log(`downloaded ${NE_URL} (${raw.length} bytes)`);
  }
  const digest = sha256Hex(raw);
  if (digest !== NE_SHA256) {
    throw new Error(`sha256 mismatch: expected ${NE_SHA256}, got ${digest} — refusing to write`);
  }
  const ne = JSON.parse(raw.toString("utf8")) as { features: NeFeature[] };
  const outline = buildRegionOutline(ne, new Date().toISOString());
  const json = `${JSON.stringify(outline)}\n`;
  const bytes = Buffer.byteLength(json);
  if (bytes > MAX_BYTES) throw new Error(`output is ${bytes} bytes, above the ${MAX_BYTES}-byte ceiling`);
  if (!outline.features.some((f) => f.properties.thailand)) throw new Error("Thailand missing from the output");
  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, json);
  console.log(
    `wrote ${path.relative(process.cwd(), OUT_PATH)}: ${outline.features.length} countries, ${bytes} bytes`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : "build-region-outline failed");
    process.exit(1);
  });
}
