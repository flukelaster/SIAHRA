/**
 * ศูนย์การแจ้งเตือน (ฝั่งเบราว์เซอร์ล้วน) — แปลง state ของ hook ที่รันอยู่แล้ว
 * (`useActiveAlerts`, `useProvinceForecast`, `useApiHealth`) เป็นรายการแถวเดียว
 * ที่ `NotificationCenter` วาด **ไม่มีคำขอเครือข่ายใหม่เลย** ไม่มี Web Push
 *
 * ความซื่อสัตย์ต่อข้อมูล (AGENTS.md):
 *   - ทุกแถวมี `kind` (observed / forecast / source-status) ชื่อแหล่ง และเวลาพร้อม
 *     ความหมายของเวลานั้น (`time.kind`) — `iso: null` แสดงเป็น "ยังไม่เคยสำเร็จ"
 *     หรือ "ยังไม่ได้รับผลการประเมิน" ตามชนิด ไม่เคยแสดงเป็น "ตอนนี้"
 *   - ตัวเลขฝนคือค่าที่ TMD ส่งมาตรง ๆ (`String(rainMm)` ไม่ปัด) — ไม่มีเปอร์เซ็นต์
 *     หรือความน่าจะเป็นที่ไหนเลย และ `rainMm: null` ถูกข้าม ไม่ใช่นับเป็น 0
 *   - TMD ไม่เผยแพร่รอบรันของแบบจำลอง: เวลาที่แสดงคือ "เราดึงมาเมื่อ" (`batch.fetchedAt`)
 *     และ `batchId` ไม่ถูกใช้เป็นรอบรันเด็ดขาด
 *   - แหล่งที่ติดต่อไม่ได้/เสื่อม ยังคงเป็นแถว (หรี่) ไม่หายไปเงียบ ๆ และไม่ถูกพูดว่า
 *     "ไม่มีแจ้งเตือน"
 *
 * การตีความสี่สถานะของแจ้งเตือน อปท. ใช้ `alertRailBadge` ของ `lib/alertSummary.ts`
 * ตัวเดียวกับ toast/badge บน rail — ไม่เขียนกติกาซ้ำที่นี่
 *
 * เวลาในช่องเวลาของแถวเป็นเวลาสัมบูรณ์ทั้งหมด ("วันนี้" รับเข้ามาเป็น `todayKey`) —
 * ข้อยกเว้นเดียวคือข้อความสถานะ `delayed` ที่ยืม `statusLabel` ของ `sourceStatusText.ts`
 * มาตรง ๆ ซึ่งต่อท้ายอายุแบบสัมพัทธ์ (`formatAge` อ่าน `Date.now()`) ณ ตอนสร้างรายการ
 * (สร้างใหม่ทุกรอบโพล /health 60 วิ) — import ข้ามจาก components/ มาที่ lib/ โดยตั้งใจ
 * เพื่อใช้ถ้อยคำสถานะชุดเดียวกับแถบสถานะ ไม่แตกเป็นชุดที่สอง
 */
import {
  bandRain24h,
  SOURCES,
  type ActiveAlertsResponse,
  type HealthResponse,
  type ProvinceForecastResponse,
  type SourceId,
} from "@siahra/shared-types";
import { translator, type Lang, type MessageKey } from "../i18n";
import type { ErrorMessage } from "./errorMessage";
import { alertRailBadge } from "./alertSummary";
import { ALERT_SEVERITY_STYLE } from "./alertSeverityStyle";
import { sourceLabel, statusLabel } from "../components/layout/sourceStatusText";
import { bangkokDateKey, formatDateTime, formatDayMonth, formatWeekday } from "./time";
import type { PanelKey } from "./shellPrefs";

export type NotificationCategory = "rain" | "alerts" | "system";
export type NotificationKind = "forecast" | "observed" | "source-status";

/**
 * ความหมายของเวลาในแถว — แต่ละชนิดมีข้อความของ `iso: null` ของตัวเอง:
 *   - `fetchedAt`   : เวลาที่ backend ดึงจากต้นทางสำเร็จ · null = ยังไม่เคยสำเร็จ
 *   - `triggeredAt` : เวลาที่แจ้งเตือนเริ่ม
 *   - `evaluatedAt` : เวลาที่เอนจินแจ้งเตือนประเมินรอบล่าสุด · null = ยังไม่ได้รับผลการประเมิน
 *   - `checkedAt`   : เวลาที่เบราว์เซอร์ถาม `/api/v1/health` ครั้งล่าสุด (ไม่ใช่เวลาดึงข้อมูล)
 *   - `received`    : เบราว์เซอร์ยังไม่ได้รับคำตอบใดเลยในหน้านี้ · null เสมอ
 */
