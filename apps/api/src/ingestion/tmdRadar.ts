/**
 * TMD national radar composite (weather.tmd.go.th/composite). The site keeps a
 * rolling set of image files overwritten in place; the only way to know which
 * file is which time is `images_composite.list`. Two line forms are accepted:
 *   old (until ~2026-09-02): background_THA.png "2026-08-17 03:30" overlay=topo_THA.png,zr0023.png,map_THA_province.png,…
 *   new (probed 2026-09-27): background_THA.png "2026-09-27 16:30" overlay=zr/24.png
 * The new list has 25 lines at 15-min steps, `zr/0` oldest … `zr/24` newest,
 * and the names are a rolling window reused as time advances — a file name no
 * longer identifies a time, so RadarDO re-reads the list before storing a frame.
 * Some listed files answer 404 (probed: `zr/0`..`zr/9`), i.e. TMD lists a time
 * it does not serve — `RadarFrameNotServedError` keeps that apart from a real
 * failure. Times are UTC. No CORS upstream, so frames are proxied through the Worker.
 *
 * Georeferencing — two formats, told apart by the PNG's IHDR size (checked in
 * `schemas/radar.ts`; any other size is rejected, never drawn with a guess):
 * - **web-mercator, 1800×2644** (every frame TMD serves since the list change).
 *   Verified 2026-09-27 ~17:17Z by fetching TMD's own viewer
 *   https://weather.tmd.go.th/composite/index_composite.html: it drapes
 *   `images/zr/<n>.png` as a MapLibre (4.5.2) `type:'image'` source with
 *   `RADAR_COORDS` [[95,22.5],[108,22.5],[108,4],[95,4]] — MapLibre stretches an
 *   image source linearly in Web Mercator. Cross-check: the Mercator aspect of
 *   that box is 0.68069 against 1800/2644 = 0.68079 (0.015 %), while plate
 *   carrée would be 0.70270 (3.1 % off). IHDR of `zr/24.png` and `zr/10.png`
 *   read 1800×2644 in the same probe. No independent ground-truth check (land
 *   pixels) has been done for this format — the viewer's box is TMD's own claim.
 * - **equirectangular, 1173×1668** (legacy frames archived until 2026-09-02).
 *   This format is no longer served, so it cannot be re-checked; the box below
 *   (95.005–108.005 E, 3.995–22.495 N) is the one the earlier ingest used,
 *   derived from TMD's QPE grid header and spot checks made in 2026-08 against
 *   the old frames only. It says nothing about the new frames.
 * Stored frames carry no projection column (no new SQL/state by design), so the
 * projection of a stored frame follows from its time: see `WEB_MERCATOR_SINCE_MS`.
 */
import type { RadarGeoreference, RadarProjection } from "@siahra/shared-types";
import { RADAR_FILE_RE, assertRadarFrame, assertRadarIndex } from "./schemas/radar.js";

export const RADAR_LIST_URL = "https://weather.tmd.go.th/composite/images_composite.list";
export const RADAR_IMAGE_BASE = "https://weather.tmd.go.th/composite/images/";

export const RADAR_GEOREFERENCES: Record<RadarProjection, RadarGeoreference> = {
  "web-mercator": {
    projection: "web-mercator",
    bounds: { minLon: 95, minLat: 4, maxLon: 108, maxLat: 22.5 },
    widthPx: 1800,
    heightPx: 2644,
    basis:
      "TMD composite viewer RADAR_COORDS as a MapLibre image source (linear in Web Mercator); IHDR and aspect checked 2026-09-27",
  },
  equirectangular: {
    projection: "equirectangular",
    bounds: { minLon: 95.005, minLat: 3.995, maxLon: 108.005, maxLat: 22.495 },
    widthPx: 1173,
    heightPx: 1668,
    basis: "Legacy frames archived until 2026-09-02; box from TMD's QPE grid header, checked 2026-08 on the old format only",
  },
};

/**
 * เฟรมที่เวลาตรวจวัดตั้งแต่ค่านี้ขึ้นไปเป็น web-mercator ก่อนหน้านี้เป็น equirectangular
 * ตารางเฟรมไม่มีคอลัมน์ projection (ห้ามเพิ่ม SQL/สถานะรายช่อง) จึงแบ่งด้วยเวลา:
 * - เฟรมทุกเฟรมที่โค้ดเดิมเก็บไว้มีเวลา ≤ รอบดึงสำเร็จครั้งสุดท้ายของมัน
 *   2026-09-02T15:40:39Z (`/api/v1/health` บน prod, ตรวจ 2026-09-27) — เวลาเฟรม
 *   ไม่มีทางใหม่กว่าเวลาที่ดึง และหลังจากนั้นไม่มีเฟรมใดถูกเก็บเลยเพราะ parse ไม่ผ่าน
 * - ดัชนีรูปแบบใหม่ย้อนหลังแค่ ~6 ชม. เฟรมแรกที่โค้ดนี้เก็บได้จึงเป็นของ 2026-09-27
 * ค่าใด ๆ ระหว่างสองจุดนี้แบ่งคลังได้ตรงทุกเฟรม ขาเข้า RadarDO บังคับให้ขนาดใน IHDR
 * ตรงกับ projection ตามเวลาเสมอ (ไม่ตรง = ข้าม + lastError) ป้ายตอนอ่านจึงไม่โกหก
 */
