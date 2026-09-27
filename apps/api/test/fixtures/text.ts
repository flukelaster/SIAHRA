/**
 * Fixture ที่ไม่ใช่ JSON — เก็บเป็นโมดูล TS เพราะเป็นทั้ง XML, ข้อความธรรมดา และไบต์
 *
 * ทั้งหมดเป็น payload ที่ "รูปร่างเหมือนของจริง" แต่ย่อจำนวนระเบียนลง โครงสร้าง
 * อ้างอิงจากสิ่งที่ adapter แต่ละตัวอ่านจริงในโค้ด (คอมเมนต์ใน src/ingestion/*.ts
 * บันทึกรูปแบบที่วัดจากต้นทางไว้แล้ว) — E5.6 จะมาต่อยอดชุดนี้ให้ครบเป็นทางการ
 */

/** TMD DailySeismicEvent: XML ที่ข้อความไทยเข้ารหัสเป็น numeric character reference */
export const TMD_SEISMIC_XML = `<?xml version="1.0" encoding="utf-8"?>
<DailySeismicEvents>
  <DailyEarthquakes>
    <OriginThai>&#xE2D;.&#xE41;&#xE21;&#xE48;&#xE25;&#xE32;&#xE19;&#xE49;&#xE2D;&#xE22; &#xE08;.&#xE40;&#xE0A;&#xE35;&#xE22;&#xE07;&#xE43;&#xE2B;&#xE21;&#xE48;</OriginThai>
    <DateTimeUTC>2026-08-19 04:12:33.000</DateTimeUTC>
    <Magnitude>3.1</Magnitude>
    <Latitude>19.4410</Latitude>
    <Longitude>98.0230</Longitude>
    <Depth unit="km.">5</Depth>
  </DailyEarthquakes>
  <DailyEarthquakes>
    <OriginThai>&#xE1B;&#xE23;&#xE30;&#xE40;&#xE17;&#xE28;&#xE40;&#xE21;&#xE35;&#xE22;&#xE19;&#xE21;&#xE32;</OriginThai>
    <DateTimeUTC>2026-08-18 21:03:10.000</DateTimeUTC>
    <Magnitude>4.4</Magnitude>
    <Latitude>20.1100</Latitude>
    <Longitude>96.2800</Longitude>
    <Depth unit="km.">10</Depth>
  </DailyEarthquakes>
</DailySeismicEvents>`;

/** ดัชนีเรดาร์ TMD: บรรทัดจริงยาวกว่านี้ แต่รูปแบบ overlay= เหมือนกันทุกประการ */
export const RADAR_LIST_TEXT = [
  `background_THA.png "2026-08-19 08:30" overlay=topo_THA.png,zr0022.png,map_THA_province.png`,
  `background_THA.png "2026-08-19 08:45" overlay=topo_THA.png,zr0023.png,map_THA_province.png`,
  ``,
].join("\n");

/**
 * ดัชนีเรดาร์ **จริง** ที่ดึงจาก `images_composite.list` เมื่อ 2026-09-27 (curl ครั้งเดียว)
 * — รูปแบบใหม่ที่ TMD เปลี่ยนมาใช้ราว 2026-09-02: 25 บรรทัด ห่างกัน 15 นาที
 * `zr/0` เก่าสุด … `zr/24` ใหม่สุด เวลาเป็น UTC และบรรทัดสุดท้ายไม่มีขึ้นบรรทัดใหม่
 * (เก็บไว้ตามไบต์ที่ได้มา)
 */