export type NotificationTimeKind = "fetchedAt" | "triggeredAt" | "evaluatedAt" | "checkedAt" | "received";

export interface NotificationTime {
  kind: NotificationTimeKind;
  iso: string | null;
}

export type NotificationAction = { kind: "open-panel"; panel: PanelKey; labelKey: MessageKey };

export interface NotificationItem {
  /** คงที่ข้ามรอบโพล — ใช้เป็นกุญแจของสถานะ "อ่านแล้ว" */
  id: string;
  category: NotificationCategory;
  kind: NotificationKind;
  /** ชื่อแหล่งข้อมูลตามทะเบียนกลาง (แปลตามภาษาแล้ว) */
  source: string;
  title: string;
  body: string | null;
  time: NotificationTime;
  /** แสดงหรี่ — ข้อมูลอาจไม่ทันปัจจุบัน หรือเป็นแถวสถานะของแหล่งที่ผิดปกติ */
  dim: boolean;
  /** ระดับสำหรับสีของแถว — ไม่ใช่ตัวเลขใหม่ แค่ชื่อแถบที่ต้นทาง/เกณฑ์ประกาศ */
  tone: "severe" | "high" | "warn" | "danger" | "muted";
  action?: NotificationAction;
}

export interface NotificationInputs {
  provinceCode: string;
  /**
   * วันปฏิทินกรุงเทพฯ ของวันนี้ ("YYYY-MM-DD" จาก `bangkokDateKey`) — ขั้นรายวันที่ valid
   * ก่อนวันนี้ถูกข้าม (ชุดเก่าที่ค้างอยู่ไม่ควรเตือนฝนของวันที่ผ่านไปแล้ว) · null = ไม่กรอง
   */
  todayKey?: string | null;
  activeAlerts: { data: ActiveAlertsResponse | null; loading: boolean; error: ErrorMessage | null };
  forecast: { data: ProvinceForecastResponse | null; loading: boolean; error: ErrorMessage | null };
  apiHealth: { health: HealthResponse | null; apiDown: boolean; checkedAt: string | null };
  /** id → ชื่อ อปท. (มาจาก `affectedAuthorities.entries`) — ไม่มีใน map ก็แสดง id ดิบ */
  authorityNames?: ReadonlyMap<string, string>;
}

const sourceName = (id: SourceId, lang: Lang): string => {
  const s = SOURCES[id];
  return lang === "th" ? s.nameTh : s.nameEn;
};

const OPEN_IMPACT: NotificationAction = { kind: "open-panel", panel: "impact", labelKey: "notifications.action.openImpact" };
const OPEN_FORECAST: NotificationAction = {
  kind: "open-panel",
  panel: "forecast",
  labelKey: "forecast.notif.open",
};

