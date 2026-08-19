/**
 * TMD national radar composite (weather.tmd.go.th/composite). The site keeps a
 * 24-slot ring buffer `zr0000.png … zr0023.png` overwritten in place; the only
 * way to know which slot is which time is `images_composite.list`, whose lines
 * look like:
 *   background_THA.png "2026-08-17 03:30" overlay=topo_THA.png,zr0023.png,map_THA_province.png,…
 * Times are UTC. No CORS upstream, so frames are proxied through the Worker.
 *
 * Georeferencing: TMD publishes none for the PNGs, but their QPE grid header
 * (95.005–108.005 E, 3.995–22.495 N, 1300×1850 @0.01°) has the same aspect as
 * the 1173×1668 composite to 0.06 %, and land/sea pixels sampled at Bangkok,
 * Chiang Mai, Phuket, the Gulf and the Andaman all land correctly with it.
 */
export const RADAR_LIST_URL = "https://weather.tmd.go.th/composite/images_composite.list";
export const RADAR_IMAGE_BASE = "https://weather.tmd.go.th/composite/images/";
export const RADAR_BOUNDS = { minLon: 95.005, minLat: 3.995, maxLon: 108.005, maxLat: 22.495 };
export const RADAR_SIZE = { widthPx: 1173, heightPx: 1668 };

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
    const file = m[2].split(",").find((f) => /^zr\d{4}\.png$/.test(f));
    if (!Number.isFinite(tsMs) || !file) continue;
    slots.push({ tsMs, file });
  }
  const lastModified = res.headers.get("last-modified");
  const publishedMs = lastModified ? Date.parse(lastModified) : NaN;
  return { slots, publishedAt: Number.isFinite(publishedMs) ? new Date(publishedMs).toISOString() : null };
}

export async function fetchRadarFrame(file: string): Promise<ArrayBuffer> {
  const res = await fetch(`${RADAR_IMAGE_BASE}${file}?t=${Date.now()}`, {
    headers: { "User-Agent": "siahra-api/0.0.0 (radar ingestion)" },
  });
  if (!res.ok) throw new Error(`TMD radar frame ${file} failed: ${res.status}`);
  return res.arrayBuffer();
}
