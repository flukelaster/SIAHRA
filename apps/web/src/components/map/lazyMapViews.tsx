import type { ComponentProps, ReactNode } from "react";
import { GUTTER, TOOLS_W, type ShellSafeArea } from "../../lib/shellLayout";
import { ChunkBoundary } from "../ui/ChunkBoundary";
import { lazyView } from "../ui/lazyView";
import type { CameraSheet as CameraSheetType } from "./CameraSheet";
import type { InfoPopup as InfoPopupType } from "./InfoPopup";
import type { ReportCompose as ReportComposeType } from "./ReportCompose";
import type { ReportSheet as ReportSheetType } from "./ReportSheet";

/**
 * ป๊อปอัปของจุดที่คลิก (`InfoPopup`) แผงกล้อง (`CameraSheet`) แผงรายงานจากประชาชน (`ReportSheet`) และฟอร์ม
 * รายงาน (`ReportCompose` — รวมตัวบีบอัดรูป/worker และ Turnstile) เป็น chunk แยก — ใหญ่ (กราฟย้อนหลัง, บล็อก CCTV/iTIC, ช่อง GFM, Turnstile/โหวต) แต่ไม่มีใครเห็นจนกว่าจะ
 * คลิกบนแผนที่ `Map3DCanvas` ใช้ตัวห่อเหล่านี้แทนของจริงโดยส่ง props เหมือนเดิมทุกตัว
 *
 * ตำแหน่งของป๊อปอัปมาจาก div ห่อใน Map3DCanvas (transform ต่อเฟรม เป็น % ของขนาดตัวเอง)
 * วงหมุนระหว่างโหลดจึงอยู่ที่จุดเดียวกับป๊อปอัปจริง ส่วนแผงด้านขวาทั้งสองวางวงหมุนที่มุมบนขวาของกล่อง
 * แผงบนจอกว้าง (ขอบขวาเดียวกับ `rightSheetBox`) ใต้ TopBar ทุก tier
 */
const InfoPopupView = lazyView(() => import("./InfoPopup").then((m) => m.InfoPopup));
const CameraSheetView = lazyView(() => import("./CameraSheet").then((m) => m.CameraSheet));
const ReportSheetView = lazyView(() => import("./ReportSheet").then((m) => m.ReportSheet));
const ReportComposeView = lazyView(() => import("./ReportCompose").then((m) => m.ReportCompose));

const popupFrame = (content: ReactNode) => (
  <div className="glass pointer-events-auto w-72 rounded-xl px-3 py-2.5 shadow-2xl">{content}</div>
);

export function LazyInfoPopup(props: ComponentProps<typeof InfoPopupType>) {
  return (
    <ChunkBoundary frame={popupFrame}>
      <InfoPopupView {...props} />
    </ChunkBoundary>
  );
}

/** กรอบของวงหมุน/กล่องผิดพลาดระหว่างโหลด chunk ของแผงด้านขวา (กล้องและรายงาน ตำแหน่งเดียวกัน) */
function rightSheetFrame(safeArea: ShellSafeArea) {
  return (content: ReactNode) => (
    <div
      className="glass pointer-events-auto absolute z-30 rounded-2xl px-3 py-2.5"
      style={{ top: safeArea.top, right: GUTTER + TOOLS_W + GUTTER }}
    >
      {content}
    </div>
  );
}

export function LazyCameraSheet(props: ComponentProps<typeof CameraSheetType>) {
  return (
    <ChunkBoundary frame={rightSheetFrame(props.safeArea)}>
      <CameraSheetView {...props} />
    </ChunkBoundary>
  );
}

export function LazyReportSheet(props: ComponentProps<typeof ReportSheetType>) {
  return (
    <ChunkBoundary frame={rightSheetFrame(props.safeArea)}>
      <ReportSheetView {...props} />
    </ChunkBoundary>
  );
}

export function LazyReportCompose(props: ComponentProps<typeof ReportComposeType>) {
  return (
    <ChunkBoundary frame={rightSheetFrame(props.safeArea)}>
      <ReportComposeView {...props} />
    </ChunkBoundary>
  );
}
