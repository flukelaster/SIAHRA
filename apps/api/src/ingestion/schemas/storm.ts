import * as z from "zod/mini";
import { assertShape } from "../errors.js";
import { numeric, text } from "./common.js";

/**
 * รูปร่างของสองต้นทางเส้นทางพายุ (วัดจริง 2026-09-26 — fixture ใน
 * `test/fixtures/storm/`) ตามหลักของโฟลเดอร์นี้: หลวมเท่าที่ mapper ทนได้
 * เข้มเฉพาะสิ่งที่ mapper ต้องพึ่ง
 *
 * **JMA bosai ไม่มีเอกสาร schema** — ด่านนี้จึงสำคัญกว่าปกติ: ถ้าวันหนึ่ง JMA
 * เปลี่ยนรูป ต้องได้ `UpstreamShapeError` ที่บอก path (แล้ว DO คงสำเนาเดิมไว้
 * พร้อม `lastError`) ไม่ใช่รายการพายุว่างที่อ่านได้ว่า "ไม่มีพายุ"
 */

/** [lat, lon] — ลำดับของ JMA (ละติจูดก่อน) ไม่ใช่ GeoJSON */
const latLon = z.tuple([z.number(), z.number()]);

/** `targetTc.json` — รายการพายุที่ JMA กำลังติดตาม อาเรย์ว่าง = ไม่มีพายุ (รูปที่ถูกต้อง) */
const jmaTargetList = z.array(
  z.object({
    // รหัสนี้ถูกต่อเข้า URL ของคำขอถัดไป — บังคับรูปตรงนี้ ขยะจึงไม่มีทางกลายเป็น path
    tropicalCyclone: z.string().check(z.regex(/^TC\d{4}$/)),
    typhoonNumber: text,
    category: text,
    issue: text,
  }),
);

export function assertJmaTargetList<T>(value: T): T {
  return assertShape("jma-typhoon targetTc", jmaTargetList, value);
}

const enJp = z.optional(z.nullable(z.object({ en: text, jp: text })));
const utcTime = z.optional(z.nullable(z.object({ UTC: text, JST: text })));

/**
 * `TC{id}/specifications.json` — ส่วนแรกคือหัวเรื่อง (`part: "title"` + `issue`)
 * ที่เหลือคือตำแหน่งวิเคราะห์ (`advancedHours: 0`) และตำแหน่งพยากรณ์ ตัวเลขลม/ความกด
 * เป็น **สตริง** (`"55"`, `"990"`, `"-"`) — mapper เป็นคนแปลง
 */
const jmaSpecPart = z.object({
  part: z.union([z.string(), enJp]),
  issue: utcTime,
  name: enJp,
  category: enJp,
  advancedHours: z.optional(z.number()),
  position: z.optional(z.nullable(z.object({ deg: latLon }))),
  validtime: utcTime,
  pressure: numeric,
  probabilityCircleRadius: z.optional(z.nullable(z.object({ km: numeric }))),
  maximumWind: z.optional(
    z.nullable(z.object({ sustained: z.optional(z.nullable(z.object({ kt: numeric }))) })),
  ),
});
const jmaSpecifications = z.array(jmaSpecPart).check(z.minLength(2));

export function assertJmaSpecifications<T>(value: T): T {
  return assertShape("jma-typhoon specifications", jmaSpecifications, value);
}

/** `TC{id}/forecast.json` — ใช้เฉพาะเส้นทางที่ผ่านมา (`track`) ในส่วนวิเคราะห์ */
const jmaForecastPart = z.object({
  advancedHours: z.optional(z.number()),
  track: z.optional(
    z.nullable(
      z.object({
        preTyphoon: z.optional(z.nullable(z.array(latLon))),
        typhoon: z.optional(z.nullable(z.array(latLon))),
      }),
    ),
  ),
});
const jmaForecast = z.array(jmaForecastPart).check(z.minLength(1));

export function assertJmaForecast<T>(value: T): T {
  return assertShape("jma-typhoon forecast", jmaForecast, value);
}

/**
 * GDACS `geteventlist` — `iscurrent` เป็น **สตริง** `"true"`/`"false"` (วัดจริง)
 * รับทั้งสตริงและ boolean เผื่อ API ของเขาแก้ให้ถูกชนิด แต่ไม่รับค่าอื่น
 */
const gdacsEventList = z.object({
  features: z.array(
    z.object({
      geometry: z.object({ type: z.string(), coordinates: z.array(z.number()) }),
      properties: z.object({
        eventtype: z.string(),
        eventid: z.number(),
        episodeid: z.number(),
        eventname: text,
        iscurrent: z.optional(z.nullable(z.union([z.string(), z.boolean()]))),
        alertlevel: text,
        severitydata: z.optional(z.nullable(z.object({ severitytext: text }))),
        url: z.optional(z.nullable(z.object({ report: text }))),
      }),
    }),
  ),
});

export function assertGdacsEventList<T>(value: T): T {
  return assertShape("gdacs-tc eventlist", gdacsEventList, value);
}

/** GDACS `getgeometry` — ฟีเจอร์หลายชนิดปนกัน แยกด้วย `properties.Class` */
const gdacsGeometry = z.object({
  features: z.array(
    z.object({
      geometry: z.optional(z.nullable(z.object({ type: z.string(), coordinates: z.unknown() }))),
      properties: z.object({
        Class: text,
        polygondate: text,
        key: text,
        polygonlabel: text,
      }),
    }),
  ),
});

export function assertGdacsGeometry<T>(value: T): T {
  return assertShape("gdacs-tc geometry", gdacsGeometry, value);
}
