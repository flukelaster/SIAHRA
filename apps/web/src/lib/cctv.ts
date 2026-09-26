/**
 * ภาพกล้อง CCTV ของกรมทรัพยากรน้ำ (DWR, E15) — ฟังก์ชันล้วน + ตัวดึงภาพ + แคช
 *
 * เบราว์เซอร์ขอภาพจาก DWR ตรง ๆ (ไม่ผ่าน Worker ของเรา — ไม่มีค่าใช้จ่าย Cloudflare)
 * **ทีละกล้อง เฉพาะตอนผู้ใช้คลิก** ไม่เคยดึงภาพของทุกกล้องพร้อมกัน:
 *   1. GET  `/api/public/reportCctv/snapshot/{id}` → `{"value": "/TC020106/2026/9/26/7_17.jpg"}`
 *   2. POST `/api/file/image/cctv` `{"path": …}` → JPEG (POST เท่านั้น จึงใช้ `<img src>` ตรง ๆ ไม่ได้)
 *
 * เวลาถ่าย (`observedAt`) มาจาก path ของภาพ ไม่ใช่ `cctvOnline` (ธงนั้นไม่ได้บอกความสด —
 * ตัวอย่าง 2/21 กล้องที่ "online" มีภาพเก่า 3–4 วัน) และไม่ใช่ EXIF (นาฬิกากล้องเพี้ยน:
 * วัด 2026-09-26 path `7_47` ขณะนาฬิกาเครื่องเรา 07:49:59 +07 แต่ EXIF บอก 07:51:12
 * ซึ่งอยู่ในอนาคต) path จึงเป็นเวลาไทย (+07:00) — ถ้าเป็น UTC ภาพจะอยู่ในอนาคต 7 ชม.
 *
 * ความล้มเหลวสองแบบต้องแยกกันเสมอ และห้ามพูดว่ากล้อง/พื้นที่ "เงียบ" หรือ "ปกติ":
 *   - `unreachable` — เราถาม DWR ไม่สำเร็จ (เครือข่าย/CORS/5xx) บอกอะไรเกี่ยวกับกล้องไม่ได้
 *   - `no-image`    — DWR ตอบแล้วว่าไม่มีภาพให้ (value ว่าง หรือไฟล์ภาพ 404)
 */
import type { Lang } from "../i18n";
import { formatAge } from "./time";

export const DWR_API = "https://telemetry.dwr.go.th/api";
/** หน้าเว็บของ DWR สำหรับเครดิต/ลิงก์กลับ */
export const DWR_HOME = "https://telemetry.dwr.go.th";
/** บัญชีกล้อง (static asset จาก `npm run build:cctv -w apps/etl`) */
export const CCTV_CATALOGUE_URL = "/cctv/dwr-cameras.json";

/**
 * ภาพสด MJPEG ของ DWR (E15.2) — `multipart/x-mixed-replace` แสดงด้วย `<img src>` ได้ตรง ๆ
 * (DWR สะท้อน origin ใน CORS; `img-src` ของ CSP ต้องมี telemetry.dwr.go.th)
 *
 * วัดจริง 2026-09-26: เฟรมแรกมาหลัง 3.7–6.1 วินาที ราวหนึ่งเฟรมทุก 2–3 วินาที และ DWR ตัด
 * การเชื่อมต่อเองหลัง ~11–24 วินาที ผู้ใช้จึงต้องต่อใหม่ทุก ~15 วินาที (`n` = ตัวกันแคช
 * ให้เบราว์เซอร์เปิดการเชื่อมต่อใหม่จริง) บางสถานีตอบ 200 แต่ 0 ไบต์ = ไม่ได้ภาพสด
 */
export function dwrLiveUrl(stationCode: string, n: number): string {
  return `${DWR_API}/public/cctv/mjpegStream?stnCode=${encodeURIComponent(stationCode)}&_=${n}`;
}
/** รอบต่อใหม่ของภาพสด DWR */
export const DWR_LIVE_RECONNECT_MS = 15_000;
/**
 * ดูสดได้นานสุดต่อการกดหนึ่งครั้ง แล้วหยุดเอง (กด "ดูสดต่อ" ได้) — popup ที่เปิดค้างไว้
 * ไม่ควรต่อเซิร์ฟเวอร์ของ DWR ใหม่ทุก 15 วินาทีไปเรื่อย ๆ
 */
export const DWR_LIVE_MAX_MS = 5 * 60 * 1000;

