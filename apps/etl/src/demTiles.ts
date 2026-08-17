import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { execa } from "execa";

const RAW_DIR = path.resolve(import.meta.dirname, "../data/raw");

export interface Bbox {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

function tileName(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  const la = String(Math.abs(lat)).padStart(2, "0");
  const lo = String(Math.abs(lon)).padStart(3, "0");
  return `Copernicus_DSM_COG_10_${ns}${la}_00_${ew}${lo}_00_DEM`;
}

export function tileUrl(name: string): string {
  return `https://copernicus-dem-30m.s3.amazonaws.com/${name}/${name}.tif`;
}

/** Every Copernicus 1°x1° tile whose cell intersects the bbox. */
export function tilesForBbox(bbox: Bbox): string[] {
  const out: string[] = [];
  const lat0 = Math.floor(bbox.minLat);
  const lat1 = Math.floor(bbox.maxLat);
  const lon0 = Math.floor(bbox.minLon);
  const lon1 = Math.floor(bbox.maxLon);
  for (let lat = lat0; lat <= lat1; lat++) {
    for (let lon = lon0; lon <= lon1; lon++) {
      out.push(tileName(lat, lon));
    }
  }
  return out;
}

export function tilePath(name: string): string {
  return path.join(RAW_DIR, `${name}.tif`);
}

/**
 * Downloads the given tiles, skipping ones already on disk. Copernicus has no
 * tile over open ocean, so a 404 is expected near coastlines and is recorded
 * as missing rather than treated as a failure.
 */
export async function downloadTiles(
  names: string[],
  concurrency = 6,
): Promise<{ present: string[]; missing: string[] }> {
  const present: string[] = [];
  const missing: string[] = [];
  const queue = [...names];

  async function worker() {
    for (;;) {
      const name = queue.shift();
      if (!name) return;
      const dest = tilePath(name);
      if (existsSync(dest) && statSync(dest).size > 0) {
        present.push(name);
        continue;
      }
      try {
        await execa("curl", ["-fSL", "--retry", "2", "--create-dirs", "-o", dest, tileUrl(name)]);
        present.push(name);
      } catch {
        missing.push(name);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  console.log(`[demTiles] present=${present.length} missing(ocean/no-data)=${missing.length}`);
  return { present, missing };
}

/** Builds a single VRT mosaic so each province clips from one virtual raster. */
export async function buildVrt(tileNames: string[], vrtPath: string): Promise<string> {
  const paths = tileNames.map(tilePath).filter((p) => existsSync(p));
  const listFile = `${vrtPath}.txt`;
  const { writeFileSync } = await import("node:fs");
  writeFileSync(listFile, paths.join("\n"));
  await execa("gdalbuildvrt", ["-overwrite", "-input_file_list", listFile, vrtPath], {
    stdio: "inherit",
  });
  return vrtPath;
}