export const RADAR_LIST_TEXT_2026_09_27 = [
  `background_THA.png "2026-09-27 10:30" overlay=zr/0.png`,
  `background_THA.png "2026-09-27 10:45" overlay=zr/1.png`,
  `background_THA.png "2026-09-27 11:00" overlay=zr/2.png`,
  `background_THA.png "2026-09-27 11:15" overlay=zr/3.png`,
  `background_THA.png "2026-09-27 11:30" overlay=zr/4.png`,
  `background_THA.png "2026-09-27 11:45" overlay=zr/5.png`,
  `background_THA.png "2026-09-27 12:00" overlay=zr/6.png`,
  `background_THA.png "2026-09-27 12:15" overlay=zr/7.png`,
  `background_THA.png "2026-09-27 12:30" overlay=zr/8.png`,
  `background_THA.png "2026-09-27 12:45" overlay=zr/9.png`,
  `background_THA.png "2026-09-27 13:00" overlay=zr/10.png`,
  `background_THA.png "2026-09-27 13:15" overlay=zr/11.png`,
  `background_THA.png "2026-09-27 13:30" overlay=zr/12.png`,
  `background_THA.png "2026-09-27 13:45" overlay=zr/13.png`,
  `background_THA.png "2026-09-27 14:00" overlay=zr/14.png`,
  `background_THA.png "2026-09-27 14:15" overlay=zr/15.png`,
  `background_THA.png "2026-09-27 14:30" overlay=zr/16.png`,
  `background_THA.png "2026-09-27 14:45" overlay=zr/17.png`,
  `background_THA.png "2026-09-27 15:00" overlay=zr/18.png`,
  `background_THA.png "2026-09-27 15:15" overlay=zr/19.png`,
  `background_THA.png "2026-09-27 15:30" overlay=zr/20.png`,
  `background_THA.png "2026-09-27 15:45" overlay=zr/21.png`,
  `background_THA.png "2026-09-27 16:00" overlay=zr/22.png`,
  `background_THA.png "2026-09-27 16:15" overlay=zr/23.png`,
  `background_THA.png "2026-09-27 16:30" overlay=zr/24.png`,
].join("\n");

