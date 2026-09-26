/**
 * คีย์ข้อความของส่วน "ผลกระทบจากน้ำท่วม" ใน `ImpactSummaryCard` — เลือกตามความสด
 * ของฉาก GISTDA (`lib/gistdaImpactFreshness.ts`)
 *
 * เมื่อตัวเลขถูกหรี่ (ฉากเก่า/แหล่งไม่ ok) หัวข้อกับบรรทัดสถานที่สำคัญต้องไม่พูดว่า
 * "ปัจจุบัน"/"ตอนนี้" — มันบรรยายภาพที่ดึงมาเมื่อวันหนึ่ง ไม่ใช่สถานการณ์ขณะนี้ จึงใช้
 * ข้อความที่ผูกกับวันที่ดึงภาพแทน ส่วนตอนสดคงข้อความเดิมไว้
 */
import type { MessageKey } from "../i18n";

export interface ImpactFloodWording {
  /** หัวข้อของส่วน — ตัวที่หรี่รับ `{date}` */
  sectionKey: MessageKey;
  /** บรรทัดเมื่อไม่มีสถานที่สำคัญในพื้นที่ท่วม */
  facilitiesNoneKey: MessageKey;
}

export function impactFloodWording(dim: boolean): ImpactFloodWording {
  return dim
    ? { sectionKey: "impact.section.flood.dated", facilitiesNoneKey: "impact.facilitiesExposed.none.dated" }
    : { sectionKey: "impact.section.flood", facilitiesNoneKey: "impact.facilitiesExposed.none" };
}
