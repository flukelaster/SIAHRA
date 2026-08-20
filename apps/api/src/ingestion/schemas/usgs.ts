import * as z from "zod/mini";
import { assertShape } from "../errors.js";

/**
 * USGS GeoJSON summary/FDSN — ฟีดเดียวกันทั้งสองปลายทาง
 *
 * `features: []` ถือว่าถูกต้อง: กรอบ bbox ของไทยไม่มีแผ่นดินไหวในหนึ่งชั่วโมงคือ
 * เรื่องปกติ สิ่งที่ยอมไม่ได้คือ "ไม่มีคีย์ features เลย" ซึ่งเป็นรูปร่างที่โค้ดเดิม
 * ตีความเป็น "ศูนย์เหตุการณ์" แล้วรายงานว่าดึงสำเร็จ
 */
const feature = z.object({
  id: z.string(),
  properties: z.object({
    time: z.number(),
    updated: z.number(),
    type: z.string(),
    mag: z.optional(z.nullable(z.number())),
    magType: z.optional(z.nullable(z.string())),
    place: z.optional(z.nullable(z.string())),
    status: z.optional(z.nullable(z.string())),
    tsunami: z.optional(z.nullable(z.number())),
    url: z.optional(z.nullable(z.string())),
  }),
  // [lon, lat, depthKm] — ความลึกเป็น null ได้ (EarthquakeEvent.depthKm ก็ nullable)
  geometry: z.nullable(
    z.object({
      type: z.string(),
      coordinates: z.tuple([z.number(), z.number(), z.nullable(z.number())], z.unknown()),
    }),
  ),
});

const feed = z.object({ features: z.array(feature) });

export function assertUsgsFeed<T>(data: T, source = "usgs"): T {
  return assertShape(source, feed, data);
}
