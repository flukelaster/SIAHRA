import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { Province } from "../../data/types";
import type { ApiHealthState } from "../../hooks/useApiHealth";
import type { ShellState } from "../../hooks/useShellState";
import type { SearchPlace } from "../../lib/searchIndex";
import { DRAWER_W, GUTTER, RAIL_W, SHEET_COLLAPSED_H, TOPBAR_H } from "../../lib/shellLayout";
import type { PanelKey } from "../../lib/shellPrefs";
import { AlertToast } from "./AlertToast";
import { BottomDock } from "./BottomDock";
import { ExaggerationControl } from "./ExaggerationControl";
import { ForecastStrip } from "./ForecastStrip";
import type { MapInfo } from "./Map3DCanvas";
import { MapAttribution } from "./MapAttribution";
import { MobileSheet } from "./MobileSheet";
import type { PanelContext } from "./panelRegistry";
import { SideDrawer } from "./SideDrawer";
import { SideRail } from "./SideRail";
import { SourceStatusPopover } from "./SourceStatusPopover";
import { TimelineBar } from "./TimelineBar";
import { TopBar } from "./TopBar";

export interface AppShellProps {
  ctx: PanelContext;
  shell: ShellState;
  provinces: Province[];
  places: SearchPlace[];
  onSelectProvince: (code: string) => void;
  onSelectPlace: (place: SearchPlace) => void;
  onShare: () => Promise<boolean>;
  onSnapshot: () => void;
  apiHealth: ApiHealthState;
  mapInfo: MapInfo | null;
  exaggeration: number;
  onExaggerationChange: (f: number) => void;
  onAtIsoChange: (atIso: string | null) => void;
  forecastAtIso: string | null;
  onForecastAtIsoChange: (forecastAtIso: string | null) => void;
}

/**
 * Dock ล่างของมือถือ: จุดสถานะ + มาตราส่วน · ไทม์ไลน์เต็ม · แถบ TMD เต็ม ·
 * เครดิต — วัดความสูงแบบเดียวกับ `BottomDock` เพื่อให้ safe area ตรงกับของจริง
 */
function PhoneDock({
  bottom,
  sheetOpen,
  onHeight,
  apiHealth,
  mapInfo,
  exaggeration,
  onExaggerationChange,
  atIso,
  onAtIsoChange,
  forecast,
  forecastAtIso,
  onForecastAtIsoChange,
}: {
  bottom: number;
  /** แผ่นเลื่อนขยายอยู่ — ซ่อนแถบไทม์ไลน์/TMD ชั่วคราวให้แผนที่มีที่เหลือ */
  sheetOpen: boolean;
  onHeight: (px: number) => void;
} & Pick<
  AppShellProps,
  | "apiHealth"
  | "mapInfo"
  | "exaggeration"
  | "onExaggerationChange"
  | "onAtIsoChange"
  | "forecastAtIso"
  | "onForecastAtIsoChange"
> & { atIso: string | null; forecast: PanelContext["forecast"] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [attributionExpanded, setAttributionExpanded] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => onHeight(Math.round(el.getBoundingClientRect().height));
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeight]);
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute z-10 flex flex-col gap-2 @container"
      style={{ left: 8, right: 8, bottom }}
    >
      {/* ห่อบรรทัดได้ — "{n} แหล่งผิดปกติ" ต้องอ่านครบ ห้ามให้ตัวเลือกมาตราส่วนทับ
          (ความสูง dock ถูกวัด safe area จึงตามไปเอง) */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="pointer-events-auto min-w-0">
          <SourceStatusPopover state={apiHealth} />
        </div>
        <div className="pointer-events-auto ml-auto shrink-0">
          <ExaggerationControl value={exaggeration} onChange={onExaggerationChange} compact />
        </div>
      </div>
      {/* TimelineBar (observed) และ ForecastStrip (TMD) ต้องอยู่แถวเดียวกัน
          เพื่อให้ปลาย "ปัจจุบัน" ของอันแรกชนกับปลาย "0h" ของอันหลัง
          ตอนแผ่นเลื่อนขยาย (45% ของจอ) สองแถบนี้ถูกซ่อนชั่วคราว ไม่งั้นบนจอ 390
          แผนที่เหลือ ~130px — แถวจุดสถานะและบรรทัดเครดิตยัง mount อยู่เสมอ
          (พื้นผิวความซื่อสัตย์ต่อข้อมูลไม่หาย) และความสูง dock ที่วัดได้ป้อน safe
          area ให้เอง พอหุบแผ่นสองแถบก็กลับมา */}
      {sheetOpen ? null : (
        <div className="pointer-events-auto flex flex-col gap-2">
          <TimelineBar atIso={atIso} onChange={onAtIsoChange} />
          <ForecastStrip state={forecast} forecastAtIso={forecastAtIso} onChange={onForecastAtIsoChange} />
        </div>
      )}
      <div className="pointer-events-auto max-w-full self-start">
        <MapAttribution
          info={mapInfo}
          exaggeration={exaggeration}
          expanded={attributionExpanded}
          onToggle={() => setAttributionExpanded((v) => !v)}
          compact
        />
      </div>
    </div>
  );
}

