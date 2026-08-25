import { useCallback, useEffect, useRef, type DOMAttributes, type PointerEvent, type RefObject } from "react";
import { nearestSnap, snapHeights, type SheetSnap } from "../lib/shellLayout";

/** ขยับน้อยกว่านี้และเร็วกว่า TAP_MAX_MS = ถือว่าเป็นการแตะ ไม่ใช่การลาก */
const TAP_MAX_PX = 8;
const TAP_MAX_MS = 250;
/** น้ำหนักของตัวอย่างล่าสุดในการเฉลี่ยความเร็ว — กันตัวอย่างหลงพลิกการสะบัด */
const VELOCITY_ALPHA = 0.3;
const REST_TRANSITION = "transform 260ms cubic-bezier(0.32, 0.72, 0, 1)";

/** เรียงลำดับเดียวกับ `SheetSnap` — ใช้ตอนแตะมือจับเพื่อวนขึ้นทีละขั้น */
const CYCLE: Record<SheetSnap, SheetSnap> = { peek: "half", half: "full", full: "peek" };

interface DragSession {
  pointerId: number;
  startY: number;
  startTx: number;
  startSnap: SheetSnap;
  elH: number;
  lastY: number;
  lastT: number;
  velocity: number;
  moved: number;
  startedAt: number;
  /** true = ลากมาจาก body ที่เลื่อนได้ ต้องกัน native scroll ที่ move แรก */
  fromBody: boolean;
}

/**
 * ลาก/สแนปแผ่นเลื่อนของมือถือ
 *
 * ระหว่างลาก **ไม่มี React re-render เลย** — ตัวแผ่นถูกขยับด้วยการเขียน
 * `el.style.transform` ตรง ๆ (translate3d อยู่บน compositor: ไม่มี layout ไม่มี
 * paint ไม่ไปกวนลูป requestAnimationFrame ของฉาก Three.js ที่วิ่งอยู่ข้างหลัง)
 * แล้วค่อย commit ครั้งเดียวตอนปล่อยนิ้ว ถ้าสแนปเปลี่ยน
 *
 * ความสูงของแผ่นเป็นค่าคงที่ใน CSS (`SHEET_FULL_VH` ของ dvh) แล้วเลื่อนลงด้วย
 * transform — ห้าม animate `height` เด็ดขาด เพราะนั่นคือ layout ทุกเฟรม
 *
 * ตำแหน่งพักของ peek ใช้ **ความสูงที่วัดได้จริง** ของส่วน peek ไม่ใช่ค่าคงที่
 * `SHEET_PEEK_H` (ซึ่งเป็นเพดานสำหรับ safe area) — ถ้า clamp ด้วยเพดาน บรรทัด
 * เครดิตที่ยาวกว่าค่าคาดจะหลุดขอบจอ ซึ่งผิดเงื่อนไขของผู้ให้ภาพดาวเทียม
 */
