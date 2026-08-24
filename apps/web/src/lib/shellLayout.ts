/**
 * เรขาคณิตของเปลือกหน้าต่าง (shell) — pure module ไม่มี React/DOM
 *
 * ตัวเลขทุกตัวที่กำหนดว่าแผงลอยกินพื้นที่ตรงไหนของแผนที่อยู่ที่นี่ที่เดียว:
 * `computeSafeArea()` ให้ inset ที่ `frameTerrain` (scene/setupScene.ts) ใช้จัด
 * กรอบจังหวัดให้พ้นแผง และ `AppShell` ใช้ตัวเลขชุดเดียวกันวางแผงจริง — สองฝั่ง
 * จึงเห็นตรงกันเสมอ
 *
 * ความกว้างของ drawer เป็น **ค่าคงที่ต่อ tier ไม่ใช่ค่าที่วัด** เพื่อให้ safe area
 * ถูกตั้งแต่เรนเดอร์แรกแบบ synchronous ก่อน manifest จะโหลดเสร็จและ `frameTerrain`
 * ทำงาน (มันอ่าน safe area ครั้งเดียวตอน AOI โหลด ไม่ได้อ่านซ้ำตอน resize)
 * ส่วนความสูงของ dock ล่างวัดจริงด้วย ResizeObserver (`BottomDock`)
 */
export type Tier = "phone" | "tablet" | "laptop" | "wide";

/** ระยะขอบระหว่างแผงกับขอบ viewport (CSS px) */
export const GUTTER = 12;
export const TOPBAR_H = 48;
export const RAIL_W = 48;
/** กลุ่มปุ่มเข็มทิศ/ซูมด้านขวา */
export const TOOLS_W = 48;
export const DRAWER_W: Record<Exclude<Tier, "phone">, number> = {
  tablet: 320,
  laptop: 352,
  wide: 360,
};
/** แผ่นเลื่อนบนมือถือตอนย่อ: เหลือแค่แถบแท็บ */
export const SHEET_COLLAPSED_H = 44;

/** phone < 768 ≤ tablet < 1024 ≤ laptop < 1280 ≤ wide */
export function tierFor(width: number): Tier {
  if (width < 768) return "phone";
  if (width < 1024) return "tablet";
  if (width < 1280) return "laptop";
  return "wide";
}

/**
 * drawer เปิดเป็นค่าเริ่มต้นเฉพาะจอกว้าง — laptop/tablet เริ่มปิดเพื่อให้แผนที่
 * ได้พื้นที่ก่อน (tablet ไม่เชื่อค่า "เปิด" ที่จำไว้ด้วย — ดู useShellState)
 */
export function defaultDrawerOpen(tier: Tier): boolean {
  return tier === "wide";
}

/** inset ที่แผงลอยบังไว้ (โครงสร้างเดียวกับ `SafeArea` ใน scene/setupScene.ts) */
export interface ShellSafeArea {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface SafeAreaInput {
  tier: Tier;
  drawerOpen: boolean;
  /** ความสูงที่วัดได้ของ dock ล่าง (0 = ยังไม่ได้วัด) */
  dockHeight: number;
  sheetOpen: boolean;
  /** ความสูงของแผ่นเลื่อนบนมือถือตอนขยาย */
  sheetHeight: number;
}

/**
 *   top    = GUTTER + TOPBAR_H + GUTTER                                   // 72 ทุก tier
 *   phone  : left/right 8; bottom = (sheetOpen ? sheetHeight : 44) + 8 + dockHeight
 *   ≥tablet: left  = GUTTER + RAIL_W + (drawerOpen ? DRAWER_W[tier] : 0) + GUTTER
 *            right = GUTTER + TOOLS_W + GUTTER                            // 72
 *            bottom= GUTTER + dockHeight
 */
export function computeSafeArea({
  tier,
  drawerOpen,
  dockHeight,
  sheetOpen,
  sheetHeight,
}: SafeAreaInput): ShellSafeArea {
  const top = GUTTER + TOPBAR_H + GUTTER;
  if (tier === "phone") {
    return {
      left: 8,
      right: 8,
      top,
      bottom: (sheetOpen ? sheetHeight : SHEET_COLLAPSED_H) + 8 + dockHeight,
    };
  }
  return {
    left: GUTTER + RAIL_W + (drawerOpen ? DRAWER_W[tier] : 0) + GUTTER,
    right: GUTTER + TOOLS_W + GUTTER,
    top,
    bottom: GUTTER + dockHeight,
  };
}