function alertItems(input: NotificationInputs, lang: Lang): NotificationItem[] {
  const t = translator(lang);
  const state = input.activeAlerts;
  const badge = alertRailBadge(state);
  if (!badge) return [];
  const source = sourceName("alert-engine", lang);
  const out: NotificationItem[] = [];
  const evaluatedAt = state.data?.evaluatedAt ?? null;

  if (badge.kind === "unreachable") {
    out.push({
      id: `alerts:unreachable:${input.provinceCode}`,
      category: "alerts",
      kind: "source-status",
      source,
      title: t("notifications.alerts.unreachable"),
      body: null,
      time: { kind: "received", iso: null },
      dim: true,
      tone: "danger",
      action: OPEN_IMPACT,
    });
    return out;
  }
  if (badge.kind === "neverEvaluated") {
    out.push({
      id: `alerts:never-evaluated:${input.provinceCode}`,
      category: "alerts",
      kind: "source-status",
      source,
      title: t("notifications.alerts.neverEvaluated"),
      body: null,
      time: { kind: "evaluatedAt", iso: null },
      dim: true,
      tone: "muted",
      action: OPEN_IMPACT,
    });
    return out;
  }
  const degraded = badge.kind === "degraded";
  if (degraded) {
    out.push({
      id: `alerts:degraded:${input.provinceCode}`,
      category: "alerts",
      kind: "source-status",
      source,
      title: t("notifications.alerts.degraded"),
      body: null,
      time: { kind: "evaluatedAt", iso: evaluatedAt },
      dim: true,
      tone: "warn",
      action: OPEN_IMPACT,
    });
  }
  for (const a of state.data?.alerts ?? []) {
    const style = ALERT_SEVERITY_STYLE[a.level];
    const name = input.authorityNames?.get(a.localAuthorityId) ?? a.localAuthorityId;
    out.push({
      id: `alert:${a.id}`,
      category: "alerts",
      kind: "observed",
      source,
      title: t("notifications.alerts.item", { level: style ? t(style.labelKey) : a.level, name }),
      body: a.stale ? t("alert.banner.stale") : null,
      time: { kind: "triggeredAt", iso: a.triggeredAt },
      dim: degraded || a.stale,
      tone: a.level === "severe" ? "severe" : "high",
      action: OPEN_IMPACT,
    });
  }
  return out;
}

function rainItems(input: NotificationInputs, lang: Lang): NotificationItem[] {
  const t = translator(lang);
  const { data, error } = input.forecast;
  const source = sourceName("tmd-nwp", lang);
  const code = input.provinceCode;

  if (error && !data) {
    return [
      {
        id: `forecast:unreachable:${code}`,
        category: "rain",
        kind: "source-status",
        source,
        title: t("forecast.notif.unreachable"),
        body: null,
        time: { kind: "received", iso: null },
        dim: true,
        tone: "danger",
        action: OPEN_FORECAST,
      },
    ];
  }
  if (!data) return []; // ยังโหลดอยู่ — ไม่พูดอะไรแทนต้นทาง
  const batch = data.batch;
  if (!batch) {
    // คำตอบ 200 ที่บอกว่า backend ยังไม่เคยดึงจาก TMD สำเร็จ — ไม่ใช่ "ไม่มีฝน"
    return [
      {
        id: `forecast:no-batch:${code}`,
        category: "rain",
        kind: "source-status",
        source,
        title: t("forecast.notif.noBatch"),
        body: null,
        time: { kind: "fetchedAt", iso: null },
        dim: true,
        tone: "muted",
        action: OPEN_FORECAST,
      },
    ];
  }

  const out: NotificationItem[] = [];
  const degraded = error !== null;
  // ต้นทางผิดปกติตาม /health (เช่น ชุดนี้ค้างมาหลายวัน) → แถวฝนหรี่ลง แถวสถานะอยู่ในแท็บระบบ
  const nwp = input.apiHealth.health?.sources.find((s) => s.id === "tmd-nwp") ?? null;
  const nwpUnhealthy = nwp !== null && nwp.health !== "ok";
  // API สถานะล่ม = เราถามไม่ได้ ไม่ใช่ "ต้นทางผิดปกติ" — หรี่ได้ แต่ห้ามอ้างว่าต้นทางเสีย
  const sourceUnhealthy = input.apiHealth.apiDown || nwpUnhealthy;
  if (nwp && nwpUnhealthy && !degraded) {
    // แถวสถานะในแท็บฝนหนักด้วย — ไม่งั้นแท็บนี้จะขึ้น "ไม่มีรายการ" ทั้งที่ชุดที่ถืออยู่อาจเก่า
    // (แถวของ /health ตัวเต็มยังอยู่ในแท็บระบบ คนละ id คนละหลักฐาน)
    out.push({
      id: `forecast:source-unhealthy:${code}:${nwp.health}`,
      category: "rain",
      kind: "source-status",
      source,
      title: t("forecast.notif.sourceUnhealthy"),
      body: null,
      time: { kind: "fetchedAt", iso: batch.fetchedAt },
      dim: true,
      tone: "warn",
      action: OPEN_FORECAST,
    });
  }
  if (degraded) {
    out.push({
      id: `forecast:degraded:${code}`,
      category: "rain",
      kind: "source-status",
      source,
      title: t("forecast.notif.degraded"),
      body: null,
      time: { kind: "fetchedAt", iso: batch.fetchedAt },
      dim: true,
      tone: "warn",
      action: OPEN_FORECAST,
    });
  }
  // ใช้ batch.provinceCode ของชุดที่ได้มาจริง (หลังสลับจังหวัด hook รีเซ็ต data เป็น null
  // อยู่แล้ว แต่ id ต้องผูกกับชุดข้อมูล ไม่ใช่กับสิ่งที่ผู้ใช้เลือกอยู่)
  const batchProvince = batch.provinceCode || code;
  for (const step of batch.daily) {
    if (step.rainMm === null) continue; // ต้นทางไม่ได้ส่งค่า ≠ 0
    const band = bandRain24h(step.rainMm);
    if (band !== "high" && band !== "severe") continue;
    const dayKey = bangkokDateKey(step.validAt);
    if (dayKey === null) continue;
    if (input.todayKey && dayKey < input.todayKey) continue; // วันที่ผ่านไปแล้ว
    const day = `${formatWeekday(lang, step.validAt)} ${formatDayMonth(lang, step.validAt)}`;
    out.push({
      id: `rain:${batchProvince}:${dayKey}:${band}`,
      category: "rain",
      kind: "forecast",
      source,
      title: t(band === "severe" ? "forecast.notif.band.severe" : "forecast.notif.band.high", { day }),
      // ตัวเลขตามที่ TMD ส่งมา ไม่ปัด ไม่แปลงหน่วย
      body: t("forecast.notif.value", { mm: String(step.rainMm), day }),
      time: { kind: "fetchedAt", iso: batch.fetchedAt },
      dim: degraded || sourceUnhealthy,
      tone: band === "severe" ? "severe" : "high",
      action: OPEN_FORECAST,
    });
  }
  return out;
}

