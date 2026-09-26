import * as z from "zod/mini";
import { assertShape } from "../errors.js";
import { numeric, text } from "./common.js";

/**
 * GISTDA API gateway — `resources/features/flood/{window}` (E16.PR0)
 *
 * `features: []` ยังถือว่าถูกต้อง — จังหวัดที่ภาพรอบนี้ไม่พบน้ำท่วมเป็นเรื่องปกติ (วัดจริง
 * 2026-09-26: pv_idn 10/12/13 ได้ 0 ทุกหน้าต่าง) สิ่งที่ยอมไม่ได้คือไม่มีคีย์ `features`
 * (เคยถูกแปลงเป็นฉากว่างแล้วเขียนทับฉากล่าสุด) `links` ไม่ถูกตรวจและไม่ถูกอ่านเลย —
 * มันสะท้อนกุญแจกลับมาเป็น `?api_key=`
 */
const envelope = z.object({
  features: z.array(z.unknown()),
  numberMatched: numeric,
  numberReturned: numeric,
});

const feature = z.object({
  properties: z.optional(
    z.nullable(
      z.object({
        pv_idn: numeric,
        ap_idn: numeric,
        tb_idn: numeric,
        pv_tn: text,
        ap_tn: text,
        tb_tn: text,
        f_area: numeric,
        h3_address: text,
        file_name: text,
        _createdAt: text,
      }),
    ),
  ),
  geometry: z.nullable(
    z.object({
      type: z.string(),
      // MultiPolygon ซ้อนหลายชั้น — ตรวจแค่ว่าเป็นอาเรย์ที่ไม่ว่าง การเดินตรวจทุกพิกัดของ
      // หลายหมื่นเซลล์แพงเกินประโยชน์ projection ข้ามพิกัดที่ไม่ใช่ตัวเลขเองอยู่แล้ว
      coordinates: z.array(z.unknown()).check(z.minLength(1)),
    }),
  ),
});

export function assertGistdaEnvelope<T>(body: T): T {
  return assertShape("gistda", envelope, body);
}

export function assertGistdaFeature<T>(f: T, index: number): T {
  return assertShape("gistda", feature, f, `features.${index}`);
}