/**
 * ป้าย "สด" ของภาพ MJPEG ใช้ได้นานเท่าไรหลังเฟรมใหม่ล่าสุดที่ **ตรวจเห็นจริง**
 *
 * สิ่งที่เบราว์เซอร์บอกได้ (วัดใน Chromium 2026-09-26): `load` ของ `<img>` multipart ยิง
 * **ครั้งเดียว** ตอนเฟรมแรก และไม่มี event ใดตอน DWR ปิดสตรีม — เฟรมถัด ๆ ไปจึงตรวจได้ทางเดียว
 * คือวาดภาพลง canvas เล็ก ๆ แล้วดูว่าพิกเซลเปลี่ยนไหม (ต้องใช้ `crossOrigin="anonymous"` ซึ่ง
 * DWR สะท้อน origin ให้ ทั้ง siahra-radar.co และ localhost) วัดช่วงห่างระหว่างเฟรมของสตรีมที่
 * ยังเปิดอยู่ได้ 0.8–8.2 วินาที (TA020510 สามรอบ, 2026-09-26) แล้วเงียบไปเมื่อ DWR ตัด — ตั้งไว้ 10
 * วินาที = ช่วงห่างยาวสุดที่วัดได้ + รอบสุ่มตัวอย่าง 0.4 วินาที + เผื่อ (ทดลอง 7 วินาทีแล้วป้ายกระพริบ
 * เป็น "เชื่อมต่อใหม่" บนสตรีมปกติ); เงียบนานกว่านั้น = "กำลังเชื่อมต่อใหม่" (เฟรมยังแสดง แต่ไม่เรียกว่าสด)
 */
export const DWR_LIVE_STALE_MS = 10_000;
/**
 * ถ้าอ่านพิกเซลไม่ได้ (canvas ติด taint) เห็นได้แค่เฟรมแรกของแต่ละการเชื่อมต่อ — ป้าย "สด" ใช้ได้
 * นานสุดเท่าอายุสตรีมที่สั้นที่สุดที่วัดได้ (~11 วินาที) หลังเฟรมแรกนั้น
 */
export const DWR_LIVE_OBSERVED_LIFETIME_MS = 11_000;

/**
 * ภาพที่แสดงยังนับว่า "สด" ไหม — `lastFrameAt` = เวลา (นาฬิกาเครื่อง ใช้วัดช่วงห่างเท่านั้น ไม่ใช่
 * เวลาถ่าย) ของเฟรมใหม่ล่าสุดที่ตรวจเห็น, `perFrame` = ตรวจเห็นทุกเฟรม (อ่านพิกเซลได้) หรือเห็น
 * แค่เฟรมแรกของการเชื่อมต่อ; null = ยังไม่เคยเห็นเฟรมเลย
 */
export function isDwrFrameFresh(now: number, lastFrameAt: number | null, perFrame: boolean): boolean {
  if (lastFrameAt === null) return false;
  return now - lastFrameAt <= (perFrame ? DWR_LIVE_STALE_MS : DWR_LIVE_OBSERVED_LIFETIME_MS);
}

const SNAPSHOT_PATH_RE = /^\/[A-Za-z0-9_-]+\/(\d{4})\/(\d{1,2})\/(\d{1,2})\/(\d{1,2})_(\d{1,2})\.jpe?g$/;
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * `/TC020106/2026/9/26/7_17.jpg` → `2026-09-26T07:17:00+07:00`
 *
 * null = path ไม่ใช่รูปแบบที่รู้จัก หรือวันที่เป็นไปไม่ได้ — ผู้เรียกต้องแสดงว่า
 * "ไม่ทราบเวลาถ่าย" ห้ามแทนด้วยเวลาปัจจุบันหรือเวลาที่ดึง
 */
