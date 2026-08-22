import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { AoiManifest } from "@siahra/shared-types";
import { loadLocalAuthorityBoundaries } from "./localAuthorityBoundaries";
import { createLocalProjection } from "./localProjection";

/** Lifted above the terrain so the outline is not z-fought by the surface. */
const DRAPE_OFFSET_M = 20;

export interface LocalAuthorityOutlineResult {
  group: THREE.Group;
  /** Must be called with the drawing-buffer size whenever the canvas resizes. */
  setResolution: (width: number, height: number) => void;
  dispose: () => void;
}

/**
 * ขอบเขต อปท. (OSM `admin_level=7`, E11.2) ดราปเหนือภูมิประเทศแบบเดียวกับ
 * `BoundaryOutline.ts` (province) แต่ใช้โทนสีอุ่น (อำพัน/ส้ม) แทนขาว/ฟ้าอ่อน
 * โดยตั้งใจ — เวอร์ชันก่อนหน้าที่ถูก revert มีบั๊กตรงจุดนี้เป๊ะ: วาดขอบเขตจังหวัด
 * ซ้ำภายใต้ชื่อ "ขอบเขต อปท." ด้วยสีที่ต่างกันแค่เล็กน้อย จนอ่านไม่ออกว่าเป็นชั้น
 * ที่สอง โทนสีตรงนี้ต้องต่างพอที่จะอ่านออกว่าเป็นชั้นข้อมูลคนละชั้นจริง ๆ
 */
export async function buildLocalAuthorityOutline(
  manifest: AoiManifest,
  sampleGround: (x: number, z: number) => number,
): Promise<LocalAuthorityOutlineResult | null> {
  const features = await loadLocalAuthorityBoundaries(manifest);
  if (!features) return null;

  const proj = createLocalProjection(manifest);
  const step = manifest.terrain.cellSizeM * 0.6;

  const group = new THREE.Group();
  group.name = "localAuthorities";
  group.renderOrder = 22;

  const core = new LineMaterial({
    color: 0xf59e0b,
    linewidth: 1.6,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
    worldUnits: false,
  });
  const halo = new LineMaterial({
    color: 0xfb923c,
    linewidth: 5,
    transparent: true,
    opacity: 0.16,
    depthTest: false,
    depthWrite: false,
    worldUnits: false,
  });

  const geometries: LineGeometry[] = [];

  for (const feature of features) {
    for (const ring of feature.rings) {
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