export function useSheetDrag({
  sheetRef,
  snap,
  onSnapChange,
  peekPx,
}: {
  sheetRef: RefObject<HTMLDivElement | null>;
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  /** ความสูงที่ ResizeObserver วัดได้ของส่วน peek (0 = ยังไม่ได้วัด) */
  peekPx: number;
}): { dragHandlers: DOMAttributes<HTMLElement>; bodyHandlers: DOMAttributes<HTMLElement> } {
  const session = useRef<DragSession | null>(null);
  /** transform ปัจจุบันที่เราเขียนไว้เอง — อ่านจากตรงนี้แทนการ parse กลับจาก DOM */
  const tx = useRef(0);

  const visibleFor = useCallback(
    (s: SheetSnap) => (s === "peek" ? peekPx || snapHeights(window.innerHeight).peek : snapHeights(window.innerHeight)[s]),
    [peekPx],
  );

  const rest = useCallback(
    (s: SheetSnap, animate: boolean) => {
      const el = sheetRef.current;
      if (!el) return;
      const elH = el.getBoundingClientRect().height;
      tx.current = Math.max(0, elH - visibleFor(s));
      el.style.transition = animate ? REST_TRANSITION : "none";
      el.style.transform = `translate3d(0, ${tx.current}px, 0)`;
      // แผ่นสูงคงที่แล้วถูกเลื่อนลง ก้นของมันจึงอยู่ **ต่ำกว่าขอบจอ** เท่ากับระยะเลื่อน
      // ที่ทุกสแนปยกเว้น full — ส่วนท้ายของกล่องที่เลื่อนได้ก็เลยตกไปอยู่นอกจอ และ
      // เนื้อหาแถวสุดท้ายเลื่อนขึ้นมาดูไม่ได้ ชดเชยด้วย padding ล่างเท่าระยะเลื่อน
      // (padding นับรวมใน scroll extent) — เขียนเฉพาะตอนเข้าที่ ไม่ใช่ทุกเฟรมของการลาก
      // เพราะการเปลี่ยน padding คือ layout ส่วน transform ไม่ใช่
      el.style.setProperty("--sheet-tx", `${tx.current}px`);
    },
    [sheetRef, visibleFor],
  );

  // ตำแหน่งพักตามสแนปปัจจุบัน (และตามความสูง peek ที่วัดใหม่ / จอที่หมุน)
  useEffect(() => {
    rest(snap, true);
  }, [rest, snap]);
  useEffect(() => {
    const onResize = () => rest(snap, false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [rest, snap]);

  const begin = (e: PointerEvent<HTMLElement>, fromBody: boolean) => {
    const el = sheetRef.current;
    if (!el || session.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    el.style.transition = "none";
    session.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startTx: tx.current,
      startSnap: snap,
      elH: el.getBoundingClientRect().height,
      lastY: e.clientY,
      lastT: e.timeStamp,
      velocity: 0,
      moved: 0,
      startedAt: e.timeStamp,
      fromBody,
    };
  };

  const move = (e: PointerEvent<HTMLElement>) => {
    const s = session.current;
    const el = sheetRef.current;
    if (!s || !el || s.pointerId !== e.pointerId) return;
    // ตัดสินใจแล้วว่ารอบนี้เป็นการลากแผ่น — กัน native scroll ไม่ให้เริ่ม
    if (s.fromBody) e.preventDefault();
    const dy = e.clientY - s.startY;
    s.moved = Math.max(s.moved, Math.abs(dy));
    const heights = snapHeights(window.innerHeight);
    const min = Math.max(0, s.elH - heights.full);
    const max = Math.max(min, s.elH - visibleFor("peek"));
    tx.current = Math.min(max, Math.max(min, s.startTx + dy));
    el.style.transform = `translate3d(0, ${tx.current}px, 0)`;

    const dt = e.timeStamp - s.lastT;
    if (dt > 0) {
      const v = (e.clientY - s.lastY) / dt;
      s.velocity = s.velocity === 0 ? v : s.velocity * (1 - VELOCITY_ALPHA) + v * VELOCITY_ALPHA;
      s.lastY = e.clientY;
      s.lastT = e.timeStamp;
    }
  };

  const end = (e: PointerEvent<HTMLElement>) => {
    const s = session.current;
    if (!s || s.pointerId !== e.pointerId) return;
    session.current = null;
    // แตะสั้น ๆ บนมือจับ = วนขึ้นทีละขั้น (ปุ่มบนแถบมือจับทำงานของตัวเองไป)
    const tapped = s.moved < TAP_MAX_PX && e.timeStamp - s.startedAt < TAP_MAX_MS;
    const next = tapped
      ? CYCLE[s.startSnap]
      : nearestSnap(s.elH - tx.current, s.velocity, snapHeights(window.innerHeight), s.startSnap);
    // เขียนตำแหน่งปลายทางทันที ไม่รอ React — ถ้าสแนปไม่เปลี่ยน effect จะไม่ยิงเลย
    rest(next, true);
    if (next !== snap) onSnapChange(next);
  };

  const cancel = () => {
    if (!session.current) return;
    session.current = null;
    rest(snap, true);
  };

  const dragHandlers: DOMAttributes<HTMLElement> = {
    onPointerDown: (e) => begin(e, false),
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: cancel,
  };

  const bodyHandlers: DOMAttributes<HTMLElement> = {
    // ตัดสินตอน pointerdown เท่านั้น: อยู่บนสุดของ scroll = ลากแผ่นทั้งรอบ
    // มิฉะนั้นปล่อยให้เลื่อนเนื้อหาตามปกติ — ถ้าไปตัดสินกลางคันคือแข่งกับ
    // native scroll ที่ยกเลิกไม่ได้แล้ว
    onPointerDown: (e) => {
      if (e.currentTarget.scrollTop === 0) begin(e, true);
    },
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: cancel,
  };

  return { dragHandlers, bodyHandlers };
}