export const WEB_MERCATOR_SINCE_MS = Date.parse("2026-09-02T16:00:00Z");

export function radarProjectionAt(tsMs: number): RadarProjection {
  return tsMs >= WEB_MERCATOR_SINCE_MS ? "web-mercator" : "equirectangular";
}

export interface RadarSlot {
  tsMs: number;
  file: string;
}

const LINE_RE = /"(\d{4}-\d{2}-\d{2} \d{2}:\d{2})"[^\n]*?overlay=([^\s]+)/;

export interface RadarIndex {
  slots: RadarSlot[];
  /**
   * เวลาที่ TMD เผยแพร่ index นี้ อ่านจากส่วนหัว Last-Modified — วัดจริงเมื่อ
   * 2026-08-19 แล้วต้นทาง (หลัง Imperva) ไม่ส่งส่วนหัวนี้มา จึงเป็น null ตามจริง
   * ห้ามเอาเวลาของเฟรมล่าสุดมาสวมแทน เพราะนั่นคือ "เวลาที่ตรวจวัด" คนละอย่างกับ
   * "เวลาที่เผยแพร่"
   */
  publishedAt: string | null;
}

export async function fetchRadarIndex(): Promise<RadarIndex> {
  const res = await fetch(RADAR_LIST_URL, {
    headers: { "User-Agent": "siahra-api/0.0.0 (radar ingestion)" },
    cf: { cacheTtl: 0 },
  } as RequestInit);
  if (!res.ok) throw new Error(`TMD radar list failed: ${res.status}`);
  const text = await res.text();
  const slots: RadarSlot[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const tsMs = Date.parse(`${m[1].replace(" ", "T")}:00Z`);
    const file = m[2].split(",").find((f) => RADAR_FILE_RE.test(f));
    if (!Number.isFinite(tsMs) || !file) continue;
    slots.push({ tsMs, file });
  }
  const lastModified = res.headers.get("last-modified");
  const publishedMs = lastModified ? Date.parse(lastModified) : NaN;
  // ดัชนีที่ parse แล้วได้ศูนย์ช่อง = รูปแบบบรรทัดเปลี่ยน ไม่ใช่ "ไม่มีเฟรมใหม่"
  return assertRadarIndex({
    slots,
    publishedAt: Number.isFinite(publishedMs) ? new Date(publishedMs).toISOString() : null,
  });
}

/**
 * ต้นทางตอบ 404 ให้ไฟล์ที่ตัวเองลงไว้ในดัชนี = TMD "ลงเวลาไว้แต่ไม่ได้ให้บริการภาพ"
 * ไม่ใช่ความล้มเหลวของฝั่งเรา (วัดจริง 2026-09-27: `zr/0`..`zr/9` เป็น 404 ทั้งที่
 * อยู่ในดัชนี) — แยกชนิดไว้ให้ RadarDO นับเป็น `notServed` แทนการเขียน lastError
 */
export class RadarFrameNotServedError extends Error {
  constructor(readonly file: string) {
    super(`TMD radar frame ${file} not served: 404`);
    this.name = "RadarFrameNotServedError";
  }
}

export async function fetchRadarFrame(file: string): Promise<ArrayBuffer> {
  // ต่อ path ตามที่ดัชนีให้มาตรง ๆ (`zr/24.png` → images/zr/24.png) — ตัวกันแคช
  // จำเป็นยิ่งกว่าเดิม เพราะชื่อไฟล์เดิมถูกใช้ซ้ำกับเวลาใหม่ทุก 15 นาที
  const res = await fetch(`${RADAR_IMAGE_BASE}${file}?t=${Date.now()}`, {
    headers: { "User-Agent": "siahra-api/0.0.0 (radar ingestion)" },
  });
  if (!res.ok) {
    // ทิ้ง body ที่ไม่อ่าน — ไม่งั้น workerd ถือ connection ค้างไว้ระหว่างเฟรมถัดไป
    await res.body?.cancel();
    if (res.status === 404) throw new RadarFrameNotServedError(file);
    throw new Error(`TMD radar frame ${file} failed: ${res.status}`);
  }
  return assertRadarFrame(await res.arrayBuffer(), file);
}
