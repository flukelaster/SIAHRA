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
 * ส่วนความสูงของ dock ล่างวัดจริงด้วย ResizeObserver (`BottomDock`) — เฉพาะ tablet
 * ขึ้นไป บนมือถือ inset ล่างเป็นค่าคงที่ `SHEET_PEEK_H` (ดู `computeSafeArea`)
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
/**
 * ระดับความสูงของแผ่นเลื่อนบนมือถือ — peek เห็นเสมอ, half/full เป็นสัดส่วนของจอ
 */
export type SheetSnap = "peek" | "half" | "full";

/* ความสูงของแต่ละแถวใน peek (CSS px) — export ไว้ให้เทสต์ตรวจเป็นเลขคณิต ไม่ใช่
   magic number: `SHEET_PEEK_H` ต้องกว้างพอสำหรับผลรวมที่แย่ที่สุดเสมอ */
/** แถบมือจับ (h-6 + py-1.5) */
export const SHEET_GRIP_H = 24;
/** แถวสรุป: ชื่อจังหวัด + ชิปย้อนหลัง + จุดสถานะ — ห่อเป็นสองแถวได้ */
export const SHEET_SUMMARY_MAX_H = 64;
/** `TimelineBar variant="dense"` = `glass flex h-10` + ขอบ */
export const TIMELINE_DENSE_H = 42;
/** บรรทัดเครดิตย่อ ตอนห่อยาวที่สุดบนจอ 360 */
export const ATTRIBUTION_MAX_H = 73;
/** ช่องไฟ 3 ช่อง (gap-2) + padding ล่างของ peek */
export const SHEET_PEEK_GAPS = 4 * 8;

/**
 * ส่วนที่เห็นเสมอของแผ่นเลื่อน — **เพดาน** ไม่ใช่ค่าที่วัดได้
 *
 * การเลื่อนแผ่นจริงใช้ความสูงที่ ResizeObserver วัดได้ ไม่ใช่ค่านี้ (ถ้า clamp ด้วย
 * ค่าคงที่ บรรทัดเครดิตจะหลุดจอ ซึ่งผิดเงื่อนไขของผู้ให้ภาพดาวเทียมที่บังคับให้
 * ข้อความเครดิต "มองเห็นได้") ค่านี้ใช้เป็น inset ของ `computeSafeArea` เท่านั้น
 * จึงต้องเป็นเพดานเสมอ — ดูเทสต์ที่ยืนยันผลรวมข้างบน
 */
export const SHEET_PEEK_H = 240;
export const SHEET_HALF_VH = 0.55;
export const SHEET_FULL_VH = 0.92;
/** เร็วกว่านี้ (px/ms) = สะบัด → ไปสแนปถัดไปตามทิศ ไม่ใช่สแนปที่ใกล้ที่สุด */
export const SHEET_FLING_PX_PER_MS = 0.5;

/** ความสูงจริงของแต่ละสแนปบนจอสูง `viewportH` */
export function snapHeights(viewportH: number): Record<SheetSnap, number> {
  return {
    peek: SHEET_PEEK_H,
    half: Math.max(SHEET_PEEK_H, Math.round(viewportH * SHEET_HALF_VH)),
    full: Math.max(SHEET_PEEK_H, Math.round(viewportH * SHEET_FULL_VH)),
  };
}

const SNAP_ORDER: readonly SheetSnap[] = ["peek", "half", "full"];

/**
 * สแนปปลายทางเมื่อปล่อยนิ้ว
 *
 * @param heightPx ความสูงที่เห็นอยู่ตอนปล่อย
 * @param velocity px/ms — **บวก = นิ้วเลื่อนลง = แผ่นหด**
 * @param from     สแนปที่เริ่มลาก (ใช้เฉพาะตอนสะบัด)
 *
 * สะบัดขยับ **ทีละขั้น** เสมอ ไม่ข้ามระดับ — สะบัดลงแรง ๆ จาก full ควรได้ half
 * ไม่ใช่หุบมิดจนเสียบริบทที่กำลังอ่านอยู่
 */
export function nearestSnap(
  heightPx: number,
  velocity: number,
  heights: Record<SheetSnap, number>,
  from: SheetSnap,
): SheetSnap {
  if (Math.abs(velocity) >= SHEET_FLING_PX_PER_MS) {
    const i = SNAP_ORDER.indexOf(from);
    const next = velocity > 0 ? i - 1 : i + 1;
    return SNAP_ORDER[Math.min(SNAP_ORDER.length - 1, Math.max(0, next))];
  }
  let best: SheetSnap = "peek";
  let bestGap = Infinity;
  for (const snap of SNAP_ORDER) {
    const gap = Math.abs(heights[snap] - heightPx);
    if (gap < bestGap) {
      bestGap = gap;
      best = snap;
    }
  }
  return best;
}

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
  /** ความสูงที่วัดได้ของ dock ล่าง — ≥ tablet เท่านั้น (มือถือไม่มี dock แล้ว) */
  dockHeight: number;
}

/**
 *   top    = GUTTER + TOPBAR_H + GUTTER                                   // 72 ทุก tier
 *   phone  : left/right 8; bottom = SHEET_PEEK_H + 8                      // **คงที่**
 *   ≥tablet: left  = GUTTER + RAIL_W + (drawerOpen ? DRAWER_W[tier] : 0) + GUTTER
 *            right = GUTTER + TOOLS_W + GUTTER                            // 72
 *            bottom= GUTTER + dockHeight
 *
 * inset ของมือถือ **ไม่ขึ้นกับสถานะแผ่นเลื่อนอีกต่อไป** — กล้องจัดกรอบเทียบกับ
 * ส่วน peek เสมอ แล้วปล่อยให้แผ่นทับแผนที่ตอนกางขึ้น (พฤติกรรมเดียวกับ Google Maps)
 * เหตุผลที่ทำได้: `frameTerrain` อ่าน safe area **ครั้งเดียวตอนโหลด AOI** อยู่แล้ว
 * (`Map3DCanvas.tsx`) การผูก inset กับแผ่นจึงไม่เคยขยับกล้องจริง มีแต่ทำให้ identity
 * ของ safe area เปลี่ยนทุกครั้งที่ลาก แล้วไล่ re-render ลงไปถึงต้นไม้ canvas
 */
export function computeSafeArea({ tier, drawerOpen, dockHeight }: SafeAreaInput): ShellSafeArea {
  const top = GUTTER + TOPBAR_H + GUTTER;
  if (tier === "phone") {
    return { left: 8, right: 8, top, bottom: SHEET_PEEK_H + 8 };
  }
  return {
    left: GUTTER + RAIL_W + (drawerOpen ? DRAWER_W[tier] : 0) + GUTTER,
    right: GUTTER + TOOLS_W + GUTTER,
    top,
    bottom: GUTTER + dockHeight,
  };
}
