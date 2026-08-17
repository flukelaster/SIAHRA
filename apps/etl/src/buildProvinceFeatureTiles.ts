import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execa } from "execa";
import type { FeatureTileLevel, FeatureTilePyramid, TerrainTilePyramid } from "@siahra/shared-types";
import type { AoiDefinition } from "./aoi.js";
import { TILES_ROOT } from "./buildProvinceTerrainTiles.js";
import { utmZoneNumber, wgs84ToUtm } from "./projection.js";

const WORK_DIR = path.resolve(import.meta.dirname, "../data/work");

export const FEATURE_MAGIC = 0x4e494c53; // "SLIN"
const NODATA = -32768;
const LEVELS_ABOVE_LEAF = 4;

/** Feature classes shared with the client (see FeatureTilePyramid). */
export const FEATURE_CLASS = {
  river: 1,
  canal: 2,
  stream: 3,
  waterArea: 5,
  motorway: 10,
  trunk: 11,
  primary: 12,
  secondary: 13,
  link: 14,
} as const;

const KIND_LINE = 0;
const KIND_AREA = 1;

/** Which classes survive per level (leaf-4 … leaf), and water-area thresholds (m²). */
const LEVEL_RULES = [
  { classes: new Set([1, 5, 10, 11]), minAreaM2: 3_000_000 }, // leaf-4 (province view)
  { classes: new Set([1, 5, 10, 11, 12]), minAreaM2: 1_000_000 }, // leaf-3
  { classes: new Set([1, 5, 10, 11, 12]), minAreaM2: 200_000 }, // leaf-2
  { classes: new Set([1, 2, 5, 10, 11, 12, 13]), minAreaM2: 20_000 }, // leaf-1
  { classes: new Set([1, 2, 3, 5, 10, 11, 12, 13, 14]), minAreaM2: 300 }, // leaf
];

interface RawFeature {
  properties: Record<string, string | null | undefined>;
  geometry: { type: string; coordinates: unknown } | null;
}

interface Area {
  cls: number;
  ring: [number, number][];
  levelZ: number;
  areaM2: number;
  minE: number;
  maxE: number;
  minN: number;
  maxN: number;
}

function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length <= 2) return pts;
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

function densify(pts: [number, number][], maxSeg: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / maxSeg));
    for (let s = 0; s < n; s++) out.push([ax + ((bx - ax) * s) / n, ay + ((by - ay) * s) / n]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function ringAreaM2(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
  }
  return Math.abs(a / 2);
}

/** Liang–Barsky: clip a polyline to a rectangle, returning connected pieces. */
function clipPolyline(
  pts: [number, number, number][],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): [number, number, number][][] {
  const pieces: [number, number, number][][] = [];
  let cur: [number, number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    let t0 = 0;
    let t1 = 1;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    let ok = true;
    for (const [p, q] of [
      [-dx, a[0] - minX],
      [dx, maxX - a[0]],
      [-dy, a[1] - minY],
      [dy, maxY - a[1]],
    ]) {
      if (p === 0) {
        if (q < 0) {
          ok = false;
          break;
        }
        continue;
      }
      const r = q / p;
      if (p < 0) {
        if (r > t1) {
          ok = false;
          break;
        }
        if (r > t0) t0 = r;
      } else {
        if (r < t0) {
          ok = false;
          break;
        }
        if (r < t1) t1 = r;
      }
    }
    if (!ok) {
      if (cur.length > 1) pieces.push(cur);
      cur = [];
      continue;
    }
    const lerp = (t: number): [number, number, number] => [
      a[0] + dx * t,
      a[1] + dy * t,
      a[2] + (b[2] - a[2]) * t,
    ];
    const start = t0 > 0 ? lerp(t0) : a;
    const end = t1 < 1 ? lerp(t1) : b;
    if (cur.length === 0 || t0 > 0) {
      if (cur.length > 1) pieces.push(cur);
      cur = [start];
    }
    cur.push(end);
    if (t1 < 1) {
      pieces.push(cur);
      cur = [];
    }
  }
  if (cur.length > 1) pieces.push(cur);
  return pieces;
}

