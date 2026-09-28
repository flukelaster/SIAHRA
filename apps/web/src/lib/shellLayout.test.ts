import { describe, expect, it } from "vitest";
import {
  ATTRIBUTION_MAX_H,
  DRAWER_W,
  GUTTER,
  PHONE_TABBAR_H,
  RAIL_W,
  SHEET_FLING_PX_PER_MS,
  SHEET_FULL_VH,
  SHEET_GRIP_H,
  SHEET_HALF_VH,
  SHEET_PEEK_GAPS,
  SHEET_PEEK_H,
  SHEET_SUMMARY_MAX_H,
  TIME_CHIP_ROW_H,
  TOOLS_W,
  TOPBAR_H,
  computeSafeArea,
  defaultDrawerOpen,
  nearestSnap,
  PHONE_FLOAT_GAP,
  phoneFloatBottomPx,
  phoneToolsBottom,
  snapHeights,
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
    expect(RAIL_W).toBe(80);
    expect(PHONE_TABBAR_H).toBe(56);
    expect(TOOLS_W).toBe(48);
    expect(DRAWER_W).toEqual({ tablet: 320, laptop: 352, wide: 360 });
    expect(SHEET_PEEK_H).toBe(224);
    expect(SHEET_HALF_VH).toBe(0.55);
    expect(SHEET_FULL_VH).toBe(0.92);
  });

  it("peek สูงพอสำหรับทุกแถวที่ต้องเห็นเสมอ", () => {
    // ถ้าอันนี้แดง แปลว่าบรรทัดเครดิตหลุดขอบล่างของจอ และเครดิตภาพดาวเทียม
    // (Esri ToU / EOX CC BY-NC-SA) ไม่ "มองเห็นได้" อีกต่อไป — เป็นการผิดเงื่อนไข
    // การใช้ข้อมูล ไม่ใช่แค่เรื่องเลย์เอาต์ ห้ามแก้ด้วยการลดค่าความสูงรายแถว
    const worstCase =
      SHEET_GRIP_H + SHEET_SUMMARY_MAX_H + TIME_CHIP_ROW_H + ATTRIBUTION_MAX_H + SHEET_PEEK_GAPS;
    expect(SHEET_PEEK_H).toBeGreaterThanOrEqual(worstCase);
    // แผ่นเลื่อนวางอยู่บนแถบแท็บหัวข้อ — inset ล่างของแผนที่ต้องคลุมทั้งสองชั้น
    // (peek ที่แย่ที่สุด + แถบแท็บ) ไม่งั้นกล้องจัดกรอบจังหวัดไปไว้ใต้บรรทัดเครดิต
    const phone = computeSafeArea({ tier: "phone", drawerOpen: false, dockHeight: 0 });
    expect(phone.bottom).toBeGreaterThanOrEqual(worstCase + PHONE_TABBAR_H);
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
      expect(computeSafeArea({ tier, drawerOpen: false, dockHeight: 0 }).top).toBe(72);
    }
  });

  it("phone: ซ้าย/ขวา 8 และ bottom = เพดาน peek + แถบแท็บหัวข้อ + 8", () => {
    expect(computeSafeArea({ tier: "phone", drawerOpen: true, dockHeight: 0 })).toEqual({
      left: 8,
      right: 8,
      top: 72,
      bottom: SHEET_PEEK_H + PHONE_TABBAR_H + 8,
    });
    expect(computeSafeArea({ tier: "phone", drawerOpen: false, dockHeight: 0 }).bottom).toBe(288);
  });

  it("phone ไม่ขึ้นกับ dockHeight เลย — ลูป sheet → dock → safeArea ถูกตัดแล้ว", () => {
    // ยามของกฎข้อนี้: ถ้ามีใครใส่มิติของแผ่นเลื่อนกลับเข้า SafeAreaInput identity
    // ของ safeArea จะเปลี่ยนทุกเฟรมที่ลาก แล้วไล่ re-render ลงไปถึงต้นไม้ canvas
    const a = computeSafeArea({ tier: "phone", drawerOpen: false, dockHeight: 0 });
    const b = computeSafeArea({ tier: "phone", drawerOpen: true, dockHeight: 400 });
    expect(a).toEqual(b);
  });

  it("จอเล็กสุดที่รองรับ (360×640) ยังเหลือพื้นที่แผนที่เกินพื้น 200px ของ frameTerrain", () => {
    // ต่ำกว่า 200px `frameTerrain` จะ clamp แล้ว `fitProjectedExtent` ทำงานบนกรอบ
    // พิการ → การจัดกรอบจังหวัดเพี้ยน
    const sa = computeSafeArea({ tier: "phone", drawerOpen: false, dockHeight: 0 });
    expect(640 - sa.top - sa.bottom).toBeGreaterThanOrEqual(200);
    expect(360 - sa.left - sa.right).toBeGreaterThanOrEqual(200);
  });

  it("≥ tablet: ซ้าย = 12+80+drawer+12, ขวา = 72, bottom = 12 + dock (drawer ไม่ถูกวัด แต่เป็นค่าคงที่)", () => {
    expect(
      computeSafeArea({ tier: "tablet", drawerOpen: false, dockHeight: 60 }),
    ).toEqual({ left: 104, right: 72, top: 72, bottom: 72 });
    expect(computeSafeArea({ tier: "tablet", drawerOpen: true, dockHeight: 60 }).left).toBe(
      12 + 80 + 320 + 12,
    );
    expect(computeSafeArea({ tier: "laptop", drawerOpen: true, dockHeight: 60 }).left).toBe(
      12 + 80 + 352 + 12,
    );
    expect(computeSafeArea({ tier: "wide", drawerOpen: true, dockHeight: 60 }).left).toBe(
      12 + 80 + 360 + 12,
    );
  });

  it("tablet แคบสุด (768) ที่ drawer เปิด ยังเหลือแผนที่เกินพื้น 200px ของ frameTerrain", () => {
    const sa = computeSafeArea({ tier: "tablet", drawerOpen: true, dockHeight: 60 });
    expect(768 - sa.left - sa.right).toBeGreaterThanOrEqual(200);
  });
});

