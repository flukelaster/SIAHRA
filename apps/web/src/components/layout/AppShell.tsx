import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
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
import { DRAWER_W, GUTTER, PHONE_TABBAR_H, RAIL_W, TOPBAR_H, type SheetSnap } from "../../lib/shellLayout";
import { DEFAULT_TIMELINE_RANGE_INDEX } from "../../lib/timelineRange";
import type { TopicKey } from "../../lib/topics";
import { AlertToast } from "./AlertToast";
import { BottomDock } from "./BottomDock";
import type { MapInfo } from "./Map3DCanvas";
import { MapAttribution } from "./MapAttribution";
import { MobileSheet } from "./MobileSheet";
import { LazyNotificationCenter as NotificationCenter } from "./LazyNotificationCenter";
import { LayersPopover, LayersSheet } from "./LayersSurface";
import type { PanelContext } from "./panelRegistry";
import { SideDrawer } from "./SideDrawer";
import { SideRail } from "./SideRail";
import type { TimelineMark } from "./TimelineBar";
import { TimeChip } from "./TimeChip";
import { TIMELINE_PANEL_ID, TimelinePanel } from "./TimelinePanel";
import { TopBar } from "./TopBar";
import { TopicTabBar } from "./TopicTabBar";

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
  /** ค่ามาตราส่วนแนวดิ่ง — บรรทัดเครดิตบอกค่าเมื่อไม่ใช่ 1:1 (ตัวเลือกอยู่ในชั้นข้อมูลผ่าน ctx) */
  exaggeration: number;
  onAtIsoChange: (atIso: string | null) => void;
  /** E14.F5 — ขีดรอบบิน Sentinel-1 บน TimelineBar (แผงแถบเวลาที่กางจากชิปเวลา) */
  timelineMarks?: TimelineMark[];
  /**
   * ช่วงของแถบเวลา (ดัชนีใน `TIMELINE_RANGES`) — ถือใน App.tsx เพราะหน้าต่างของหมุดรายงานจากประชาชนใช้ช่วงเดียวกัน
   * ไม่ส่ง = เปลือกถือเอง (ตามเดิมของ E18.4)
   */
  timelineRangeIdx?: number;
  onTimelineRangeChange?: (rangeIdx: number) => void;
  forecastAtIso: string | null;
  onForecastAtIsoChange: (forecastAtIso: string | null) => void;
  /** มือถือ: ความสูง peek ที่วัดได้ของแผ่นเลื่อน — App ส่งต่อให้ MapViewport (ของลอยเกาะเหนือ peek จริง) */
  onPhonePeekPx?: (px: number) => void;
}

/**
 * เลือกเปลือกตาม tier — ไม่มี data hook ที่นี่ (ทั้งหมดอยู่ใน App.tsx)
 *   ≥ tablet: TopBar (+ ชิปเวลา) + rail หัวข้อ + drawer เดียว (แท็บย่อยของหัวข้อ) + dock ล่างเต็มความกว้าง
 *             (สถานะแหล่ง + เครดิต + แผงแถบเวลาเมื่อกาง) + toast + popover ชั้นข้อมูล
 *   phone   : TopBar + แผ่นเลื่อนชั้นเดียว (ทะเบียนแผงเดียวกัน, ชิปเวลาใน peek) บนแถบแท็บหัวข้อ + toast
 *             + แผงแถบเวลาเหนือแถบแท็บเมื่อกาง + แผ่นล่าง modal ของชั้นข้อมูล — แผนที่เต็มจอ ทุกอย่างที่
 *             ไม่ใช่ TopBar/ปุ่มเครื่องมืออยู่ในแผ่นทั้งหมด
 *
 * E18.4 — ชิปเวลา/แผงแถบเวลา: สถานะ "กางอยู่" และช่วงที่เลือก (48 ชม./7 วัน/30 วัน) เป็นสถานะการแสดงผล
 * ของเปลือกเท่านั้น — ไม่อยู่ใน permalink ไม่ทำให้เกิดคำขอ และไม่เปลี่ยน atIso/forecastAtIso (C6)
 * มี `TimelineBar` ได้ไม่เกินหนึ่งตัว: เฉพาะในแผงที่กางอยู่ (C4) และหุบ = unmount (C5)
 */
