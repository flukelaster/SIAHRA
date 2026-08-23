/**
 * ภาษาภาพของระดับแจ้งเตือน อปท. (E11.5/E11.6) — ใช้ร่วมกันทั้ง `ActiveAlertBanner`
 * และ `AffectedAuthorityList` ไม่ให้มีสีคนละชุดสำหรับความหมายเดียวกัน
 *
 * `AlertSeverityTier` ("high" | "severe") เป็นเซตย่อยของ `ExposureLevel` เดียวกับ
 * ที่ `apps/api/src/exposure/compute.ts` ใช้อยู่แล้ว — ป้ายข้อความจึงยืมคีย์เดิม
 * จาก `legend.exposure.level.*` ตรง ๆ ไม่สร้างคำแปลคู่ขนานขึ้นมาใหม่
 *
 * **สีจงใจไม่ยืมจาก `lib/exposureStyle.ts`**: ไล่โทนม่วง→บานเย็นของไฟล์นั้นถูก
 * เลือกไว้ให้ต่างจากสีของ "ค่าที่วัดได้จริง" (ส้ม/แดง) อย่างตั้งใจ — สถานีที่
 * แจ้งเตือนอยู่นี้มาจากสถานีที่วัดได้จริง ไม่ใช่ชั้นภาพประกอบ การทาสีม่วงจึงกลับ
 * ความหมายที่ไฟล์นั้นพยายามรักษาไว้ จึงใช้โทเคนความเสี่ยงเดียวกับ `WaterLevelCard`/
 * `EarthquakeLiveCard` (`--color-risk-high`/`--color-risk-extreme`) แทน
 */
import type { AlertSeverityTier } from "@siahra/shared-types";
import type { MessageKey } from "../i18n";

export interface AlertSeverityStyle {
  labelKey: MessageKey;
  textClassName: string;
  dotClassName: string;
  ringClassName: string;
}

export const ALERT_SEVERITY_STYLE: Record<AlertSeverityTier, AlertSeverityStyle> = {
  high: {
    labelKey: "legend.exposure.level.high",
    textClassName: "text-[var(--color-risk-high)]",
    dotClassName: "bg-[var(--color-risk-high)]",
    ringClassName: "ring-[var(--color-risk-high)]/40 bg-[var(--color-risk-high)]/10",
  },
  severe: {
    labelKey: "legend.exposure.level.severe",
    textClassName: "text-[var(--color-risk-extreme)]",
    dotClassName: "bg-[var(--color-risk-extreme)]",
    ringClassName: "ring-[var(--color-risk-extreme)]/40 bg-[var(--color-risk-extreme)]/10",
  },
};
