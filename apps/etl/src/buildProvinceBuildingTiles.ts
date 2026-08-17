import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execa } from "execa";
import type { BuildingTileLevel, BuildingTilePyramid, TerrainTilePyramid } from "@siahra/shared-types";
import type { AoiDefinition } from "./aoi.js";
import { TILES_ROOT } from "./buildProvinceTerrainTiles.js";
import { utmZoneNumber, wgs84ToUtm } from "./projection.js";

const WORK_DIR = path.resolve(import.meta.dirname, "../data/work");

export const BUILDING_MAGIC = 0x444c4253; // "SBLD"
export const BUILDING_UNIT_M = 0.25;
/** Building levels are the leaf and this many coarser terrain levels. */
const LEVELS_ABOVE_LEAF = 2;
/** Importance filters, index 0 = leaf (everything), 1 = leaf-1, 2 = leaf-2. */
const LEVEL_FILTERS: { minAreaM2: number; minHeightM: number }[] = [
  { minAreaM2: 0, minHeightM: 0 },
  { minAreaM2: 300, minHeightM: 12 },
  { minAreaM2: 1500, minHeightM: 25 },
];
const MAX_RING_VERTICES = 64;
const SIMPLIFY_TOLERANCE_M = 0.6;
const NODATA = -32768;

interface RawFeature {
  type: "Feature";
  properties: Record<string, unknown> & { other_tags?: string; building?: string };
  geometry: { type: string; coordinates: unknown } | null;
}

