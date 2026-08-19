/**
 * แปลง `HazardLayerDescriptor` เป็นข้อความที่ legend แสดงจริง — ป้ายชนิดความรู้
 * (epistemic badge) กับบรรทัดเวลา "ตรวจวัด HH:mm · ดึงข้อมูล N นาทีที่แล้ว"
 *
 * ความซื่อสัตย์ต่อข้อมูลสองข้อที่ไฟล์นี้เป็นคนบังคับ:
 *
 * 1. อายุข้อมูลถูกคำนวณตอน "เรนเดอร์" เสมอ (`nowMs` ส่งเข้ามาจากนาฬิกาที่เดินอยู่)
 *    ไม่มีการเก็บหรือส่งค่าอายุผ่าน API — อายุที่ถูก serialise ไว้จะผิดทันทีที่ถูกอ่าน
 *
 * 2. `fetchedAt: null` ห้ามกลายเป็นเวลาใด ๆ และข้อความแทนต้องเลือกตาม *ชนิด* ของชั้น
 *    ไม่ใช่ตามความเป็น null อย่างเดียว:
 *      - observed         → "ยังไม่เคยได้รับข้อมูล" (เราดึงไม่สำเร็จจริง ๆ)
 *      - static-reference → "ไม่ได้บันทึกเวลาที่ดึงข้อมูล" (ของอยู่ในชุดข้อมูลแล้ว
 *                            แต่ไปป์ไลน์ยังไม่ได้บันทึกเวลาของ artefact นั้นไว้ — E9.1)
 *      - illustrative     → ไม่ได้ "ดึง" มาจากไหน เพราะคำนวณจากภูมิประเทศเอง
 *      - probabilistic    → ยังไม่มีชั้นแบบนี้ในระบบ แต่ต้องมีข้อความรองรับไว้
 *    การใช้ "ยังไม่เคยได้รับข้อมูล" กับ static-reference จะเป็นการกล่าวหาว่าดึงพลาด
 *    ทั้งที่ความจริงคือไม่เคยจดเวลาไว้ — คนละเรื่องกัน
 */
import type { EpistemicClass, HazardLayerDescriptor, SourceHealth } from "@siahra/shared-types";
import { formatAge, formatTime, NEVER_RECEIVED_TH } from "./time";

export interface EpistemicBadge {
  label: string;
  /** คำอธิบายเต็มสำหรับ `title` */
  title: string;
  /** คลาส Tailwind ของชิป */
  className: string;
}

/**
 * ป้ายสี่ชนิดตาม `EpistemicClass` — ผู้ใช้ต้องแยกออกว่าอันไหน "มีคนวัดมา" และ
 * อันไหน "เราคำนวณเอง" ก่อนจะอ่านตัวเลขใด ๆ บนแผนที่
 */
export const EPISTEMIC_BADGE: Record<EpistemicClass, EpistemicBadge> = {
  observed: {
    label: "ตรวจวัดจริง",
    title: "ค่าที่เครื่องมือตรวจวัด/ดาวเทียมรายงานมาโดยตรง",
    className: "bg-[var(--color-success)]/15 text-[#7ee2a8] ring-[var(--color-success)]/35",
  },
  "static-reference": {
    label: "ข้อมูลอ้างอิงคงที่",
    title: "ชุดข้อมูลอ้างอิงที่ฝังมากับแผนที่ ไม่ได้อัปเดตแบบเรียลไทม์",
    className: "bg-white/8 text-[var(--color-fg-muted)] ring-white/15",
  },
  illustrative: {
    label: "ภาพประกอบ",
    title: "เราคำนวณเองจากภูมิประเทศเพื่อประกอบการอ่านแผนที่ ไม่ใช่การตรวจวัดและไม่ใช่การพยากรณ์",
    className: "bg-[#8b5cf6]/18 text-[#c4b0f5] ring-[#8b5cf6]/40",
  },
  probabilistic: {
    // ยังไม่มีชั้นชนิดนี้ในระบบ (ดู D-1 ใน docs/roadmap.md) — มีไว้ให้ tsc บังคับว่า
    // ครบทุกชนิด ถ้าวันหนึ่งมีชั้นแบบนี้จริงจะได้ไม่หลุดออกไปโดยไม่มีป้าย
    label: "แบบจำลองภายนอกที่อ้างอิงได้",
    title: "ผลจากแบบจำลองของหน่วยงานภายนอกที่ระบุที่มาได้ ไม่ใช่การคำนวณของโครงการนี้",
    className: "bg-[var(--color-risk-low)]/15 text-[var(--color-risk-low)] ring-[var(--color-risk-low)]/35",
  },
};

/**
 * ป้ายสำรองเมื่อ api ส่งชนิดที่บันเดิลนี้ยังไม่รู้จัก (api กับ web deploy แยกกัน)
 * — ต้องบอกว่า "ไม่ทราบชนิด" ไม่ใช่เดาเป็นชนิดใดชนิดหนึ่ง เพราะการติดป้ายผิดชนิด
 * คือการบิดเบือนว่าข้อมูลนั้นมาจากไหน
 */
