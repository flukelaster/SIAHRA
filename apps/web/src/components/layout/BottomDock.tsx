import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ApiHealthState } from "../../hooks/useApiHealth";
import { GUTTER } from "../../lib/shellLayout";
import type { MapInfo } from "./Map3DCanvas";
import { MapAttribution } from "./MapAttribution";
import { SourceStatusPopover } from "./SourceStatusPopover";

/**
 * Dock ล่างเต็มความกว้าง (จอ ≥ tablet) — E18.4 เหลือแถวเดียว: สถานะแหล่งข้อมูล + บรรทัดเครดิต
 * (+ แผงแถบเวลาเหนือแถวนั้นเมื่อกางจากชิปเวลาบน TopBar, `timelinePanel`)
 *
 * ของที่ย้ายออกไป: แถบเวลา dense → ชิปเวลา + แผงลอย · แถบพยากรณ์ TMD → มุมมองพยากรณ์ของหัวข้อฝนและ
 * พายุ · มาตราส่วนแนวดิ่ง → กลุ่มแผนที่ฐานในชั้นข้อมูล (ค่าที่ไม่ใช่ 1:1 ยังอยู่ในบรรทัดเครดิตเสมอ)
 *
 * ความสูงจริงถูกวัดด้วย ResizeObserver ใน `useLayoutEffect` (ก่อน paint) แล้วรายงานให้ safe area
 * — แผงแถบเวลาที่กางอยู่จึงดัน rail/drawer ขึ้นแทนที่จะทับมัน
 *
 * root เป็น `pointer-events-none` และเปิดกลับเฉพาะลูกที่เป็นตัวควบคุมจริง —
 * ช่องว่างระหว่างตัวควบคุมต้องปล่อยให้ลากแผนที่ทะลุได้
 */
export function BottomDock({
  apiHealth,
  mapInfo,
  exaggeration,
  timelinePanel = null,
  onHeight,
}: {
  apiHealth: ApiHealthState;
  mapInfo: MapInfo | null;
  /** ค่ามาตราส่วนแนวดิ่ง — แสดงในบรรทัดเครดิตเมื่อไม่ใช่ 1:1 (ตัวเลือกอยู่ในชั้นข้อมูลแล้ว) */
  exaggeration: number;
  /** แผงแถบเวลา (mount เฉพาะตอนกาง — C5) */
  timelinePanel?: ReactNode;
  /** Reports the rendered dock height so the map can keep the province clear of it. */
  onHeight?: (px: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [attributionExpanded, setAttributionExpanded] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !onHeight) return;
    const report = () => onHeight(Math.round(el.getBoundingClientRect().height));
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeight]);

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute z-10 flex flex-col gap-1.5"
      style={{ left: GUTTER, right: GUTTER, bottom: GUTTER }}
    >
      {timelinePanel ? (
        <div className="pointer-events-auto w-full max-w-[760px] self-center">{timelinePanel}</div>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <div className="pointer-events-auto shrink-0">
          <SourceStatusPopover state={apiHealth} />
        </div>
        {/* ตัวห่อ flex-1 ปล่อยให้ลากแผนที่ทะลุได้ — เปิด pointer เฉพาะกล่องเครดิตเอง */}
        <div className="max-w-full min-w-0 flex-1 basis-80">
          <div className="pointer-events-auto w-fit max-w-full">
            <MapAttribution
              info={mapInfo}
              exaggeration={exaggeration}
              expanded={attributionExpanded}
              onToggle={() => setAttributionExpanded((v) => !v)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
