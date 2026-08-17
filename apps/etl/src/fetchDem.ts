import { existsSync } from "node:fs";
import path from "node:path";
import { execa } from "execa";
import type { AoiDefinition } from "./aoi.js";

const RAW_DIR = path.resolve(import.meta.dirname, "../data/raw");

/** Downloads (with caching) every Copernicus DEM tile the AOI needs and returns their local paths. */
export async function fetchDemTiles(aoi: AoiDefinition): Promise<string[]> {
  const paths: string[] = [];

  for (const url of aoi.demTileUrls) {
    const filename = url.split("/").pop()!;
    const dest = path.join(RAW_DIR, filename);

    if (existsSync(dest)) {
      console.log(`[fetchDem] cached: ${filename}`);
    } else {
      console.log(`[fetchDem] downloading: ${url}`);
      await execa("curl", ["-fSL", "--create-dirs", "-o", dest, url], { stdio: "inherit" });
    }

    paths.push(dest);
  }

  return paths;
}
