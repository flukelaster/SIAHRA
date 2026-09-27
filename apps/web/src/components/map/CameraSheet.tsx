import { Camera as CameraIcon, MapPin, Video } from "lucide-react";
import { useState } from "react";
import { SOURCES, cameraKey } from "@siahra/shared-types";
import { useLang } from "../../i18n/context";
import { cameraName, cameraSelectionKey, type CameraContext, type CameraSelection } from "../../lib/cameraSheet";
import type { ShellSafeArea } from "../../lib/shellLayout";
import { markerStyle } from "../../scene/CctvMarkers";
import { CameraBody } from "./CameraBody";
import { RightSheet, RightSheetHeader } from "./RightSheet";

const TITLE_ID = "camera-sheet-title";

/**
 * แผงกล้องด้านขวา — กล้องของแหล่งใดก็ได้ที่เลือกจากหมุดหรือจากปุ่ม "กล้องใกล้เคียง" ของสถานี
 * แทน popup ที่เกาะหมุด (ซึ่งหลุดขอบจอบ่อยและเล็กเกินจะดูภาพ)
 *
 * กรอบ (ตำแหน่ง ปัดปิด Escape คืนโฟกัส `role="dialog"` เต็มจอบนมือถือ) อยู่ใน `RightSheet` ที่ใช้ร่วมกับ
 * แผงรายงานจากประชาชน — ไฟล์นี้เหลือเฉพาะเนื้อหาของกล้อง
 * - เนื้อหา remount ด้วย key ของกล้อง → สลับกล้อง = ตัวเล่นของกล้องเดิมถูกถอดก่อน มีสตรีมเดียวเสมอ
 */
export function CameraSheet({
  selection,
  safeArea,
  ctx,
  onClose,
}: {
  selection: CameraSelection;
  safeArea: ShellSafeArea;
  ctx: CameraContext | null;
  onClose: () => void;
}) {
  const { t } = useLang();
  const selKey = cameraSelectionKey(selection);
  return (
    <RightSheet
      kind="camera"
      selKey={selKey}
      titleId={TITLE_ID}
      safeArea={safeArea}
      onClose={onClose}
      dataAttrs={{ "data-camera-sheet": selKey }}
    >
      {ctx ? (
        <CameraSheetContent key={selKey} selection={selection} ctx={ctx} onClose={onClose} closeLabel={t("common.close")} />
      ) : null}
    </RightSheet>
  );
}

/**
 * หัวแผง + เนื้อหาของกล้องหนึ่งตัว — remount ต่อกล้อง (key) จึงถือสถานะกล้องที่เลือกในกลุ่มที่
 * ตั้งซ้อนกันไว้ที่นี่ แล้วหัวแผงแสดงชื่อและแหล่งของกล้องที่กำลังดูอยู่จริง
 */
function CameraSheetContent({
  selection,
  ctx,
  onClose,
  closeLabel,
}: {
  selection: CameraSelection;
  ctx: CameraContext;
  onClose: () => void;
  closeLabel: string;
}) {
  const { lang, t } = useLang();
  const [activeKey, setActiveKey] = useState(cameraKey(selection.camera));

  const active = ctx.cameras.find((c) => cameraKey(c) === activeKey) ?? selection.camera;
  const title = cameraName(active, lang, t);
  const source = SOURCES[active.sourceId];
  const kicker = lang === "th" ? source.nameTh : source.nameEn;
  const style = markerStyle(active);
  const KickerIcon = style.kind === "location" ? MapPin : style.kind === "video" ? Video : CameraIcon;

  return (
    <>
      <RightSheetHeader
        titleId={TITLE_ID}
        kicker={
          <>
            <KickerIcon size={11} aria-hidden="true" className={style.verified ? "text-[#38bdf8]" : "text-[#94a3b8]"} />
            {kicker}
          </>
        }
        title={title}
        onClose={onClose}
        closeLabel={closeLabel}
      />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3.5 py-3">
        <CameraBody
          camera={selection.camera}
          ctx={ctx}
          lang={lang}
          t={t}
          distanceKm={selection.distanceKm}
          activeKey={activeKey}
          onActiveChange={setActiveKey}
          showName={false}
        />
      </div>
    </>
  );
}
