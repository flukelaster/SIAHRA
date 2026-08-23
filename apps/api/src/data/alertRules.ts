import type { ThresholdRule } from "@siahra/shared-types";
import raw from "./alertRules.json";
import { LOCAL_AUTHORITIES } from "./localAuthorities.js";

/**
 * ตาราง rule ของ threshold/alert engine (E11.5) ที่ bake เข้า bundle ของ Worker —
 * สร้างใหม่ด้วย `npm run build:alert-rules -w apps/etl`
 * (`apps/etl/src/buildAlertRules.ts`) ซึ่งทำ point-in-polygon จริงระหว่างสถานี
 * ThaiWater จริงกับขอบเขต อปท. จริงของ E11.2/E11.4
 *
 * **การ validate ที่นี่** (ไม่ใช่แค่ตอน build): rule ตัวไหนอ้างถึง
 * `TH-LAO-*` id ที่ไม่มีอยู่จริงในทะเบียน E11.1 (เช่นทะเบียนถูกแก้ไขหลังตาราง
 * rule ถูก bake) จะถูก**ตัดออก ไม่ใช่ถูกโยน error ทำให้ทั้ง endpoint 500** —
 * จำนวนที่ถูกตัดออกถูกเก็บไว้ให้ `AlertEngineDO.status()` ใส่ลง `detail` เพื่อให้
 * ปรากฏใน `/api/v1/health` (กฎเดียวกับ "แหล่งที่ตายไปแล้วต้องยังมองเห็นได้" —
 * rule ตารางที่มีปัญหาห้ามหายไปเงียบ ๆ)
 */
const rawArtefact = raw as unknown as { generatedAt: string; recordCount: number; rules: ThresholdRule[] };

export interface AlertRuleValidationResult {
  valid: ThresholdRule[];
  droppedCount: number;
  droppedIds: string[];
}

/**
 * ฟังก์ชันล้วน ทดสอบตรง ๆ ได้โดยไม่ต้องพึ่งไฟล์ที่ bake ไว้ — `unknown` id ใน
 * `affectedLocalAuthorityIds` ทำให้ทั้ง rule นั้นถูกตัดออก (rule เดียวมีได้
 * หลาย authority; ถ้าบาง id ผิดแต่บาง id ถูก การเก็บ rule ไว้บางส่วนจะทำให้
 * alert ไปโผล่ที่ id ที่ไม่มีจริงบางส่วน จึงตัดทั้ง rule)
 */
export function validateAlertRules(
  rules: readonly ThresholdRule[],
  knownAuthorityIds: ReadonlySet<string>,
): AlertRuleValidationResult {
  const valid: ThresholdRule[] = [];
  const droppedIds: string[] = [];
  for (const rule of rules) {
    const allKnown = rule.affectedLocalAuthorityIds.every((id) => knownAuthorityIds.has(id));
    if (allKnown) valid.push(rule);
    else droppedIds.push(rule.id);
  }
  return { valid, droppedCount: droppedIds.length, droppedIds };
}

const KNOWN_AUTHORITY_IDS = new Set(LOCAL_AUTHORITIES.map((a) => a.id));
const VALIDATED = validateAlertRules(rawArtefact.rules, KNOWN_AUTHORITY_IDS);

export const ALERT_RULES: readonly ThresholdRule[] = VALIDATED.valid;
export const ALERT_RULES_DROPPED_COUNT = VALIDATED.droppedCount;
export const ALERT_RULES_GENERATED_AT: string = rawArtefact.generatedAt;

const BY_STATION_KEY = new Map<string, ThresholdRule>(
  ALERT_RULES.map((r) => [`${r.stationKind}:${r.stationId}`, r]),
);

/** ไม่มี rule สำหรับสถานีนี้ = null ไม่ใช่ error — สถานีส่วนใหญ่ไม่ตกใน อปท. ที่มีขอบเขตจริง */
export function getAlertRuleForStation(stationKind: "waterlevel" | "rainfall", stationId: number): ThresholdRule | null {
  return BY_STATION_KEY.get(`${stationKind}:${stationId}`) ?? null;
}

export interface AlertRuleFilter {
  stationId?: number;
}

export function queryAlertRules(filter: AlertRuleFilter = {}): ThresholdRule[] {
  return ALERT_RULES.filter((r) => (filter.stationId === undefined ? true : r.stationId === filter.stationId));
}
