import type { HazardLayerDescriptor } from "./hazard-layer.js";

/** One TMD national radar composite frame, proxied and cached by the backend. */
export interface RadarFrame {
  /** Observation time (UTC ISO). */
  t: string;
  /** Same-origin URL of the PNG (transparent overlay, EPSG:4326 box). */
  url: string;
}

export interface RadarFramesResponse {
  layer: HazardLayerDescriptor;
  /** Geographic box the PNG covers (verified against TMD's QPE grid header). */
  bounds: { minLon: number; minLat: number; maxLon: number; maxLat: number };
  widthPx: number;
  heightPx: number;
  fetchedAt: string | null;
  frames: RadarFrame[];
}
