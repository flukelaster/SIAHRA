/**
 * ความจำของเปลือกหน้าต่าง: แผงไหนเปิดอยู่ และ drawer เปิดหรือปิด —
 * `localStorage["siahra.shell"] = {"v":1,"drawerOpen":bool,"panel":PanelKey}`
 *
 * ไม่อยู่ใน URL โดยตั้งใจ: ลิงก์ที่แชร์คือ "มุมมองของแผนที่" (จังหวัด กล้อง ชั้น
 * เวลา — `lib/permalink.ts`) ไม่ใช่ว่าผู้แชร์เปิดแผงไหนค้างไว้ `permalink.ts`
 * จึงไม่ถูกแตะเลย
 *
 * ตัวอ่าน/เขียนรับ **getter ของ storage** ไม่ใช่ตัว storage — `window.localStorage`
 * เป็น property getter ที่โยน `SecurityError` ได้ตั้งแต่ตอนอ่าน (iframe ที่ปิด
 * storage / นโยบายองค์กร) getter จึงถูกเรียก **ใน** `try` เดียวกับ `.getItem()`
 * ตามแบบเดียวกับ `i18n/initialLang.ts`
 */
export const PANEL_KEYS = ["layers", "flood", "impact", "water", "rain", "forecast", "dams", "quake"] as const;
export type PanelKey = (typeof PANEL_KEYS)[number];

export const SHELL_STORAGE_KEY = "siahra.shell";

export function isPanelKey(value: unknown): value is PanelKey {
  return typeof value === "string" && (PANEL_KEYS as readonly string[]).includes(value);
}

export interface ShellPrefs {
  drawerOpen: boolean;
  panel: PanelKey;
}

/** ส่วนของ `Storage` ที่ใช้จริง — พอให้เทสส่งของปลอมเข้ามาได้โดยไม่ต้องมี DOM */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * แปลงข้อความดิบเป็น prefs — อะไรที่ไม่ใช่รูปร่าง v:1 เป๊ะ (ชนิดผิด คีย์แผงที่
 * ไม่รู้จัก JSON พัง รุ่นอื่น) คืน null ทั้งก้อน ไม่เดาบางส่วน
 */
export function parseShellPrefs(raw: string | null): ShellPrefs | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (typeof o.drawerOpen !== "boolean") return null;
  if (!isPanelKey(o.panel)) return null;
  return { drawerOpen: o.drawerOpen, panel: o.panel };
}

/** null = ไม่เคยจำ / อ่านไม่ได้ / storage ถูกปิด — ผู้เรียกใช้ค่าเริ่มต้นตาม tier */
export function readShellPrefs(getStorage: () => StorageLike): ShellPrefs | null {
  try {
    // getter อยู่ใน try โดยตั้งใจ — ดูหัวไฟล์
    return parseShellPrefs(getStorage().getItem(SHELL_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeShellPrefs(getStorage: () => StorageLike, prefs: ShellPrefs): void {
  try {
    getStorage().setItem(
      SHELL_STORAGE_KEY,
      JSON.stringify({ v: 1, drawerOpen: prefs.drawerOpen, panel: prefs.panel }),
    );
  } catch {
    // เก็บไม่ได้ก็ยังใช้แผงในหน้านี้ได้ตามปกติ
  }
}
