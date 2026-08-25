import { ChevronDown, ChevronUp } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { ApiHealthState } from "../../hooks/useApiHealth";
import { useSheetDrag } from "../../hooks/useSheetDrag";
import { useLang } from "../../i18n/context";
import { SHEET_FULL_VH, type SheetSnap } from "../../lib/shellLayout";
import type { PanelKey } from "../../lib/shellPrefs";
import { formatDateTime } from "../../lib/time";
import { ExaggerationControl } from "./ExaggerationControl";
import { ForecastStrip } from "./ForecastStrip";
import type { MapInfo } from "./Map3DCanvas";
import { MapAttribution } from "./MapAttribution";
import { PanelBadge } from "./PanelBadge";
import { PANELS, panelByKey, type PanelContext } from "./panelRegistry";
import { SourceStatusPopover } from "./SourceStatusPopover";
import { StatPills } from "./StatPills";
import { TimelineBar } from "./TimelineBar";

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
 * ส่วนที่เหลือ (สรุปตัวเลข, แถบพยากรณ์, แท็บแผง, มาตราส่วนแนวดิ่ง) อยู่ใน body
 * ซึ่ง mount เฉพาะตอนกาง
 */
export function MobileSheet({
  ctx,
  active,
  onActiveChange,
  snap,
  onSnapChange,
  apiHealth,
  mapInfo,
  exaggeration,
  onExaggerationChange,
  onAtIsoChange,
  forecastAtIso,
  onForecastAtIsoChange,
}: {
  ctx: PanelContext;
  active: PanelKey;
  onActiveChange: (key: PanelKey) => void;
  snap: SheetSnap;
  onSnapChange: (snap: SheetSnap) => void;
  apiHealth: ApiHealthState;
  mapInfo: MapInfo | null;
  exaggeration: number;
  onExaggerationChange: (f: number) => void;
  onAtIsoChange: (atIso: string | null) => void;
  forecastAtIso: string | null;
  onForecastAtIsoChange: (forecastAtIso: string | null) => void;
}) {
  const { lang, t } = useLang();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const peekRef = useRef<HTMLDivElement | null>(null);
  const [peekPx, setPeekPx] = useState(0);
  const [attributionExpanded, setAttributionExpanded] = useState(false);
  const current = panelByKey(active);
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
      className="glass absolute right-0 bottom-0 left-0 z-20 flex flex-col rounded-t-2xl"
      style={{ height: `${SHEET_FULL_VH * 100}dvh`, willChange: "transform" }}
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

        <TimelineBar atIso={ctx.atIso} onChange={onAtIsoChange} variant="dense" />

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
          className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-2 pb-3"
          style={{ touchAction: "pan-y" }}
        >
          <StatPills
            summary={ctx.observations.data?.summary ?? null}
            loading={ctx.observations.loading}
            compact
          />
          <ForecastStrip
            state={ctx.forecast}
            forecastAtIso={forecastAtIso}
            onChange={onForecastAtIsoChange}
            variant="dense"
          />

          <div className="flex shrink-0 items-center gap-1 overflow-x-auto">
            {PANELS.map((p) => {
              const isActive = current.key === p.key;
              const badge = p.badge?.(ctx) ?? null;
              return (
                <div key={p.key} className="relative shrink-0">
                  <button
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => onActiveChange(p.key)}
                    className={`cursor-pointer rounded-lg px-2.5 py-1 text-xs whitespace-nowrap transition-colors ${
                      isActive
                        ? "bg-[var(--color-accent)]/25 text-white"
                        : "text-[var(--color-fg-muted)] hover:bg-white/8"
                    }`}
                  >
                    {t(p.labelKey)}
                  </button>
                  <PanelBadge badge={badge} />
                </div>
              );
            })}
          </div>

          <div className="min-h-0">{current.render(ctx)}</div>

          <div className="shrink-0 self-start pt-1">
            <ExaggerationControl value={exaggeration} onChange={onExaggerationChange} compact />
          </div>
        </div>
      ) : null}
    </div>
  );
}
