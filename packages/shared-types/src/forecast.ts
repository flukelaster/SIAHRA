import type { HazardLayerDescriptor } from "./hazard-layer.js";

/**
 * One forecast step from TMD's numerical weather model (NWP), as the upstream
 * returned it — deterministic values valid at a future instant, not probabilities.
 *
 * A field TMD did not return is `null`, never `0`: "no rain forecast" and "TMD
 * did not send a rain field" are different statements, and zero would silently
 * turn the second one into the first.
 */
export interface ForecastStep {
  /** เวลาที่ค่านี้ "มีผล" (valid time, ISO) — ไม่ใช่เวลาที่แบบจำลองรัน */
  validAt: string;
  /**
   * ปริมาณฝน — หน่วยต่างกันตามชุดที่มันอยู่:
   * ใน `hourly` คือ มม./ชม. · ใน `daily` คือ มม./24 ชม.
   * null = ต้นทางไม่ได้ส่งค่านี้มา (ห้ามอ่านเป็น 0)
   */
  rainMm: number | null;
  /** อุณหภูมิ (°C) — null = ต้นทางไม่ได้ส่งค่านี้มา */
  tempC: number | null;
  /** รหัสลักษณะอากาศตามตารางของ TMD — null = ต้นทางไม่ได้ส่งค่านี้มา */
  cond: number | null;
}

/** ผลพยากรณ์ของหนึ่งจังหวัดจากการดึงหนึ่งครั้ง */
export interface ProvinceForecastBatch {
  provinceCode: string;
  /**
   * รหัสของ "รอบที่เราดึง" ไม่ใช่รหัสรอบรันของแบบจำลอง — TMD ไม่เผยแพร่ run id
   * หรือ cycle ใด ๆ ผ่าน NWP API ค่านี้จึงมีไว้อ้างอิงชุดข้อมูลฝั่งเราเท่านั้น
   * ห้ามแสดงหรือตีความว่าเป็นรอบรันของแบบจำลอง
   */
  batchId: string;
  /** เวลาที่ backend ดึงชุดนี้สำเร็จ (ISO) */
  fetchedAt: string;
  /**
   * พิกัดที่ TMD ตอบกลับมาว่าใช้ตอบคำถามนี้ (จุดกริดที่ใกล้ที่สุด) —
   * ไม่ใช่พิกัดที่เราเลือกส่งไป ทั้งสองอาจไม่ตรงกัน และค่าที่แสดงคือของจุดที่ TMD ใช้จริง
   */
  queryPoint: { lat: number; lon: number };
  /** รายชั่วโมง ไม่เกิน 48 ขั้น (ตามที่ต้นทางส่งมา อาจสั้นกว่านี้) */
  hourly: ForecastStep[];
  /** รายวัน ไม่เกิน 7 ขั้น (ตามที่ต้นทางส่งมา อาจสั้นกว่านี้) */
  daily: ForecastStep[];
}

/**
 * คำตอบของ endpoint พยากรณ์รายจังหวัด
 *
 * `batch: null` = ยังไม่เคยดึงสำเร็จเลย — UI ต้องแสดงว่า "ยังไม่เคยได้รับข้อมูล"
 * ไม่ใช่แสดงเป็นตารางว่าง ซึ่งอ่านได้เป็น "แบบจำลองบอกว่าไม่มีอะไร" คนละเรื่องกัน
 * (`layer.fetchedAt` ก็จะเป็น null คู่กัน ดูกฎใน `hazard-layer.ts`)
 */
export interface ProvinceForecastResponse {
  layer: HazardLayerDescriptor;
  batch: ProvinceForecastBatch | null;
}