function bitsetBase64(bits: Uint8Array): string {
  return Buffer.from(bits).toString("base64");
}

export interface FeatureTilesResult {
  pyramid: FeatureTilePyramid;
  fileCount: number;
  bytes: number;
}

/**
 * Rivers / canals / streams / water bodies and major roads from OSM as binary
 * LOD tiles on the terrain grid, draped by sampling the 30 m DEM per vertex.
 */
export async function buildProvinceFeatureTiles(
  aoi: AoiDefinition,
  terrainTiles: TerrainTilePyramid,
  urlPrefix: string,
): Promise<FeatureTilesResult> {
  const id = aoi.aoiId;
  const zone = utmZoneNumber(aoi.utmZone);
  const extractPbf = path.join(WORK_DIR, `p${id}-extract.osm.pbf`);
  if (!existsSync(extractPbf)) throw new Error(`missing ${extractPbf} (run build:all first)`);
  const featPbf = path.join(WORK_DIR, `p${id}-features.osm.pbf`);
  const linesJson = path.join(WORK_DIR, `p${id}-features-lines.geojson`);
  const polysJson = path.join(WORK_DIR, `p${id}-features-polys.geojson`);
  await execa(
    "osmium",
    [
      "tags-filter",
      "-o",
      featPbf,
      "--overwrite",
      extractPbf,
      "w/waterway=river,canal,stream",
      "w/natural=water",
      "w/landuse=reservoir",
      "w/highway=motorway,trunk,primary,secondary,motorway_link,trunk_link",
      "r/natural=water",
      "r/landuse=reservoir",
    ],
    { stdio: "ignore" },
  );
  for (const f of [linesJson, polysJson]) rmSync(f, { force: true });
  await execa("ogr2ogr", ["-f", "GeoJSON", linesJson, featPbf, "lines"], { stdio: "ignore" });
  await execa("ogr2ogr", ["-f", "GeoJSON", polysJson, featPbf, "multipolygons"], {
    stdio: "ignore",
  });

  // 30 m DEM for draping.
  const clippedTif = path.join(WORK_DIR, `p${id}-clipped30.tif`);
  if (!existsSync(clippedTif)) throw new Error(`missing ${clippedTif} (run build:tiles first)`);
  const demBin = path.join(WORK_DIR, `p${id}-clipped30-f.bin`);
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
  const W = leafLevel.width;
  const H = leafLevel.height;
  /** Bilinear sample at cell-centre convention (matches the mesh). */
  const groundAt = (e: number, n: number): number => {
    const fc = (e - terrainTiles.originEasting) / cell - 0.5;
    const fr = (terrainTiles.originNorthing - n) / cell - 0.5;
    const c0 = Math.max(0, Math.min(W - 1, Math.floor(fc)));
    const r0 = Math.max(0, Math.min(H - 1, Math.floor(fr)));
    const c1 = Math.min(W - 1, c0 + 1);
    const r1 = Math.min(H - 1, r0 + 1);
    const tx = Math.max(0, Math.min(1, fc - c0));
    const ty = Math.max(0, Math.min(1, fr - r0));
    const v = (r: number, c: number) => {
      const x = dem[r * W + c];
      return x === NODATA ? 0 : x;
    };
    const top = v(r0, c0) * (1 - tx) + v(r0, c1) * tx;
    const bot = v(r1, c0) * (1 - tx) + v(r1, c1) * tx;
    return top * (1 - ty) + bot * ty;
  };

  const rawLines = JSON.parse(readFileSync(linesJson, "utf-8")) as { features: RawFeature[] };
  const rawPolys = JSON.parse(readFileSync(polysJson, "utf-8")) as { features: RawFeature[] };
  rmSync(featPbf, { force: true });

  const classOf = (p: RawFeature["properties"]): number | null => {
    if (p.waterway === "river") return FEATURE_CLASS.river;
    if (p.waterway === "canal") return FEATURE_CLASS.canal;
    if (p.waterway === "stream") return FEATURE_CLASS.stream;
    if (p.highway === "motorway") return FEATURE_CLASS.motorway;
    if (p.highway === "trunk") return FEATURE_CLASS.trunk;
    if (p.highway === "primary") return FEATURE_CLASS.primary;
    if (p.highway === "secondary") return FEATURE_CLASS.secondary;
    if (p.highway === "motorway_link" || p.highway === "trunk_link") return FEATURE_CLASS.link;
    return null;
  };

  const lines: { cls: number; utm: [number, number][] }[] = [];
  for (const f of rawLines.features) {
    if (!f.geometry) continue;
    const cls = classOf(f.properties);
    if (cls === null) continue;
    const parts =
      f.geometry.type === "LineString"
        ? [f.geometry.coordinates as number[][]]
        : f.geometry.type === "MultiLineString"
          ? (f.geometry.coordinates as number[][][])
          : [];
    for (const part of parts) {
      if (part.length < 2) continue;
      lines.push({ cls, utm: part.map(([lon, lat]) => wgs84ToUtm(lon, lat, zone)) });
    }
  }

  const areas: Area[] = [];
  for (const f of rawPolys.features) {
    if (!f.geometry) continue;
    const isWater = f.properties.natural === "water" || f.properties.landuse === "reservoir";
    if (!isWater) continue;
    const c = f.geometry.coordinates as any;
    const polys: number[][][][] =
      f.geometry.type === "Polygon" ? [c] : f.geometry.type === "MultiPolygon" ? c : [];
    for (const poly of polys) {
      const outer = poly?.[0];
      if (!outer || outer.length < 4) continue;
      let ring = outer.map(([lon, lat]) => wgs84ToUtm(lon, lat, zone)) as [number, number][];
      ring = ring.slice(0, -1);
      const areaM2 = ringAreaM2(ring);
      if (areaM2 < 300) continue;
      let minE = Infinity;
      let maxE = -Infinity;
      let minN = Infinity;
      let maxN = -Infinity;
      let levelZ = Infinity;
      for (const [e, n] of ring) {
        minE = Math.min(minE, e);
        maxE = Math.max(maxE, e);
        minN = Math.min(minN, n);
        maxN = Math.max(maxN, n);
        levelZ = Math.min(levelZ, groundAt(e, n));
      }
      areas.push({ cls: FEATURE_CLASS.waterArea, ring, levelZ, areaM2, minE, maxE, minN, maxN });
    }
  }

  const outRoot = path.join(TILES_ROOT, id, "features");
  rmSync(outRoot, { recursive: true, force: true });
  mkdirSync(outRoot, { recursive: true });

  const leafZ = terrainTiles.levels.length - 1;
  const firstZ = Math.max(0, leafZ - LEVELS_ABOVE_LEAF);
  const levelMeta: FeatureTileLevel[] = [];
  let fileCount = 0;
  let bytes = 0;

  for (let z = firstZ; z <= leafZ; z++) {
    const level = terrainTiles.levels[z];
    const rule = LEVEL_RULES[Math.min(LEVEL_RULES.length - 1, LEVELS_ABOVE_LEAF - (leafZ - z))];
    const tileM = level.cellSizeM * terrainTiles.tileSize;
    const tol = Math.max(1, level.cellSizeM / 4);
    const maxSeg = Math.max(40, level.cellSizeM);
    const margin = tileM * 0.03;

    type Rec = { kind: number; cls: number; pts: [number, number, number][]; levelZ: number };
    const buckets = new Map<number, Rec[]>();
    const push = (key: number, rec: Rec) => {
      let arr = buckets.get(key);
      if (!arr) {
        arr = [];
        buckets.set(key, arr);
      }
      arr.push(rec);
    };
    const tileIndex = (e: number, n: number): [number, number] => [
      Math.floor((e - terrainTiles.originEasting) / tileM),
      Math.floor((terrainTiles.originNorthing - n) / tileM),
    ];

    let count = 0;
    for (const line of lines) {
      if (!rule.classes.has(line.cls)) continue;
      const simplified = densify(simplify(line.utm, tol), maxSeg);
      const withZ = simplified.map(([e, n]) => [e, n, groundAt(e, n)] as [number, number, number]);
      let minE = Infinity;
      let maxE = -Infinity;
      let minN = Infinity;
      let maxN = -Infinity;
      for (const [e, n] of withZ) {
        minE = Math.min(minE, e);
        maxE = Math.max(maxE, e);
        minN = Math.min(minN, n);
        maxN = Math.max(maxN, n);
      }
      const [tx0, ty0] = tileIndex(minE, maxN);
      const [tx1, ty1] = tileIndex(maxE, minN);
      for (let ty = Math.max(0, ty0); ty <= Math.min(level.tilesY - 1, ty1); ty++) {
        for (let tx = Math.max(0, tx0); tx <= Math.min(level.tilesX - 1, tx1); tx++) {
          const e0 = terrainTiles.originEasting + tx * tileM - margin;
          const n1 = terrainTiles.originNorthing - ty * tileM + margin;
          const pieces = clipPolyline(withZ, e0, n1 - tileM - 2 * margin, e0 + tileM + 2 * margin, n1);
          for (const p of pieces) {
            push(ty * level.tilesX + tx, { kind: KIND_LINE, cls: line.cls, pts: p, levelZ: 0 });
            count++;
          }
        }
      }
    }
    for (const a of areas) {
      if (a.areaM2 < rule.minAreaM2) continue;
      const ring = simplify([...a.ring, a.ring[0]], tol).slice(0, -1);
      if (ring.length < 3) continue;
      const pts = ring.map(([e, n]) => [e, n, a.levelZ] as [number, number, number]);
      const [tx0, ty0] = tileIndex(a.minE, a.maxN);
      const [tx1, ty1] = tileIndex(a.maxE, a.minN);
      for (let ty = Math.max(0, ty0); ty <= Math.min(level.tilesY - 1, ty1); ty++) {
        for (let tx = Math.max(0, tx0); tx <= Math.min(level.tilesX - 1, tx1); tx++) {
          push(ty * level.tilesX + tx, { kind: KIND_AREA, cls: a.cls, pts, levelZ: a.levelZ });
          count++;
        }
      }
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
      for (const r of list) size += 10 + r.pts.length * 6;
      const buf = Buffer.alloc(size);
      let o = 0;
      buf.writeUInt32LE(FEATURE_MAGIC, o);
      o += 4;
      buf.writeUInt32LE(list.length, o);
      o += 4;
      for (const r of list) {
        let ext = 1;
        for (const [e, n] of r.pts) {
          ext = Math.max(ext, Math.abs(e - centreE), Math.abs(centreN - n));
        }
        // Per-feature unit so even a 100 km reservoir fits in int16.
        const unitM = Math.max(0.25, ext / 32000);
        buf.writeUInt8(r.kind, o);
        o += 1;
        buf.writeUInt8(r.cls, o);
        o += 1;
        buf.writeUInt16LE(r.pts.length, o);
        o += 2;
        buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(r.levelZ))), o);
        o += 2;
        buf.writeFloatLE(unitM, o);
        o += 4;
        for (const [e, n, zz] of r.pts) {
          buf.writeInt16LE(Math.round((e - centreE) / unitM), o);
          o += 2;
          buf.writeInt16LE(Math.round((centreN - n) / unitM), o);
          o += 2;
          buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(zz))), o);
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
    });
  }

  return {
    pyramid: {
      urlTemplate: `${urlPrefix}/features/{z}/{x}_{y}.bin`,
      levels: levelMeta,
      lineCount: lines.length,
      waterAreaCount: areas.length,
    },
    fileCount,
    bytes,
  };
}
