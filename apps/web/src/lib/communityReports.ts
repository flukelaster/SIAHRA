/**
 * รายงานผลกระทบจากประชาชน (community report pins) ฝั่งเว็บ — กฎล้วน ๆ ไม่มี React/DOM/three
 *
 * ทุกอย่างในไฟล์นี้เป็น "การแสดงผล" ของรายการที่ API ส่งมา ไม่ใช่การประเมินความน่าเชื่อถือ:
 *   - หน้าต่างเวลา: แสดงเฉพาะรายงานที่ `createdAt` อยู่ใน [เวลาที่ดู − ช่วงของแถบเวลา, เวลาที่ดู]
 *     (เจ้าของตัดสินใจ — ดูสด = ตอนนี้) กรองฝั่ง client เพราะ API ไม่รับ query เลย
 *   - ความจางของหมุด: เต็มเมื่ออายุ < 6 ชม. แล้วจางลงเป็นเส้นตรงถึงพื้นที่ 7 วันขึ้นไป และจางอีกเมื่อโหวต
 *     "ไม่ตรงความจริง" มากกว่า "เห็นจริง" — เป็นแค่การลดน้ำหนักทางสายตา ไม่มีการคิดคะแนนความจริงใด ๆ
 *   - ชั้นซ้อนในเครื่อง (overlay): การโหวต/ลบของผู้ใช้เองถูกใส่ทับรายการทันที เพราะรายการถูกแคชที่ขอบ
 *     30 วิ + memo ใน DO 30 วิ — overlay ถูกทิ้งเมื่อ `fetchedAt` ของคำตอบใหม่ (เวลาที่ DO อ่านจริง)
 *     ใหม่กว่าเวลาที่แก้ในเครื่อง คือเมื่อ server เห็นการเปลี่ยนนั้นแล้ว
 */
import type { CommunityCategory, CommunityReport, CommunityReportsResponse } from "@siahra/shared-types";

/* ------------------------------------------------------------------ */
/* หน้าต่างเวลา                                                          */
/* ------------------------------------------------------------------ */

export interface CommunityWindow {
  /** ขอบล่าง (รวม) ms */
  startMs: number;
  /** ขอบบน (รวม) ms — เวลาที่ดูอยู่ (`atIso`) หรือ "ตอนนี้" เมื่อดูสด */
  endMs: number;
}

/** หน้าต่างของหมุด: [เวลาที่ดู − ช่วงของแถบเวลา, เวลาที่ดู] — `atIso` null = ดูสด (ตอนนี้) */
export function communityWindow(atIso: string | null, rangeHours: number, nowMs: number): CommunityWindow {
  const at = atIso !== null ? Date.parse(atIso) : Number.NaN;
  const endMs = Number.isFinite(at) ? at : nowMs;
  return { startMs: endMs - rangeHours * 3_600_000, endMs };
}

/** รายงานในหน้าต่าง — `createdAt` ที่อ่านไม่ได้ไม่ถูกแสดง (ไม่เดาเวลาให้) */
export function reportsInWindow(reports: readonly CommunityReport[], win: CommunityWindow): CommunityReport[] {
  return reports.filter((r) => {
    const ms = Date.parse(r.createdAt);
    return Number.isFinite(ms) && ms >= win.startMs && ms <= win.endMs;
  });
}

/* ------------------------------------------------------------------ */
/* ความจางของหมุด                                                        */
/* ------------------------------------------------------------------ */

/** อายุน้อยกว่านี้ = ทึบเต็ม */
export const COMMUNITY_FULL_ALPHA_MS = 6 * 3_600_000;
/** อายุถึงนี้ขึ้นไป = จางถึงพื้น */
export const COMMUNITY_FLOOR_AGE_MS = 7 * 24 * 3_600_000;
/** พื้นของความทึบตามอายุ — หมุดเก่ายังเห็นได้ ไม่หายไป */
export const COMMUNITY_MIN_ALPHA = 0.35;
/** คูณเพิ่มเมื่อ down > up (ผู้ใช้อื่นโหวตว่าไม่ตรงความจริงมากกว่า) — ความเห็น ไม่ใช่การยืนยัน */
export const COMMUNITY_DISPUTED_FACTOR = 0.6;

/**
 * ความทึบของหมุดหนึ่งตัว (0–1) — `refMs` = เวลาที่ดูอยู่ (ย้อนหลัง = `atIso`, สด = ตอนนี้)
 * อายุติดลบ (เวลาในเครื่องช้ากว่า server) นับเป็น 0
 */
export function communityMarkerAlpha(report: Pick<CommunityReport, "createdAt" | "up" | "down">, refMs: number): number {
  const created = Date.parse(report.createdAt);
  const age = Number.isFinite(created) ? Math.max(0, refMs - created) : COMMUNITY_FLOOR_AGE_MS;
  let alpha: number;
  if (age <= COMMUNITY_FULL_ALPHA_MS) alpha = 1;
  else if (age >= COMMUNITY_FLOOR_AGE_MS) alpha = COMMUNITY_MIN_ALPHA;
  else {
    const f = (age - COMMUNITY_FULL_ALPHA_MS) / (COMMUNITY_FLOOR_AGE_MS - COMMUNITY_FULL_ALPHA_MS);
    alpha = 1 - f * (1 - COMMUNITY_MIN_ALPHA);
  }
  return report.down > report.up ? alpha * COMMUNITY_DISPUTED_FACTOR : alpha;
}

