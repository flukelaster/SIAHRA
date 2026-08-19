import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { execa } from "execa";
import {
  SOURCES,
  type LandcoverTileLevel,
  type LandcoverTilePyramid,
  type TerrainTilePyramid,
} from "@siahra/shared-types";
import type { AoiDefinition } from "./aoi.js";
import { TILES_ROOT } from "./buildProvinceTerrainTiles.js";

const WORK_DIR = path.resolve(import.meta.dirname, "../data/work");
const RAW_DIR = path.resolve(import.meta.dirname, "../data/raw/worldcover");
const WC_BASE = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map";
/** เครดิตมาจากทะเบียนกลางใน shared-types แหล่งเดียว จะได้ไม่มีสองสำนวนให้เพี้ยนกัน */
export const WORLDCOVER_ATTRIBUTION = SOURCES.worldcover.attributionText;
const NODATA = 0;

/** WorldCover tiles are 3°×3°, named by their SW corner (N15E099 covers 15–18N, 99–102E). */
function tilesFor(bbox: AoiDefinition["bbox"]): string[] {
  const out: string[] = [];
  const lat0 = Math.floor(bbox.minLat / 3) * 3;
  const lat1 = Math.floor(bbox.maxLat / 3) * 3;
  const lon0 = Math.floor(bbox.minLon / 3) * 3;
  const lon1 = Math.floor(bbox.maxLon / 3) * 3;
  for (let lat = lat0; lat <= lat1; lat += 3) {
    for (let lon = lon0; lon <= lon1; lon += 3) {
      const ns = lat >= 0 ? "N" : "S";
      const ew = lon >= 0 ? "E" : "W";
      out.push(`${ns}${String(Math.abs(lat)).padStart(2, "0")}${ew}${String(Math.abs(lon)).padStart(3, "0")}`);
    }
  }
  return out;
}

async function ensureTile(name: string): Promise<string | null> {
  mkdirSync(RAW_DIR, { recursive: true });
  const file = path.join(RAW_DIR, `ESA_WorldCover_10m_2021_v200_${name}_Map.tif`);
  if (existsSync(file) && statSync(file).size > 1000) return file;
  const url = `${WC_BASE}/ESA_WorldCover_10m_2021_v200_${name}_Map.tif`;
  const res = await fetch(url);
  if (res.status === 404) return null; // ocean-only tile
  if (!res.ok || !res.body) throw new Error(`WorldCover ${name}: HTTP ${res.status}`);
  const tmp = `${file}.part`;
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
  await execa("mv", [tmp, file]);
  return file;
}

function bitsetBase64(bits: Uint8Array): string {
  return Buffer.from(bits).toString("base64");
}

/** Mode (most frequent non-zero class) of a 2×2 block. */
function downsampleMode(src: Uint8Array, w: number, h: number): { data: Uint8Array; w: number; h: number } {
  const W = Math.ceil(w / 2);
  const H = Math.ceil(h / 2);
  const data = new Uint8Array(W * H);
  const counts = new Map<number, number>();
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      counts.clear();
      for (let dr = 0; dr < 2; dr++) {
        for (let dc = 0; dc < 2; dc++) {
          const rr = Math.min(h - 1, r * 2 + dr);
          const cc = Math.min(w - 1, c * 2 + dc);
          const v = src[rr * w + cc];
          if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
        }
      }
      let best = 0;
      let bestN = 0;
      for (const [v, n] of counts) if (n > bestN) [best, bestN] = [v, n];
      data[r * W + c] = best;
    }
  }
  return { data, w: W, h: H };
}

export interface LandcoverTilesResult {
  pyramid: LandcoverTilePyramid;
  fileCount: number;
  bytes: number;
}

/**
 * ESA WorldCover classes on the province's terrain grid, tiled for the
 * vegetation layer. Downloads the 3° source tiles on first use (~50–110 MB
 * each, cached under data/raw/worldcover).
 */
