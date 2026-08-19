import { SOURCES, type SourceHealth, type SourceStatus } from "@siahra/shared-types";
import type { Lang, MessageKey, TFunction } from "../../i18n";
import { formatAge } from "../../lib/time";

/**
 * ข้อความและสัญลักษณ์ของแถบสถานะแหล่งข้อมูล แยกจากคอมโพเนนต์ที่วาดมัน
 *
 * แยกไฟล์เพราะสองเหตุผล: เทสยิงตรงได้โดยไม่ต้องมี DOM (เทสฝั่ง web เป็น pure
 * module ล้วน environment: "node") และไฟล์คอมโพเนนต์ยังคง export เฉพาะคอมโพเนนต์
 * ตามกฎ fast refresh
 *
 * **แถบนี้อ่านจาก `SourceStatus` แค่ `health` กับ `lastError` เท่านั้น** คีย์ใน
 * `detail` ไม่เคยถูกแสดงที่ไหนเลย ต้นทางที่นับความล้มเหลวไว้ใน detail อย่างเดียว
 * จึงเงียบสนิทบนหน้าจอ (ดู E4.4 AC 3 — RadarDO ต้องตั้ง lastError ด้วย ไม่ใช่แค่นับ)
 *
 * `lastError` มาจากต้นทาง/ฝั่ง api ไม่ใช่ข้อความ UI จึงแสดงตามที่ได้มา ไม่แปล
 */

/**
 * `delayed` กับ `stale` ต้องอ่านออกว่าเป็นคนละความล้มเหลว: `delayed` คือดึงสำเร็จ
 * แต่ต้นทางยังไม่ปล่อยค่าตรวจวัดรอบใหม่ (จุดกลวงสีฟ้า) ส่วน `stale` คือฝั่งเรา
 * ดึงไม่สำเร็จมานาน (จุดทึบสีเหลือง)
 */
const HEALTH_META: Record<SourceHealth, { dot: string; labelKey: MessageKey }> = {
  ok: { dot: "bg-[var(--color-success)] shadow-[0_0_8px_rgba(34,197,94,0.8)]", labelKey: "health.ok" },
  delayed: {
    dot: "bg-transparent ring-2 ring-inset ring-[var(--color-risk-low)]",
    labelKey: "health.delayed",
  },
  stale: { dot: "bg-[var(--color-risk-medium)]", labelKey: "health.stale" },
  degraded: { dot: "bg-[var(--color-risk-high)]", labelKey: "health.degraded" },
  down: { dot: "bg-[var(--color-danger)]", labelKey: "health.down" },
  unknown: { dot: "bg-[var(--color-fg-subtle)]", labelKey: "health.unknown" },
};

/**
 * ความซื่อสัตย์ต่อข้อมูล: "ยังไม่เคยได้ข้อมูลจากต้นทางเลย" เป็นคนละเรื่องกับ
 * "เคยได้ แต่รอบล่าสุดดึงไม่สำเร็จ" — และผู้ใช้ควรรู้ว่าความผิดพลาดอยู่ที่ต้นทาง
 * ไม่ใช่ที่แอป
 */
/**
 * api กับ web ถูก deploy แยกกัน: api รุ่นใหม่อาจส่งสถานะที่บันเดิลนี้ยังไม่รู้จัก
 * ตกกลับไปที่ "ยังไม่ทราบ" แทนที่จะโยน error แล้วทำให้แถบสถานะหายไปทั้งแถบ
 * (แนวเดียวกับ `SOURCES[s.id]?.nameTh ?? s.labelTh` ด้านล่าง)
 */
export function healthMeta(health: SourceHealth): { dot: string; labelKey: MessageKey } {
  return HEALTH_META[health] ?? HEALTH_META.unknown;
}

