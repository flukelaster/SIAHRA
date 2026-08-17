import { existsSync } from "node:fs";
import path from "node:path";
import { execa } from "execa";

const RAW_DIR = path.resolve(import.meta.dirname, "../data/raw");
const GEOFABRIK_URL = "https://download.geofabrik.de/asia/thailand-latest.osm.pbf";

/** Downloads (with caching) the national Thailand OSM extract and returns its local path. */
export async function fetchThailandOsm(): Promise<string> {
  const dest = path.join(RAW_DIR, "thailand-latest.osm.pbf");

  if (existsSync(dest)) {
    console.log("[fetchOsm] cached: thailand-latest.osm.pbf");
    return dest;
  }

  console.log(`[fetchOsm] downloading ${GEOFABRIK_URL} (~500MB, this will take a while)...`);
  await execa("curl", ["-fSL", "--create-dirs", "-o", dest, GEOFABRIK_URL], { stdio: "inherit" });
  return dest;
}