export function parseSnapshotPath(path: string): string | null {
  const m = SNAPSHOT_PATH_RE.exec(path);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59) return null;
  // วันที่ต้องมีจริง (ไม่ใช่ 31 ก.พ.) — ตรวจด้วยปฏิทิน UTC ของวันเดียวกัน
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:00+07:00`;
}

export type SnapshotResult =
  | {
      kind: "ok";
      /** object URL ของ JPEG — เจ้าของคือ `SnapshotCache` (revoke ตอน evict) */
      blobUrl: string;
      /** เวลาถ่ายจาก path — null = path แปลงไม่ได้ ("ไม่ทราบเวลาถ่าย") */
      observedAt: string | null;
      /** เวลาที่เบราว์เซอร์นี้ได้ภาพสำเร็จ */
      fetchedAt: string;
    }
  | { kind: "no-image" }
  | { kind: "unreachable"; detail: string };

export interface SnapshotDeps {
  fetch: typeof fetch;
  createObjectURL: (blob: Blob) => string;
  now: () => number;
}

const defaultDeps = (): SnapshotDeps => ({
  fetch: (...a) => fetch(...a),
  createObjectURL: (b) => URL.createObjectURL(b),
  now: () => Date.now(),
});

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/**
 * ดึงภาพล่าสุดของกล้องหนึ่งตัว — การยกเลิก (`signal`) โยน AbortError ต่อ ไม่ถูกนับเป็น
 * `unreachable` (ผู้ใช้ปิด popup ไม่ได้แปลว่า DWR ล่ม)
 */
export async function fetchSnapshot(
  id: string,
  signal: AbortSignal,
  deps: SnapshotDeps = defaultDeps(),
): Promise<SnapshotResult> {
  let path: string;
  try {
    const res = await deps.fetch(`${DWR_API}/public/reportCctv/snapshot/${encodeURIComponent(id)}`, { signal });
    if (res.status === 404) return { kind: "no-image" };
    if (!res.ok) return { kind: "unreachable", detail: `HTTP ${res.status}` };
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { kind: "unreachable", detail: "unexpected response" };
    }
    const value = (body as { value?: unknown } | null)?.value;
    if (typeof value !== "string" || value.trim() === "") return { kind: "no-image" };
    path = value;
  } catch (err) {
    if (isAbort(err) || signal.aborted) throw err;
    return { kind: "unreachable", detail: "network" };
  }

  try {
    const res = await deps.fetch(`${DWR_API}/file/image/cctv`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path }),
      signal,
    });
    if (res.status === 404) return { kind: "no-image" };
    if (!res.ok) return { kind: "unreachable", detail: `HTTP ${res.status}` };
    const blob = await res.blob();
    if (blob.size === 0 || (blob.type !== "" && !blob.type.startsWith("image/"))) return { kind: "no-image" };
    // popup ปิดระหว่างอ่าน body — อย่าสร้าง object URL ที่ไม่มีใครเป็นเจ้าของ
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    return {
      kind: "ok",
      blobUrl: deps.createObjectURL(blob),
      observedAt: parseSnapshotPath(path),
      fetchedAt: new Date(deps.now()).toISOString(),
    };
  } catch (err) {
    if (isAbort(err) || signal.aborted) throw err;
    return { kind: "unreachable", detail: "network" };
  }
}

export type FreshnessLevel = "fresh" | "stale" | "old";

/** ภาพสดเมื่ออายุ ≤ 45 นาที (DWR ส่งภาพทุก ~15 นาที = พลาดไม่เกินสองรอบ) */
export const FRESH_MAX_MS = 45 * 60 * 1000;
export const STALE_MAX_MS = 24 * 60 * 60 * 1000;

/**
 * ความสดของภาพจากเวลาถ่าย — อายุคิดตอนเรนเดอร์จาก `nowMs` เสมอ
 *
 * เวลาถ่ายที่อยู่ในอนาคตเล็กน้อย (นาฬิกาเครื่องผู้ใช้ช้ากว่า) ถูกตรึงเป็นอายุ 0 = สด
 * ไม่ใช่ "อีกสักครู่" ซึ่งอ่านเหมือนภาพยังไม่ถูกถ่าย
 */
export function freshness(
  observedAt: string,
  nowMs: number,
  lang: Lang,
): { level: FreshnessLevel; ageMs: number; label: string } | null {
  const ms = Date.parse(observedAt);
  if (!Number.isFinite(ms)) return null;
  const ageMs = Math.max(0, nowMs - ms);
  const level: FreshnessLevel = ageMs <= FRESH_MAX_MS ? "fresh" : ageMs <= STALE_MAX_MS ? "stale" : "old";
  return { level, ageMs, label: formatAge(lang, observedAt, Math.max(nowMs, ms)) };
}

const EARTH_RADIUS_KM = 6371.0088;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * กล้องที่ใกล้ที่สุดภายใน `maxKm` — null = ไม่มีกล้องในระยะ (ไม่ใช่ "ไม่มีน้ำ")
 * ใช้ได้กับบัญชีกล้องทุกแหล่ง (DWR / iTIC) — ผู้เรียกเทียบระยะข้ามแหล่งเอง
 */
export function nearestCamera<T extends { lat: number; lon: number }>(
  lat: number,
  lon: number,
  cams: readonly T[],
  maxKm = 3,
): { camera: T; distanceKm: number } | null {
  let best: { camera: T; distanceKm: number } | null = null;
  for (const c of cams) {
    const d = haversineKm(lat, lon, c.lat, c.lon);
    if (d <= maxKm && (best === null || d < best.distanceKm)) best = { camera: c, distanceKm: d };
  }
  return best;
}

/**
 * กล้องที่ตั้งอยู่ด้วยกันกับ `camera` (ภายใน `maxKm` จากตัวมันเอง ไม่ต่อเป็นโซ่) — หมุดที่ซ้อนกันบน
 * แผนที่คลิกได้แค่ตัวเดียว popup จึงใช้รายการนี้ทำปุ่มสลับ ตัวที่ถูกคลิกอยู่หน้าสุดเสมอ ที่เหลือเรียง
 * ตามระยะแล้วตาม `id` (ลำดับคงที่) — 150 ม. เพราะคู่ที่ซ้อนกันจริงห่างกัน ~22 ม. (ขาเข้า/ขาออกของ
 * DOH-PER-3-006) ถึง ~140 ม. (ITICM_BMAMI0164–0166 ที่แยกกันไม่ออกเมื่อซูมระดับจังหวัด)
 */
export function coLocatedCameras<T extends { id: string; lat: number; lon: number }>(
  camera: T,
  cams: readonly T[],
  maxKm = 0.15,
): T[] {
  const others = cams
    .filter((c) => c.id !== camera.id)
    .map((c) => ({ c, d: haversineKm(camera.lat, camera.lon, c.lat, c.lon) }))
    .filter((x) => x.d <= maxKm)
    .sort((a, b) => a.d - b.d || (a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0))
    .map((x) => x.c);
  return [camera, ...others];
}

/**
 * ป้ายสั้นของกล้องในกลุ่มเดียวกัน — ตัดคำนำหน้าที่ทุกชื่อมีร่วมกัน (ตัดที่ช่องว่าง ไม่ตัดกลางคำ)
 * ให้เหลือส่วนที่ต่างกัน เช่น ขาเข้า/ขาออก "…ทิศทางมุ่งหน้าบางแค" / "…ทิศทางมุ่งหน้าบางบัวทอง";
 * ชื่อเดียว หรือไม่มีคำนำหน้าร่วม = คืนชื่อเต็ม
 */
export function distinctLabels(names: readonly string[]): string[] {
  if (names.length < 2) return [...names];
  let n = 0;
  const first = names[0];
  while (n < first.length && names.every((s) => s[n] === first[n])) n++;
  const cut = first.lastIndexOf(" ", n - 1);
  // ตัดแล้วชื่อใดเหลือว่าง = ใช้ชื่อเต็ม
  if (cut <= 0 || names.some((s) => s.length <= cut + 1)) return [...names];
  return names.map((s) => `…${s.slice(cut + 1)}`);
}

type OkSnapshot = Extract<SnapshotResult, { kind: "ok" }>;

/**
 * แคชภาพในหน่วยความจำ 5 นาทีต่อกล้อง — แคชเป็น **เจ้าของ** object URL: ทุกทางที่รายการ
 * ออกจากแคช (หมดอายุ, ถูกแทนด้วยภาพใหม่, เกินเพดาน, `clear()`) เรียก `revoke` เสมอ
 *
 * popup ที่ปิดไม่ได้ revoke เอง — ไม่งั้นเปิดกล้องเดิมซ้ำภายใน 5 นาทีจะได้ URL ที่ตายแล้ว
 * ผู้ถือแคช (Map3DCanvas) `clear()` ตอนปิดชั้น/ถอดแผนที่
 */
export class SnapshotCache {
  private readonly entries = new Map<string, { snap: OkSnapshot; storedAt: number }>();

  private readonly opts: {
    ttlMs?: number;
    maxEntries?: number;
    now?: () => number;
    revoke?: (url: string) => void;
  };

  constructor(opts: SnapshotCache["opts"] = {}) {
    this.opts = opts;
  }

  private get ttl() {
    return this.opts.ttlMs ?? 5 * 60 * 1000;
  }
  private now() {
    return (this.opts.now ?? Date.now)();
  }
  private revoke(url: string) {
    (this.opts.revoke ?? ((u: string) => URL.revokeObjectURL(u)))(url);
  }

  get(id: string): OkSnapshot | null {
    const e = this.entries.get(id);
    if (!e) return null;
    if (this.now() - e.storedAt > this.ttl) {
      this.evict(id);
      return null;
    }
    return e.snap;
  }

  set(id: string, snap: OkSnapshot): void {
    const prev = this.entries.get(id);
    if (prev && prev.snap.blobUrl !== snap.blobUrl) this.revoke(prev.snap.blobUrl);
    this.entries.delete(id);
    this.entries.set(id, { snap, storedAt: this.now() });
    const max = this.opts.maxEntries ?? 12;
    while (this.entries.size > max) {
      const oldest = this.entries.keys().next().value as string;
      this.evict(oldest);
    }
  }

  evict(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    this.entries.delete(id);
    this.revoke(e.snap.blobUrl);
  }

  clear(): void {
    for (const id of [...this.entries.keys()]) this.evict(id);
  }

  get size(): number {
    return this.entries.size;
  }
}