/** ข้อความหัวแถวสถานะแหล่งข้อมูล — แยก "ดึงไม่ได้/ล้มเหลว" ออกจาก "ข้อมูลค้าง" ออกจาก "ต้นทางยังไม่ปล่อยค่าใหม่" */
function healthTitleKey(health: string, fetchedAt: string | null): MessageKey {
  switch (health) {
    case "down":
      return fetchedAt ? "notifications.health.down" : "notifications.health.downNever";
    case "degraded":
      return "notifications.health.degraded";
    case "stale":
      return "notifications.health.stale";
    case "delayed":
      return "notifications.health.delayed";
    default:
      return "notifications.health.unknown";
  }
}

function healthItems(input: NotificationInputs, lang: Lang): NotificationItem[] {
  const t = translator(lang);
  const { health, apiDown, checkedAt } = input.apiHealth;
  const out: NotificationItem[] = [];
  if (apiDown) {
    out.push({
      id: "health:api:unreachable",
      category: "system",
      kind: "source-status",
      source: t("notifications.source.api"),
      title: t("notifications.health.apiUnreachable"),
      body: health ? t("notifications.health.apiUnreachableCached") : null,
      time: { kind: "checkedAt", iso: checkedAt },
      dim: true,
      tone: "danger",
    });
  }
  for (const s of health?.sources ?? []) {
    if (s.health === "ok") continue;
    const status = statusLabel(s, lang, t);
    // lastError มาจากระบบจริง ไม่แปล (กติกาเดียวกับ tooltip ของแถบสถานะ)
    const body = s.lastError ? `${status} · ${s.lastError}` : status;
    out.push({
      id: `health:${s.id}:${s.health}`,
      category: "system",
      kind: "source-status",
      source: sourceLabel(s, lang),
      title: t(healthTitleKey(s.health, s.fetchedAt), { source: sourceLabel(s, lang) }),
      body,
      time: { kind: "fetchedAt", iso: s.fetchedAt },
      dim: true,
      tone: s.health === "down" ? "danger" : s.health === "delayed" || s.health === "unknown" ? "muted" : "warn",
    });
  }
  return out;
}

/**
 * รายการทั้งหมด เรียง: แจ้งเตือน อปท. → ฝนหนัก (ตามวันที่ TMD ส่งมา) → สถานะระบบ
 * id ซ้ำ (ไม่ควรเกิด แต่ถ้า backend ส่งซ้ำ) เก็บตัวแรก — React key ต้องไม่ชนกัน
 */
