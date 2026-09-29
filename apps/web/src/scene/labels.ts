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

/** ขนาดสำรองเมื่อวัดจริงไม่ได้ (ไม่มี DOM) — ใกล้เคียงป้ายสถานี ไม่ใช่ป้ายชื่อเขต */
const FALLBACK_W = 150;
const FALLBACK_H = 34;

let measureHost: HTMLDivElement | null = null;
/** เพิ่มเมื่อฟอนต์โหลดเสร็จ — ความกว้างที่วัดตอนยังใช้ฟอนต์สำรองต้องวัดใหม่ */
let fontEpoch = 0;
let fontListener = false;

/**
 * วัดขนาดจริงของป้ายที่ **ยังไม่เคยอยู่ใน DOM**: CSS2DRenderer จะ append element เฉพาะ
 * ตอนที่ป้ายมองเห็นเท่านั้น และ declutter รันก่อนเรนเดอร์ในเฟรมเดียวกัน — ป้ายที่แพ้ตั้งแต่
 * รอบแรกจึงไม่เคยถูกวัด (offsetWidth = 0) ถ้าใช้ขนาดสำรองกว้าง 150 ป้ายชื่อเขต (~60–80 px)
 * จะถูกตีกรอบใหญ่เกินจริงราว 4 เท่า แล้วแพ้ป้ายข้างเคียงค้างไปจนกว่ากล้องจะขยับ
 * → วัดจากสำเนาใน host ที่ซ่อนอยู่นอกจอ (ได้ CSS ชุดเดียวกัน ไม่กระทบ layout)
 */
export function measureLabelElement(el: HTMLElement): { w: number; h: number } | null {
  if (typeof document === "undefined") return null;
  if (!fontListener && document.fonts) {
    fontListener = true;
    document.fonts.addEventListener?.("loadingdone", () => {
      fontEpoch++;
    });
  }
  if (!measureHost) {
    measureHost = document.createElement("div");
    measureHost.setAttribute("aria-hidden", "true");
    measureHost.style.cssText =
      "position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;contain:layout style;";
    document.body.appendChild(measureHost);
  }
  const copy = el.cloneNode(true) as HTMLElement;
  copy.style.display = "";
  measureHost.appendChild(copy);
  const w = copy.offsetWidth;
  const h = copy.offsetHeight;
  copy.remove();
  return w > 0 ? { w, h } : null;
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
  measure: (el: HTMLElement) => { w: number; h: number } | null = measureLabelElement,
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
      // อยู่ใน DOM และมองเห็น = ค่าจริง เชื่อค่านี้เหนือสำเนา
      label.userData.w = el.offsetWidth;
      label.userData.h = el.offsetHeight;
      label.userData.measuredEpoch = fontEpoch;
    } else if (label.userData.w === undefined || label.userData.measuredEpoch !== fontEpoch) {
      const m = measure(el);
      if (m) {
        label.userData.w = m.w;
        label.userData.h = m.h;
        label.userData.measuredEpoch = fontEpoch;
      }
    }
    const w = (label.userData.w ?? FALLBACK_W) + 6;
    const h = (label.userData.h ?? FALLBACK_H) + 6;
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
