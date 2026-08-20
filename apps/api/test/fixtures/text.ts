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

/** PNG 1×1 ที่ถูกต้องครบทั้งลายเซ็น, IHDR, IDAT และ IEND */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export function validPngFrame(): ArrayBuffer {
  const binary = atob(PNG_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
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
