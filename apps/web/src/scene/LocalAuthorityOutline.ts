import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { AoiManifest } from "@siahra/shared-types";
import { loadBoundaryRings, type Ring } from "./boundaryMask.js";
import { createLocalProjection } from "./localProjection.js";

/** Elevation offset above ground to avoid z-fighting. */
const DRAPE_OFFSET_M = 30;

export interface LocalAuthorityOutlineResult {
  group: THREE.Group;
  setResolution: (width: number, height: number) => void;
  dispose: () => void;
}

/**
 * Builds local authority (อปท.) sub-boundary vector outlines draped on 3D terrain.
 */
export async function buildLocalAuthorityOutline(
  manifest: AoiManifest,
  sampleGround: (x: number, z: number) => number,
  customRings?: Ring[] | null,
): Promise<LocalAuthorityOutlineResult | null> {
  const rings = customRings ?? (await loadBoundaryRings(manifest));
  if (!rings || rings.length === 0) return null;

  const proj = createLocalProjection(manifest);
  const step = manifest.terrain.cellSizeM * 0.8;

  const group = new THREE.Group();
  group.name = "localAuthorities";
  group.renderOrder = 22;

  // Distinct sub-boundary styling: subtle cyan/sky line
  const core = new LineMaterial({
    color: 0x38bdf8,
    linewidth: 1.8,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
    depthWrite: false,
    worldUnits: false,
  });

  const halo = new LineMaterial({
    color: 0x0284c7,
    linewidth: 5.5,
    transparent: true,
    opacity: 0.2,
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
    haloLine.renderOrder = 22;
    group.add(haloLine);

    const coreLine = new Line2(geometry, core);
    coreLine.computeLineDistances();
    coreLine.renderOrder = 23;
    group.add(coreLine);
  }

  if (group.children.length === 0) return null;

  return {
    group,
    setResolution: (w: number, h: number) => {
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
