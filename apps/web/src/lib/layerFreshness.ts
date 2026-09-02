/**
 * แปลง `HazardLayerDescriptor` เป็นข้อความที่ legend แสดงจริง — ป้ายชนิดความรู้
 * (epistemic badge) กับบรรทัดเวลา "ตรวจวัด HH:mm · ดึงข้อมูล N นาทีที่แล้ว"
 *
 * (`observedAt` ที่เก่ากว่า 24 ชม. แสดงเป็นวัน-เวลาเต็ม — ดู `formatObservedAt`)
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
 *      - forecast         → "ยังไม่เคยได้รับผลพยากรณ์จาก TMD" (เราดึงจากแบบจำลอง
 *                            ของหน่วยงานภายนอกไม่สำเร็จจริง ๆ — ต่างจาก probabilistic
 *                            ตรงที่ชั้นชนิดนี้มีใช้จริง)
 *    การใช้ "ยังไม่เคยได้รับข้อมูล" กับ static-reference จะเป็นการกล่าวหาว่าดึงพลาด
 *    ทั้งที่ความจริงคือไม่เคยจดเวลาไว้ — คนละเรื่องกัน
 *
 * ทั้งสองข้อต้องเป็นจริงในทั้งสองภาษา ข้อความจึงอยู่ใน `i18n/{th,en}.ts` และไฟล์นี้
 * ถือแค่ "คีย์ไหนคู่กับสถานะไหน" (ดูเทสใน `i18n/catalog.test.ts` ที่กันไม่ให้
 * delayed กับ stale กลายเป็นข้อความเดียวกัน)
 */
import type { EpistemicClass, HazardLayerDescriptor, SourceHealth } from "@siahra/shared-types";
import type { Lang, MessageKey, TFunction } from "../i18n";
import { formatAge, formatFullDateTime, formatTime } from "./time";

export interface EpistemicBadge {
  labelKey: MessageKey;
  /** คีย์ของคำอธิบายเต็มสำหรับ `title` */
  titleKey: MessageKey;
  /** คลาส Tailwind ของชิป */
  className: string;
}

/**
 * ป้ายห้าชนิดตาม `EpistemicClass` — ผู้ใช้ต้องแยกออกว่าอันไหน "มีคนวัดมา" และ
 * อันไหน "เราคำนวณเอง" ก่อนจะอ่านตัวเลขใด ๆ บนแผนที่
 */
export const EPISTEMIC_BADGE: Record<EpistemicClass, EpistemicBadge> = {
  observed: {
    labelKey: "badge.observed",
    titleKey: "badge.observed.title",
    className: "bg-[var(--color-success)]/15 text-[#7ee2a8] ring-[var(--color-success)]/35",
  },
  "static-reference": {
    labelKey: "badge.staticReference",
    titleKey: "badge.staticReference.title",
    className: "bg-white/8 text-[var(--color-fg-muted)] ring-white/15",
  },
  illustrative: {
    labelKey: "badge.illustrative",
    titleKey: "badge.illustrative.title",
    className: "bg-[#8b5cf6]/18 text-[#c4b0f5] ring-[#8b5cf6]/40",
  },
  probabilistic: {
    // ยังไม่มีชั้นชนิดนี้ในระบบ (ดู D-1 ใน docs/roadmap.md) — มีไว้ให้ tsc บังคับว่า
    // ครบทุกชนิด ถ้าวันหนึ่งมีชั้นแบบนี้จริงจะได้ไม่หลุดออกไปโดยไม่มีป้าย
    labelKey: "badge.probabilistic",
    titleKey: "badge.probabilistic.title",
    className: "bg-[var(--color-risk-low)]/15 text-[var(--color-risk-low)] ring-[var(--color-risk-low)]/35",
  },
  forecast: {
    // ต่างจาก probabilistic ข้างบน: ชั้นชนิดนี้มีข้อมูลจริงกำลังจะเข้ามา (TMD NWP)
    // จึงต้องอ่านออกทันทีว่าเป็นค่าของอนาคตจากแบบจำลองภายนอก ไม่ใช่ค่าที่วัดมา
    labelKey: "badge.forecast",
    titleKey: "badge.forecast.title",
    // ตามแบบเดียวกับชิปอื่น: พื้น/ขอบใช้โทเคน ส่วนสีตัวอักษรเป็นเฉดอ่อนของโทเคนนั้น
    // (พื้นเป็นสีจาง 18% ไม่ใช่สีทึบ ตัวอักษรจึงต้องเป็นสีที่อ่านบนพื้นเข้ม ไม่ใช่ --color-accent-fg)
    className: "bg-[var(--color-accent)]/18 text-[#9dc0ff] ring-[var(--color-accent)]/40",
  },
};

/**
 * ป้ายสำรองเมื่อ api ส่งชนิดที่บันเดิลนี้ยังไม่รู้จัก (api กับ web deploy แยกกัน)
 * — ต้องบอกว่า "ไม่ทราบชนิด" ไม่ใช่เดาเป็นชนิดใดชนิดหนึ่ง เพราะการติดป้ายผิดชนิด
 * คือการบิดเบือนว่าข้อมูลนั้นมาจากไหน
 */
export const UNKNOWN_BADGE: EpistemicBadge = {
  labelKey: "badge.unknown",
  titleKey: "badge.unknown.title",
  className: "bg-white/8 text-[var(--color-fg-subtle)] ring-white/15",
};

