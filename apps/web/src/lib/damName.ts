import type { DamObservation } from "@siahra/shared-types";
import type { Lang, TFunction } from "../i18n";

/**
 * ชื่อเขื่อนที่แสดงบนหน้าจอ — แหล่งความจริงเดียวของทั้งการ์ด (`DamCard`) และป้ายบน
 * แผนที่ (`scene/DamMarkers`) ทั้งสองที่เคยเติมคำนำหน้าเองคนละชุด
 *
 * ชื่อมาจากต้นทาง (ThaiWater) ตามที่ประกาศไว้ ไม่ได้แปลเอง แต่ต้นทาง **ไม่สม่ำเสมอ**
 * ว่าจะใส่คำว่า "เขื่อน"/"DAM" มาในชื่อหรือไม่:
 *
 *   nameTh "ภูมิพล"                 · nameEn "BHUMIBOL DAM"
 *   nameTh "เขื่อนแม่ปิงตอนล่าง"      · nameEn "LOWER PING DAM"
 *
 * เติมคำนำหน้าแบบไม่มีเงื่อนไขจึงได้ "Dam BHUMIBOL DAM" และ "เขื่อนเขื่อนแม่ปิงตอนล่าง"
 * ตรงนี้จึงเติมเฉพาะเมื่อชื่อยังไม่มีคำนั้นอยู่แล้ว
 */

/**
 * ตรวจว่าชื่อ "ติดป้ายมาแล้ว" — ตรวจด้วยรูปแบบของ **ภาษาของตัวชื่อ** ไม่ใช่ภาษาที่
 * กำลังแสดงผล เพราะชื่ออาจตกกลับไปใช้อีกฟิลด์เมื่อฟิลด์ของภาษานั้นว่าง
 *
 * ไทยยึดหัวสตริง (ต้นทางเขียนนำหน้าเสมอ) อังกฤษไม่ยึด เพราะเป็นคำท้าย ("... DAM")
 */
const ALREADY_LABELLED: Record<Lang, RegExp> = {
  th: /^\s*(เขื่อน|อ่างเก็บน้ำ)/,
  en: /\b(dam|reservoir)\b/i,
};

export function damDisplayName(
  d: Pick<DamObservation, "nameTh" | "nameEn" | "kind">,
  lang: Lang,
  t: TFunction,
): string {
  const preferred = lang === "th" ? d.nameTh : d.nameEn;
  const name = preferred ?? (lang === "th" ? d.nameEn : d.nameTh);
  // ไม่มีชื่อจากต้นทางเลย — บอกว่าเป็นอ่างเก็บน้ำ ไม่ใช่เดาชื่อขึ้นมาเอง
  if (!name) return t("dam.reservoir");
  if (d.kind !== "large") return name;
  const nameLang: Lang = preferred ? lang : lang === "th" ? "en" : "th";
  if (ALREADY_LABELLED[nameLang].test(name)) return name;
  return `${t("dam.prefix")}${name}`;
}