export function buildNotifications(input: NotificationInputs, lang: Lang): NotificationItem[] {
  const all = [...alertItems(input, lang), ...rainItems(input, lang), ...healthItems(input, lang)];
  const seen = new Set<string>();
  return all.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
}

/** ข้อความเวลาพร้อมความหมาย — `iso: null` ไม่เคยกลายเป็นเวลาปัจจุบัน */
export function notificationTimeText(time: NotificationTime, lang: Lang): string {
  const t = translator(lang);
  if (time.kind === "received") return t("notifications.time.nothingReceived");
  if (time.iso === null) {
    if (time.kind === "evaluatedAt") return t("notifications.time.notEvaluated");
    if (time.kind === "checkedAt") return t("notifications.time.notChecked");
    return t("notifications.time.neverSucceeded");
  }
  const at = formatDateTime(lang, time.iso);
  switch (time.kind) {
    case "fetchedAt":
      return t("notifications.time.fetchedAt", { time: at });
    case "triggeredAt":
      return t("notifications.time.triggeredAt", { time: at });
    case "evaluatedAt":
      return t("notifications.time.evaluatedAt", { time: at });
    case "checkedAt":
      return t("notifications.time.checkedAt", { time: at });
  }
}

// ── แท็บ ──────────────────────────────────────────────────────────────────

export type NotificationTab = "all" | NotificationCategory;
export const NOTIFICATION_TABS: readonly NotificationTab[] = ["all", "rain", "alerts", "system"];

export function itemsForTab(items: readonly NotificationItem[], tab: NotificationTab): NotificationItem[] {
  return tab === "all" ? [...items] : items.filter((i) => i.category === tab);
}

/** จำนวนต่อแท็บ — แท็บที่ไม่มีรายการได้ 0 (ยังแสดงแท็บเสมอ) */
export function tabCounts(items: readonly NotificationItem[]): Record<NotificationTab, number> {
  const c: Record<NotificationTab, number> = { all: items.length, rain: 0, alerts: 0, system: 0 };
  for (const i of items) c[i.category] += 1;
  return c;
}

// ── สถานะ "อ่านแล้ว" ─────────────────────────────────────────────────────
/**
 * `localStorage["siahra.notifications"] = {"v":1,"seen":string[]}` — รูปแบบเดียวกับ
 * `lib/shellPrefs.ts`: รับ **getter** ของ storage และเรียกมันใน `try` เดียวกับ
 * `.getItem()` เพราะ `window.localStorage` โยน `SecurityError` ได้ตั้งแต่ตอนอ่าน
 */
export const NOTIFICATIONS_STORAGE_KEY = "siahra.notifications";
/** เพดานจำนวน id ที่จำไว้ — เก็บตัวใหม่สุด */
export const SEEN_CAP = 200;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** อะไรที่ไม่ใช่รูป v:1 เป๊ะ → [] ทั้งก้อน ไม่เดาบางส่วน */
export function parseSeen(raw: string | null): string[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const o = parsed as Record<string, unknown>;
  if (o.v !== 1 || !Array.isArray(o.seen)) return [];
  if (!o.seen.every((s) => typeof s === "string")) return [];
  return (o.seen as string[]).slice(-SEEN_CAP);
}

export function readSeen(getStorage: () => StorageLike): string[] {
  try {
    return parseSeen(getStorage().getItem(NOTIFICATIONS_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function writeSeen(getStorage: () => StorageLike, seen: readonly string[]): void {
  try {
    getStorage().setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify({ v: 1, seen: seen.slice(-SEEN_CAP) }));
  } catch {
    // เก็บไม่ได้ก็ยังใช้ได้ในหน้านี้ — แค่จำข้ามการโหลดไม่ได้
  }
}

/** "อ่านทั้งหมด": id ปัจจุบันไปอยู่ท้ายสุด (ใหม่สุด) จึงไม่ถูกตัดด้วยเพดาน */
export function markAllSeen(seen: readonly string[], items: readonly NotificationItem[]): string[] {
  const current = items.map((i) => i.id);
  const currentSet = new Set(current);
  return [...seen.filter((id) => !currentSet.has(id)), ...current].slice(-SEEN_CAP);
}

export function unreadCount(items: readonly NotificationItem[], seen: readonly string[]): number {
  const s = new Set(seen);
  return items.reduce((n, i) => (s.has(i.id) ? n : n + 1), 0);
}
