import { ChevronDown, ChevronUp } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { ApiHealthState } from "../../hooks/useApiHealth";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { useLang } from "../../i18n/context";
import { PHONE_TABBAR_H, SHEET_FULL_VH, type SheetSnap } from "../../lib/shellLayout";
import type { PanelKey } from "../../lib/shellPrefs";
import { subPanelId, subTabId, topicByKey, topicOf } from "../../lib/topics";
import { formatDateTime } from "../../lib/time";
import { ExaggerationControl } from "./ExaggerationControl";
import { ForecastStrip } from "./ForecastStrip";
import type { MapInfo } from "./Map3DCanvas";
import { MapAttribution } from "./MapAttribution";
import { panelByKey, type PanelContext } from "./panelRegistry";
import { PanelSlot } from "./PanelSlot";
import { SubTabs } from "./SubTabs";
import { SHEET_ID } from "./TopicTabBar";
import { SourceStatusPopover } from "./SourceStatusPopover";
import { StatPills } from "./StatPills";
import { FloodSourceAgeChip } from "./FloodSourceAgeChip";
import { TimelineBar, type TimelineMark } from "./TimelineBar";

/**
 * เปลือกล่างของมือถือ — **ชั้นเดียว** ที่ลอยอยู่เหนือแผนที่ (แบบ Google Maps)
 *
 * แผ่นถูกเรนเดอร์เต็มความสูง `SHEET_FULL_VH` เสมอ แล้วเลื่อนลงด้วย transform
 * (`useSheetDrag`) — สามระดับ peek / half / full ความสูงของ element ไม่เคยเปลี่ยน
 * จึงไม่มี layout ระหว่างลาก และลูปเรนเดอร์ของฉาก Three.js ไม่ถูกรบกวน
 *
 * ส่วน **peek ถูก mount เสมอ** ทุกระดับ และมีของสี่อย่างที่ต้องเห็นตลอด:
 *   1. ชื่อจังหวัด + ชิป "กำลังดูค่าย้อนหลัง" (ย้ายมาจากหัวข้อบนแผนที่)
 *   2. จุดสถานะแหล่งข้อมูล — แหล่งที่หยุดส่งต้องยังเห็นว่าหยุด ไม่ใช่หายไปเงียบ ๆ
 *   3. ไทม์ไลน์ (เวอร์ชันก่อนหน้าถอดมันทิ้งตอนเปิดแผง ทำให้กดย้อนเวลาไม่ได้เลย)
 *   4. บรรทัดเครดิต — เงื่อนไขของผู้ให้ภาพดาวเทียมบังคับให้ "มองเห็นได้"
 * ส่วนที่เหลือ (สรุปตัวเลข, แถบพยากรณ์, แท็บย่อยของหัวข้อ, มาตราส่วนแนวดิ่ง) อยู่ใน body
 * ซึ่ง mount เฉพาะตอนกาง
 *
 * แผ่นวางอยู่ **บน** แถบแท็บหัวข้อ (`TopicTabBar`, `PHONE_TABBAR_H`) ไม่ใช่ขอบจอ — ตัวเลือก
 * หัวข้ออยู่ที่แถบนั้น ส่วนแผ่นมีแค่แท็บย่อยของหัวข้อที่เลือก (`SubTabs`) ความสูงของแผ่น
 * หักความสูงแถบออกแล้ว สแนป full จึงยังสูงเท่าเดิมนับจากขอบจอ และตำแหน่งพักของ peek ยังใช้
 * ความสูงที่ **วัดได้** ของส่วน peek เหมือนเดิม (`useSheetDrag`)
 */
