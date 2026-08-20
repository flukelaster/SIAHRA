import * as z from "zod/mini";
import { assertShape } from "../errors.js";
import { numeric, text } from "./common.js";

/**
 * GISTDA WFS (GeoJSON FeatureCollection)
 *
 * `features: []` ยังถือว่าถูกต้อง — หน้าแล้งที่ไม่มีพื้นที่น้ำท่วมเลยเป็นไปได้จริง
 * สิ่งที่ยอมไม่ได้คือไม่มีคีย์ `features` (โค้ดเดิมแปลงเป็นฉากว่างแล้วเขียนทับ
 * ฉากล่าสุดใน R2) — ตรวจทีละ feature เพราะ payload มีหลายร้อยรูปหลายเหลี่ยม
 */
const envelope = z.object({ features: z.array(z.unknown()) });

const feature = z.object({
  id: z.optional(z.nullable(z.string())),
  properties: z.optional(
    z.nullable(
      z.object({
        TB_IDN: numeric,
        PV_IDN: numeric,
        TB_TN: text,
        AP_TN: text,
        PV_TN: text,
        flood_area: numeric,
        house: numeric,
        lat: numeric,
        long: numeric,
      }),
    ),
  ),
  geometry: z.nullable(
    z.object({
      type: z.string(),
      // MultiPolygon/Polygon ซ้อนกันหลายชั้น — ตรวจแค่ว่าเป็นอาเรย์ที่ไม่ว่าง
      // การเดินตรวจทุกพิกัดของ 359 รูปหลายเหลี่ยมแพงเกินประโยชน์ที่ได้
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