export function AppShell(props: AppShellProps) {
  const { ctx, shell } = props;
  const railButtons = useRef<Partial<Record<TopicKey, HTMLButtonElement | null>>>({});
  const focusRail = useCallback((topic: TopicKey) => {
    railButtons.current[topic]?.focus();
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

  // ── ชิปเวลา + แผงแถบเวลา (E18.4)
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [ownTimelineRangeIdx, setOwnTimelineRangeIdx] = useState(DEFAULT_TIMELINE_RANGE_INDEX);
  const timelineRangeIdx = props.timelineRangeIdx ?? ownTimelineRangeIdx;
  const setTimelineRangeIdx = props.onTimelineRangeChange ?? setOwnTimelineRangeIdx;
  const chipRef = useRef<HTMLButtonElement | null>(null);
  const closeTimeline = useCallback(() => setTimelineOpen(false), []);
  const { onAtIsoChange, onForecastAtIsoChange } = props;
  const obs = ctx.observations;
  const timeChip = (
    <TimeChip
      atIso={ctx.atIso}
      forecastAtIso={props.forecastAtIso}
      observations={{
        hasData: obs.data !== null,
        loading: obs.loading,
        failed: obs.error !== null,
        fetchedAt: obs.data?.summary.fetchedAt ?? null,
        latestObservedAt: obs.data?.summary.latestObservedAt ?? null,
      }}
      expanded={timelineOpen}
      panelId={TIMELINE_PANEL_ID}
      onToggle={() => setTimelineOpen((o) => !o)}
      onClearAt={() => onAtIsoChange(null)}
      onClearForecast={() => onForecastAtIsoChange(null)}
      chipRef={chipRef}
      variant={shell.tier === "phone" ? "sheet" : "bar"}
    />
  );
  const timelinePanel = (footer?: ReactNode) =>
    timelineOpen ? (
      <TimelinePanel
        atIso={ctx.atIso}
        onAtIsoChange={onAtIsoChange}
        marks={props.timelineMarks}
        rangeIdx={timelineRangeIdx}
        onRangeIdxChange={setTimelineRangeIdx}
        onClose={closeTimeline}
        returnFocusRef={chipRef}
        footer={footer}
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
      timeChip={shell.tier === "phone" ? null : timeChip}
    />
  );
  const toast = (
    // ปุ่มของ toast เปิดศูนย์การแจ้งเตือน — แผงผลกระทบยังเข้าได้จากปุ่มของแต่ละแถวแจ้งเตือน
    <AlertToast state={ctx.activeAlerts} safeArea={shell.safeArea} onOpen={() => setNotifOpen(true)} />
  );

  if (shell.tier === "phone") {
    // แผ่นเปลี่ยนระดับ / แตะหัวข้อ = หุบแผงแถบเวลา (แผงทับส่วนล่างของแผ่นอยู่) — ไม่แตะ atIso (C6)
    const setSnap = (snap: SheetSnap) => {
      setTimelineOpen(false);
      shell.setSheetSnap(snap);
    };
    const tapTopic = (topic: TopicKey) => {
      setTimelineOpen(false);
      shell.tapTopic(topic);
    };
    return (
      <>
        {topBar}
        <MobileSheet
          ctx={ctx}
          panel={shell.panel}
          onPanelChange={shell.setPanel}
          snap={shell.sheetSnap}
          onSnapChange={setSnap}
          apiHealth={props.apiHealth}
          mapInfo={props.mapInfo}
          exaggeration={props.exaggeration}
          timeChip={timeChip}
          onPeekPx={props.onPhonePeekPx}
        />
        <TopicTabBar ctx={ctx} topic={shell.topic} sheetOpen={shell.sheetSnap !== "peek"} onTap={tapTopic} />
        {timelineOpen ? (
          // แผงแถบเวลาของมือถือ: เหนือแถบแท็บหัวข้อ ทับ peek ของแผ่นเลื่อน (รวมบรรทัดเครดิตของมัน) จึงพก
          // บรรทัดเครดิตย่อของตัวเองมาด้วย — เครดิตภาพดาวเทียม (Esri ToU / EOX CC BY-NC-SA) ต้องมองเห็นได้
          // ตลอดที่แผงเปิด (แบบเดียวกับ LayersSheet)
          <div
            className="glass absolute right-0 left-0 z-30 rounded-t-2xl p-2"
            style={{ bottom: `calc(${PHONE_TABBAR_H}px + env(safe-area-inset-bottom))` }}
          >
            {timelinePanel(<CompactAttribution info={props.mapInfo} exaggeration={props.exaggeration} />)}
          </div>
        ) : null}
        {toast}
        {notificationCenter}
        {shell.layersOpen ? (
          <LayersSheet
            ctx={ctx}
            mapInfo={props.mapInfo}
            exaggeration={props.exaggeration}
            buttonRef={shell.layersButtonRef}
            onClose={shell.closeLayers}
          />
        ) : null}
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
          topic={shell.topic}
          drawerOpen={shell.drawerOpen}
          onToggle={shell.toggleTopic}
          buttonRefs={railButtons}
        />
        {shell.drawerOpen ? (
          <SideDrawer
            ctx={ctx}
            panel={shell.panel}
            onPanelChange={shell.setPanel}
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
        timelinePanel={timelinePanel()}
        onHeight={shell.setDockHeight}
      />
      {toast}
      {notificationCenter}
      {shell.layersOpen ? (
        <LayersPopover
          ctx={ctx}
          safeArea={shell.safeArea}
          buttonRef={shell.layersButtonRef}
          onClose={shell.closeLayers}
        />
      ) : null}
    </>
  );
}

/** บรรทัดเครดิตย่อของแผงแถบเวลาบนมือถือ (แผงทับ peek ที่มีบรรทัดเครดิตของแผ่นเลื่อน) */
function CompactAttribution({ info, exaggeration }: { info: MapInfo | null; exaggeration: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <MapAttribution
      info={info}
      exaggeration={exaggeration}
      expanded={expanded}
      onToggle={() => setExpanded((v) => !v)}
      compact
    />
  );
}
