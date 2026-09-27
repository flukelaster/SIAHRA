/**
 * หัวข้อ (topic) ของเปลือกหน้าต่าง — pure module ไม่มี React/DOM
 *
 * แผงเก้าแผงเดิม (`PANEL_KEYS` ใน `lib/shellPrefs.ts`) ถูกจัดเป็น **สี่หัวข้อ** บน rail
 * (≥ tablet) และแถบแท็บล่าง (phone) แต่ละแผงกลายเป็น "มุมมองย่อย" ของหัวข้อเดียว
 * ความจำ `siahra.shell` และ `NotificationAction {kind:"open-panel", panel}` จึงยังพูด
 * เป็นคีย์แผงเหมือนเดิม — หัวข้อ derive จากคีย์แผงเสมอผ่าน `topicOf()` ไม่มีที่เก็บซ้ำ
 *
 * ไอคอนของหัวข้ออยู่ใน `components/layout/panelRegistry.ts` (ไฟล์นี้ไม่ import React)
 */
import type { MessageKey } from "../i18n";
import type { AlertRailBadge } from "./alertSummary";
import type { PanelKey } from "./shellPrefs";

export const TOPIC_KEYS = ["overview", "water", "weather", "quake"] as const;
export type TopicKey = (typeof TOPIC_KEYS)[number];

export interface TopicDef {
  key: TopicKey;
  /** มุมมองย่อยตามลำดับแท็บ — ตัวแรก = ค่าเริ่มต้นของหัวข้อ */
  views: readonly PanelKey[];
  /** ชื่อเต็ม — หัวข้อของ drawer และ aria-label ของปุ่ม */
  labelKey: MessageKey;
  /** ป้ายสั้นใต้ไอคอนบน rail/แถบแท็บ (ความกว้างปุ่ม ~72 px) */
  shortLabelKey: MessageKey;
}

export const TOPICS: readonly TopicDef[] = [
  { key: "overview", views: ["impact"], labelKey: "topic.overview", shortLabelKey: "topic.overview.short" },
  {
    key: "water",
    views: ["water", "north", "dams", "flood"],
    labelKey: "topic.water",
    shortLabelKey: "topic.water.short",
  },
  {
    key: "weather",
    views: ["rain", "forecast", "storm"],
    labelKey: "topic.weather",
    shortLabelKey: "topic.weather.short",
  },
  { key: "quake", views: ["quake"], labelKey: "topic.quake", shortLabelKey: "topic.quake.short" },
];

export function topicByKey(key: TopicKey): TopicDef {
  return TOPICS.find((t) => t.key === key) ?? TOPICS[0];
}

/** หัวข้อที่แผงนี้เป็นมุมมองย่อย — ทุกแผงอยู่ในหัวข้อเดียวเท่านั้น (เทสยืนยัน) */
export function topicOf(panel: PanelKey): TopicKey {
  return (TOPICS.find((t) => t.views.includes(panel)) ?? TOPICS[0]).key;
}

export function defaultViewOf(topic: TopicKey): PanelKey {
  return topicByKey(topic).views[0];
}

/**
 * มุมมองที่จะเปิดเมื่อผู้ใช้เลือกหัวข้อ: มุมมองล่าสุดที่เคยใช้ในหัวข้อนั้น (ถ้ายังเป็นของ
 * หัวข้อนั้นจริง) มิฉะนั้นมุมมองเริ่มต้น
 */
export function viewForTopic(topic: TopicKey, lastUsed: Partial<Record<TopicKey, PanelKey>>): PanelKey {
  const last = lastUsed[topic];
  return last !== undefined && topicOf(last) === topic ? last : defaultViewOf(topic);
}

/**
 * ลำดับความรุนแรงของ badge เมื่อหัวข้อหนึ่งมีหลายมุมมองที่มี badge (ตัวเลขน้อย = รุนแรงกว่า)
 *
 *   count          — มีรายการจริงให้ดู (แจ้งเตือน อปท. ที่ active / พายุที่แหล่งรายงาน)
 *   unreachable    — ถามแหล่งไม่ได้เลย: ต้องเห็น เพราะ "ไม่มีรายการ" อ่านเป็น "ปลอดภัย" ไม่ได้
 *   degraded       — รอบล่าสุดพลาด/บางแหล่งล้มเหลว (ยังมีข้อมูลเดิมอยู่)
 *   neverEvaluated — ยังไม่เคยได้คำตอบเลย
 *
 * `count` นำเพราะเป็นสิ่งเดียวที่ผู้ใช้ต้องลงมือดู ถ้ามุมมองหนึ่งมีรายการ อีกมุมมองหนึ่งที่
 * ติดต่อไม่ได้ยังคงเห็นเป็นจุดบนแท็บย่อยของมันเองเมื่อเปิดหัวข้อ
 */
export const BADGE_SEVERITY: Record<NonNullable<AlertRailBadge>["kind"], number> = {
  count: 0,
  unreachable: 1,
  degraded: 2,
  neverEvaluated: 3,
};

/**
 * badge ของหัวข้อ = badge ที่รุนแรงที่สุดของมุมมองย่อย — เสมอกันใช้ตัวที่มาก่อนตามลำดับ
 * มุมมอง (ไม่รวมจำนวนข้ามแผง: จำนวนแจ้งเตือนกับจำนวนพายุบวกกันไม่มีความหมาย)
 */
export function mostSevereBadge<B extends { kind: NonNullable<AlertRailBadge>["kind"] }>(
  badges: readonly (B | null)[],
): B | null {
  let best: B | null = null;
  for (const b of badges) {
    if (b === null) continue;
    if (best === null || BADGE_SEVERITY[b.kind] < BADGE_SEVERITY[best.kind]) best = b;
  }
  return best;
}

/** id ของปุ่มแท็บย่อย / กล่องเนื้อหา (`role="tabpanel"`) — `idBase` แยก drawer กับแผ่นเลื่อนออกจากกัน */
export const subTabId = (idBase: string, key: PanelKey) => `${idBase}-tab-${key}`;
export const subPanelId = (idBase: string) => `${idBase}-tabpanel`;
