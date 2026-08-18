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

export interface HazardLayerDescriptor {
  id: string;
  epistemicClass: EpistemicClass;
  liveOrStatic: "live" | "static";
  observedAt?: string;
  /** เวลาที่ backend ดึงสำเร็จครั้งล่าสุด — null = ยังไม่เคยสำเร็จ (ห้ามแทนด้วย "ตอนนี้") */
  fetchedAt: string | null;
  staleAfterSeconds?: number;
  methodologyUrl?: string;
  sourceIds: string[];
}

export type RiskLevel = "low" | "medium" | "high" | "extreme";