/** PNG 1×1 ที่ถูกต้องครบทั้งลายเซ็น, IHDR, IDAT และ IEND */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function png1x1(): Uint8Array<ArrayBuffer> {
  const binary = atob(PNG_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * PNG ที่ IHDR ประกาศขนาด `width×height` (CRC ของ IHDR คำนวณใหม่ให้ถูกต้อง) แต่
 * IDAT ยังเป็นข้อมูลของภาพ 1×1 — **ถูกต้องระดับหัวไฟล์ ถอดรหัสเป็นภาพไม่ได้**
 * พอสำหรับเทส api ที่ไม่มีใครถอดรหัสภาพ (API ตรวจแค่ลายเซ็น, IHDR, ขนาด และ IEND)
 */
export function pngOfSize(width: number, height: number): ArrayBuffer {
  const bytes = png1x1();
  const dv = new DataView(bytes.buffer);
  dv.setUint32(16, width);
  dv.setUint32(20, height);
  dv.setUint32(29, crc32(bytes.subarray(12, 29)));
  return bytes.buffer;
}

/** เฟรมรูปแบบปัจจุบันของ TMD: 1800×2644 (web-mercator) */
export function validPngFrame(): ArrayBuffer {
  return pngOfSize(1800, 2644);
}

/** เฟรมรูปแบบเดิมก่อน 2026-09-02: 1173×1668 (equirectangular) */
export function legacyPngFrame(): ArrayBuffer {
  return pngOfSize(1173, 1668);
}

/** PNG 1×1 ตัวจริง (ถอดรหัสได้) — ขนาดที่ไม่รู้ georeference ต้องถูกปฏิเสธ */
export function unknownSizePngFrame(): ArrayBuffer {
  return png1x1().buffer;
}

/**
 * PNG ที่ถูกต้องแต่ **ไบต์ต่างกันตาม `tag`** — แทรก chunk `tEXt` (CRC ถูกต้อง) ก่อน
 * IEND ของ `validPngFrame()` RadarDO เทียบ SHA-256 ของภาพ (ภาพสองเฟรมที่ไบต์
 * เหมือนกันถูกทิ้งว่า "ยังไม่ถูกสลับภาพ") ต้นทางปลอมจึงต้องส่งภาพที่ต่างกันต่อช่อง
 */
export function pngFrameFor(tag: string): ArrayBuffer {
  const base = new Uint8Array(validPngFrame());
  const iendAt = base.length - 12;
  const body = new TextEncoder().encode(`tEXtComment\0${tag}`);
  const chunk = new Uint8Array(4 + body.length + 4);
  new DataView(chunk.buffer).setUint32(0, body.length - 4);
  chunk.set(body, 4);
  new DataView(chunk.buffer).setUint32(4 + body.length, crc32(body));
  const out = new Uint8Array(base.length + chunk.length);
  out.set(base.subarray(0, iendAt), 0);
  out.set(chunk, iendAt);
  out.set(base.subarray(iendAt), iendAt + chunk.length);
  return out.buffer;
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** เฟรมที่ถูกตัดกลาง: ลายเซ็นยังครบทุกไบต์ แต่ไม่มี IEND — เคสที่การเช็กลายเซ็นอย่างเดียวปล่อยผ่าน */
export function truncatedPngFrame(): ArrayBuffer {
  const full = new Uint8Array(validPngFrame());
  return full.slice(0, Math.floor(full.length / 2)).buffer;
}

/**
 * ดัชนีเรดาร์รูปแบบเดียวกับ `RADAR_LIST_TEXT` แต่ประทับเวลาให้ใกล้ปัจจุบัน — ใช้
 * กับเทสที่วัด `health` ของ RadarDO ซึ่งขึ้นกับ *อายุ* ของเฟรม ไม่ใช่แค่รูปร่าง
 * ของบรรทัด (ดัชนีตรึงเวลาจะกลายเป็น `delayed` ทันทีที่เวลาผ่านไป)
 *
 * อยู่ในไฟล์ fixture เดียวกันโดยตั้งใจ: รูปแบบบรรทัดของต้นทางถูกเขียนไว้ที่เดียว
 * ถ้า TMD เปลี่ยนรูปแบบ ต้องแก้จุดเดียวแล้วเทสทุกไฟล์ขยับตาม
 */
export const RADAR_DEFAULT_SLOTS: { offsetMin: number; file: string }[] = [
  { offsetMin: 30, file: "zr0022.png" },
  { offsetMin: 15, file: "zr0023.png" },
];

export function radarListAt(nowMs: number, slots = RADAR_DEFAULT_SLOTS): string {
  const slotTime = (offsetMin: number) =>
    new Date(Math.floor((nowMs - offsetMin * 60_000) / 900_000) * 900_000)
      .toISOString()
      .slice(0, 16)
      .replace("T", " ");
  return [
    ...slots.map((s) => `background_THA.png "${slotTime(s.offsetMin)}" overlay=topo_THA.png,${s.file},map_THA_province.png`),
    "",
  ].join("\n");
}

/**
 * เหมือน `radarListAt` แต่เป็นรูปแบบบรรทัดใหม่ของ TMD (`overlay=zr/24.png` ไม่มี
 * ภาพพื้นหลังอื่นในรายการ overlay) — ใช้ตัวปัดเวลา 15 นาทีตัวเดียวกัน
 */
export function radarListZrAt(nowMs: number, slots: { offsetMin: number; file: string }[]): string {
  const slotTime = (offsetMin: number) =>
    new Date(Math.floor((nowMs - offsetMin * 60_000) / 900_000) * 900_000)
      .toISOString()
      .slice(0, 16)
      .replace("T", " ");
  return slots.map((s) => `background_THA.png "${slotTime(s.offsetMin)}" overlay=${s.file}`).join("\n");
}

/** เวลา (ms) ของช่องที่ `radarListAt`/`radarListZrAt` เขียนให้ offset นั้น */
export function radarSlotMs(nowMs: number, offsetMin: number): number {
  return Math.floor((nowMs - offsetMin * 60_000) / 900_000) * 900_000;
}
