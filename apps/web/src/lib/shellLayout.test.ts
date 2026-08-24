import { describe, expect, it } from "vitest";
import {
  DRAWER_W,
  GUTTER,
  RAIL_W,
  SHEET_COLLAPSED_H,
  TOOLS_W,
  TOPBAR_H,
  computeSafeArea,
  defaultDrawerOpen,
  tierFor,
} from "./shellLayout";

describe("shellLayout — tierFor", () => {
  it("phone < 768 ≤ tablet < 1024 ≤ laptop < 1280 ≤ wide (ขอบรวมฝั่งบน)", () => {
    expect(tierFor(390)).toBe("phone");
    expect(tierFor(767)).toBe("phone");
    expect(tierFor(768)).toBe("tablet");
    expect(tierFor(1023)).toBe("tablet");
    expect(tierFor(1024)).toBe("laptop");
    expect(tierFor(1279)).toBe("laptop");
    expect(tierFor(1280)).toBe("wide");
    expect(tierFor(1440)).toBe("wide");
  });
});

describe("shellLayout — ค่าคงที่ตามสเปก", () => {
  it("ตัวเลขทุกตัวตรงกับที่ตกลงไว้", () => {
    expect(GUTTER).toBe(12);
    expect(TOPBAR_H).toBe(48);
    expect(RAIL_W).toBe(48);
    expect(TOOLS_W).toBe(48);
    expect(DRAWER_W).toEqual({ tablet: 320, laptop: 352, wide: 360 });
    expect(SHEET_COLLAPSED_H).toBe(44);
  });

  it("drawer เปิดเป็นค่าเริ่มต้นเฉพาะ wide", () => {
    expect(defaultDrawerOpen("wide")).toBe(true);
    expect(defaultDrawerOpen("laptop")).toBe(false);
    expect(defaultDrawerOpen("tablet")).toBe(false);
    expect(defaultDrawerOpen("phone")).toBe(false);
  });
});

describe("shellLayout — computeSafeArea", () => {
  it("top = 72 ทุก tier", () => {
    for (const tier of ["phone", "tablet", "laptop", "wide"] as const) {
      expect(
        computeSafeArea({ tier, drawerOpen: false, dockHeight: 0, sheetOpen: false, sheetHeight: 300 }).top,
      ).toBe(72);
    }
  });

  it("phone: ซ้าย/ขวา 8 และ bottom = แผ่นเลื่อน (44 ตอนย่อ) + 8 + dock", () => {
    expect(
      computeSafeArea({ tier: "phone", drawerOpen: true, dockHeight: 150, sheetOpen: false, sheetHeight: 380 }),
    ).toEqual({ left: 8, right: 8, top: 72, bottom: 44 + 8 + 150 });
    expect(
      computeSafeArea({ tier: "phone", drawerOpen: false, dockHeight: 150, sheetOpen: true, sheetHeight: 380 }),
    ).toEqual({ left: 8, right: 8, top: 72, bottom: 380 + 8 + 150 });
  });

  it("≥ tablet: ซ้าย = 12+48+drawer+12, ขวา = 72, bottom = 12 + dock (drawer ไม่ถูกวัด แต่เป็นค่าคงที่)", () => {
    expect(
      computeSafeArea({ tier: "tablet", drawerOpen: false, dockHeight: 60, sheetOpen: true, sheetHeight: 999 }),
    ).toEqual({ left: 72, right: 72, top: 72, bottom: 72 });
    expect(
      computeSafeArea({ tier: "tablet", drawerOpen: true, dockHeight: 60, sheetOpen: false, sheetHeight: 0 }).left,
    ).toBe(12 + 48 + 320 + 12);
    expect(
      computeSafeArea({ tier: "laptop", drawerOpen: true, dockHeight: 60, sheetOpen: false, sheetHeight: 0 }).left,
    ).toBe(12 + 48 + 352 + 12);
    expect(
      computeSafeArea({ tier: "wide", drawerOpen: true, dockHeight: 60, sheetOpen: false, sheetHeight: 0 }).left,
    ).toBe(12 + 48 + 360 + 12);
  });

  it("≥ tablet ไม่สนใจสถานะแผ่นเลื่อนของมือถือ", () => {
    const a = computeSafeArea({ tier: "wide", drawerOpen: true, dockHeight: 40, sheetOpen: false, sheetHeight: 0 });
    const b = computeSafeArea({ tier: "wide", drawerOpen: true, dockHeight: 40, sheetOpen: true, sheetHeight: 500 });
    expect(a).toEqual(b);
  });
});
