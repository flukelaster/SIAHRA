import * as z from "zod/mini";
import type { RadarProjection } from "@siahra/shared-types";
import { UpstreamShapeError, assertShape } from "../errors.js";

/**
 * เรดาร์ TMD มีสอง payload คนละชนิด และตรวจคนละแบบ:
 *
 * 1. **ดัชนี** (`images_composite.list`) เป็นข้อความ — ตรวจ "ผลของการ parse"
 *    ว่ายังได้ slot ออกมาอย่างน้อยหนึ่งช่อง ถ้าต้นทางเปลี่ยนรูปแบบบรรทัด regex
 *    จะได้ศูนย์ช่อง ซึ่งโค้ดเดิมตีเป็น "ไม่มีเฟรมใหม่" แล้วรายงานว่าดึงสำเร็จ
 * 2. **เฟรม** เป็นไบต์ PNG — zod ไม่มีประโยชน์ ตรวจลายเซ็นและท้ายไฟล์เอง
 *    ต้องเช็ก IEND ด้วย ไม่ใช่แค่ลายเซ็น เพราะไฟล์ที่ถูกตัดกลาง (truncated)
 *    ยังมีลายเซ็นครบทุกไบต์ — นั่นคือกรณีที่เรากลัวจริง ๆ
 */
/**
 * ชื่อไฟล์ของช่องเรดาร์ — รับทั้งรูปแบบเดิม `zr0023.png` และรูปแบบที่ TMD ใช้
 * ตั้งแต่ราว 2026-09-02 `zr/24.png` (วัดจริง 2026-09-27) ตัว anchor ทั้งสองฝั่ง
 * คือด่านกันเส้นทางด้วย เพราะชื่อนี้ถูกต่อเข้า URL ของภาพตรง ๆ
 */
export const RADAR_FILE_RE = /^zr(?:\/\d{1,3}|\d{4})\.png$/;

const slot = z.object({
  tsMs: z.number(),
  file: z.string().check(z.regex(RADAR_FILE_RE)),
});

const index = z.object({
  slots: z.array(slot).check(z.minLength(1)),
  publishedAt: z.nullable(z.string()),
});

export function assertRadarIndex<T>(value: T): T {
  return assertShape("tmd-radar", index, value);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** ลายเซ็น 8 + IHDR ขั้นต่ำ 25 + IEND 12 ไบต์ */
const MIN_PNG_BYTES = 45;

/**
 * ขนาดภาพที่รู้ว่าวางลงพื้นอย่างไร (ดูหัวไฟล์ `tmdRadar.ts`) — ขนาดอื่นทุกขนาด
 * ถูกปฏิเสธ เพราะภาพที่ไม่รู้ georeference ห้ามถูกวาดด้วยกรอบที่เดาเอา
 */
const PROJECTION_BY_SIZE: Readonly<Record<string, RadarProjection>> = {
  "1800x2644": "web-mercator",
  "1173x1668": "equirectangular",
};

/** อ่านกว้าง×สูงจาก IHDR (chunk แรกเสมอตามสเปก PNG) — ไม่ใช่ IHDR = ไม่ใช่ PNG ที่ถูกต้อง */
function ihdrSize(view: Uint8Array, file: string): { width: number; height: number } {
  const dv = new DataView(view.buffer, view.byteOffset, view.byteLength);
  if (dv.getUint32(8) !== 13 || String.fromCharCode(...view.subarray(12, 16)) !== "IHDR") {
    throw new UpstreamShapeError("tmd-radar", `frame.${file}`, "PNG does not start with an IHDR chunk");
  }
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

/**
 * projection ของเฟรมตามขนาดใน IHDR — โยน `UpstreamShapeError` ถ้าขนาดไม่ใช่
 * ขนาดที่รู้จัก (เรียกหลัง `assertRadarFrame` ผ่านแล้ว)
 */
export function radarFrameProjection(bytes: ArrayBuffer, file: string): RadarProjection {
  const { width, height } = ihdrSize(new Uint8Array(bytes), file);
  const projection = PROJECTION_BY_SIZE[`${width}x${height}`];
  if (!projection) {
    throw new UpstreamShapeError("tmd-radar", `frame.${file}`, `unexpected size ${width}x${height} (no known georeference)`);
  }
  return projection;
}

/**
 * โยน `UpstreamShapeError` ถ้าไบต์ที่ได้ไม่ใช่ PNG ที่สมบูรณ์ หรือขนาดใน IHDR
 * ไม่ใช่ขนาดที่รู้ georeference (ชื่อไฟล์อยู่ในข้อความ)
 */
export function assertRadarFrame(bytes: ArrayBuffer, file: string): ArrayBuffer {
  const view = new Uint8Array(bytes);
  if (view.byteLength < MIN_PNG_BYTES) {
    throw new UpstreamShapeError("tmd-radar", `frame.${file}`, `truncated PNG (${view.byteLength} bytes)`);
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (view[i] !== PNG_SIGNATURE[i]) {
      throw new UpstreamShapeError("tmd-radar", `frame.${file}`, "not a PNG (bad signature)");
    }
  }
  const tail = view.subarray(view.byteLength - 8, view.byteLength - 4);
  if (String.fromCharCode(...tail) !== "IEND") {
    throw new UpstreamShapeError("tmd-radar", `frame.${file}`, "truncated PNG (no IEND chunk)");
  }
  radarFrameProjection(bytes, file);
  return bytes;
}
