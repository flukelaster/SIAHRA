import * as z from "zod/mini";
import { assertShape } from "../errors.js";

/**
 * EMSC/seismicportal FDSN — โครงเดียวกับ GeoJSON แต่พิกัดอยู่ใน properties
 *
 * ต้นทางตอบ 204 (ไม่มี body) เมื่อไม่มีเหตุการณ์ ตัว adapter จึงต้องลัดออกก่อน
 * ถึงจุดตรวจนี้ — 204 ไม่ใช่ payload ที่ผิดรูป
 */
const feature = z.object({
  properties: z.object({
    unid: z.string(),
    time: z.string(),
    lastupdate: z.string(),
    lat: z.number(),
    lon: z.number(),
    depth: z.nullable(z.number()),
    mag: z.optional(z.nullable(z.number())),
    magtype: z.optional(z.nullable(z.string())),
    flynn_region: z.optional(z.nullable(z.string())),
  }),
});

const feed = z.object({ features: z.array(feature) });

export function assertEmscFeed<T>(data: T): T {
  return assertShape("emsc", feed, data);
}
