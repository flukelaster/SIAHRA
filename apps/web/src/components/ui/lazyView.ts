import { createElement, use, type ComponentType, type ReactElement } from "react";
import { lazyModule } from "../../lib/lazyModule";

/**
 * คอมโพเนนต์ที่โค้ดอยู่ใน chunk แยก — เหมือน `React.lazy` แต่ลองใหม่ได้หลังโหลดพลาด
 * (`lib/lazyModule.ts`) ต้องอยู่ใต้ `<ChunkBoundary>` เสมอ: ระหว่างโหลดมัน suspend
 * (boundary แสดงวงหมุน "กำลังโหลด…") และถ้าโหลดพลาดมันโยน error ให้ boundary แสดงกล่อง
 * "โหลดส่วนนี้ไม่สำเร็จ" พร้อมปุ่มลองใหม่ — ไม่ใช่จอขาวทั้งแอป
 *
 * `importer` คืน **คอมโพเนนต์** (ไม่ใช่ `{ default }` แบบ React.lazy) เพื่อให้ export
 * แบบมีชื่อที่ไฟล์ทั้งหมดในโปรเจกต์นี้ใช้ ต่อได้ตรง ๆ:
 * `lazyView(() => import("../map/InfoPopup").then((m) => m.InfoPopup))`
 */
export type LazyView<P extends object> = ((props: P) => ReactElement) & {
  /** เริ่มโหลดล่วงหน้า (เช่นตอนชี้เมาส์) — ไม่ต้องรอให้เรนเดอร์ */
  preload: () => Promise<unknown>;
};

export function lazyView<P extends object>(importer: () => Promise<ComponentType<P>>): LazyView<P> {
  const mod = lazyModule(importer);
  function LazyViewComponent(props: P): ReactElement {
    // เรียก use() ทุกครั้ง (ห้ามเรียกแบบมีเงื่อนไข — React โยน error ถ้ารอบที่ suspend
    // เรียกแต่รอบที่ต่อเนื่องไม่เรียก) กับ promise ตัวเดิมเสมอ ถ้าโหลดเสร็จแล้วแต่ React
    // ยังไม่เคยเห็น promise นี้ (preload ไว้ก่อน) ติดป้ายสถานะแบบที่ React ใช้เองให้ —
    // use() จึงคืนค่าทันทีไม่ suspend (เปิดแผงที่โหลดแล้วไม่กะพริบวงหมุน)
    const promise = mod.load();
    const loaded = mod.peek();
    const tracked = promise as unknown as { status?: string; value?: unknown };
    if (loaded && tracked.status === undefined) {
      tracked.status = "fulfilled";
      tracked.value = loaded;
    }
    return createElement(use(promise), props);
  }
  return Object.assign(LazyViewComponent, { preload: () => mod.load() });
}
