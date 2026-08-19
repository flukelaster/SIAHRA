import * as THREE from "three";
import type { AoiManifest, EarthquakeEvent } from "@siahra/shared-types";
import { makeLabel } from "./labels";
import type { TFunction } from "../i18n";
import { createLocalProjection } from "./localProjection";

const PULSE_PERIOD_S = 3.2;

export interface EarthquakeMarkerResult {
  /** Flat epicentre rings + labels — lives INSIDE the world group. */
  group: THREE.Group;
  count: number;
  tick: (timeS: number) => void;
  dispose: () => void;
}

/**
 * Detected earthquakes (USGS/EMSC/TMD) whose epicentre falls inside the
 * loaded province: concentric expanding rings scaled by magnitude, plus a
 * label. These are events that already happened — not a forecast.
 */
export function buildEarthquakeMarkers(
  manifest: AoiManifest,
  events: EarthquakeEvent[],
  sampleGround: (x: number, z: number) => number,
  /** ตัวแปลของภาษาที่กำลังแสดง — ป้ายบนฉากถูกสร้างใหม่ทุกครั้งที่สลับภาษา */
  t: TFunction,
): EarthquakeMarkerResult {
  const proj = createLocalProjection(manifest);
  const group = new THREE.Group();
  group.name = "earthquakes";
  const ringGeometry = new THREE.RingGeometry(0.9, 1, 64);
  ringGeometry.rotateX(-Math.PI / 2);
  const discGeometry = new THREE.CircleGeometry(1, 40);
  discGeometry.rotateX(-Math.PI / 2);
  const pulses: { mesh: THREE.Mesh; phase: number; radius: number; material: THREE.MeshBasicMaterial }[] = [];
  const materials: THREE.Material[] = [];
  let count = 0;

  for (const ev of events) {
    if (ev.status === "deleted") continue;
    const [x, z] = proj.lonLatToLocal(ev.lon, ev.lat);
    if (!proj.insideGrid(x, z)) continue;
    count++;
    const groundY = sampleGround(x, z) + 14;
    const mag = ev.mag ?? 3;
    const radius = THREE.MathUtils.clamp(1200 * Math.pow(2, mag - 3), 1500, 20000);
    const color = mag >= 6 ? 0xef4444 : mag >= 5 ? 0xf97316 : mag >= 4 ? 0xeab308 : 0x38bdf8;

    const discMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false,
    });
    materials.push(discMat);
    const disc = new THREE.Mesh(discGeometry, discMat);
    disc.scale.setScalar(Math.max(250, radius * 0.06));
    disc.position.set(x, groundY, z);
    disc.renderOrder = 26;
    disc.userData = { kind: "quake", event: ev };
    group.add(disc);

    for (let k = 0; k < 3; k++) {
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      materials.push(mat);
      const mesh = new THREE.Mesh(ringGeometry, mat);
      mesh.position.set(x, groundY, z);
      mesh.renderOrder = 25;
      group.add(mesh);
      pulses.push({ mesh, phase: k / 3, radius, material: mat });
    }

    const label = makeLabel(
      t("scene.quakeLabel", { mag: mag.toFixed(1) }),
      ev.status === "automatic" ? t("scene.quakeAutomatic") : t("scene.quakeReviewed"),
      mag >= 5 ? "severe" : "warning",
      new THREE.Vector3(x, groundY, z),
      200 + mag * 10,
    );
    group.add(label);
  }

  return {
    group,
    count,
    tick: (timeS) => {
      for (const p of pulses) {
        const t = ((timeS / PULSE_PERIOD_S + p.phase) % 1 + 1) % 1;
        const s = p.radius * (0.1 + 0.9 * t);
        p.mesh.scale.set(s, 1, s);
        p.material.opacity = 0.7 * (1 - t);
      }
    },
    dispose: () => {
      ringGeometry.dispose();
      discGeometry.dispose();
      materials.forEach((m) => m.dispose());
    },
  };
}
