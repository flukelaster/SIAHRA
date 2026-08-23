import type { SourceId } from "./sources.js";

/**
 * Every hazard layer rendered on the map must declare what kind of claim it is
 * making, so the UI can style/badge it honestly instead of implying more
 * certainty than the underlying data supports.
 *
 * - observed:         a sensor/network reported this directly (rain gauge, seismograph, tide station)
 * - static-reference:  a government-published hazard-zone/geology dataset; not live, not a forecast
 * - illustrative:      a topographic approximation we computed; explicitly not a calibrated model
 * - probabilistic:     a named, cited, third-party probabilistic model (e.g. USGS aftershock forecast)
 * - forecast:          a named, cited, third-party DETERMINISTIC model forecast (e.g. TMD NWP);
 *                      never computed here, and never a probability — a value valid for a future
 *                      instant is still not a statement about how likely anything is
 */
export type EpistemicClass =
  | "observed"
  | "static-reference"
  | "illustrative"
  | "probabilistic"
  | "forecast";

/**
 * A layer carries three distinct timestamps, and conflating any two of them is
 * a data-honesty bug:
 *
 * - observedAt:  when the phenomenon was measured (gauge reading, radar scan,
 *                satellite acquisition). What the number is *about*.
 * - publishedAt: when the upstream made that measurement available or last
 *                revised it. Null whenever the upstream publishes no such
 *                timestamp — never substitute the observation time for it.
 * - fetchedAt:   when our backend last received the data successfully
 *                ("received"). Null = never succeeded, and null must never be
 *                rendered as "now".
 *
 * Age ("N minutes old") is computed at RENDER time from these instants against
 * the current clock. There is deliberately no `age*` field on this type: a
 * cached age is wrong the moment it is serialised, and a stale age reads as a
 * fresh one.
 */
export interface HazardLayerDescriptor {
  id: string;
  epistemicClass: EpistemicClass;
  liveOrStatic: "live" | "static";
  /** เวลาที่ปรากฏการณ์ถูกวัดจริง */
  observedAt?: string;
  /** เวลาที่ต้นทางเผยแพร่/แก้ไขข้อมูลชุดนี้ — null = ต้นทางไม่ได้บอกเวลาไว้ */
  publishedAt?: string | null;
  /** เวลาที่ backend ดึงสำเร็จครั้งล่าสุด — null = ยังไม่เคยสำเร็จ (ห้ามแทนด้วย "ตอนนี้") */
  fetchedAt: string | null;
  staleAfterSeconds?: number;
  methodologyUrl?: string;
  /** Join key into SOURCES / /api/v1/health `.sources[].id`. */
  sourceIds: SourceId[];
  /**
   * Only for `epistemicClass: "forecast"`: which third-party model produced the
   * values, at what grid resolution, and how far ahead it reaches — so the UI can
   * name the model instead of implying we computed anything.
   *
   * `issuedAt` is the model RUN time (the cycle the numbers came out of), and it
   * exists only when the upstream publishes one. TMD's NWP API does not: it
   * returns the forecast valid time and nothing about the run, so `issuedAt` is
   * `null` for that source. Null must never be filled in from `fetchedAt` —
   * exactly the rule `publishedAt` carries. "When we asked" is not "when the
   * model ran", and synthesising one from the other invents a provenance the
   * upstream never gave us.
   */
  forecast?: {
    /** ชื่อแบบจำลองตามที่ต้นทางเรียก (เช่น "TMD WRF-ARW") */
    modelName: string;
    /** ความละเอียดกริดของแบบจำลอง (กม.) ตามที่ต้นทางประกาศ */
    resolutionKm: number;
    /** ระยะเวลาที่แบบจำลองพยากรณ์ไปข้างหน้า (ชม.) */
    horizonHours: number;
    /** เวลารอบรันของแบบจำลอง — null = ต้นทางไม่ได้บอกไว้ (ห้ามแทนด้วย fetchedAt) */
    issuedAt: string | null;
  };
}

export type RiskLevel = "low" | "medium" | "high" | "extreme";