/** คีย์ข้อความแทน `fetchedAt: null` เลือกตามชนิดของชั้นข้อมูล (ห้ามคืนเป็นเวลา) */
export function missingFetchedAtKey(kind: EpistemicClass): MessageKey {
  switch (kind) {
    case "observed":
      return "freshness.missing.observed";
    case "static-reference":
      return "freshness.missing.staticReference";
    case "illustrative":
      return "freshness.missing.illustrative";
    case "probabilistic":
      return "freshness.missing.probabilistic";
    case "forecast":
      return "freshness.missing.forecast";
  }
  // ชนิดที่ยังไม่รู้จัก: บอกว่าไม่ทราบเวลา ห้ามเดาเป็นเวลาใด ๆ
  return "freshness.missing.unknown";
}

/** คีย์ข้อความของสถานะแหล่งข้อมูล — `null` = ปกติ ไม่ต้องพูดอะไรเพิ่ม */
export function healthStatusKey(health: SourceHealth | null): MessageKey | null {
  switch (health) {
    case null:
    case "ok":
      return null;
    case "delayed":
      return "health.delayed";
    case "down":
      return "health.down";
    case "degraded":
      return "health.degraded";
    case "stale":
      return "health.stale";
    default:
      // api รุ่นใหม่อาจส่งสถานะที่บันเดิลนี้ยังไม่รู้จัก — แถวจะเป็นสีเหลือง
      // อยู่แล้ว จึงต้องบอกเหตุผลด้วย ไม่ใช่เหลืองเฉย ๆ โดยไม่มีคำอธิบาย
      return "freshness.status.unknown";
  }
}

export interface LayerFreshness {
  badge: { label: string; title: string; className: string };
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
    // ชั้นพยากรณ์มีรอบดึงเหมือนข้อมูลสด จึงนับเป็นข้อมูลหายเช่นกัน
    return (
      d.epistemicClass === "observed" ||
      d.epistemicClass === "probabilistic" ||
      d.epistemicClass === "forecast"
    );
  }
  if (!d.staleAfterSeconds) return false;
  const ms = Date.parse(d.fetchedAt);
  if (Number.isNaN(ms)) return false;
  return nowMs - ms > d.staleAfterSeconds * 1000;
}

/**
 * `observedAt` ที่เก่ากว่านี้เลิกแสดงเป็นเวลานาฬิกาอย่างเดียว — "ตรวจวัด 06:14" เป็น
 * ธรรมเนียมของแหล่งราย 5 นาที (ThaiWater เรดาร์) ที่ค่าล่าสุดอยู่ในวันเดียวกันเสมอ
 * แต่ฉาก Sentinel-1 (E14.F4) มีอายุเป็นวันหรือปีได้ และ "06:14" ของเมื่อวานซืนอ่าน
 * เหมือน "06:14" ของวันนี้ทุกประการ
 */
export const OBSERVED_AT_FULL_DATE_AFTER_MS = 24 * 60 * 60 * 1000;

/** เวลาตรวจวัด: นาฬิกาอย่างเดียวภายใน 24 ชม. ล่าสุด, เกินนั้น = วัน-เดือน-ปี + เวลา */
export function formatObservedAt(lang: Lang, iso: string, nowMs: number): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms) || nowMs - ms <= OBSERVED_AT_FULL_DATE_AFTER_MS) return formatTime(lang, iso);
  return formatFullDateTime(lang, iso);
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
  lang: Lang,
  t: TFunction,
): LayerFreshness {
  const parts: string[] = [];
  if (descriptor.observedAt) {
    parts.push(t("freshness.observedAt", { time: formatObservedAt(lang, descriptor.observedAt, nowMs) }));
  }
  // `publishedAt` มีเฉพาะต้นทางที่ประกาศเวลาเผยแพร่ไว้เอง (เช่น
  // `osmosis_replication_timestamp` ของ OSM extract, ดัชนีเรดาร์ของ TMD) —
  // แสดงเป็นวัน-เวลาเต็ม ไม่ใช่ "อายุ" เพราะมันคือเหตุการณ์ของต้นทาง ไม่ใช่รอบดึง
  // ของเรา และห้ามเอา observedAt/fetchedAt มาสวมแทนเมื่อมันเป็น null
  if (descriptor.publishedAt) {
    parts.push(t("freshness.publishedAt", { time: formatFullDateTime(lang, descriptor.publishedAt) }));
  }
  parts.push(
    descriptor.fetchedAt
      ? t("freshness.fetchedAt", { age: formatAge(lang, descriptor.fetchedAt, nowMs) })
      : t(missingFetchedAtKey(descriptor.epistemicClass)),
  );

  const stale = isStale(descriptor, nowMs);
  const unhealthy = health !== null && health !== "ok";
  const statusKey = healthStatusKey(health);
  const badge = EPISTEMIC_BADGE[descriptor.epistemicClass] ?? UNKNOWN_BADGE;

  return {
    badge: {
      label: t(badge.labelKey),
      title: t(badge.titleKey),
      className: badge.className,
    },
    timeText: parts.join(" · "),
    amber: stale || unhealthy,
    statusText: statusKey ? t(statusKey) : null,
  };
}
