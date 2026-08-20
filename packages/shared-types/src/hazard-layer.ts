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
 */
export type EpistemicClass = "observed" | "static-reference" | "illustrative" | "probabilistic";

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
}

export type RiskLevel = "low" | "medium" | "high" | "extreme";
