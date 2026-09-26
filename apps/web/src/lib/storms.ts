/**
 * การตีความคำตอบ `/api/v1/storms` ที่แผงพายุ (`StormPanel.tsx`) badge บน rail และศูนย์
 * การแจ้งเตือน (`notifications.ts`) ใช้ร่วมกัน — **จุดตัดสินเดียว** ทั้งสามที่จึงไม่มีวัน
 * พูดขัดกันเอง (แบบเดียวกับ `alertSummary.ts`) pure ทั้งไฟล์ ผู้เรียกส่ง `nowMs` เข้ามา
 *
 * ความซื่อสัตย์ต่อข้อมูล:
 *   - `storms: []` ไม่ใช่ "ปลอดภัย": ถ้าไม่มีแหล่งไหนตอบสำเร็จเลย มันแปลว่า "เรายังไม่รู้"
 *     (`never`) หรือ "ถามไม่ได้" (`failing`) — มีแต่แหล่งที่ `ok` เท่านั้นที่พูดแทนได้ว่า
 *     "ไม่ได้รายงานพายุ" และพูดได้เฉพาะแอ่งของตัวเอง
 *   - ระยะ (`nearestKmByProvince`) เป็นเรขาคณิตที่ API คำนวณ ไม่ใช่ความน่าจะเป็น
 *   - จุดล่าสุดของพายุที่เก่ากว่า `STORM_FIX_OLD_MS` ถูกบอกอายุ ห้ามอ่านเป็น "ตอนนี้"
 */
import type { StormPastPosition, StormSourceId, StormsResponse, StormTrack } from "@siahra/shared-types";

/**
 * เกณฑ์แจ้งเตือน (กม.) — แถวในศูนย์การแจ้งเตือนเกิดเมื่อ `nearestKmByProvince[จังหวัด]`
 * ≤ ค่านี้ ข้อความของแถวระบุเกณฑ์นี้ตรง ๆ (เป็นกติกาที่ประกาศไว้ ไม่ใช่การประเมินภัย)
 */
export const STORM_NOTIFY_KM = 300;

/** จุดวิเคราะห์ล่าสุดที่เก่ากว่านี้ = แผงบอกอายุของจุดนั้น ไม่ใช่ "กำลังเคลื่อนที่อยู่" */
export const STORM_FIX_OLD_MS = 24 * 60 * 60 * 1000;

/** ลำดับคงที่ของแหล่ง — แสดงทุกแหล่งเสมอ แม้คำตอบจะไม่มีแถวของมัน */
export const STORM_SOURCES: readonly StormSourceId[] = ["jma-typhoon", "gdacs-tc"];

export type StormSourceCondition =
  /** ยังไม่เคยตอบสำเร็จเลย (`lastSuccessAt: null`) — ไม่รู้ ไม่ใช่ "ไม่มีพายุ" */
  | { id: StormSourceId; kind: "never"; lastAttemptAt: string | null; lastError: string | null }
  /**
   * เคยสำเร็จ แต่รอบล่าสุด **ติดต่อไม่ได้/ต้นทางพัง** (`lastSuccessAt` เก่ากว่า `lastAttemptAt`)
   * — สิ่งที่แสดงคือของรอบ `lastSuccessAt`
   */
  | { id: StormSourceId; kind: "failing"; lastSuccessAt: string; lastAttemptAt: string | null; lastError: string }
  /**
   * รอบล่าสุด **ติดต่อได้** (ได้รายการ, `lastSuccessAt` = `lastAttemptAt`) แต่พายุบางลูกโหลด
   * รายละเอียดไม่สำเร็จ (`StormTrackDO` outcome "partial") — ห้ามพูดว่า "ติดต่อไม่ได้"
   */
  | { id: StormSourceId; kind: "partial"; lastSuccessAt: string; lastError: string }
  | { id: StormSourceId; kind: "ok"; lastSuccessAt: string };

export function stormSourceConditions(data: StormsResponse | null): StormSourceCondition[] {
  return STORM_SOURCES.map((id) => {
    const s = data?.sources.find((x) => x.id === id);
    if (!s || s.lastSuccessAt === null) {
      return { id, kind: "never", lastAttemptAt: s?.lastAttemptAt ?? null, lastError: s?.lastError ?? null };
    }
    if (s.lastError !== null) {
      // StormTrackDO: รอบที่ได้รายการเขียน lastSuccessAt = lastAttemptAt = เวลาเริ่มรอบ (ครบ/ไม่ครบ
      // แยกด้วย lastError) ส่วนรอบที่ล้มทั้งแหล่งขยับแค่ lastAttemptAt — จึงแยกสองกรณีได้จาก meta
      // ที่มีอยู่แล้ว ไม่ต้องเพิ่มฟิลด์ในสัญญา; lastAttemptAt ไม่มี = บอกไม่ได้ → ถือว่าล้มเหลว (ข้างปลอดภัย)
      if (s.lastAttemptAt !== null && s.lastAttemptAt === s.lastSuccessAt) {
        return { id, kind: "partial", lastSuccessAt: s.lastSuccessAt, lastError: s.lastError };
      }
      return { id, kind: "failing", lastSuccessAt: s.lastSuccessAt, lastAttemptAt: s.lastAttemptAt, lastError: s.lastError };
    }
    return { id, kind: "ok", lastSuccessAt: s.lastSuccessAt };
  });
}