export const UNKNOWN_BADGE: EpistemicBadge = {
  label: "ไม่ทราบชนิดข้อมูล",
  title: "แอปรุ่นนี้ยังไม่รู้จักชนิดของชั้นข้อมูลนี้",
  className: "bg-white/8 text-[var(--color-fg-subtle)] ring-white/15",
};

/** ข้อความแทน `fetchedAt: null` เลือกตามชนิดของชั้นข้อมูล (ห้ามคืนเป็นเวลา) */
export function missingFetchedAtText(kind: EpistemicClass): string {
  switch (kind) {
    case "observed":
      return NEVER_RECEIVED_TH;
    case "static-reference":
      return "ไม่ได้บันทึกเวลาที่ดึงข้อมูล";
    case "illustrative":
      return "คำนวณจากภูมิประเทศ ไม่มีการดึงข้อมูลรายครั้ง";
    case "probabilistic":
      return "ยังไม่เคยได้รับผลจากแบบจำลอง";
  }
  // ชนิดที่ยังไม่รู้จัก: บอกว่าไม่ทราบเวลา ห้ามเดาเป็นเวลาใด ๆ
  return "ไม่ทราบเวลาที่ดึงข้อมูล";
}

export interface LayerFreshness {
  badge: EpistemicBadge;
  /** บรรทัดเวลาที่ประกอบเสร็จแล้ว เช่น "ตรวจวัด 14:30 · ดึงข้อมูล 5 นาทีที่แล้ว" */
  timeText: string;
  /** true = แสดงบรรทัดเวลาเป็นสีเหลืองอำพัน (ข้อมูลค้าง/ดึงไม่สำเร็จ) */
  amber: boolean;
  /** สถานะจาก /api/v1/health ที่ต้องพูดเพิ่ม (เช่น delayed) หรือ null */
  statusText: string | null;
}

function isStale(d: HazardLayerDescriptor, nowMs: number): boolean {
  if (!d.fetchedAt) {
    // ไม่เคยดึงสำเร็จ = ข้อมูลสด "หายไป" จริง; ส่วนชั้นคงที่/ภาพประกอบไม่มีรอบดึง
    return d.epistemicClass === "observed" || d.epistemicClass === "probabilistic";
  }
  if (!d.staleAfterSeconds) return false;
  const ms = Date.parse(d.fetchedAt);
  if (Number.isNaN(ms)) return false;
  return nowMs - ms > d.staleAfterSeconds * 1000;
}

/**
 * `health` คือสถานะของแหล่งข้อมูลที่ชั้นนี้ผูกอยู่ (join ผ่าน `sourceIds`)
 * `delayed` (E3.3) ไม่ใช่ "เราดึงไม่ได้" แต่คือ "ต้นทางยังไม่ปล่อยค่าตรวจวัดรอบใหม่"
 * จึงต้องพูดคนละประโยคกับข้อมูลค้าง แม้จะเน้นสีเหมือนกันว่าอย่าอ่านเป็นค่าปัจจุบัน
 */
export function describeLayerFreshness(
  descriptor: HazardLayerDescriptor,
  health: SourceHealth | null,
  nowMs: number,
): LayerFreshness {
  const parts: string[] = [];
  if (descriptor.observedAt) parts.push(`ตรวจวัด ${formatTime(descriptor.observedAt)}`);
  parts.push(
    descriptor.fetchedAt
      ? `ดึงข้อมูล ${formatAge(descriptor.fetchedAt, nowMs)}`
      : missingFetchedAtText(descriptor.epistemicClass),
  );

  const stale = isStale(descriptor, nowMs);
  const unhealthy = health !== null && health !== "ok";
  const statusText =
    health === "delayed"
      ? "ต้นทางยังไม่ส่งค่าใหม่"
      : health === "down"
        ? "ดึงข้อมูลไม่ได้"
        : health === "degraded"
          ? "บางแหล่งล้มเหลว"
          : health === "stale"
            ? "ข้อมูลค้าง"
            : // api รุ่นใหม่อาจส่งสถานะที่บันเดิลนี้ยังไม่รู้จัก — แถวจะเป็นสีเหลือง
              // อยู่แล้ว จึงต้องบอกเหตุผลด้วย ไม่ใช่เหลืองเฉย ๆ โดยไม่มีคำอธิบาย
              health !== null && health !== "ok"
              ? "ยังไม่ทราบสถานะแหล่งข้อมูล"
              : null;

  return {
    badge: EPISTEMIC_BADGE[descriptor.epistemicClass] ?? UNKNOWN_BADGE,
    timeText: parts.join(" · "),
    amber: stale || unhealthy,
    statusText,
  };
}
