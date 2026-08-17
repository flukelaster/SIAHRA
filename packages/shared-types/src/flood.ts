import type { HazardLayerDescriptor } from "./hazard-layer.js";

/**
 * Satellite-derived flood extent (GISTDA "flooding_vis" scene, tambon-level
 * polygons). Epistemic class: observed — it is an interpretation of a real
 * satellite image, not a forecast. The upstream features carry no timestamp,
 * so the backend stamps when it retrieved them and when each polygon was
 * first/last seen; the UI must show those, never imply "now".
 */
export interface FloodExtentFeatureProps {
  tambonTh: string | null;
  amphoeTh: string | null;
  provinceTh: string | null;
  provinceCode: string | null;
  /** Flooded area in rai (upstream unit). */
  floodAreaRai: number | null;
  houses: number | null;
  /** Upstream centroid. */
  lat: number | null;
  lon: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface FloodExtentFeature {
  type: "Feature";
  id: string;
  properties: FloodExtentFeatureProps;
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] };
}

export interface FloodExtentResponse {
  layer: HazardLayerDescriptor;
  /** When our backend last pulled the scene successfully. */
  retrievedAt: string | null;
  provinceCode: string;
  features: FloodExtentFeature[];
}

export interface FloodExtentProvinceSummary {
  provinceCode: string;
  provinceTh: string | null;
  tambonCount: number;
  floodAreaRai: number;
  houses: number;
}

export interface FloodExtentSummaryResponse {
  layer: HazardLayerDescriptor;
  retrievedAt: string | null;
  totalFeatures: number;
  provinces: FloodExtentProvinceSummary[];
}
