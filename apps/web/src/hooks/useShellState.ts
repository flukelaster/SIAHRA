import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  computeSafeArea,
  defaultDrawerOpen,
  type SheetSnap,
  type ShellSafeArea,
  type Tier,
} from "../lib/shellLayout";
import { readShellPrefs, writeShellPrefs, type PanelKey } from "../lib/shellPrefs";
import { useViewport } from "./useViewport";

export interface ShellState {
  tier: Tier;
  drawerOpen: boolean;
  panel: PanelKey;
  /**
   * มือถือ: ระดับของแผ่นเลื่อน — peek (เห็นเสมอ) / half / full
   * **ไม่ถูกจำใน localStorage** — `siahra.shell` คงรูป `{v:1, drawerOpen, panel}` ไว้เท่าเดิม
   */
  sheetSnap: SheetSnap;
  /** ≥ tablet เท่านั้น — มือถือไม่มี dock ล่างแล้ว */
  dockHeight: number;
  safeArea: ShellSafeArea;
  openPanel: (key: PanelKey) => void;
  closeDrawer: () => void;
  /** กดปุ่มแผงที่เปิดอยู่ = ปิด drawer; แผงอื่น = สลับไปแผงนั้น (เปิดไว้) */
  togglePanel: (key: PanelKey) => void;
  /** มือถือ: เปลี่ยนแท็บโดยไม่แตะระดับของแผ่นเลื่อน */
  setPanel: (key: PanelKey) => void;
  setSheetSnap: (snap: SheetSnap) => void;
  setDockHeight: (px: number) => void;
}

const getLocalStorage = () => window.localStorage;

/** อีเวนต์คีย์บอร์ดที่มาจากช่องพิมพ์ — Escape ของช่องนั้นเป็นของช่องนั้น ไม่ใช่ของเปลือก */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

/**
 * สถานะของเปลือกหน้าต่าง: tier, drawer/แผง, แผ่นเลื่อนมือถือ, ความสูง dock และ
 * safe area ที่คำนวณจากทั้งหมดนั้น (`lib/shellLayout.ts`)
 *
 * กติกา tier ถูกใช้ **ใน lazy initialiser** ไม่ใช่ใน effect — ถ้าเริ่มด้วยค่าที่
 * จำไว้แล้วค่อยปิดใน effect จอ tablet จะเห็น drawer เปิดหนึ่งเฟรมก่อนหุบ และ
 * safe area เฟรมแรกจะผิดไปด้วย
 *
 * ความจำ (`lib/shellPrefs.ts`) ถูกเขียน **หลังผู้ใช้เปลี่ยนเอง** เท่านั้น ไม่ใช่
 * ตอน mount — ไม่งั้นแค่เปิดหน้าบน tablet ก็เขียนทับค่า "เปิด" ที่ผู้ใช้ตั้งไว้
 * จากจอกว้างด้วย "ปิด" ที่ tablet บังคับ
 */
export function useShellState(): ShellState {
  const viewport = useViewport();
  const tier = viewport.tier;

  const [{ drawerOpen, panel }, setShell] = useState<{ drawerOpen: boolean; panel: PanelKey }>(() => {
    const prefs = readShellPrefs(getLocalStorage);
    const key = prefs?.panel ?? "layers";
    // tablet เริ่มปิดเสมอ (ไม่เชื่อค่า "เปิด" ที่จำไว้); phone ใช้เฉพาะ `panel`
    // (ระดับของแผ่นเลื่อนคือ sheetSnap ต่างหาก); laptop/wide ใช้ค่าที่จำไว้
    // ถ้าไม่มีจึงค่อยเป็นค่าเริ่มต้นตาม tier
    const open =
      tier === "tablet" || tier === "phone" ? false : (prefs?.drawerOpen ?? defaultDrawerOpen(tier));
    return { drawerOpen: open, panel: key };
  });
  const [sheetSnap, setSheetSnap] = useState<SheetSnap>("peek");
  const [dockHeight, setDockHeight] = useState(0);

  // ค่าล่าสุดสำหรับ callback ที่ identity คงที่ (Escape handler / openPanel)
  const sheetSnapRef = useRef(sheetSnap);
  sheetSnapRef.current = sheetSnap;
  const drawerOpenRef = useRef(drawerOpen);
  drawerOpenRef.current = drawerOpen;
  const tierRef = useRef(tier);
  tierRef.current = tier;

  // เขียนความจำเฉพาะหลังผู้ใช้เปลี่ยนเอง — ธง `userChanged` ถูกตั้งใน action เท่านั้น
  const userChanged = useRef(false);
  useEffect(() => {
    if (!userChanged.current) return;
    writeShellPrefs(getLocalStorage, { drawerOpen, panel });
  }, [drawerOpen, panel]);

  /** เปิดแผงที่ระบุ (toast/ปุ่มชั้นข้อมูลใช้): จอกว้าง = เปิด drawer, มือถือ = กางครึ่ง */
  const openPanel = useCallback((key: PanelKey) => {
    userChanged.current = true;
    if (tierRef.current === "phone") {
      setShell((s) => ({ ...s, panel: key }));
      setSheetSnap("half");
    } else {
      setShell({ drawerOpen: true, panel: key });
    }
  }, []);
  const closeDrawer = useCallback(() => {
    userChanged.current = true;
    setShell((s) => ({ ...s, drawerOpen: false }));
  }, []);
  const togglePanel = useCallback((key: PanelKey) => {
    userChanged.current = true;
    setShell((s) => (s.drawerOpen && s.panel === key ? { ...s, drawerOpen: false } : { drawerOpen: true, panel: key }));
  }, []);
  const setPanel = useCallback((key: PanelKey) => {
    userChanged.current = true;
    setShell((s) => ({ ...s, panel: key }));
  }, []);

  // Escape ปิด drawer / หุบแผ่นเลื่อน — เว้นตอนกำลังพิมพ์ และเว้นเมื่อ popover
  // ตัวไหนรับ Esc ไปแล้ว (ProvinceChip/SourceStatusPopover เรียก preventDefault
  // ใน capture phase บน document ซึ่งวิ่งก่อน listener แบบ bubble บน window ตัวนี้)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isTypingTarget(e.target)) return;
      if (tierRef.current === "phone") {
        // หุบทีเดียวจาก full — บันไดจาก full ไป half ไป peek จะทำให้ Escape
        // ต้องกดสองครั้งโดยไม่มีเหตุผล
        if (sheetSnapRef.current !== "peek") setSheetSnap("peek");
      } else if (drawerOpenRef.current) {
        closeDrawer();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeDrawer]);

  // บนมือถือ memo นี้ไม่ invalidate จากการเล่นแผ่นเลื่อนอีกแล้ว — identity ของ
  // safeArea จึงนิ่งตลอด gesture และ props ของ Map3DCanvas ไม่กระเพื่อม
  const safeArea = useMemo(
    () => computeSafeArea({ tier, drawerOpen, dockHeight }),
    [tier, drawerOpen, dockHeight],
  );

  return {
    tier,
    drawerOpen,
    panel,
    sheetSnap,
    dockHeight,
    safeArea,
    openPanel,
    closeDrawer,
    togglePanel,
    setPanel,
    setSheetSnap,
    setDockHeight,
  };
}