function parseOtherTags(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  const re = /"((?:[^"\\]|\\.)*)"=>"((?:[^"\\]|\\.)*)"/g;
  const unescape = (s: string) => s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  for (const m of raw.matchAll(re)) out[unescape(m[1])] = unescape(m[2]);
  return out;
}

function computeHeight(tags: Record<string, string>): {
  height: number;
  heightSource: "tag" | "inferred" | "default";
} {
  const heightTag = tags.height ?? tags["building:height"];
  if (heightTag) {
    const parsed = Number.parseFloat(heightTag);
    if (Number.isFinite(parsed) && parsed > 0) return { height: parsed, heightSource: "tag" };
  }
  const levelsTag = tags["building:levels"];
  if (levelsTag) {
    const levels = Number.parseFloat(levelsTag);
    if (Number.isFinite(levels) && levels > 0) {
      return { height: levels * 3.2, heightSource: "inferred" };
    }
  }
  return { height: 6, heightSource: "default" };
}

/** Douglas–Peucker on a closed ring (metres). */
function simplifyRing(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length <= 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (b - a < 2) continue;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-9;
    let worst = -1;
    let worstD = tol2;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

function ringAreaM2(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  }
  return Math.abs(a / 2);
}

function outerRings(geom: NonNullable<RawFeature["geometry"]>): number[][][] {
  const c = geom.coordinates as any;
  if (geom.type === "Polygon") return c?.[0] ? [c[0]] : [];
  if (geom.type === "MultiPolygon") return (c as number[][][][]).map((p) => p[0]).filter(Boolean);
  return [];
}

function bitsetBase64(bits: Uint8Array): string {
  return Buffer.from(bits).toString("base64");
}

interface Building {
  /** UTM ring, unclosed. */
  ring: [number, number][];
  cx: number;
  cy: number;
  areaM2: number;
  heightM: number;
  groundZ: number;
}

export interface BuildingTilesResult {
  pyramid: BuildingTilePyramid;
  fileCount: number;
  bytes: number;
}

/**
 * Whole-province building footprints as binary LOD tiles on the terrain tile
 * grid. Reads the raw OSM buildings GeoJSON produced by buildProvinceBuildings
 * (regenerating it from the per-province PBF if needed), projects to UTM,
 * simplifies, samples ground elevation from the 30 m DEM and buckets by tile.
 */
export async function buildProvinceBuildingTiles(
  aoi: AoiDefinition,
  terrainTiles: TerrainTilePyramid,
  urlPrefix: string,
): Promise<BuildingTilesResult> {
  const id = aoi.aoiId;
  const zone = utmZoneNumber(aoi.utmZone);
  const rawGeojson = path.join(WORK_DIR, `p${id}-buildings-raw.geojson`);
  const buildingsPbf = path.join(WORK_DIR, `p${id}-buildings.osm.pbf`);
  if (!existsSync(rawGeojson)) {
    if (!existsSync(buildingsPbf)) {
      throw new Error(`no building source for ${id} (run build:all first)`);
    }
    await execa("ogr2ogr", ["-f", "GeoJSON", rawGeojson, buildingsPbf, "multipolygons"], {
      stdio: "ignore",
    });
  }

  // 30 m DEM for ground elevation (built by buildProvinceTerrainTiles).
  const clippedTif = path.join(WORK_DIR, `p${id}-clipped30.tif`);
  if (!existsSync(clippedTif)) throw new Error(`missing ${clippedTif} (run build:tiles first)`);
  const demBin = path.join(WORK_DIR, `p${id}-clipped30-b.bin`);
  await execa(
    "gdal_translate",
    ["-of", "EHdr", "-ot", "Int16", "-a_nodata", String(NODATA), clippedTif, demBin],
    { stdio: "ignore" },
  );
  const leafLevel = terrainTiles.levels[terrainTiles.levels.length - 1];
  const demBuf = readFileSync(demBin);
  const dem = new Int16Array(demBuf.buffer, demBuf.byteOffset, leafLevel.width * leafLevel.height);
  for (const ext of [".bin", ".hdr", ".prj", ".bin.aux.xml"]) {
    rmSync(demBin.replace(/\.bin$/, ext), { force: true });
  }
  const cell = terrainTiles.leafCellSizeM;
  const groundAt = (e: number, n: number): number | null => {
    const c = Math.floor((e - terrainTiles.originEasting) / cell);
    const r = Math.floor((terrainTiles.originNorthing - n) / cell);
    let min = Infinity;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= leafLevel.height || cc >= leafLevel.width) continue;
        const v = dem[rr * leafLevel.width + cc];
        if (v !== NODATA && v < min) min = v;
      }
    }
    return Number.isFinite(min) ? min : null;
  };

  const raw = JSON.parse(readFileSync(rawGeojson, "utf-8")) as { features: RawFeature[] };
  const heightSourceCounts: Record<string, number> = { tag: 0, inferred: 0, default: 0 };
  const buildings: Building[] = [];
  for (const f of raw.features) {
    if (!f.properties.building || !f.geometry) continue;
    const { height, heightSource } = computeHeight(parseOtherTags(f.properties.other_tags));
    let counted = false;
    for (const ringLonLat of outerRings(f.geometry)) {
      if (ringLonLat.length < 4) continue;
      let ring = ringLonLat.map(([lon, lat]) => wgs84ToUtm(lon, lat, zone)) as [number, number][];
      // Drop the closing vertex and any consecutive duplicates.
      if (
        ring.length > 1 &&
        Math.abs(ring[0][0] - ring[ring.length - 1][0]) < 1e-6 &&
        Math.abs(ring[0][1] - ring[ring.length - 1][1]) < 1e-6
      ) {
        ring = ring.slice(0, -1);
      }
      ring = simplifyRing([...ring, ring[0]], SIMPLIFY_TOLERANCE_M).slice(0, -1);
      if (ring.length > MAX_RING_VERTICES) {
        const step = ring.length / MAX_RING_VERTICES;
        ring = Array.from({ length: MAX_RING_VERTICES }, (_, i) => ring[Math.floor(i * step)]);
      }
      if (ring.length < 3) continue;
      const areaM2 = ringAreaM2(ring);
      if (areaM2 < 4) continue;
      let cx = 0;
      let cy = 0;
      for (const [x, y] of ring) {
        cx += x;
        cy += y;
      }
      cx /= ring.length;
      cy /= ring.length;
      const groundZ = groundAt(cx, cy);
      if (groundZ === null) continue;
      buildings.push({ ring, cx, cy, areaM2, heightM: height, groundZ });
      counted = true;
    }
    if (counted) heightSourceCounts[heightSource]++;
  }

  const outRoot = path.join(TILES_ROOT, id, "buildings");
  rmSync(outRoot, { recursive: true, force: true });
  mkdirSync(outRoot, { recursive: true });

  const leafZ = terrainTiles.levels.length - 1;
  const firstZ = Math.max(0, leafZ - LEVELS_ABOVE_LEAF);
  const levelMeta: BuildingTileLevel[] = [];
  let fileCount = 0;
  let bytes = 0;

  for (let z = firstZ; z <= leafZ; z++) {
    const level = terrainTiles.levels[z];
    const filter = LEVEL_FILTERS[leafZ - z] ?? LEVEL_FILTERS[LEVEL_FILTERS.length - 1];
    const tileM = level.cellSizeM * terrainTiles.tileSize;
    const buckets = new Map<number, Building[]>();
    let count = 0;
    for (const b of buildings) {
      if (b.areaM2 < filter.minAreaM2 && b.heightM < filter.minHeightM) continue;
      const tx = Math.floor((b.cx - terrainTiles.originEasting) / tileM);
      const ty = Math.floor((terrainTiles.originNorthing - b.cy) / tileM);
      if (tx < 0 || ty < 0 || tx >= level.tilesX || ty >= level.tilesY) continue;
      const key = ty * level.tilesX + tx;
      let arr = buckets.get(key);
      if (!arr) {
        arr = [];
        buckets.set(key, arr);
      }
      arr.push(b);
      count++;
    }

    const present = new Uint8Array(Math.ceil((level.tilesX * level.tilesY) / 8));
    const dir = path.join(outRoot, String(z));
    mkdirSync(dir, { recursive: true });
    for (const [key, list] of buckets) {
      const tx = key % level.tilesX;
      const ty = Math.floor(key / level.tilesX);
      const centreE = terrainTiles.originEasting + (tx + 0.5) * tileM;
      const centreN = terrainTiles.originNorthing - (ty + 0.5) * tileM;
      let size = 8;
      for (const b of list) size += 8 + b.ring.length * 4;
      const buf = Buffer.alloc(size);
      let o = 0;
      buf.writeUInt32LE(BUILDING_MAGIC, o);
      o += 4;
      buf.writeUInt32LE(list.length, o);
      o += 4;
      for (const b of list) {
        buf.writeUInt16LE(b.ring.length, o);
        o += 2;
        buf.writeUInt16LE(Math.min(65535, Math.round(b.heightM * 10)), o);
        o += 2;
        buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(b.groundZ))), o);
        o += 2;
        buf.writeUInt16LE(0, o);
        o += 2;
        for (const [e, n] of b.ring) {
          const dx = Math.max(-32768, Math.min(32767, Math.round((e - centreE) / BUILDING_UNIT_M)));
          const dy = Math.max(-32768, Math.min(32767, Math.round((centreN - n) / BUILDING_UNIT_M)));
          buf.writeInt16LE(dx, o);
          o += 2;
          buf.writeInt16LE(dy, o);
          o += 2;
        }
      }
      writeFileSync(path.join(dir, `${tx}_${ty}.bin`), buf);
      present[key >> 3] |= 1 << (key & 7);
      fileCount++;
      bytes += buf.length;
    }
    levelMeta.push({
      z,
      tilesX: level.tilesX,
      tilesY: level.tilesY,
      present: bitsetBase64(present),
      count,
      minAreaM2: filter.minAreaM2,
      minHeightM: filter.minHeightM,
    });
  }

  return {
    pyramid: {
      urlTemplate: `${urlPrefix}/buildings/{z}/{x}_{y}.bin`,
      unitM: BUILDING_UNIT_M,
      levels: levelMeta,
      count: buildings.length,
      heightSourceCounts,
    },
    fileCount,
    bytes,
  };
}
