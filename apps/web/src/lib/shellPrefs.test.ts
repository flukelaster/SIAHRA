import { describe, expect, it } from "vitest";
import {
  PANEL_KEYS,
  SHELL_STORAGE_KEY,
  isPanelKey,
  parseShellPrefs,
  readShellPrefs,
  writeShellPrefs,
  type StorageLike,
} from "./shellPrefs";

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { store: Map<string, string> } {
  const store = new Map(Object.entries(initial));
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v);
    },
  };
}

describe("shellPrefs — parseShellPrefs", () => {
  it("รับเฉพาะรูปร่าง v:1 ที่ชนิดถูกและแผงรู้จัก", () => {
    expect(parseShellPrefs('{"v":1,"drawerOpen":true,"panel":"impact"}')).toEqual({
      drawerOpen: true,
      panel: "impact",
    });
    expect(parseShellPrefs('{"v":1,"drawerOpen":false,"panel":"layers"}')).toEqual({
      drawerOpen: false,
      panel: "layers",
    });
  });

  it("ปฏิเสธ null / JSON พัง / รุ่นอื่น / ชนิดผิด / แผงที่ไม่รู้จัก — คืน null ทั้งก้อน", () => {
    expect(parseShellPrefs(null)).toBeNull();
    expect(parseShellPrefs("")).toBeNull();
    expect(parseShellPrefs("{not json")).toBeNull();
    expect(parseShellPrefs("null")).toBeNull();
    expect(parseShellPrefs('"layers"')).toBeNull();
    expect(parseShellPrefs('{"v":2,"drawerOpen":true,"panel":"layers"}')).toBeNull();
    expect(parseShellPrefs('{"drawerOpen":true,"panel":"layers"}')).toBeNull();
    expect(parseShellPrefs('{"v":1,"drawerOpen":"true","panel":"layers"}')).toBeNull();
    expect(parseShellPrefs('{"v":1,"drawerOpen":true,"panel":"province"}')).toBeNull();
    expect(parseShellPrefs('{"v":1,"drawerOpen":true}')).toBeNull();
  });

  it("isPanelKey รู้จักทั้งแปดแผงและไม่รับอย่างอื่น", () => {
    for (const k of PANEL_KEYS) expect(isPanelKey(k)).toBe(true);
    expect(isPanelKey("province")).toBe(false);
    expect(isPanelKey(1)).toBe(false);
    expect(isPanelKey(undefined)).toBe(false);
  });
});

describe("shellPrefs — read/write ผ่าน getter ของ storage", () => {
  it("อ่านค่าที่เขียนไว้กลับมาได้ครบ", () => {
    const s = memoryStorage();
    writeShellPrefs(() => s, { drawerOpen: true, panel: "water" });
    expect(JSON.parse(s.store.get(SHELL_STORAGE_KEY) ?? "null")).toEqual({
      v: 1,
      drawerOpen: true,
      panel: "water",
    });
    expect(readShellPrefs(() => s)).toEqual({ drawerOpen: true, panel: "water" });
  });

  it("ไม่เคยเขียน → null", () => {
    expect(readShellPrefs(() => memoryStorage())).toBeNull();
  });

  it("getter ของ storage เอง throw (SecurityError) → อ่านได้ null และเขียนไม่ throw", () => {
    const throwing = (): StorageLike => {
      throw new Error("storage ถูกปิดโดยนโยบาย");
    };
    expect(readShellPrefs(throwing)).toBeNull();
    expect(() => writeShellPrefs(throwing, { drawerOpen: false, panel: "layers" })).not.toThrow();
  });

  it("getItem/setItem เอง throw ก็ยังไม่ล้ม", () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("quota");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(readShellPrefs(() => broken)).toBeNull();
    expect(() => writeShellPrefs(() => broken, { drawerOpen: true, panel: "quake" })).not.toThrow();
  });
});
