/**
 * ความสดของตัวเลข "% พื้นที่ท่วม" ของ อปท./เขต — โมดูลบริสุทธิ์ที่
 * `AffectedAuthorityList` กับ `ImpactSummaryCard` ใช้ร่วมกัน (ไม่มี fetch ไม่มี timer:
 * รับ descriptor ของ `/impact` ที่โหลดมาแล้ว + แถว `gistda-flood` ของ `/api/v1/health`
 * ที่ `useApiHealth` ดึงอยู่แล้ว + นาฬิกา)
 *
 * เหตุที่ต้องมี (prod 2026-09-26): GISTDA ตอบ 401 มา 16 วัน ฉากล่าสุดที่ดึงได้คือ
 * 10 ก.ย. และปทุมธานีไม่มีพื้นที่ท่วมในฉากนั้นเลย — รายการจึงขึ้น "ท่วม 0%" ทุกแถว
 * แบบตัวเลขสด ขณะที่จุดแจ้งเตือนระดับน้ำของ ThaiWater ขึ้น "สูง" ตัวเลข 0% ที่มาจาก
 * ฉากเก่าต้องถูกหรี่และติดวันที่ของฉาก ไม่ใช่อ่านเหมือนค่าปัจจุบัน
 *
 * กติกาความซื่อสัตย์ที่ไฟล์นี้บังคับ:
 * - `fetchedAt: null` = ไม่เคยดึงสำเร็จ → `never-fetched` ห้ามกลายเป็นเวลาใด ๆ
 * - "ติดต่อ GISTDA ไม่ได้" (`unreachable`) พูดได้ **เฉพาะ** เมื่อ /health ยืนยันจริง
 *   (`down`/`degraded` หรือ `stale` ที่มี `lastError`) — `unknown` หรือไม่มีแถว
 *   `gistda-flood` เลย พูดได้แค่ "ภาพเก่า" (`old`) ไม่อ้างสภาพของแหล่ง
 * - `delayed` = ต้นทางตอบแต่ยังไม่มีภาพใหม่ (`no-new-scene`) — คนละประโยคกับติดต่อไม่ได้
 * - `fresh` คือทั้งอายุไม่เกิน `staleAfterSeconds` **และ** /health เป็น `ok` (หรือไม่มี
 *   แถวให้ดู) เท่านั้น
 */
import type { HazardLayerDescriptor, SourceStatus } from "@siahra/shared-types";

export type GistdaImpactFreshnessKind =
  /** ไม่เคยดึงฉากใดสำเร็จเลย (`fetchedAt: null`) */
  | "never-fetched"
  /** ดึงสำเร็จภายในรอบปกติ และ /health ไม่ได้บอกว่ามีปัญหา */
  | "fresh"
  /** /health ยืนยันว่ารอบล่าสุดติดต่อ GISTDA ไม่ได้ — ตัวเลขมาจากฉากที่ดึงได้ครั้งสุดท้าย */
  | "unreachable"
  /** /health บอกว่า GISTDA ตอบแต่ยังไม่มีฉากใหม่ (`delayed`) */
  | "no-new-scene"
  /** เก่ากว่ารอบปกติ (หรือ /health ไม่ ok แบบที่ไม่ได้ยืนยันว่าติดต่อไม่ได้) — ไม่อ้างสภาพแหล่ง */
  | "old";

export interface GistdaImpactFreshness {
  kind: GistdaImpactFreshnessKind;
  /** true = หรี่ตัวเลข % และติดวันที่ฉาก */
  dim: boolean;
  /** เวลาที่ดึงฉาก GISTDA สำเร็จครั้งล่าสุด — null เฉพาะ `never-fetched` */
  fetchedAt: string | null;
}

export const GISTDA_FLOOD_SOURCE_ID = "gistda-flood";

export function deriveGistdaImpactFreshness(
  descriptor: Pick<HazardLayerDescriptor, "fetchedAt" | "staleAfterSeconds"> | null,
  gistda: Pick<SourceStatus, "health" | "lastError"> | null | undefined,
  nowMs: number,
): GistdaImpactFreshness {
  const fetchedAt = descriptor?.fetchedAt ?? null;
  if (fetchedAt === null) return { kind: "never-fetched", dim: false, fetchedAt: null };

  const fetchedMs = Date.parse(fetchedAt);
  const staleAfterMs = (descriptor?.staleAfterSeconds ?? 0) * 1000;
  const oldByAge = staleAfterMs > 0 && (Number.isNaN(fetchedMs) || nowMs - fetchedMs > staleAfterMs);

  const health = gistda?.health ?? null;
  if (health === "down" || health === "degraded" || (health === "stale" && gistda?.lastError)) {
    return { kind: "unreachable", dim: true, fetchedAt };
  }
  if (health === "delayed") return { kind: "no-new-scene", dim: true, fetchedAt };
  if (oldByAge || (health !== null && health !== "ok")) return { kind: "old", dim: true, fetchedAt };
  return { kind: "fresh", dim: false, fetchedAt };
}

/** แถว `gistda-flood` ของ /health — `undefined` เมื่อยังโหลดไม่เสร็จหรือ api ไม่ได้รายงาน */
export function gistdaSourceStatus(
  health: { sources: readonly SourceStatus[] } | null | undefined,
): SourceStatus | undefined {
  return health?.sources.find((s) => s.id === GISTDA_FLOOD_SOURCE_ID);
}

/**
 * descriptor ตัวแทนของทั้งรายการ — ทุกแถวมาจาก FloodExtentDO ตัวเดียวกัน จึงควรมี
 * `fetchedAt` เดียวกัน แต่คำขอแต่ละแถวอาจกลับมาคนละรอบ: เลือกตัวที่ใหม่ที่สุด (ถ้า
 * ตัวใหม่ที่สุดยังเก่า ทั้งรายการก็เก่า) — null เมื่อไม่มีแถวใดได้ผล `/impact` เลย
 */
export function newestImpactDescriptor(
  descriptors: readonly Pick<HazardLayerDescriptor, "fetchedAt" | "staleAfterSeconds">[],
): Pick<HazardLayerDescriptor, "fetchedAt" | "staleAfterSeconds"> | null {
  let best: Pick<HazardLayerDescriptor, "fetchedAt" | "staleAfterSeconds"> | null = null;
  for (const d of descriptors) {
    if (best === null) {
      best = d;
      continue;
    }
    if (d.fetchedAt === null) continue;
    if (best.fetchedAt === null || Date.parse(d.fetchedAt) > Date.parse(best.fetchedAt)) best = d;
  }
  return best;
}
