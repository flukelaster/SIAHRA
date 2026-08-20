import * as z from "zod/mini";

/**
 * Schema ทั้งหมดในโฟลเดอร์นี้ใช้ `zod/mini` ไม่ใช่ `zod` ตัวเต็ม — วัดขนาด bundle
 * จริงด้วย `wrangler deploy --dry-run` แล้ว zod ตัวเต็มบวกเข้ามา ~83 KB gzipped
 * (ทะลุเพดาน 60 KB ของ roadmap ไปเท่าตัว) ส่วน `zod/mini` บวก ~6.5 KB
 *
 * หลักการเขียน schema ที่นี่: **หลวมเท่าที่ mapper ทนได้ เข้มเฉพาะสิ่งที่ mapper
 * ต้องพึ่ง** ถ้าเข้มเกินจริง ต้นทางที่ยังดีอยู่จะถูกตีว่าพัง แล้วบันไดสุขภาพจะ
 * รายงานผิด (เช่น ฟีดแผ่นดินไหวจะกลายเป็น `down` ทั้งที่ปัญหาจริงคือ TMD ไม่มีคีย์)
 */

/** ตัวเลขที่ต้นทางส่งมาเป็น number หรือ string ก็ได้ (ThaiWater/GISTDA ปนกันทั้งคู่) */
export const numeric = z.optional(z.nullable(z.union([z.number(), z.string()])));

/** ข้อความที่อาจไม่มี/เป็น null */
export const text = z.optional(z.nullable(z.string()));

/** ชื่อสองภาษาแบบที่ ThaiWater ใช้ทุกที่ */
export const localizedName = z.optional(
  z.nullable(z.object({ th: text, en: text })),
);
