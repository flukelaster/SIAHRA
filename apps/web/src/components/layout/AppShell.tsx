import { useCallback, useRef } from "react";
import type { Province } from "../../data/types";
import type { ApiHealthState } from "../../hooks/useApiHealth";
import type { ShellState } from "../../hooks/useShellState";
import type { SearchPlace } from "../../lib/searchIndex";
import { DRAWER_W, GUTTER, RAIL_W, TOPBAR_H } from "../../lib/shellLayout";
import type { PanelKey } from "../../lib/shellPrefs";
import { AlertToast } from "./AlertToast";
import { BottomDock } from "./BottomDock";
import type { MapInfo } from "./Map3DCanvas";
import { MobileSheet } from "./MobileSheet";
import type { PanelContext } from "./panelRegistry";
import { SideDrawer } from "./SideDrawer";
import { SideRail } from "./SideRail";
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
 * เลือกเปลือกตาม tier — ไม่มี data hook ที่นี่ (ทั้งหมดอยู่ใน App.tsx)
 *   ≥ tablet: TopBar + rail + drawer เดียว + dock ล่างเต็มความกว้าง + toast
 *   phone   : TopBar + แผ่นเลื่อนชั้นเดียว (ทะเบียนแผงเดียวกัน) + toast
 *             แผนที่เต็มจอ ทุกอย่างที่ไม่ใช่ TopBar/ปุ่มเครื่องมืออยู่ในแผ่นทั้งหมด
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
    <AlertToast state={ctx.activeAlerts} safeArea={shell.safeArea} onOpen={() => shell.openPanel("impact")} />
  );

  if (shell.tier === "phone") {
    return (
      <>
        {topBar}
        <MobileSheet
          ctx={ctx}
          active={shell.panel}
          onActiveChange={shell.setPanel}
          snap={shell.sheetSnap}
          onSnapChange={shell.setSheetSnap}
          apiHealth={props.apiHealth}
          mapInfo={props.mapInfo}
          exaggeration={props.exaggeration}
          onExaggerationChange={props.onExaggerationChange}
          onAtIsoChange={props.onAtIsoChange}
          forecastAtIso={props.forecastAtIso}
          onForecastAtIsoChange={props.onForecastAtIsoChange}
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
