import * as z from "zod/mini";
import { assertShape } from "../errors.js";

/**
 * TMD NWP API (`data.tmd.go.th/nwpapi/v1`) — สองรูปร่างที่เราอ่านจริง
 *
 * **คีย์บนสุดคือ `WeatherForecasts` ทั้งสอง endpoint** (วัดจริงด้วย token จริง
 * 2026-08-23) หน้าเอกสารของ TMD เขียนว่า `WeatherForcasts` (สะกดตก) สำหรับ hourly
 * และ `weather_forecast.locations[]` สำหรับ daily — **ผิดทั้งคู่** จึงจงใจไม่เขียน
 * schema แบบรับสองรูป: การเผื่อรูปที่ไม่มีอยู่จริงคือการเปิดทางให้ต้นทางเปลี่ยน
 * รูปแล้วเราอ่านเป็น "ไม่มีข้อมูล" เงียบ ๆ
 *
 * `/region` ตอบมาทั้งภาค หนึ่ง element ต่อหนึ่งจังหวัด — ดังนั้น **อาเรย์ว่าง
 * = รูปร่างเปลี่ยน ไม่ใช่ "ภาคนี้ไม่มีพยากรณ์"** (ตรรกะเดียวกับดัชนีเรดาร์ที่
 * parse ได้ศูนย์ช่อง) `minLength(1)` ที่นี่คือด่านนั้น
 *
 * `data` ปล่อยเป็น record หลวม ๆ โดยตั้งใจ: ฟิลด์ที่ขอมาต่างกันระหว่าง hourly
 * (`tc,rain,cond`) กับ daily (`rain,cond` — daily ของ TMD ไม่มี `tc` เดี่ยว)
 * และตัว mapper แยก "ไม่มีคีย์" ออกจาก "ค่าเป็น 0" ด้วยตัวเอง การบังคับให้มีคีย์
 * ที่นี่จะทำให้ชุดรายวันที่ปกติดีถูกตีว่าพัง
 */
const location = z.object({
  /** รหัสจังหวัด (ตรงกับ PROVINCE_CODES) — ผู้เรียกเป็นคนตรวจว่ารู้จักหรือไม่ */
  geocode: z.string().check(z.minLength(1)),
  province: z.optional(z.nullable(z.string())),
  lat: z.number(),
  lon: z.number(),
});

const step = z.object({
  /** valid time ของค่านั้น — ต้นทางส่งพร้อม offset +07:00 */
  time: z.string().check(z.minLength(1)),
  data: z.record(z.string(), z.unknown()),
});

const regionDocument = z.object({
  WeatherForecasts: z
    .array(z.object({ location, forecasts: z.array(step) }))
    .check(z.minLength(1)),
});

export function assertNwpRegionDocument<T>(value: T): T {
  return assertShape("tmd-nwp", regionDocument, value);
}

/**
 * `GET …/forecast/location/daily` (ไม่มีพารามิเตอร์) — ช่วงวันที่ต้นทางมีข้อมูลให้
 * วัดจริง: `{"daily_data":{"min":"2026-08-23","max":"2026-09-02"}}`
 */
const availabilityDocument = z.object({
  daily_data: z.object({
    min: z.string().check(z.minLength(1)),
    max: z.string().check(z.minLength(1)),
  }),
});

export function assertNwpAvailability<T>(value: T): T {
  return assertShape("tmd-nwp", availabilityDocument, value);
}
