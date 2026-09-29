import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { declutterLabels } from "./labels";

/** element เทียม — environment เป็น node ไม่มี DOM; offsetWidth 0 = ยังไม่เคยถูก append */
function fakeEl(offsetWidth = 0, offsetHeight = 0) {
  return { style: {}, setAttribute() {}, offsetWidth, offsetHeight } as unknown as HTMLElement;
}

function label(el: HTMLElement, x: number, priority: number, centered = false) {
  const o = new CSS2DObject(el);
  o.position.set(x, 0, 0);
  o.updateMatrixWorld(true);
  o.userData.priority = priority;
  if (centered) o.userData.centered = true;
  return o;
}

function camera() {
  const c = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.1, 10);
  c.position.set(0, 0, 5);
  c.updateMatrixWorld(true);
  c.updateProjectionMatrix();
  return c;
}

describe("declutterLabels", () => {
  // viewport 200×200 ↔ ortho ±100 ⇒ 1 world unit = 1 px, จุดกึ่งกลางที่ (100,100)
  it("uses the measured size of a never-shown label, not the 150 px fallback", () => {
    const a = label(fakeEl(60, 16), 0, 10, true);
    const b = label(fakeEl(0, 0), 60, 0, true); // ยังไม่เคยอยู่ใน DOM
    const measure = () => ({ w: 40, h: 16 });
    declutterLabels([a, b], camera(), 200, 200, measure);
    // a กว้าง 66 (±33) · b กว้าง 46 (±23) ห่างกัน 60 → ไม่ทับ → ต้องแสดงทั้งคู่
    expect(a.visible).toBe(true);
    expect(b.visible).toBe(true);
  });

  it("still hides a label that really overlaps a higher-priority one", () => {
    const a = label(fakeEl(60, 16), 0, 10, true);
    const b = label(fakeEl(0, 0), 20, 0, true);
    declutterLabels([a, b], camera(), 200, 200, () => ({ w: 40, h: 16 }));
    expect(a.visible).toBe(true);
    expect(b.visible).toBe(false);
  });

  it("falls back to the wide default only when the size cannot be measured", () => {
    const a = label(fakeEl(60, 16), 0, 10, true);
    const b = label(fakeEl(0, 0), 60, 0, true);
    declutterLabels([a, b], camera(), 200, 200, () => null);
    // fallback 156 กว้าง → ทับ a
    expect(b.visible).toBe(false);
  });

  it("prefers the live DOM size over an earlier measurement", () => {
    const a = label(fakeEl(60, 16), 0, 10, true);
    a.userData.w = 400; // ค่าเก่าจากสำเนา
    declutterLabels([a], camera(), 200, 200, () => ({ w: 400, h: 16 }));
    expect(a.userData.w).toBe(60);
  });
});
