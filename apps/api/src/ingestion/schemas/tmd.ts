import * as z from "zod/mini";
import { UpstreamShapeError, assertShape } from "../errors.js";

/**
 * TMD seismic เป็น **XML** ไม่ใช่ JSON — zod แตะตัวเอกสารไม่ได้ จึงตรวจสองชั้น:
 *
 * 1. เอกสารที่ไม่ว่างแต่ไม่มีบล็อก `<DailyEarthquakes>` เลย = รูปร่างเปลี่ยน
 *    (โค้ดเดิมตีความเป็น "ไม่มีแผ่นดินไหว" แล้วรายงานว่าดึงสำเร็จ)
 * 2. ค่าที่ regex ดึงออกมาได้แล้วต้องอยู่ในพิสัยที่เป็นไปได้ — ค่าที่แปลงเป็นตัวเลข
 *    ไม่ได้จะกลายเป็น null ตั้งแต่ตัวแปลง จึงถูกข้ามเหมือนเดิม (แถวที่ไม่ครบฟิลด์
 *    เป็นเรื่องปกติของฟีดนี้) แต่ละติจูด 999 คือรูปร่าง/หน่วยที่เปลี่ยน ไม่ใช่ค่าว่าง
 */
const record = z.object({
  lat: z.nullable(z.number().check(z.gte(-90), z.lte(90))),
  lon: z.nullable(z.number().check(z.gte(-180), z.lte(180))),
  timeMs: z.nullable(z.number()),
  mag: z.nullable(z.number().check(z.gte(-2), z.lte(10))),
  depthKm: z.nullable(z.number().check(z.gte(-1), z.lte(1000))),
});

export interface TmdSeismicRecord {
  lat: number | null;
  lon: number | null;
  timeMs: number | null;
  mag: number | null;
  depthKm: number | null;
}

export function assertTmdDocument(xml: string, blockCount: number): void {
  if (xml.trim() === "") {
    throw new UpstreamShapeError("tmd", "<document>", "empty body");
  }
  if (blockCount === 0) {
    throw new UpstreamShapeError("tmd", "DailyEarthquakes", "no <DailyEarthquakes> block in a non-empty document");
  }
}

export function assertTmdRecord(rec: TmdSeismicRecord, index: number): TmdSeismicRecord {
  return assertShape("tmd", record, rec, `DailyEarthquakes.${index}`);
}