export async function buildProvinceLandcoverTiles(
  aoi: AoiDefinition,
  terrainTiles: TerrainTilePyramid,
  urlPrefix: string,
): Promise<LandcoverTilesResult> {
  const id = aoi.aoiId;
  const names = tilesFor(aoi.bbox);
  const files: string[] = [];
  for (const n of names) {
    const f = await ensureTile(n);
    if (f) files.push(f);
  }
  if (files.length === 0) throw new Error(`no WorldCover tiles for ${id}`);

  mkdirSync(WORK_DIR, { recursive: true });
  const vrt = path.join(WORK_DIR, `p${id}-worldcover.vrt`);
  await execa("gdalbuildvrt", ["-overwrite", vrt, ...files], { stdio: "ignore" });
  const leaf = terrainTiles.levels[terrainTiles.levels.length - 1];
  const cell = terrainTiles.leafCellSizeM;
  const warped = path.join(WORK_DIR, `p${id}-worldcover30.tif`);
  // Exact same grid as the terrain leaf: origin + size in cells.
  const minX = terrainTiles.originEasting;
  const maxY = terrainTiles.originNorthing;
  const maxX = minX + leaf.width * cell;
  const minY = maxY - leaf.height * cell;
  await execa(
    "gdalwarp",
    ["-overwrite", "-t_srs", `EPSG:${aoi.utmZone}`, "-te", String(minX), String(minY), String(maxX), String(maxY), "-tr", String(cell), String(cell), "-r", "mode", "-ot", "Byte", "-dstnodata", String(NODATA), "-multi", vrt, warped],
    { stdio: "ignore" },
  );
  const rawBin = path.join(WORK_DIR, `p${id}-worldcover30.bin`);
  await execa("gdal_translate", ["-of", "ENVI", "-ot", "Byte", warped, rawBin], { stdio: "ignore" });
  const buf = readFileSync(rawBin);
  if (buf.length !== leaf.width * leaf.height) throw new Error(`landcover raster size mismatch for ${id}: ${buf.length} vs ${leaf.width * leaf.height}`);
  const leafData = new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
  for (const ext of [".bin", ".hdr", ".bin.aux.xml"]) rmSync(rawBin.replace(/\.bin$/, ext), { force: true });

  const share = new Map<number, number>();
  let n = 0;
  for (const v of leafData) {
    if (!v) continue;
    n++;
    share.set(v, (share.get(v) ?? 0) + 1);
  }
  const classShare: Record<string, number> = {};
  for (const [k, v] of share) classShare[String(k)] = Math.round((v / Math.max(1, n)) * 1000) / 1000;

  const outRoot = path.join(TILES_ROOT, id, "landcover");
  rmSync(outRoot, { recursive: true, force: true });
  const T = terrainTiles.tileSize;
  const levelMeta: LandcoverTileLevel[] = [];
  let fileCount = 0;
  let bytes = 0;
  const levels: { z: number; data: Uint8Array; w: number; h: number }[] = [
    { z: leaf.z, data: leafData, w: leaf.width, h: leaf.height },
  ];
  if (leaf.z > 0) {
    const d = downsampleMode(leafData, leaf.width, leaf.height);
    levels.push({ z: leaf.z - 1, ...d });
  }
  for (const lv of levels) {
    const tilesX = Math.ceil(lv.w / T);
    const tilesY = Math.ceil(lv.h / T);
    const present = new Uint8Array(Math.ceil((tilesX * tilesY) / 8));
    const dir = path.join(outRoot, String(lv.z));
    mkdirSync(dir, { recursive: true });
    const tileBuf = new Uint8Array(T * T);
    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        let any = false;
        for (let j = 0; j < T; j++) {
          const r = ty * T + j;
          for (let i = 0; i < T; i++) {
            const c = tx * T + i;
            const v = r < lv.h && c < lv.w ? lv.data[r * lv.w + c] : NODATA;
            tileBuf[j * T + i] = v;
            if (v) any = true;
          }
        }
        if (!any) continue;
        writeFileSync(path.join(dir, `${tx}_${ty}.bin`), tileBuf);
        const idx = ty * tilesX + tx;
        present[idx >> 3] |= 1 << (idx & 7);
        fileCount++;
        bytes += tileBuf.length;
      }
    }
    levelMeta.push({ z: lv.z, tilesX, tilesY, present: bitsetBase64(present) });
  }
  return {
    pyramid: { urlTemplate: `${urlPrefix}/landcover/{z}/{x}_{y}.bin`, levels: levelMeta, attribution: WORLDCOVER_ATTRIBUTION, classShare },
    fileCount,
    bytes,
  };
}
