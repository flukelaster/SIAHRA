/**
 * ข้อความของชิป "อายุแหล่งน้ำท่วม" บนแผนที่ (`components/layout/FloodSourceAgeChip.tsx`, E16 B-1)
 * — ตอบคำถามเดียว: ภาพน้ำท่วมที่เห็นอยู่ใหม่แค่ไหน ในวันที่ GISTDA ติดต่อไม่ได้ (401 ตั้งแต่
 * 2026-09-10) และ Sentinel-1 ผ่านทุก 6–12 วัน
 *
 * กฎความซื่อสัตย์ (AGENTS.md) ที่ฟังก์ชันนี้ต้องแยกให้ออก:
 * - `apiDown` = **เราถาม /health ไม่ได้** ไม่ใช่ GISTDA ล่ม — บอกว่าตรวจสถานะไม่ได้
 * - `fetchedAt: null` = ไม่เคยได้ข้อมูลเลย ("ยังไม่เคยได้รับข้อมูล") ห้ามเป็น "เมื่อสักครู่"
 * - `health: down` = ต้นทางปฏิเสธ/ติดต่อไม่ได้ — บอกเวลาที่ได้ข้อมูลสำเร็จครั้งสุดท้าย
 * - Sentinel-1: ไม่มีภาพในหน้าต่าง 14 วัน ≠ จังหวัดนี้ไม่มีฉากในระบบเลย ≠ โหลดรายการไม่ได้
 * - job ดึงภาพ GFM ค้าง = อาจมีรอบบินใหม่กว่านี้ที่เรายังไม่ได้ดึง ต้องบอก ไม่ใช่ให้อ่านว่า
 *   "ดาวเทียมยังไม่ผ่าน"
 */
import type { SourceStatus } from "@siahra/shared-types";
import { translate, type Lang } from "../i18n";
import { formatAge, formatDateTime, neverReceived } from "./time";

export type ChipTone = "ok" | "warn" | "bad" | "muted";

export interface ChipPart {
  key: "gistda" | "s1";
  label: string;
  value: string;
  tone: ChipTone;
}

export interface FloodSourceAgeInput {
  /** `/api/v1/health` ตอบไม่ได้ (`useApiHealth().apiDown`) */
  apiDown: boolean;
  /** แถว `gistda-flood` ของ /health — null = ยังไม่ได้คำตอบแรก หรือไม่มีแถวนี้ */
  gistda: SourceStatus | null;
  gfm: {
    /** เวลาบันทึกภาพของฉากที่กำลังแสดง — null = ไม่มีฉาก */
    sceneObservedAt: string | null;
    /** `useFloodScene().reason` */
    noSceneInWindow: boolean;
    /** `useFloodScenes().missing` — 404: จังหวัดนี้ยังไม่มีฉากในระบบ */
    missing: boolean;
    /** โหลดดัชนี/ฉากไม่สำเร็จ */
    error: boolean;
    loading: boolean;
    /** แถว `copernicus-gfm` ของ /health — null = ยังไม่รู้ */
    health: SourceStatus | null;
  };
  /** เวลาบนเส้นเวลา — null = สด; อายุของฉากนับจากเวลานี้ */
  atIso: string | null;
}

function gistdaPart(input: FloodSourceAgeInput, lang: Lang, nowMs: number): ChipPart {
  const label = translate(lang, "floodAge.gistda");
  const g = input.gistda;
  if (input.apiDown) return { key: "gistda", label, value: translate(lang, "floodAge.healthUnreachable"), tone: "muted" };
  if (!g) return { key: "gistda", label, value: translate(lang, "floodAge.statusUnknown"), tone: "muted" };
  if (g.fetchedAt === null) {
    // ไม่เคยสำเร็จเลย — ถ้าต้นทางปฏิเสธอยู่ด้วยก็ยังต้องบอกว่า "ไม่เคยได้" ก่อน
    return { key: "gistda", label, value: neverReceived(lang), tone: "bad" };
  }
  if (g.health === "down") {
    return {
      key: "gistda",
      label,
      value: translate(lang, "floodAge.downSince", { time: formatDateTime(lang, g.fetchedAt) }),
      tone: "bad",
    };
  }
  const age = formatAge(lang, g.fetchedAt, nowMs);
  if (g.health === "ok" || g.health === "delayed") {
    return { key: "gistda", label, value: translate(lang, "floodAge.updated", { age }), tone: "ok" };
  }
  return { key: "gistda", label, value: translate(lang, "floodAge.updatedStale", { age }), tone: "warn" };
}

/** ฉากเก่ากว่านี้ (นับจากเวลาที่ดู) = ชิปเป็นสีเตือน — รอบกลับของ Sentinel-1 คือ 6–12 วัน */
const S1_FRESH_MS = 3 * 24 * 3600_000;

function s1Part(input: FloodSourceAgeInput, lang: Lang, nowMs: number): ChipPart {
  const label = translate(lang, "floodAge.s1");
  const g = input.gfm;
  let part: ChipPart;
  if (g.sceneObservedAt) {
    const refMs = input.atIso !== null && Number.isFinite(Date.parse(input.atIso)) ? Date.parse(input.atIso) : nowMs;
    const age = formatAge(lang, g.sceneObservedAt, refMs);
    const ageMs = refMs - Date.parse(g.sceneObservedAt);
    part = {
      key: "s1",
      label,
      value: input.atIso !== null ? translate(lang, "floodAge.s1BeforeSelected", { age }) : age,
      tone: ageMs <= S1_FRESH_MS ? "ok" : "warn",
    };
  } else if (g.error) {
    part = { key: "s1", label, value: translate(lang, "floodAge.s1LoadError"), tone: "bad" };
  } else if (g.missing) {
    part = { key: "s1", label, value: translate(lang, "floodAge.s1NoScenes"), tone: "muted" };
  } else if (g.noSceneInWindow) {
    part = { key: "s1", label, value: translate(lang, "floodAge.s1NoSceneInWindow"), tone: "warn" };
  } else if (g.loading) {
    part = { key: "s1", label, value: translate(lang, "floodAge.loading"), tone: "muted" };
  } else {
    // ยังไม่มีดัชนีให้ตัดสิน — ไม่ใช่ "ไม่มีภาพ"
    part = { key: "s1", label, value: translate(lang, "floodAge.statusUnknown"), tone: "muted" };
  }
  // job ดึงภาพค้าง: รอบบินที่ใหม่กว่านี้อาจมีอยู่แล้วแต่เรายังไม่ได้ดึง — ต่อท้ายเสมอ
  const h = g.health;
  if (!input.apiDown && h && h.health !== "ok" && h.health !== "delayed") {
    const suffix =
      h.fetchedAt === null
        ? translate(lang, "floodAge.s1JobNever")
        : translate(lang, "floodAge.s1JobStale", { time: formatDateTime(lang, h.fetchedAt) });
    part = { ...part, value: `${part.value} · ${suffix}`, tone: part.tone === "ok" ? "warn" : part.tone };
  }
  return part;
}

/**
 * ดาวเทียมที่เห็นจริงและยังได้ภาพอยู่มาก่อน (E16 B-1 รอบ 3, การตัดสินใจของผู้ใช้ข้อ 3): Sentinel-1
 * (GFM) → GISTDA — ลำดับเดียวกับ legend และลำดับการวาด (GFM อยู่เหนือแผ่นจำลองจากสถานี)
 */
export function floodSourceAgeParts(input: FloodSourceAgeInput, lang: Lang, nowMs: number): ChipPart[] {
  return [s1Part(input, lang, nowMs), gistdaPart(input, lang, nowMs)];
}
