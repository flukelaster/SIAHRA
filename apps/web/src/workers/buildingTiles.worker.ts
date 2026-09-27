/// <reference lib="webworker" />
import { buildBuildingMesh, type BuildingTileJob } from "../lib/buildingMesh";

/**
 * Extrudes one building tile off the main thread so a dense city tile
 * (10–20k footprints) never stalls the frame — the geometry itself is built
 * by the pure `lib/buildingMesh.ts` (unit-tested there).
 */
export type { BuildingTileJob, BuildingTileMesh } from "../lib/buildingMesh";

self.onmessage = (ev: MessageEvent<BuildingTileJob>) => {
  const result = buildBuildingMesh(ev.data);
  (self as unknown as Worker).postMessage(result, [
    result.positions.buffer,
    result.colors.buffer,
    result.indices.buffer,
  ]);
};