/** หมวดหลัก = หมวดแรกที่ผู้รายงานเลือก (API บังคับให้มีอย่างน้อยหนึ่ง) — ใช้เลือกไอคอนของหมุด */
export function primaryCategory(report: Pick<CommunityReport, "categories">): CommunityCategory {
  return report.categories[0] ?? "other";
}

/**
 * สีประจำหมวด — หมุด (canvas), swatch ใน legend และชิปในแผงรายงานอ่านจากตารางเดียวกัน
 * ขอบหมุดใช้ชมพูของป้าย crowdsourced (`EPISTEMIC_BADGE.crowdsourced`) ทุกหมวด
 */
export const COMMUNITY_CATEGORY_COLOR: Record<CommunityCategory, string> = {
  flood: "#60a5fa",
  "road-blocked": "#fb923c",
  "power-out": "#facc15",
  landslide: "#d6a36b",
  "fallen-tree": "#4ade80",
  "building-damage": "#f87171",
  other: "#cbd5e1",
};

/** ขอบของหมุดทุกตัว — ชมพูเดียวกับชิป "รายงานจากประชาชน — ยังไม่ได้ตรวจสอบ" */
export const COMMUNITY_PIN_RIM = "#ec4899";

/* ------------------------------------------------------------------ */
/* ชั้นซ้อนในเครื่อง (optimistic)                                          */
/* ------------------------------------------------------------------ */

export interface CommunityOverlay {
  /** รายงานที่ใส่เอง (PR C: หมุดของผู้รายงานเอง) — `atMs` = เวลาในเครื่องตอนใส่ */
  upserts: ReadonlyMap<string, { report: CommunityReport; atMs: number }>;
  /** รายงานที่ลบเอง */
  removals: ReadonlyMap<string, number>;
  /** ตัวนับโหวตที่ server ตอบกลับมาหลังการโหวตของผู้ใช้ */
  votes: ReadonlyMap<string, { up: number; down: number; hidden: boolean; atMs: number }>;
}

export const EMPTY_OVERLAY: CommunityOverlay = { upserts: new Map(), removals: new Map(), votes: new Map() };

/**
 * ทิ้งรายการใน overlay ที่ server เห็นแล้ว — คำตอบที่ DO อ่าน (`fetchedAt`) **หลัง** การแก้ในเครื่อง
 * สะท้อนการแก้นั้นอยู่แล้ว คืนอ็อบเจ็กต์เดิมเมื่อไม่มีอะไรถูกทิ้ง
 */
export function pruneOverlay(overlay: CommunityOverlay, fetchedAt: string): CommunityOverlay {
  const seenMs = Date.parse(fetchedAt);
  if (!Number.isFinite(seenMs)) return overlay;
  const keep = <V>(m: ReadonlyMap<string, V>, at: (v: V) => number) => {
    const out = new Map<string, V>();
    for (const [k, v] of m) if (at(v) >= seenMs) out.set(k, v);
    return out.size === m.size ? m : out;
  };
  const upserts = keep(overlay.upserts, (v) => v.atMs);
  const removals = keep(overlay.removals, (v) => v);
  const votes = keep(overlay.votes, (v) => v.atMs);
  return upserts === overlay.upserts && removals === overlay.removals && votes === overlay.votes
    ? overlay
    : { upserts, removals, votes };
}

/**
 * รายการที่แสดง = คำตอบของ server + overlay — รายงานที่โหวตแล้วถูกซ่อน (`hidden`) ออกจากรายการและนับเพิ่มใน
 * `hiddenCount` (ไม่หายเงียบ); ลำดับใหม่สุดก่อนตามที่ API ส่ง รายงานที่ใส่เองอยู่หน้าสุด
 */
export function applyOverlay(res: CommunityReportsResponse, overlay: CommunityOverlay): CommunityReportsResponse {
  if (overlay.upserts.size === 0 && overlay.removals.size === 0 && overlay.votes.size === 0) return res;
  let hiddenCount = res.hiddenCount;
  const serverIds = new Set(res.reports.map((r) => r.id));
  const added = [...overlay.upserts.values()].map((u) => u.report).filter((r) => !serverIds.has(r.id));
  const reports: CommunityReport[] = [];
  for (const r0 of [...added, ...res.reports]) {
    if (overlay.removals.has(r0.id)) continue;
    const upsert = overlay.upserts.get(r0.id);
    let r = upsert && serverIds.has(r0.id) ? { ...r0, ...upsert.report } : r0;
    const v = overlay.votes.get(r.id);
    if (v) {
      if (v.hidden) {
        hiddenCount += 1;
        continue;
      }
      r = { ...r, up: v.up, down: v.down };
    }
    reports.push(r);
  }
  return { ...res, reports, hiddenCount };
}
