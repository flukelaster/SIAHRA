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
 * **ทำไมมีสอง descriptor ไม่ใช่หนึ่ง** — TMD ปล่อยสองชุดที่มี "ระยะพยากรณ์"
 * ไม่เท่ากัน: รายชั่วโมงไปข้างหน้า 48 ชม. รายวันไปข้างหน้า 7 วัน (168 ชม.)
 * ทั้งสองค่านี้ **นับจากจำนวนขั้นที่ต้นทางส่งมาจริง** ไม่ใช่จากที่เราขอ ถ้าใช้
 * descriptor เดียว `forecast.horizonHours` ต้องเลือกเลขเดียว แล้วชุดรายชั่วโมง
 * จะถูกประกาศว่าไปไกลกว่าความจริง 3.5 เท่า — UI ที่วาดแถบ 48 ชม. ข้าง ๆ คำว่า
 * "168 ชม." คือการโกหกด้วยโครงสร้างข้อมูล จึงแยกเป็นชุดละ descriptor
 * (`resolutionKm` เป็น `null` ทั้งคู่ด้วยเหตุผลคนละข้อ ดู `hazard-layer.ts`)
 *
 * `batch: null` = ยังไม่เคยดึงสำเร็จเลย — UI ต้องแสดงว่า "ยังไม่เคยได้รับข้อมูล"
 * ไม่ใช่แสดงเป็นตารางว่าง ซึ่งอ่านได้เป็น "แบบจำลองบอกว่าไม่มีอะไร" คนละเรื่องกัน
 * (`layers.*.fetchedAt` ก็จะเป็น null คู่กัน ดูกฎใน `hazard-layer.ts`)
 */
export interface ProvinceForecastResponse {
  layers: {
    /** ชุดรายชั่วโมง — `forecast.horizonHours` = ระยะที่ชุดนี้ไปถึงจริง */
    hourly: HazardLayerDescriptor;
    /** ชุดรายวัน — คนละระยะพยากรณ์กับรายชั่วโมง จึงคนละ descriptor */
    daily: HazardLayerDescriptor;
  };
  batch: ProvinceForecastBatch | null;
}

/**
 * ช่วงวันที่ TMD ประกาศว่ามีผลพยากรณ์รายวันให้ (endpoint availability ของต้นทาง)
 *
 * `daily: null` = เรายังไม่เคยอ่านค่านี้สำเร็จ ไม่ใช่ "TMD ไม่มีข้อมูล" — สองอย่างนี้
 * คนละเรื่อง และ `fetchedAt: null` คู่กันคือสิ่งที่บอกว่าเป็นแบบแรก
 */
export interface ForecastAvailabilityResponse {
  daily: { min: string; max: string } | null;
  /** เวลาที่เราอ่านช่วงนี้สำเร็จล่าสุด — null = ไม่เคยสำเร็จ (ห้ามแสดงเป็น "ตอนนี้") */
  fetchedAt: string | null;
}
