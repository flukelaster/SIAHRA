import type { HazardLayerDescriptor } from "./hazard-layer.js";
import type { SituationLevel } from "./observations.js";

/**
 * มุมมองตามลุ่มน้ำ — `GET /api/v1/basins` (ทั้งประเทศ คำขอเดียว ไม่ใช่ต่อจังหวัด)
 *
 * **การจัดกลุ่มคือป้ายลุ่มน้ำของ ThaiWater (`basinNameTh`) เท่านั้น** ไม่ใช่ขอบเขตลุ่มน้ำของ SIAHRA
 * และไม่ใช่ข้อมูลที่เราสร้างเอง: ไม่มีลำดับต้นน้ำ→ปลายน้ำ (ต้นทางไม่ให้ไว้ และการเรียงตามความสูงจะเป็น
 * ระยะทางลำน้ำที่แต่งขึ้น), ไม่มีเวลาที่น้ำจะมาถึง, ไม่มีค่าล่วงหน้าใด ๆ — ทุกค่าในสถานี/เขื่อนเป็นค่าที่
 * ต้นทางรายงานตามที่รับมา (`observed`)
 *
 * การทำให้ชื่อเป็นคีย์เดียวกัน (`BasinGroup.key`): `trim()` แล้วตัดคำนำหน้า "ลุ่มน้ำ" **หนึ่งครั้ง**
 * เท่านั้น (ต้นทางเขียนทั้ง "ลุ่มน้ำปิง" และ "ปิง") — ชื่อที่ต่างกันไม่ถูกรวมกันไม่ว่ากรณีใด
 * ส่วน `nameTh` คือข้อความที่ต้นทางเขียนไว้จริง (ตัวที่พบมากสุดในกลุ่ม เสมอกันเลือกตามลำดับรหัสอักขระ)
 *
 * สามที่ที่สถานี/เขื่อนไปอยู่ — ไม่มีอันไหนถูกทิ้งเงียบ ๆ:
 * - `basins[]`        ลุ่มน้ำที่ต้นทางระบุ
 * - `outsideThailand` ต้นทางเขียนว่า "นอกประเทศไทย" — **ไม่ใช่ลุ่มน้ำ** แสดงแยกและเรียกตามนั้น
 * - `unassigned`      ต้นทางไม่ระบุลุ่มน้ำ (null / ว่าง) — อาจว่างวันนี้ แต่ต้องนับและแสดงเมื่อมี
 */

/** สถานีวัดระดับน้ำหนึ่งแห่ง — ค่าตามที่ ThaiWater ส่งมา ไม่ประมาณ ไม่ปรับ */
export interface BasinStation {
  /** `station.id` ของ ThaiWater (เนมสเปซระดับน้ำ ไม่ใช่สถานีฝน) */
  id: number;
  nameTh: string | null;
  provinceCode: string | null;
  lat: number;
  lon: number;
  /** ม.รทก. — null = ไม่มีค่า (ไม่ใช่ 0) */
  waterlevelMsl: number | null;
  /** ระยะต่ำกว่าตลิ่งต่ำสุด (ม.) ตามที่ต้นทางให้ — null = ไม่มีค่า */
  freeboardM: number | null;
  /** ระดับสถานการณ์ที่ ThaiWater เผยแพร่ (1–5) — null = ไม่มี */
  situationLevel: SituationLevel | null;
  dischargeM3s: number | null;
  qmaxM3s: number | null;
  /** เวลาตรวจวัดของค่านี้ — null = ต้นทางไม่ระบุ */
  observedAt: string | null;
}

/** อ่างเก็บน้ำ/เขื่อนหนึ่งแห่ง — ค่าตามที่ ThaiWater ส่งมา */
export interface BasinDam {
  id: number;
  nameTh: string | null;
  nameEn: string | null;
  kind: "large" | "medium";
  provinceCode: string | null;
  storagePercent: number | null;
  storageMcm: number | null;
  observedAt: string | null;
}

/** ที่ที่สถานีและเขื่อนไปอยู่ — เรียงตาม id จากน้อยไปมาก (ผลเดียวกันทุกครั้งสำหรับข้อมูลชุดเดียวกัน) */
export interface BasinBucket {
  stations: BasinStation[];
  dams: BasinDam[];
}

export interface BasinGroup extends BasinBucket {
  /** ชื่อที่ทำให้เป็นคีย์แล้ว (trim + ตัด "ลุ่มน้ำ" นำหน้าหนึ่งครั้ง) — ไม่เคยว่าง */
  key: string;
  /** ข้อความที่ต้นทางเขียนไว้จริง (เช่น "ลุ่มน้ำปิง") */
  nameTh: string;
}

export interface BasinsResponse {
  /**
   * `observed`, `sourceIds: ["thaiwater"]` — `fetchedAt` = รอบดึงระดับน้ำสำเร็จล่าสุด **ณ ตอนที่แถวนี้ถูกสร้าง**
   * (null = ยังไม่เคยสำเร็จ ห้ามแสดงเป็น "ตอนนี้"), `observedAt` = เวลาตรวจวัดใหม่สุดของสถานี
   */
  layer: HazardLayerDescriptor;
  /** เวลาที่ดึงระดับน้ำ (waterlevel) สำเร็จล่าสุด ณ ตอนสร้างแถวนี้ — null = ยังไม่เคยดึงสำเร็จ */
  fetchedAt: string | null;
  /**
   * เวลาที่ดึงเขื่อนสำเร็จล่าสุด — **แยกจาก `fetchedAt`**: เขื่อนถูกดึงแบบ lazy (เมื่อมีคนขอ `/api/v1/dams`)
   * ไม่ได้ดึงทุกรอบ จึงเก่ากว่า/ไม่มีได้ null = ไม่เคยดึง ไม่ใช่ "ไม่มีเขื่อน" (ผู้ใช้ต้องเห็นและหรี่แถวเขื่อน)
   */
  damsFetchedAt: string | null;
  /** เรียงจากจำนวนสถานีมากไปน้อย เสมอกันเรียงตาม `key` ตามรหัสอักขระ */
  basins: BasinGroup[];
  /** ต้นทางเขียนว่า "นอกประเทศไทย" — ไม่ใช่ลุ่มน้ำ */
  outsideThailand: BasinBucket;
  /** ต้นทางไม่ระบุลุ่มน้ำ (null / ว่าง) */
  unassigned: BasinBucket;
  /**
   * เหตุที่รอบสร้างล่าสุดไม่ได้เขียนแถวใหม่ (เช่น ขนาดเกินเพดาน) — แถวที่ถืออยู่ยังเป็นของรอบก่อนพร้อม `fetchedAt` เก่า
   * null = ไม่มีปัญหา ฟิลด์นี้ไม่ถูกเก็บในแถว: มีเฉพาะคำตอบ "ยังไม่มีแถว" ที่ route สร้างเอง
   */
  buildError?: string | null;
}

/** ชื่อกลุ่มที่ต้นทางใช้แทน "อยู่นอกประเทศ" — เทียบหลังทำให้เป็นคีย์แล้ว */
export const BASIN_OUTSIDE_THAILAND_KEY = "นอกประเทศไทย";
/** คำนำหน้าที่ตัดหนึ่งครั้งตอนทำคีย์ */
export const BASIN_NAME_PREFIX = "ลุ่มน้ำ";
