/**
 * URL และตัวถอดไทล์ของ pyramid ภูมิประเทศ/สิ่งปกคลุมดิน — ที่เดียวที่ทั้งตัววาด
 * (`scene/TerrainTiles.ts`, `scene/VegetationTiles.ts`) และการคำนวณแผ่นน้ำ 30 ม.
 * (`workers/stationSheet.worker.ts`, E16 B-1) ใช้ร่วมกัน
 *
 * ทำไมต้องแชร์ (ข้อจำกัดต้นทุน devops C5 ของงานแผ่นน้ำ 30 ม.): URL ที่ worker ขอต้อง
 * **ตรงทุกไบต์** กับที่ตัววาดขอ เพื่อให้ใช้ HTTP cache ของเบราว์เซอร์ร่วมกัน — ไทล์ที่ภูมิประเทศ
 * โหลดไปแล้วจึงไม่ถูกขอซ้ำจาก R2 และกลับกัน ไม่มี query string ไม่มี header ไม่มีโหมด cache พิเศษ
 *
 * ไฟล์นี้ **ห้าม import three** (ถูกใช้ใน worker และเทสใน node)
 */

/** แทน `{z}`/`{x}`/`{y}` ใน `urlTemplate` ของ manifest (แต่ละตัวครั้งแรกเท่านั้น — พฤติกรรมเดิมของตัววาด) */
export function tileUrl(template: string, z: number, x: number, y: number): string {
  return template.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}

/** ถอด bitset `present` (base64, แถวต่อแถว y·tilesX + x) ของระดับหนึ่งใน pyramid */
export function decodePresentBits(present: string): Uint8Array {
  const bin = atob(present);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** บิตของไทล์ `(x, y)` ใน bitset ที่ถอดแล้ว — นอกช่วง = ไม่มี */
export function presentBit(bits: Uint8Array, tilesX: number, tilesY: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= tilesX || y >= tilesY) return false;
  const idx = y * tilesX + x;
  return (bits[idx >> 3] & (1 << (idx & 7))) !== 0;
}

/** จำนวนตัวอย่างต่อแถวของไทล์ภูมิประเทศ (tileSize + 1 + 2·border) */
export function terrainTileSpan(tileSize: number, border: number): number {
  return tileSize + 1 + border * 2;
}

/**
 * ไทล์ภูมิประเทศ (Int16 LE, เมตรเต็ม, `nodata` = −32768) — `null` เมื่อความยาวไม่ตรง
 * (โฮสต์ static อาจตอบ SPA shell แทนไฟล์ที่ไม่มี ซึ่งต้องนับเป็น "ไม่มีไทล์")
 */
export function decodeTerrainTile(buf: ArrayBuffer, tileSize: number, border: number): Int16Array | null {
  const span = terrainTileSpan(tileSize, border);
  if (buf.byteLength !== span * span * 2) return null;
  return new Int16Array(buf);
}

/**
 * ไทล์สิ่งปกคลุมดิน WorldCover (หนึ่งไบต์ต่อเซลล์, tileSize², ไม่มีขอบ, แถว 0 = เหนือ)
 * — `null` เมื่อความยาวไม่ตรง
 */
export function decodeLandcoverTile(buf: ArrayBuffer, tileSize: number): Uint8Array | null {
  if (buf.byteLength !== tileSize * tileSize) return null;
  return new Uint8Array(buf);
}
