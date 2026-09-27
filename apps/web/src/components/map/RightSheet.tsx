import { X } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { isTypingTarget } from "../../hooks/useShellState";
import { useViewport } from "../../hooks/useViewport";
import { rightSheetBox, swipeShouldClose } from "../../lib/rightSheet";
import type { ShellSafeArea } from "../../lib/shellLayout";

/** ขยับเกินนี้ก่อนจึงตัดสินว่าเป็นการปัดแนวนอนหรือการเลื่อนแนวตั้ง */
const SWIPE_SLOP_PX = 8;
const SNAP_BACK = "transform 200ms cubic-bezier(0.32, 0.72, 0, 1)";

interface SwipeSession {
  pointerId: number;
  startX: number;
  startY: number;
  /** null = ยังไม่ตัดสิน; true = ปัดแนวนอน (แผงตามนิ้ว); false = เลื่อนแนวตั้ง (ปล่อย native) */
  horizontal: boolean | null;
  dx: number;
  dy: number;
  lastX: number;
  lastT: number;
  velocity: number;
}

/**
 * กรอบของแผงด้านขวา — ใช้ร่วมกันโดยแผงกล้อง (`CameraSheet`) แผงรายงานจากประชาชน (`ReportSheet`) และฟอร์ม
 * รายงาน (`ReportCompose`);
 * มีได้ทีละหนึ่งแผง (Map3DCanvas ล้างอีกฝั่งเมื่อเปิดฝั่งหนึ่ง) เนื้อหา (หัวแผง + ตัวแผง) เป็นของผู้ใช้กรอบ
 *
 * - ≥ tablet: ใต้ TopBar เหนือ dock อยู่ซ้ายของคอลัมน์เข็มทิศ/ซูม (`rightSheetBox`)
 *   มือถือ: เต็มจอ ทับแผ่นเลื่อน มี padding ของ safe area (รอยบาก/แถบโฮม)
 * - เลื่อนเข้าจากขวาด้วย keyframe บน `transform` เท่านั้น — `prefers-reduced-motion` ปิดมันใน
 *   index.css; ปิด = unmount ทันที (ไม่มีแอนิเมชันขาออก) ตัวเล่น/ตัวขอภาพจึงหยุดทันทีแน่นอน
 * - ปิดได้ด้วยปุ่ม X (`RightSheetHeader`), Escape (capture บน document + preventDefault → drawer/แผ่นเลื่อน
 *   ไม่ปิดตาม; ไม่ทำงานขณะพิมพ์ในช่องกรอก) และปัดขวาบนจอสัมผัส (`swipeShouldClose`)
 * - `role="dialog"` แบบไม่ modal: แผนที่ยังใช้ได้ระหว่างเปิด; โฟกัสกลับไปที่ element เดิมตอนปิด
 *   (`selKey` เปลี่ยน = จับ element ที่ถือโฟกัสอยู่ใหม่ เว้นแต่โฟกัสอยู่ในแผงเอง)
 */
