import * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

/** ระยะที่แต่ละนิ้วต้องขยับก่อนจึงจะจำแนก gesture สองนิ้วได้ (CSS px) */
const CLASSIFY_MIN_PX = 8;
/** dot ของเวกเตอร์การขยับสองนิ้ว เกินค่านี้ = ไปทางเดียวกัน = ลาก (ก้มเงย/ทิศ) */
const PARALLEL_DOT = 0.35;

const UP = new THREE.Vector3(0, 1, 0);

interface Pt {
  x: number;
  y: number;
}

/**
 * Two-finger twist → compass bearing, Google-Maps style.
 *
 * OrbitControls r185 ไม่มี gesture บิด (ทั้งไฟล์ไม่มีการหามุมระหว่างสองนิ้วเลย —
 * state ของสองนิ้วมีแค่ "จุดกึ่งกลาง" กับ "ระยะห่าง") เราจึงเติมเอง โดยหมุน
 * `camera.position` รอบแกนดิ่งที่ลากผ่าน `controls.target`
 *
 * ที่ทำแบบนี้ได้เพราะ `OrbitControls#update()` **สร้าง spherical ใหม่จากตำแหน่ง
 * กล้องจริงทุกเฟรม** แล้วจบด้วย `lookAt(target)` — การเขียน `camera.position`
 * ตรง ๆ จึงถูก "รับช่วง" ไม่ใช่ถูกล้างทิ้ง และเราไม่ต้องเรียก `lookAt`/`update()` เอง
 * (มันยังยิง event `change` ให้ด้วย ลูปเรนเดอร์จึงเด้งขึ้น 60fps เองอัตโนมัติ)
 *
 * การจำแนก: หนึ่งรอบสองนิ้วถูกตัดสิน **ครั้งเดียว** ว่าเป็น "twist" หรือ "drag"
 * — "twist" พัก flag สาธารณะ `controls.enableRotate` ไว้ ให้ DOLLY_ROTATE เหลือแต่
 * การซูม แล้วเราคุมทิศเอง ส่วน "drag" ปล่อยไว้ตามเดิม ให้ DOLLY_ROTATE ให้ก้มเงย
 * จาก Δy และทิศจาก Δx
 *
 * **ต้องเหนียวทั้งรอบ ไม่ใช่เรื่องรสนิยม**: `_rotateStart.copy(_rotateEnd)` อยู่ใน
 * `_handleTouchMoveRotate` ที่เดียว ถ้า `enableRotate` กะพริบระหว่างรอบ จุดอ้างจะค้าง
 * อยู่ที่เฟรมที่ปิด แล้ว delta ก้อนใหญ่จะถูกใส่รวดเดียวในเฟรมที่เปิดกลับ
 *
 * ไม่มีการอ่าน/เขียนสมาชิกที่ขึ้นต้นด้วย `_` ของ OrbitControls เลย — แตะเฉพาะ
 * `enableRotate` ซึ่งเป็น API สาธารณะ
 */
export function attachTouchGestures(
  controls: OrbitControls,
  camera: THREE.Camera,
  element: HTMLElement,
): () => void {
  const pts = new Map<number, Pt>();
  let mode: "twist" | "drag" | null = null;
  let rotateWasEnabled = controls.enableRotate;
  let startA: Pt | null = null;
  let startB: Pt | null = null;
  let prevAngle = 0;

  const twoIds = (): [number, number] => {
    const it = pts.keys();
    return [it.next().value as number, it.next().value as number];
  };
  /** y ชี้ลงใน coordinate ของหน้าจอ — มุมจึงเป็น "ตามเข็ม = เพิ่ม" */
  const angleOf = (a: Pt, b: Pt) => Math.atan2(b.y - a.y, b.x - a.x);

  const beginPair = () => {
    const [i, j] = twoIds();
    const a = pts.get(i);
    const b = pts.get(j);
    if (!a || !b) return;
    startA = { ...a };
    startB = { ...b };
    prevAngle = angleOf(a, b);
    mode = null;
    rotateWasEnabled = controls.enableRotate;
  };

  /** คืน enableRotate เสมอ — ถ้าปล่อยค้างเป็น false มันจะไปฆ่าการหมุนด้วยเมาส์บนเดสก์ท็อป */
  const endPair = () => {
    if (mode === "twist") controls.enableRotate = rotateWasEnabled;
    mode = null;
    startA = null;
    startB = null;
  };

  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) beginPair();
    else if (pts.size > 2) endPair();
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== "touch" || !pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size !== 2 || !startA || !startB) return;

    const [i, j] = twoIds();
    const a = pts.get(i);
    const b = pts.get(j);
    if (!a || !b) return;

    // จำแนกตอน move เท่านั้น ห้ามตอน down — ถ้า enableRotate เป็น false อยู่ก่อนที่
    // onTouchStart case 2 ของ OrbitControls จะทำงาน มันจะข้ามการตั้งจุดอ้างของ rotate
    if (mode === null) {
      const dax = a.x - startA.x;
      const day = a.y - startA.y;
      const dbx = b.x - startB.x;
      const dby = b.y - startB.y;
      const la = Math.hypot(dax, day);
      const lb = Math.hypot(dbx, dby);
      if (la < CLASSIFY_MIN_PX || lb < CLASSIFY_MIN_PX) {
        prevAngle = angleOf(a, b); // ยังไม่ตัดสิน แต่จุดอ้างต้องสด (การบีบยังทำงานปกติ)
        return;
      }
      const dot = (dax * dbx + day * dby) / (la * lb);
      mode = dot > PARALLEL_DOT ? "drag" : "twist";
      if (mode === "twist") controls.enableRotate = false;
      prevAngle = angleOf(a, b);
      return;
    }

    if (mode !== "twist") return;

    const now = angleOf(a, b);
    let d = now - prevAngle;
    if (d > Math.PI) d -= 2 * Math.PI; // คลี่รอยต่อของ atan2
    else if (d < -Math.PI) d += 2 * Math.PI;
    prevAngle = now;
    if (d === 0) return;

    const off = new THREE.Vector3().subVectors(camera.position, controls.target);
    off.applyAxisAngle(UP, d);
    camera.position.copy(controls.target).add(off);
  };

  const onUp = (e: PointerEvent) => {
    if (!pts.delete(e.pointerId)) return;
    if (pts.size < 2) endPair();
  };

  // ผูก move/up ที่ window ไม่ใช่ element — `setPointerCapture` ของ OrbitControls
  // จับแค่ **นิ้วแรก** นิ้วที่สองจึงหยุดรายงานถ้าไถลออกนอกกล่อง
  element.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);

  // page pinch-zoom ของ iOS Safari: `touch-action: none` **ไม่หยุดมัน** (WebKit ไม่สนใจ
  // touch-action สำหรับการซูมระดับหน้า) event ตระกูล gesture* ของ WebKit หยุดได้ และ
  // ต่างจาก preventDefault บน touchmove ตรงที่ไม่ไปกดการส่ง pointer event ต่อ
  // ซึ่งจะฆ่า OrbitControls เอง
  const killGesture = (e: Event) => e.preventDefault();
  element.addEventListener("gesturestart", killGesture, { passive: false });
  element.addEventListener("gesturechange", killGesture, { passive: false });
  element.addEventListener("gestureend", killGesture, { passive: false });

  return () => {
    endPair();
    controls.enableRotate = rotateWasEnabled;
    element.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    element.removeEventListener("gesturestart", killGesture);
    element.removeEventListener("gesturechange", killGesture);
    element.removeEventListener("gestureend", killGesture);
  };
}
