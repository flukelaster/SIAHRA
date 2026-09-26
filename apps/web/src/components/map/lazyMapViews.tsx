import type { ComponentProps, ReactNode } from "react";
import { GUTTER, TOOLS_W } from "../../lib/shellLayout";
import { ChunkBoundary } from "../ui/ChunkBoundary";
import { lazyView } from "../ui/lazyView";
import type { CameraSheet as CameraSheetType } from "./CameraSheet";
import type { InfoPopup as InfoPopupType } from "./InfoPopup";

/**
 * ป๊อปอัปของจุดที่คลิก (`InfoPopup`) และแผงกล้อง (`CameraSheet`) เป็น chunk แยก — สอง
 * ตัวนี้ใหญ่ (กราฟย้อนหลัง, บล็อก CCTV/iTIC, ช่อง GFM) แต่ไม่มีใครเห็นจนกว่าจะคลิกบน
 * แผนที่ `Map3DCanvas` ใช้สองตัวนี้แทนของจริงโดยส่ง props เหมือนเดิมทุกตัว
 *
 * ตำแหน่งของป๊อปอัปมาจาก div ห่อใน Map3DCanvas (transform ต่อเฟรม เป็น % ของขนาดตัวเอง)
 * วงหมุนระหว่างโหลดจึงอยู่ที่จุดเดียวกับป๊อปอัปจริง ส่วนแผงกล้องวางวงหมุนที่มุมบนขวา
 * ตรงหัวของแผง (`cameraSheetBox`)
 */
const InfoPopupView = lazyView(() => import("./InfoPopup").then((m) => m.InfoPopup));
const CameraSheetView = lazyView(() => import("./CameraSheet").then((m) => m.CameraSheet));

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

export function LazyCameraSheet(props: ComponentProps<typeof CameraSheetType>) {
  const frame = (content: ReactNode) => (
    <div
      className="glass pointer-events-auto absolute z-30 rounded-2xl px-3 py-2.5"
      style={{ top: props.safeArea.top, right: GUTTER + TOOLS_W + GUTTER }}
    >
      {content}
    </div>
  );
  return (
    <ChunkBoundary frame={frame}>
      <CameraSheetView {...props} />
    </ChunkBoundary>
  );
}
