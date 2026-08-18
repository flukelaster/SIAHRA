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

/** GeoServer ค้างได้ — กันไม่ให้ DO ถูกแขวนรอ response ที่ไม่มีวันมา */
const FETCH_TIMEOUT_MS = 25_000;
/** ดีเลย์ก่อน retry ในรอบเดียวกัน (หน่วง + jitter) — กลบอาการล่มแป๊บเดียวของต้นทาง */
const RETRY_DELAYS_MS = [800, 2_500];

/** 5xx/429 คือ "ลองใหม่แล้วอาจได้" (525/520 = Cloudflare ต่อ origin ไม่ติด), 4xx อื่นคือขอผิด */
function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** ±25% jitter กัน DO ทุกตัว/ทุก retry ยิงพร้อมกัน */
function jitter(ms: number): number {
  return Math.round(ms * (0.75 + Math.random() * 0.5));
}

class UpstreamError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

/**
 * ดึงฉากน้ำท่วมหนึ่งครั้ง โดยลองซ้ำได้เมื่อความผิดพลาดเป็นแบบชั่วคราว
 * (ต้นทาง GISTDA ล่ม ๆ หาย ๆ เป็นปกติ — 525/520 คือ Cloudflare ต่อ origin ไม่ติด)
 */
export interface FetchOptions {
  /** จำนวนครั้งที่ยอมยิงทั้งหมด (รวมครั้งแรก) — ผู้เรียกที่มีเพดานเวลาจำกัดใช้ 1 */
  attempts?: number;
  timeoutMs?: number;
}

async function fetchSceneJson(options?: FetchOptions): Promise<{ features?: WfsFeature[] }> {
  const attempts = Math.max(1, options?.attempts ?? RETRY_DELAYS_MS.length + 1);
  const timeoutMs = options?.timeoutMs ?? FETCH_TIMEOUT_MS;
  let lastError: Error = new Error("GISTDA WFS: no attempt made");
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(jitter(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length) - 1]));
    try {
      const res = await fetch(GISTDA_WFS_URL, {
        headers: { "User-Agent": "siahra-api/0.0.0 (flood extent ingestion)", Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return (await res.json()) as { features?: WfsFeature[] };
      throw new UpstreamError(
        `GISTDA WFS failed: ${res.status} ${res.statusText}`,
        retryableStatus(res.status),
      );
    } catch (err) {
      if (err instanceof UpstreamError && !err.retryable) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError;
}

export async function fetchGistdaFloodExtent(options?: FetchOptions): Promise<RawFloodFeature[]> {
  const body = await fetchSceneJson(options);
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
