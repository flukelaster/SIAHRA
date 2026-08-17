import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

export type LabelTone = "neutral" | "warning" | "severe" | "info";

/**
 * A DOM label anchored to a scene point (rendered by CSS2DRenderer). Kept as
 * plain DOM so Thai text renders with the app font and stays crisp at any
 * zoom — no texture atlases.
 */
export function makeLabel(
  title: string,
  subtitle: string | null,
  tone: LabelTone,
  position: THREE.Vector3,
  priority = 0,
): CSS2DObject {
  const el = document.createElement("div");
  el.className = `map-label map-label--${tone}`;
  const t = document.createElement("span");
  t.className = "map-label__title";
  t.textContent = title;
  el.appendChild(t);
  if (subtitle) {
    const s = document.createElement("span");
    s.className = "map-label__sub";
    s.textContent = subtitle;
    el.appendChild(s);
  }
  const obj = new CSS2DObject(el);
  obj.position.copy(position);
  obj.center.set(0.5, 1.35);
  obj.userData.priority = priority;
  return obj;
}

/**
 * Plain place-name label (no box): white text with a dark halo, like the
 * district names on a printed map. Lower priority than hazard labels.
 */
export function makePlaceLabel(name: string, position: THREE.Vector3, priority = -10): CSS2DObject {
  const el = document.createElement("div");
  el.className = "map-place";
  el.textContent = name;
  const obj = new CSS2DObject(el);
  obj.position.copy(position);
  obj.center.set(0.5, 0.5);
  obj.userData.priority = priority;
  obj.userData.centered = true;
  return obj;
}

export function disposeLabels(group: THREE.Object3D) {
  group.traverse((o) => {
    if (o instanceof CSS2DObject) o.element.remove();
  });
}

/**
 * Greedy screen-space declutter: labels are visited in priority order and any
 * label whose box would overlap an already-accepted one is hidden for this
 * frame. Cheap enough to run every frame for the few dozen labels we place.
 */
export function declutterLabels(
  labels: CSS2DObject[],
  camera: THREE.Camera,
  viewportW: number,
  viewportH: number,
) {
  const accepted: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const v = new THREE.Vector3();
  const sorted = [...labels].sort(
    (a, b) => (b.userData.priority ?? 0) - (a.userData.priority ?? 0),
  );
  for (const label of sorted) {
    label.getWorldPosition(v).project(camera);
    if (v.z > 1) {
      label.visible = false;
      continue;
    }
    const x = ((v.x + 1) / 2) * viewportW;
    const y = ((1 - v.y) / 2) * viewportH;
    const el = label.element;
    if (el.offsetWidth > 0) {
      label.userData.w = el.offsetWidth;
      label.userData.h = el.offsetHeight;
    }
    const w = (label.userData.w ?? 150) + 6;
    const h = (label.userData.h ?? 34) + 6;
    // Boxed labels sit above the anchor (center 0.5/1.35); place names are centred.
    const box = label.userData.centered
      ? { x0: x - w / 2, x1: x + w / 2, y0: y - h / 2, y1: y + h / 2 }
      : { x0: x - w / 2, x1: x + w / 2, y0: y - h * 1.35, y1: y - h * 0.35 };
    const clash = accepted.some(
      (b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0,
    );
    label.visible = !clash;
    if (!clash) accepted.push(box);
  }
}