/**
 * เลือกเปลือกตาม tier — ไม่มี data hook ที่นี่ (ทั้งหมดอยู่ใน App.tsx)
 *   ≥ tablet: TopBar + rail + drawer เดียว + dock ล่างเต็มความกว้าง + toast
 *   phone   : TopBar + dock ของมือถือ + แผ่นเลื่อน (ทะเบียนแผงเดียวกัน) + toast
 */
export function AppShell(props: AppShellProps) {
  const { ctx, shell } = props;
  const railButtons = useRef<Partial<Record<PanelKey, HTMLButtonElement | null>>>({});
  const focusRail = useCallback((key: PanelKey) => {
    railButtons.current[key]?.focus();
  }, []);

  const topBar = (
    <TopBar
      tier={shell.tier}
      provinces={props.provinces}
      selectedProvince={ctx.province}
      places={props.places}
      onSelectProvince={props.onSelectProvince}
      onSelectPlace={props.onSelectPlace}
      onShare={props.onShare}
      onSnapshot={props.onSnapshot}
    />
  );
  const toast = (
    <AlertToast
      state={ctx.activeAlerts}
      safeArea={shell.safeArea}
      tier={shell.tier}
      onOpen={() => shell.openPanel("impact")}
    />
  );

  if (shell.tier === "phone") {
    return (
      <>
        {topBar}
        <PhoneDock
          bottom={(shell.sheetOpen ? shell.sheetHeight : SHEET_COLLAPSED_H) + 8}
          sheetOpen={shell.sheetOpen}
          onHeight={shell.setDockHeight}
          apiHealth={props.apiHealth}
          mapInfo={props.mapInfo}
          exaggeration={props.exaggeration}
          onExaggerationChange={props.onExaggerationChange}
          atIso={ctx.atIso}
          onAtIsoChange={props.onAtIsoChange}
          forecast={ctx.forecast}
          forecastAtIso={props.forecastAtIso}
          onForecastAtIsoChange={props.onForecastAtIsoChange}
        />
        <MobileSheet
          ctx={ctx}
          active={shell.panel}
          onActiveChange={shell.setPanel}
          open={shell.sheetOpen}
          onOpenChange={shell.setSheetOpen}
          height={shell.sheetHeight}
        />
        {toast}
      </>
    );
  }

  const drawerWidth = DRAWER_W[shell.tier];
  return (
    <>
      {topBar}
      {/* rail + drawer เป็นก้อนกระจกเดียวกัน: บน 72 ซ้าย 12 ล่าง 12 + ความสูง dock
          (+8 ให้มีช่องหายใจเหนือแถวควบคุมของ dock — safe area ของแผนที่ยังเป็น 12 + dock) */}
      <div
        className="glass absolute z-10 flex overflow-hidden rounded-2xl"
        style={{
          top: GUTTER + TOPBAR_H + GUTTER,
          left: GUTTER,
          bottom: GUTTER + shell.dockHeight + 8,
          // +2 = เส้นขอบ 1px สองข้างของ .glass (box-sizing: border-box) เพื่อให้ความกว้าง
          // ภายในของ drawer เท่ากับ DRAWER_W ตรงกับที่ computeSafeArea คิดไว้
          width: RAIL_W + (shell.drawerOpen ? drawerWidth : 0) + 2,
        }}
      >
        <SideRail
          ctx={ctx}
          panel={shell.panel}
          drawerOpen={shell.drawerOpen}
          onToggle={shell.togglePanel}
          buttonRefs={railButtons}
        />
        {shell.drawerOpen ? (
          <SideDrawer
            ctx={ctx}
            panel={shell.panel}
            width={drawerWidth}
            onClose={shell.closeDrawer}
            onClosed={focusRail}
          />
        ) : null}
      </div>
      <BottomDock
        apiHealth={props.apiHealth}
        mapInfo={props.mapInfo}
        exaggeration={props.exaggeration}
        onExaggerationChange={props.onExaggerationChange}
        atIso={ctx.atIso}
        onAtIsoChange={props.onAtIsoChange}
        forecast={ctx.forecast}
        forecastAtIso={props.forecastAtIso}
        onForecastAtIsoChange={props.onForecastAtIsoChange}
        onHeight={shell.setDockHeight}
      />
      {toast}
    </>
  );
}