export function MobileSheet({
  ctx,
  panel,
  onPanelChange,
  snap,
  onSnapChange,
  apiHealth,
  mapInfo,
  exaggeration,
  onExaggerationChange,
  onAtIsoChange,
  timelineMarks,
  forecastAtIso,
  onForecastAtIsoChange,
}: {
  ctx: PanelContext;
  /** มุมมองย่อยที่เลือก — หัวข้อ derive จากมัน */
  panel: PanelKey;
  onPanelChange: (key: PanelKey) => void;
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  apiHealth: ApiHealthState;
  mapInfo: MapInfo | null;
  exaggeration: number;
  onExaggerationChange: (f: number) => void;
  onAtIsoChange: (atIso: string | null) => void;
  /** E14.F5 — ขีดรอบบิน Sentinel-1 */
  timelineMarks?: TimelineMark[];
  forecastAtIso: string | null;
  onForecastAtIsoChange: (forecastAtIso: string | null) => void;
}) {
  const { lang, t } = useLang();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const peekRef = useRef<HTMLDivElement | null>(null);
  const [peekPx, setPeekPx] = useState(0);
  const [attributionExpanded, setAttributionExpanded] = useState(false);
  const current = panelByKey(panel);
  const topic = topicOf(panel);
  const hasTabs = topicByKey(topic).views.length > 1;
  const open = snap !== "peek";

  // ความสูงจริงของส่วน peek ป้อนตำแหน่งพักของแผ่น — บรรทัดเครดิตห่อกี่บรรทัดก็ได้
  // โดยไม่มีทางหลุดขอบล่างของจอ
  useLayoutEffect(() => {
    const el = peekRef.current;
    if (!el) return;
    const report = () => setPeekPx(Math.ceil(el.getBoundingClientRect().height));
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { dragHandlers, bodyHandlers } = useSheetDrag({ sheetRef, snap, onSnapChange, peekPx });

  return (
    // ห้ามใส่ overflow-hidden: popover ของจุดสถานะกางขึ้น (`bottom-full`) เหนือแผ่น
    // ถ้าคลิป รายการแหล่งข้อมูลที่ผิดปกติจะถูกตัดหายไป
    <div
      ref={sheetRef}
      id={SHEET_ID}
      className="glass absolute right-0 left-0 z-20 flex flex-col rounded-t-2xl"
      style={{
        bottom: `calc(${PHONE_TABBAR_H}px + env(safe-area-inset-bottom))`,
        height: `calc(${SHEET_FULL_VH * 100}dvh - ${PHONE_TABBAR_H}px - env(safe-area-inset-bottom))`,
        willChange: "transform",
      }}
    >
      <div ref={peekRef} className="flex shrink-0 flex-col gap-2 px-2 pb-2">
        {/* แถบมือจับ: ลากขึ้น/ลง หรือแตะเพื่อวนระดับ */}
        <div
          {...dragHandlers}
          role="presentation"
          aria-label={t("sheet.dragHandle")}
          title={t("sheet.dragHandle")}
          className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
        >
          <span className="h-1 w-10 rounded-full bg-white/25" aria-hidden="true" />
        </div>

        {/* แถวสรุป — ลากได้เหมือนมือจับ (พื้นที่นิ้วโดนง่ายกว่าเส้นเล็ก ๆ ข้างบน) */}
        <div {...dragHandlers} className="flex touch-none items-center gap-2">
          <h2 className="min-w-0 shrink truncate text-sm font-bold text-[var(--color-fg)]">
            {t("viewport.province", { name: ctx.provinceName })}
          </h2>
          {/* กำลังดูค่าย้อนหลัง — ต้องบอกเสมอ ไม่ใช่รู้ได้เฉพาะในการ์ดระดับน้ำ */}
          {ctx.atIso !== null ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-risk-medium)]/20 px-2 py-0.5 text-[10px] text-[var(--color-risk-medium)] ring-1 ring-[var(--color-risk-medium)]/50 ring-inset">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-risk-medium)]" aria-hidden="true" />
              {t("viewport.historical", { time: formatDateTime(lang, ctx.atIso) })}
            </span>
          ) : null}
          <div className="ml-auto shrink-0 touch-auto" onPointerDown={(e) => e.stopPropagation()}>
            <SourceStatusPopover state={apiHealth} />
          </div>
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onSnapChange(open ? "peek" : "half")}
            aria-label={open ? t("sheet.collapse") : t("sheet.expand")}
            title={open ? t("sheet.collapse") : t("sheet.expand")}
            className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-[var(--color-fg-muted)] hover:bg-white/8"
          >
            {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>

        <TimelineBar atIso={ctx.atIso} onChange={onAtIsoChange} variant="dense" marks={timelineMarks} />

        <MapAttribution
          info={mapInfo}
          exaggeration={exaggeration}
          expanded={attributionExpanded}
          onToggle={() => setAttributionExpanded((v) => !v)}
          compact
        />
      </div>

      {open ? (
        <div
          {...bodyHandlers}
          className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-2"
          // pb ชดเชยส่วนของแผ่นที่ถูกเลื่อนตกขอบจอ (ดู useSheetDrag) — ที่ full ค่านี้เป็น 0
          style={{ touchAction: "pan-y", paddingBottom: "calc(0.75rem + var(--sheet-tx, 0px))" }}
        >
          {/* แท็บย่อยของหัวข้อ — บนสุดของ body (แทนแถบแท็บทุกแผงเดิม) เห็นทันทีที่กางครึ่ง
              ตัวเลือกหัวข้ออยู่ที่แถบแท็บล่าง หัวข้อที่มีมุมมองเดียวไม่มีแถวนี้ */}
          {hasTabs ? (
            <SubTabs topic={topic} active={panel} onSelect={onPanelChange} ctx={ctx} idBase={SHEET_ID} />
          ) : null}

          {/* ตัวเลขสรุป + มาตราส่วนแนวดิ่งอยู่แถวเดียวกัน: ทั้งคู่เป็นของทั้งแผนที่
              ไม่ใช่ของแผงใดแผงหนึ่ง จึงอยู่เหนือเนื้อของมุมมอง ไม่ใช่ท้ายสุดใต้แผง
              ซึ่งต้องเลื่อนผ่านรายการยาว ๆ กว่าจะเจอ */}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <StatPills
              summary={ctx.observations.data?.summary ?? null}
              loading={ctx.observations.loading}
              compact
            />
            <div className="ml-auto">
              <ExaggerationControl value={exaggeration} onChange={onExaggerationChange} compact />
            </div>
          </div>
          {/* E16 B-1 — อายุแหล่งน้ำท่วมจากดาวเทียม (บนจอกว้างอยู่ข้าง StatPills บนแผนที่) */}
          {ctx.floodAge ? (
            <div className="shrink-0">
              <FloodSourceAgeChip input={ctx.floodAge} compact />
            </div>
          ) : null}
          {/* แบบ `dense` ใช้ไม่ได้ที่ความกว้างนี้: ป้าย "พยากรณ์จากแบบจำลอง TMD"
              กับค่าฝนย่อไม่ได้ (ป้ายบอกว่านี่คือแบบจำลอง ไม่ใช่ค่าที่วัด — ตัดทิ้ง
              ไม่ได้) รวมกับปุ่มล้างแล้วกินไปแล้ว ~320 จาก 372px สไลเดอร์เลยเหลือ
              ไม่ถึงนิ้ว แบบเต็มวางสไลเดอร์คนละบรรทัดกับป้าย และ body นี้เลื่อนได้
              อยู่แล้ว ความสูงจึงถูกกว่าความกว้าง */}
          <div className="shrink-0">
            <ForecastStrip
              state={ctx.forecast}
              forecastAtIso={forecastAtIso}
              onChange={onForecastAtIsoChange}
            />
          </div>

          {/* `shrink-0` ไม่ใช่ `min-h-0`: ในคอลัมน์ flex ที่เลื่อนได้ กล่องที่ยอมหด
              จะถูกบีบให้พอดีที่ว่างแล้วเนื้อหาข้างในล้นออกมาโดยไม่มีอะไรคลิป —
              ของที่อยู่ถัดไปจึงถูกวาดทับรายการในแผง (เห็นบน iPhone จริง) */}
          <div
            id={hasTabs ? subPanelId(SHEET_ID) : undefined}
            role={hasTabs ? "tabpanel" : undefined}
            aria-labelledby={hasTabs ? subTabId(SHEET_ID, panel) : undefined}
            className="shrink-0"
          >
            <PanelSlot def={current} ctx={ctx} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
