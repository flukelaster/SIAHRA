import type { HazardLayerDescriptor } from "./hazard-layer.js";

/**
 * How a TMD composite PNG maps to the ground. The PNG rows are linear in the
 * named projection between `bounds.minLat` (bottom row) and `bounds.maxLat`
 * (top row); columns are linear in longitude in both cases.
 * - `web-mercator`: rows linear in `ln(tan(π/4 + φ/2))` — the 1800×2644 frames
 *   TMD serves since the 2026-09 list change (TMD's own viewer drapes them as a
 *   MapLibre image source).
 * - `equirectangular`: rows linear in latitude — the legacy 1173×1668 frames
 *   archived before that change.
 */
export type RadarProjection = "equirectangular" | "web-mercator";

export interface RadarGeoreference {
  projection: RadarProjection;
  /** Geographic box the PNG covers (lon/lat degrees, WGS84). */
  bounds: { minLon: number; minLat: number; maxLon: number; maxLat: number };
  /** Pixel size the API verified from the PNG's IHDR before storing the frame. */
  widthPx: number;
  heightPx: number;
  /** Where the georeference comes from and when it was checked. */
  basis: string;
}

/** One TMD national radar composite frame, proxied and cached by the backend. */
export interface RadarFrame {
  /** Observation time (UTC ISO). */
  t: string;
  /** Same-origin URL of the PNG (transparent overlay). */
  url: string;
  /** Key into `RadarFramesResponse.georeferences` — a window can mix both. */
  projection: RadarProjection;
}

export interface RadarFramesResponse {
  layer: HazardLayerDescriptor;
  /** Georeference per projection; each frame names the one it uses. */
  georeferences: Record<RadarProjection, RadarGeoreference>;
  /**
   * @deprecated Georeference of the newest frame (legacy equirectangular box
   * when there are no frames), kept only so a web bundle cached from before
   * `georeferences` existed does not crash. Use `georeferences[frame.projection]`.
   */
  bounds: { minLon: number; minLat: number; maxLon: number; maxLat: number };
  /** @deprecated See `bounds`. */
  widthPx: number;
  /** @deprecated See `bounds`. */
  heightPx: number;
  fetchedAt: string | null;
  frames: RadarFrame[];
}