export function RightSheet({
  kind,
  selKey,
  titleId,
  safeArea,
  onClose,
  dataAttrs,
  children,
}: {
  /** ชนิดของแผง — `data-right-sheet` (ให้ QA/เทสหาเจอ) */
  kind: "camera" | "report" | "compose";
  /** คีย์ของสิ่งที่แสดงอยู่ — เปลี่ยน = จับ element ที่จะคืนโฟกัสให้ใหม่ */
  selKey: string;
  /** id ของ h2 ใน `RightSheetHeader` (`aria-labelledby`) */
  titleId: string;
  safeArea: ShellSafeArea;
  onClose: () => void;
  /** แอตทริบิวต์ `data-*` เพิ่มเติมของแผง (เช่น `data-camera-sheet` เดิม) */
  dataAttrs?: Record<`data-${string}`, string>;
  children: ReactNode;
}) {
  const vp = useViewport();
  const phone = vp.tier === "phone";
  const box = rightSheetBox(vp.tier, safeArea, vp.width);
  const frameRef = useRef<HTMLElement | null>(null);
  const swipe = useRef<SwipeSession | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // โฟกัสกลับไปที่ element ที่ถือโฟกัสอยู่ก่อนแผงเปิด — จับใหม่ทุกครั้งที่สิ่งที่แสดงเปลี่ยน (layout effect
  // วิ่งก่อนที่หัวข้อใหม่จะดึงโฟกัสเข้าแผง) เว้นแต่โฟกัสอยู่ในแผงเองหรือไม่มีใครถืออยู่ (body):
  // เปิดจากหมุด → สลับด้วยปุ่ม "ดูภาพ" ของสถานี → ปิด = กลับไปที่ปุ่มนั้น
  const returnFocus = useRef<Element | null>(null);
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (active && active !== document.body && !frameRef.current?.contains(active)) returnFocus.current = active;
  }, [selKey]);
  useEffect(
    () => () => {
      const el = returnFocus.current;
      if (el instanceof HTMLElement && el.isConnected) el.focus({ preventScroll: true });
    },
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isTypingTarget(e.target)) return;
      e.preventDefault();
      onCloseRef.current();
    };
    // capture บน document: วิ่งก่อน listener แบบ bubble บน window ของ useShellState ซึ่งเช็ค
    // defaultPrevented — Escape หนึ่งครั้งปิดแผงนี้อย่างเดียว ไม่หุบ drawer/แผ่นเลื่อนไปด้วย
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  const setTx = (px: number, transition: string) => {
    const el = frameRef.current;
    if (!el) return;
    el.style.transition = transition;
    el.style.transform = px === 0 ? "" : `translate3d(${px}px, 0, 0)`;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType !== "touch" || swipe.current) return;
    // แถบเวลาของ <video controls> และช่องกรอกลากแนวนอนเอง — ไม่ใช่การปัดปิด
    if ((e.target as Element).closest("video, input, textarea, select")) return;
    swipe.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      horizontal: null,
      dx: 0,
      dy: 0,
      lastX: e.clientX,
      lastT: e.timeStamp,
      velocity: 0,
    };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const s = swipe.current;
    if (!s || s.pointerId !== e.pointerId) return;
    s.dx = e.clientX - s.startX;
    s.dy = e.clientY - s.startY;
    if (s.horizontal === null) {
      if (Math.max(Math.abs(s.dx), Math.abs(s.dy)) < SWIPE_SLOP_PX) return;
      s.horizontal = Math.abs(s.dx) > Math.abs(s.dy);
      if (!s.horizontal) {
        // เลื่อนเนื้อหาแนวตั้ง — ปล่อยให้เบราว์เซอร์ทำ
        swipe.current = null;
        return;
      }
    }
    const dt = e.timeStamp - s.lastT;
    if (dt > 0) {
      const v = (e.clientX - s.lastX) / dt;
      s.velocity = s.velocity === 0 ? v : s.velocity * 0.7 + v * 0.3;
      s.lastX = e.clientX;
      s.lastT = e.timeStamp;
    }
    // ตามนิ้วเฉพาะทางขวา — เขียน transform ตรง ๆ ไม่มี re-render ระหว่างลาก
    setTx(Math.max(0, s.dx), "none");
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const s = swipe.current;
    if (!s || s.pointerId !== e.pointerId) return;
    swipe.current = null;
    if (s.horizontal && swipeShouldClose(s.dx, s.dy, s.velocity)) {
      onCloseRef.current();
      return;
    }
    setTx(0, SNAP_BACK);
  };
  const onPointerCancel = () => {
    if (!swipe.current) return;
    swipe.current = null;
    setTx(0, SNAP_BACK);
  };

  const extra: HTMLAttributes<HTMLElement> = { ...(dataAttrs ?? {}) };
  return (
    <section
      ref={frameRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-right-sheet={kind}
      {...extra}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className={`right-sheet-in glass pointer-events-auto absolute z-30 flex flex-col overflow-hidden ${
        phone ? "" : "rounded-2xl"
      }`}
      style={{
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        left: box.left ?? undefined,
        width: box.width ?? undefined,
        // ปัดแนวนอนเป็นของเรา แนวตั้งยังเลื่อนเนื้อหาแบบ native
        touchAction: "pan-y",
        willChange: "transform",
        paddingTop: phone ? "env(safe-area-inset-top)" : undefined,
        paddingBottom: phone ? "env(safe-area-inset-bottom)" : undefined,
        paddingLeft: phone ? "env(safe-area-inset-left)" : undefined,
        paddingRight: phone ? "env(safe-area-inset-right)" : undefined,
      }}
    >
      {children}
    </section>
  );
}

/**
 * หัวของแผงด้านขวา: kicker (บรรทัดเล็กเหนือหัวข้อ) + h2 + ปุ่ม X — โฟกัสไปที่หัวข้อตอน mount (ผู้ใช้กรอบ
 * remount หัวแผงพร้อมเนื้อหาเมื่อสิ่งที่แสดงเปลี่ยน จึงได้โฟกัสใหม่ทุกครั้ง)
 */
export function RightSheetHeader({
  titleId,
  kicker,
  title,
  onClose,
  closeLabel,
  children,
}: {
  titleId: string;
  kicker: ReactNode;
  title: ReactNode;
  onClose: () => void;
  closeLabel: string;
  /** บรรทัดเพิ่มใต้หัวข้อ (เช่นป้าย "ยังไม่ได้ตรวจสอบ") — อยู่ในหัวแผง ไม่เลื่อนหายไปกับเนื้อหา */
  children?: ReactNode;
}) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <header className="flex shrink-0 items-start gap-2 border-b border-white/8 px-3.5 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="inline-flex items-center gap-1 text-[10px] text-[var(--color-fg-subtle)]">{kicker}</p>
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="text-sm leading-snug font-semibold text-white outline-none">
          {title}
        </h2>
        {children}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={closeLabel}
        title={closeLabel}
        className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-[var(--color-fg-muted)] transition-colors hover:bg-white/8 hover:text-[var(--color-fg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
      >
        <X size={15} />
      </button>
    </header>
  );
}
