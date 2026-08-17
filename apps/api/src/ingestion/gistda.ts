import type { FloodExtentFeature } from "@siahra/shared-types";

/**
 * GISTDA flood-extent scene, served openly (no key, CORS *) from their
 * GeoServer as WFS. Tambon-level MultiPolygons of the latest interpreted
 * satellite flood map. Verified 2026-08-17: 359 features, EPSG:4326.
 *
 * Two upstream quirks handled here:
 *  - Thai attribute text is cp874 bytes mislabelled as UTF-8 (arrives as
 *    latin-1 mojibake); decoded back to Thai below.
 *  - Features carry no date at all — currency is tracked by the caller
 *    (first/last seen), never invented here.
 */
export const GISTDA_WFS_URL =
  "https://flood-innotech.gistda.or.th/flooding_vis_public" +
  "?service=WFS&version=2.0.0&request=GetFeature&typeNames=flooding_vis:FloodArea_Poly&outputFormat=application/json";

export const GISTDA_ATTRIBUTION =
  "พื้นที่น้ำท่วมจากภาพดาวเทียม โดยสำนักงานพัฒนาเทคโนโลยีอวกาศและภูมิสารสนเทศ (GISTDA)";

interface WfsFeature {
  type: "Feature";
  id?: string;
  properties?: Record<string, unknown>;
  geometry?: { type: string; coordinates: unknown } | null;
}

/** cp874 (TIS-620 superset) byte -> Unicode; the Thai block is contiguous. */
function cp874ByteToChar(b: number): string {
  if (b < 0x80) return String.fromCharCode(b);
  if (b >= 0xa1 && b <= 0xda) return String.fromCharCode(0x0e01 + (b - 0xa1));
  if (b >= 0xdf && b <= 0xfb) return String.fromCharCode(0x0e3f + (b - 0xdf));
  if (b === 0xa0) return " ";
  return "�";
}

const THAI_RE = /[\u0e00-\u0e7f]/;
const HIGH_LATIN1_RE = /[\u0080-\u00ff]/;

/**
 * Undo latin-1 mojibake: each char of the incoming string is one original
 * byte (< 256). If the string already contains Thai it is left alone so a
 * future upstream encoding fix does not get double-decoded.
 */
export function fixThaiMojibake(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (THAI_RE.test(value) || !HIGH_LATIN1_RE.test(value)) return value;
  let out = "";
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    out += code < 256 ? cp874ByteToChar(code) : ch;
  }
  return out;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Stable hash of a geometry so a re-drawn polygon counts as a new feature. */
export async function digest(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface RawFloodFeature {
  id: string;
  provinceCode: string | null;
  props: Omit<FloodExtentFeature["properties"], "firstSeenAt" | "lastSeenAt">;
  geometry: FloodExtentFeature["geometry"];
}

export async function fetchGistdaFloodExtent(): Promise<RawFloodFeature[]> {
  const res = await fetch(GISTDA_WFS_URL, {
    headers: { "User-Agent": "siahra-api/0.0.0 (flood extent ingestion)", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`GISTDA WFS failed: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { features?: WfsFeature[] };
  const features = Array.isArray(body.features) ? body.features : [];
  const out: RawFloodFeature[] = [];
  for (const f of features) {
    const g = f.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;
    const p = f.properties ?? {};
    const pv = num(p.PV_IDN);
    const provinceCode = pv !== null ? String(pv).padStart(2, "0") : null;
    // Upstream ids ("FloodArea_Poly.123") are positional per scene, so key on
    // tambon id + geometry hash instead.
    const geometry = g as FloodExtentFeature["geometry"];
    const hash = await digest(JSON.stringify(geometry.coordinates));
    const tambonId = num(p.TB_IDN);
    out.push({
      id: `${tambonId ?? "x"}:${hash.slice(0, 12)}`,
      provinceCode,
      props: {
        tambonTh: fixThaiMojibake(p.TB_TN),
        amphoeTh: fixThaiMojibake(p.AP_TN),
        provinceTh: fixThaiMojibake(p.PV_TN),
        provinceCode,
        floodAreaRai: num(p.flood_area),
        houses: num(p.house),
        lat: num(p.lat),
        lon: num(p.long),
      },
      geometry,
    });
  }
  return out;
}
