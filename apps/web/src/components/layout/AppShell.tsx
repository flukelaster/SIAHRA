import { useCallback, useMemo, useRef, useState } from "react";
import type { Province } from "../../data/types";
import type { ApiHealthState } from "../../hooks/useApiHealth";
import type { ShellState } from "../../hooks/useShellState";
import { useLang } from "../../i18n/context";
import {
  buildNotifications,
  markAllSeen,
  readSeen,
  unreadCount,
  writeSeen,
  type NotificationAction,
} from "../../lib/notifications";
import type { SearchPlace } from "../../lib/searchIndex";
import { bangkokDateKey } from "../../lib/time";
import { DRAWER_W, GUTTER, RAIL_W, TOPBAR_H } from "../../lib/shellLayout";
import type { PanelKey } from "../../lib/shellPrefs";
import { AlertToast } from "./AlertToast";
import { BottomDock } from "./BottomDock";
import type { MapInfo } from "./Map3DCanvas";
import { MobileSheet } from "./MobileSheet";
import { LazyNotificationCenter as NotificationCenter } from "./LazyNotificationCenter";
import type { PanelContext } from "./panelRegistry";
import { SideDrawer } from "./SideDrawer";
import { SideRail } from "./SideRail";
import type { TimelineMark } from "./TimelineBar";
import { TopBar } from "./TopBar";

const getLocalStorage = () => window.localStorage;

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
  /** E14.F5 — ขีดรอบบิน Sentinel-1 บน TimelineBar (ทั้ง dock และแผ่นเลื่อน) */
  timelineMarks?: TimelineMark[];
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

  // ── ศูนย์การแจ้งเตือน: สร้างจาก state ของ hook ที่ App.tsx รันอยู่แล้ว (ผ่าน ctx)
  // ไม่มี hook โพลตัวที่สอง ไม่มีคำขอเครือข่ายใหม่
  const { lang } = useLang();
  const [notifOpen, setNotifOpen] = useState(false);
  const bellRef = useRef<HTMLButtonElement | null>(null);
  // อ่านครั้งเดียวตอน mount; เขียนเฉพาะตอนกด "อ่านทั้งหมดแล้ว" — การเปิดศูนย์ไม่นับว่าอ่าน
  const [seen, setSeen] = useState<string[]>(() => readSeen(getLocalStorage));
  const { activeAlerts, forecast, storms, affectedAuthorities, province } = ctx;
  // ApiHealthState เต็ม (มี apiDown/checkedAt) — ctx.apiHealth เป็นแค่ HealthResponse
  const apiHealth = props.apiHealth;
  const notifications = useMemo(
    () =>
      buildNotifications(
        {
          provinceCode: province.code,
          // วันปฏิทินกรุงเทพฯ ของ "ตอนนี้" — ขั้นรายวันของวันที่ผ่านไปแล้วไม่ใช่เรื่องที่ต้องเตือน
          // (อ่านนาฬิกาตรงนี้ ไม่ใช่ในโมดูล pure — memo คำนวณใหม่ทุกครั้งที่ข้อมูลเปลี่ยน)
          todayKey: bangkokDateKey(new Date().toISOString()),
          activeAlerts,
          forecast,
          apiHealth,
          authorityNames: new Map(affectedAuthorities.entries.map((e) => [e.id, e.nameTh])),
          storms,
          provinceName: lang === "th" ? province.nameTh : province.nameEn,
        },
        lang,
      ),
    [province, activeAlerts, forecast, storms, apiHealth, affectedAuthorities.entries, lang],
  );
  const unread = useMemo(() => unreadCount(notifications, seen), [notifications, seen]);
  const closeNotifications = useCallback(() => setNotifOpen(false), []);
  const markAllRead = useCallback(() => {
    setSeen((prev) => {
      const next = markAllSeen(prev, notifications);
      writeSeen(getLocalStorage, next);
      return next;
    });
  }, [notifications]);
  const onNotificationAction = useCallback(
    (action: NotificationAction) => {
      if (action.kind === "open-panel") {
        shell.openPanel(action.panel);
        setNotifOpen(false);
      }
    },
    [shell],
  );
  const provinceName = lang === "th" ? province.nameTh : province.nameEn;
  const notificationCenter = notifOpen ? (
    <NotificationCenter
      tier={shell.tier}
      bottomInset={shell.safeArea.bottom}
      items={notifications}
      seen={seen}
      provinceName={provinceName}
      bellRef={bellRef}
      onClose={closeNotifications}
      onMarkAllRead={markAllRead}
      onAction={onNotificationAction}
    />
  ) : null;

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
      unreadCount={unread}
      notificationsOpen={notifOpen}
      onToggleNotifications={() => setNotifOpen((o) => !o)}
      bellRef={bellRef}
    />
  );
  const toast = (
    // ปุ่มของ toast เปิดศูนย์การแจ้งเตือน — แผงผลกระทบยังเข้าได้จากปุ่มของแต่ละแถวแจ้งเตือน
    <AlertToast state={ctx.activeAlerts} safeArea={shell.safeArea} onOpen={() => setNotifOpen(true)} />
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
          timelineMarks={props.timelineMarks}
          forecastAtIso={props.forecastAtIso}
          onForecastAtIsoChange={props.onForecastAtIsoChange}
        />
        {toast}
        {notificationCenter}
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
        timelineMarks={props.timelineMarks}
        forecast={ctx.forecast}
        forecastAtIso={props.forecastAtIso}
        onForecastAtIsoChange={props.onForecastAtIsoChange}
        onHeight={shell.setDockHeight}
      />
      {toast}
      {notificationCenter}
    </>
  );
}