describe("shellLayout — phoneFloatBottomPx / phoneToolsBottom", () => {
  it("วัดแล้ว: peek ที่วัดได้ + แถบแท็บ + 8 — ห่างขอบบนของแผ่นที่ peek 8 px พอดี", () => {
    const vh = 844;
    const peekPx = 163;
    const sheetTop = vh - PHONE_TABBAR_H - peekPx; // แผ่นวางบนแถบแท็บ สูงเท่า peek ที่วัดได้
    const floatBottomY = vh - phoneFloatBottomPx(peekPx);
    expect(sheetTop - floatBottomY).toBe(PHONE_FLOAT_GAP);
    expect(phoneToolsBottom("peek", peekPx)).toBe(`${peekPx + PHONE_TABBAR_H + 8}px`);
  });

  it("ยังไม่ได้วัด (null หรือ 0): ใช้เพดาน SHEET_PEEK_H — ไม่มีทางต่ำกว่า peek จริง", () => {
    expect(phoneFloatBottomPx(null)).toBe(SHEET_PEEK_H + PHONE_TABBAR_H + 8);
    expect(phoneFloatBottomPx(0)).toBe(phoneFloatBottomPx(null));
    expect(phoneToolsBottom("peek", null)).toBe(`${SHEET_PEEK_H + PHONE_TABBAR_H + 8}px`);
  });

  it("ไม่ขึ้นกับ inset ของกล้อง — computeSafeArea ของมือถือยังเป็นเพดานคงที่", () => {
    const sa = computeSafeArea({ tier: "phone", drawerOpen: false, dockHeight: 0 });
    expect(sa.bottom).toBe(SHEET_PEEK_H + PHONE_TABBAR_H + 8);
    expect(phoneFloatBottomPx(150)).toBeLessThan(sa.bottom);
  });

  it.each([null, 163] as const)("half/full (peek=%s): max(peek, 55dvh + แถบแท็บ + 8) — ปุ่มชั้นข้อมูลไม่ถูกแผ่นบังที่ half", (peekPx) => {
    const css = phoneToolsBottom("half", peekPx);
    expect(css).toBe(
      `max(${phoneFloatBottomPx(peekPx)}px, calc(${SHEET_HALF_VH * 100}dvh + ${PHONE_TABBAR_H + 8}px))`,
    );
    expect(phoneToolsBottom("full", peekPx)).toBe(css);
  });
});

describe("shellLayout — snapHeights", () => {
  it("แปลงสัดส่วนเป็นพิกเซลตามความสูงจอ", () => {
    expect(snapHeights(900)).toEqual({ peek: 224, half: 495, full: 828 });
  });

  it("จอเตี้ยมาก: half/full ไม่มีทางต่ำกว่า peek", () => {
    const h = snapHeights(300);
    expect(h.half).toBeGreaterThanOrEqual(h.peek);
    expect(h.full).toBeGreaterThanOrEqual(h.peek);
  });
});

describe("shellLayout — nearestSnap", () => {
  const heights = snapHeights(900); // peek 224 · half 495 · full 828

  it("ปล่อยช้า = สแนปที่ความสูงใกล้ที่สุด", () => {
    expect(nearestSnap(240, 0, heights, "peek")).toBe("peek");
    expect(nearestSnap(480, 0, heights, "peek")).toBe("half");
    expect(nearestSnap(800, 0, heights, "half")).toBe("full");
    // ทิศทางที่มาไม่มีผลเมื่อไม่ได้สะบัด
    expect(nearestSnap(480, 0, heights, "full")).toBe("half");
  });

  it("สะบัดขยับทีละขั้นตามทิศ ไม่ข้ามระดับ", () => {
    // บวก = นิ้วลง = หด
    expect(nearestSnap(820, 1.2, heights, "full")).toBe("half");
    expect(nearestSnap(500, 1.2, heights, "half")).toBe("peek");
    expect(nearestSnap(220, -1.2, heights, "peek")).toBe("half");
    expect(nearestSnap(500, -1.2, heights, "half")).toBe("full");
  });

  it("สะบัดที่ปลายสุดอยู่กับที่", () => {
    expect(nearestSnap(210, 1.2, heights, "peek")).toBe("peek");
    expect(nearestSnap(826, -1.2, heights, "full")).toBe("full");
  });

  it("ที่ความเร็วเท่าเกณฑ์พอดีนับเป็นสะบัด", () => {
    // ความสูงชี้ไป full แต่การสะบัดลงต้องชนะ
    expect(nearestSnap(820, SHEET_FLING_PX_PER_MS, heights, "full")).toBe("half");
  });
});