/**
 * สรุปของแผง (และ badge) — แยกทุกกรณีที่ "ไม่มีรายการ" ออกจากกัน:
 *   - `loading`         : ยังไม่ได้คำตอบแรก
 *   - `api-unreachable` : คำขอของเว็บไปไม่ถึง API ของเราเลย (ไม่มีอะไรค้างให้แสดง)
 *   - `never`           : API ตอบ แต่ไม่มีแหล่งไหนเคยดึงสำเร็จ
 *   - `unchecked`       : ไม่มีพายุในมือ และไม่มีแหล่งไหนให้คำตอบครบในรอบล่าสุด (ล้มเหลว หรือ
 *                         ได้ไม่ครบ — แหล่ง `partial` ที่ไม่มีพายุในมือแปลว่ามีพายุที่โหลดไม่ขึ้น)
 *   - `none-reported`   : ไม่มีพายุ ตามแหล่งที่ `ok` (อาจมีแหล่งอื่นล้มเหลว/ไม่ครบอยู่ด้วย)
 *   - `storms`          : มีรายการ
 */
export type StormSummary =
  | { kind: "loading" }
  | { kind: "api-unreachable" }
  | { kind: "never" }
  | { kind: "unchecked" }
  | { kind: "none-reported"; reachable: StormSourceId[] }
  | { kind: "storms"; n: number };

export function summarizeStorms(state: { data: StormsResponse | null; loading: boolean; error: unknown }): StormSummary {
  const { data, error } = state;
  if (!data) return error ? { kind: "api-unreachable" } : { kind: "loading" };
  if (data.storms.length > 0) return { kind: "storms", n: data.storms.length };
  const conds = stormSourceConditions(data);
  if (conds.every((c) => c.kind === "never")) return { kind: "never" };
  const reachable = conds.filter((c) => c.kind === "ok").map((c) => c.id);
  if (reachable.length === 0) return { kind: "unchecked" };
  return { kind: "none-reported", reachable };
}

/** จุดวิเคราะห์ล่าสุด (ตัวท้ายของ `past`) — null เมื่อไม่มีเลย */
export function latestFix(storm: StormTrack): StormPastPosition | null {
  return storm.past.length > 0 ? storm.past[storm.past.length - 1] : null;
}

/**
 * เวลาของจุดวิเคราะห์ล่าสุดที่ **มีเวลากำกับ** — JMA ให้เวลาเฉพาะจุดล่าสุด จุดก่อนหน้า
 * เป็น `[lat, lon]` เปล่า ๆ (null) ห้ามเดา/ประมาณค่า
 */
export function latestFixTime(storm: StormTrack): string | null {
  for (let i = storm.past.length - 1; i >= 0; i--) {
    const at = storm.past[i].observedAt;
    if (at) return at;
  }
  return null;
}

/** อายุของจุดล่าสุด (ms) — null เมื่อต้นทางไม่ให้เวลาเลย */
export function fixAgeMs(storm: StormTrack, nowMs: number): number | null {
  const at = latestFixTime(storm);
  if (!at) return null;
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? null : nowMs - ms;
}

/** จุดล่าสุดเก่ากว่า 24 ชม. → แผงต้องบอกอายุ ไม่ใช่ "กำลังเคลื่อนที่" */
export function isOldFix(storm: StormTrack, nowMs: number): boolean {
  const age = fixAgeMs(storm, nowMs);
  return age !== null && age > STORM_FIX_OLD_MS;
}

/** ตำแหน่งพยากรณ์ที่เวลาใช้ได้ผ่านไปแล้ว (คำพยากรณ์เก่าที่ยังค้างอยู่ในคำตอบ) */
export function isPastValidTime(validAt: string, nowMs: number): boolean {
  const ms = Date.parse(validAt);
  return !Number.isNaN(ms) && ms < nowMs;
}

/** ระยะ (กม.) จากจังหวัดถึงพายุตามที่ API คำนวณ — null เมื่อไม่มีค่า (ห้ามแทนด้วย 0) */
export function stormDistanceKm(storm: StormTrack, provinceCode: string): number | null {
  const v = storm.nearestKmByProvince[provinceCode];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** พายุที่เข้าเกณฑ์ `STORM_NOTIFY_KM` ของจังหวัดนี้ */
export function stormsWithin(
  data: StormsResponse | null,
  provinceCode: string,
  km: number = STORM_NOTIFY_KM,
): StormTrack[] {
  return (data?.storms ?? []).filter((s) => {
    const d = stormDistanceKm(s, provinceCode);
    return d !== null && d <= km;
  });
}

/**
 * ตัวระบุ "ฉบับ" ของข้อมูลพายุ สำหรับ id ของแถวแจ้งเตือน — เปลี่ยนเฉพาะเมื่อต้นทางเปลี่ยน:
 * เวลาออกประกาศ ?? เวลาของจุดล่าสุดที่มีเวลา (past) ?? validAt ของจุดพยากรณ์สุดท้าย ?? "nofix"
 * **ห้ามใช้ fetchedAt** — มันเดินทุกรอบดึงแม้เส้นทางเหมือนเดิม
 */
export function stormRevision(storm: StormTrack): string {
  return (
    storm.advisoryIssuedAt ??
    latestFixTime(storm) ??
    storm.forecast[storm.forecast.length - 1]?.validAt ??
    "nofix"
  );
}
