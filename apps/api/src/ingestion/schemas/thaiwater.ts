import * as z from "zod/mini";
import { UpstreamShapeError, assertShape } from "../errors.js";
import { localizedName, numeric, text } from "./common.js";

/**
 * ThaiWater ส่ง payload 2–4 MB (~5,900 สถานี) ต่อหนึ่งรอบ — จึงตรวจแบบ **สองชั้น
 * และ lazy ต่อระเบียน**: ชั้นนอกตรวจ "ซองจดหมาย" (คีย์ container มีจริงและเป็น
 * array) ครั้งเดียว ส่วนชั้นในตรวจทีละระเบียนใน loop ที่ mapper เดินอยู่แล้ว
 * ไม่ต้องสร้าง schema ทั้งเอกสารและไม่ต้อง walk ซ้ำสองรอบ
 *
 * ทำไมต้องตรวจซองจดหมาย: `{}` ทำให้โค้ดเดิมได้ `records = []` แล้วรายงานว่า
 * "ดึงสำเร็จ ศูนย์สถานี" — fetchedAt ถูกประทับใหม่ทับข้อมูลเก่า และ /health
 * ขึ้น `ok` ทั้งที่เราไม่ได้ข้อมูลอะไรมาเลย ซึ่งผิดกฎความซื่อสัตย์ของข้อมูล
 *
 * ทำไม array ว่างถึงถือว่าผิดสำหรับฟีดนี้: rain_24h/waterlevel_load เป็นฟีดระดับ
 * ประเทศที่มีสถานีหลายพันตัวตลอดเวลา — "ศูนย์สถานีทั้งประเทศ" ไม่ใช่สภาพที่
 * เป็นไปได้ (ต่างจากฟีดแผ่นดินไหว ซึ่งศูนย์เหตุการณ์คือเรื่องปกติ)
 */
/*
 * ข้อความต้องอ่านออกว่า "ต้นทางส่งศูนย์สถานี" ไม่ใช่ `too_small: expected array to
 * have >=1 items` — คนที่มาอ่าน lastError ต้องแยกออกทันทีว่าเป็น "ต้นทางว่าง"
 * (รอรอบหน้า) หรือ "ต้นทางเปลี่ยนรูป" (ต้องแก้ schema) ซึ่งเป็นคนละงานกันคนละคน
 */
const nonEmptyRows = z
  .array(z.unknown())
  .check(z.minLength(1, "zero stations nationwide is not a real state"));

const rainEnvelope = z.object({ data: nonEmptyRows });
const waterEnvelope = z.object({ waterlevel_data: z.object({ data: nonEmptyRows }) });
const graphEnvelope = z.object({ data: z.object({ graph_data: z.array(z.unknown()) }) });

const station = z.optional(
  z.nullable(
    z.object({
      id: numeric,
      tele_station_name: localizedName,
      tele_station_lat: numeric,
      tele_station_long: numeric,
      min_bank: numeric,
      ground_level: numeric,
    }),
  ),
);

const geocode = z.optional(
  z.nullable(
    z.object({
      province_code: numeric,
      province_name: localizedName,
      amphoe_name: localizedName,
    }),
  ),
);

const baseRecord = {
  id: numeric,
  station,
  geocode,
  basin: z.optional(z.nullable(z.object({ basin_name: localizedName }))),
  agency: z.optional(z.nullable(z.object({ agency_shortname: localizedName }))),
};

const rainRecord = z.object({
  ...baseRecord,
  rain_24h: numeric,
  rain_1h: numeric,
  rainfall_datetime: text,
});

const waterRecord = z.object({
  ...baseRecord,
  waterlevel_datetime: text,
  waterlevel_msl: numeric,
  waterlevel_m: numeric,
  storage_percent: numeric,
  situation_level: numeric,
});

const graphPoint = z.object({
  datetime: text,
  value: numeric,
  discharge: numeric,
});

const damRecord = z.object({
  dam_date: text,
  dam_storage: numeric,
  dam_storage_percent: numeric,
  dam_inflow: numeric,
  dam_released: numeric,
  station_type: text,
  dam: z.optional(
    z.nullable(
      z.object({
        id: numeric,
        dam_name: localizedName,
        dam_lat: numeric,
        dam_long: numeric,
        max_storage: numeric,
        normal_storage: numeric,
      }),
    ),
  ),
  agency: z.optional(z.nullable(z.object({ agency_shortname: localizedName }))),
  basin: z.optional(z.nullable(z.object({ basin_name: localizedName }))),
  geocode,
});

const damEnvelope = z.object({
  data: z.object({
    dam_hourly: z.optional(z.nullable(z.array(z.unknown()))),
    dam_daily: z.optional(z.nullable(z.array(z.unknown()))),
    dam_medium: z.optional(z.nullable(z.array(z.unknown()))),
  }),
});

export function assertRainEnvelope<T>(body: T): T {
  return assertShape("thaiwater rain_24h", rainEnvelope, body);
}
export function assertRainRecord<T>(record: T, index: number): T {
  return assertShape("thaiwater rain_24h", rainRecord, record, `data.${index}`);
}

export function assertWaterEnvelope<T>(body: T): T {
  return assertShape("thaiwater waterlevel_load", waterEnvelope, body);
}
export function assertWaterRecord<T>(record: T, index: number): T {
  return assertShape("thaiwater waterlevel_load", waterRecord, record, `waterlevel_data.data.${index}`);
}

export function assertGraphEnvelope<T>(body: T): T {
  return assertShape("thaiwater waterlevel_graph", graphEnvelope, body);
}
export function assertGraphPoint<T>(point: T, index: number): T {
  return assertShape("thaiwater waterlevel_graph", graphPoint, point, `data.graph_data.${index}`);
}

/**
 * เขื่อนมาเป็นสามอาเรย์ (รายชั่วโมง/รายวัน/ขนาดกลาง) ต้นทางอาจไม่ส่งครบทั้งสาม
 * แต่ต้องมีอย่างน้อยหนึ่งแถว — เพราะ `refreshDams` ล้างตารางก่อนเขียนทับ
 * "ศูนย์เขื่อน" ที่ผ่านเข้าไปได้จึงเท่ากับลบข้อมูลที่ถืออยู่ทิ้งทั้งหมด
 */
export function assertDamEnvelope<T>(body: T): T {
  const checked = assertShape("thaiwater analyst/dam", damEnvelope, body) as {
    data?: { dam_hourly?: unknown[] | null; dam_daily?: unknown[] | null; dam_medium?: unknown[] | null };
  };
  const total =
    (checked.data?.dam_hourly?.length ?? 0) +
    (checked.data?.dam_daily?.length ?? 0) +
    (checked.data?.dam_medium?.length ?? 0);
  if (total === 0) {
    throw new UpstreamShapeError("thaiwater analyst/dam", "data", "no dam rows in any of dam_hourly/dam_daily/dam_medium");
  }
  return body;
}

export function assertDamRecord<T>(record: T, group: string, index: number): T {
  return assertShape("thaiwater analyst/dam", damRecord, record, `data.${group}.${index}`);
}
