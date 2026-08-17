import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { AoiManifest } from "@siahra/shared-types";
import { loadBoundaryRings } from "./boundaryMask";
import { createLocalProjection } from "./localProjection";

/** Lifted above the terrain so the outline is not z-fought by the surface. */
const DRAPE_OFFSET_M = 25;

export interface BoundaryOutlineResult {
  group: THREE.Group;
  /** Must be called with the drawing-buffer size whenever the canvas resizes. */
  setResolution: (width: number, height: number) => void;
  dispose: () => void;
}

/**
 * Province outline drawn over the terrain as a crisp screen-space line with a
 * soft halo — the same treatment as the reference dashboard. Rings are
 * projected with the true UTM transform and densified to sub-cell spacing so
 * the line follows the relief instead of cutting through ridges.
 */
export async function buildBoundaryOutline(
  manifest: AoiManifest,
  sampleGround: (x: number, z: number) => number,
): Promise<BoundaryOutlineResult | null> {
  const rings = await loadBoundaryRings(manifest);
  if (!rings) return null;

  const proj = createLocalProjection(manifest);
  const step = manifest.terrain.cellSizeM * 0.6;

  const group = new THREE.Group();
  group.name = "boundary";
  group.renderOrder = 20;

  const core = new LineMaterial({
    color: 0xffffff,
    linewidth: 2.2,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
    worldUnits: false,
  });
  const halo = new LineMaterial({
    color: 0xdbeafe,
    linewidth: 8,
    transparent: true,
    opacity: 0.16,
    depthTest: false,
    depthWrite: false,
    worldUnits: false,
  });

  const geometries: LineGeometry[] = [];

  for (const ring of rings) {
    if (ring.length < 2) continue;
    const local = ring.map(([lon, lat]) => proj.lonLatToLocal(lon, lat));
    const pts: number[] = [];
    const push = (x: number, z: number) => {
      pts.push(x, sampleGround(x, z) + DRAPE_OFFSET_M, z);
    };
    for (let i = 0; i < local.length; i++) {
      const [x0, z0] = local[i];
      const [x1, z1] = local[(i + 1) % local.length];
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(1, Math.ceil(len / step));
      for (let s = 0; s < n; s++) {
        const t = s / n;
        push(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
      }
    }
    push(local[0][0], local[0][1]);
    if (pts.length < 6) continue;

    const geometry = new LineGeometry();
    geometry.setPositions(pts);
    geometries.push(geometry);

    const haloLine = new Line2(geometry, halo);
    haloLine.computeLineDistances();
    haloLine.renderOrder = 20;
    group.add(haloLine);
    const coreLine = new Line2(geometry, core);
    coreLine.computeLineDistances();
    coreLine.renderOrder = 21;
    group.add(coreLine);
  }

  if (group.children.length === 0) return null;

  return {
    group,
    setResolution: (w, h) => {
      core.resolution.set(w, h);
      halo.resolution.set(w, h);
    },
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      core.dispose();
      halo.dispose();
    },
  };
}