export function statusLabel(s: SourceStatus, lang: Lang, t: TFunction): string {
  if (s.health === "down" && !s.fetchedAt) return t("health.downNeverFetched");
  // delayed = การดึง "สำเร็จ" ตัวเลขที่ผิดปกติคืออายุของค่าตรวจวัด ไม่ใช่อายุการดึง
  if (s.health === "delayed") {
    return t("health.delayedWithAge", {
      label: t("health.delayed"),
      age: ageLabel(lang, s.latestObservedAt),
    });
  }
  // degraded = "บางส่วนล้มเหลว" ซึ่งอาจมีข้อมูลบางชุดที่เพิ่งดึงมาใหม่จริง ๆ
  // (ThaiWater สำเร็จครึ่งเดียว / แผ่นดินไหวเสียแหล่งเดียว) จึงห้ามเหมาว่า "ใช้ข้อมูลเดิม"
  return t(healthMeta(s.health).labelKey);
}

/**
 * ชื่อแหล่งข้อมูลมาจากทะเบียนกลาง (`SOURCES`) ซึ่งมีทั้ง `nameTh` และ `nameEn`
 * อยู่แล้ว — ไม่มีตารางคำแปลชื่อแหล่งข้อมูลซ้อนอยู่ใน i18n catalog โดยตั้งใจ
 *
 * แต่ api กับ web ถูก deploy แยกกัน ถ้า api รุ่นใหม่ส่ง id ที่ web รุ่นเก่ายังไม่รู้จัก
 * ให้ตกกลับไปใช้ป้ายที่ติดมากับข้อมูล (`labelTh`/`labelEn`) แทนที่จะพังทั้งแถบ
 */
export function sourceLabel(s: SourceStatus, lang: Lang): string {
  const registered = SOURCES[s.id];
  if (registered) return lang === "th" ? registered.nameTh : registered.nameEn;
  return lang === "th" ? s.labelTh : s.labelEn;
}

/**
 * ข้อความที่ผู้ใช้เห็นจริงเมื่อชี้ที่จุดสถานะ — export ไว้ให้เทสยิงตรงได้ เพราะ
 * "แหล่งที่เสื่อมต้องมองเห็น" เป็นข้อกำหนดของผลิตภัณฑ์ ไม่ใช่รายละเอียดภายใน
 * (แถบนี้อ่านเฉพาะ `health` กับ `lastError` — คีย์ใน `detail` ไม่เคยถูกแสดง
 * ดังนั้นต้นทางที่นับความล้มเหลวไว้ใน detail อย่างเดียวจะเงียบสนิทที่หน้าจอ)
 *
 * `agency` และ `lastError` ไม่ได้แปล: อันแรกเป็นชื่อหน่วยงานตามที่ต้นทางประกาศไว้
 * อันหลังเป็นข้อความจริงจากระบบ การแปลทั้งคู่คือการเขียนสิ่งที่ต้นทางไม่ได้พูด
 */
export function tooltip(s: SourceStatus, lang: Lang, t: TFunction): string {
  const agency = SOURCES[s.id]?.agency;
  // ไม่เคยดึงสำเร็จเลย = ไม่มี "เวลาที่ดึงสำเร็จ" ให้พูดถึง การต่อท้ายว่า
  // "ดึงข้อมูลสำเร็จ ยังไม่เคยได้รับข้อมูล" ขัดกันเองในประโยคเดียว
  const fetched = s.fetchedAt
    ? t("health.tooltip.fetched", { age: ageLabel(lang, s.fetchedAt) })
    : "";
  const base = t("health.tooltip.line", {
    source: sourceLabel(s, lang),
    status: statusLabel(s, lang, t),
    fetched,
  });
  const withAgency = agency ? `${base}\n${agency}` : base;
  return s.lastError ? `${withAgency}\n${s.lastError}` : withAgency;
}

/** null = ยังไม่เคยดึงสำเร็จ → formatAge คืนข้อความ "ยังไม่เคยได้รับข้อมูล" ไม่ใช่เวลา */
export const ageLabel = (lang: Lang, iso: string | null): string => formatAge(lang, iso);
