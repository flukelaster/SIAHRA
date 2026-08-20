import * as z from "zod/mini";
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
const slot = z.object({
  tsMs: z.number(),
  file: z.string().check(z.regex(/^zr\d{4}\.png$/)),
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

/** โยน `UpstreamShapeError` ถ้าไบต์ที่ได้ไม่ใช่ PNG ที่สมบูรณ์ (ชื่อไฟล์อยู่ในข้อความ) */
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
  return bytes;
}
