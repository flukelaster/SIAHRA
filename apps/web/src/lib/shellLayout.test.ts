import { describe, expect, it } from "vitest";
import {
  ATTRIBUTION_MAX_H,
  DRAWER_W,
  GUTTER,
  RAIL_W,
  SHEET_FLING_PX_PER_MS,
  SHEET_FULL_VH,
  SHEET_GRIP_H,
  SHEET_HALF_VH,
  SHEET_PEEK_GAPS,
  SHEET_PEEK_H,
  SHEET_SUMMARY_MAX_H,
  TIMELINE_DENSE_H,
  TOOLS_W,
  TOPBAR_H,
  computeSafeArea,
  defaultDrawerOpen,
  nearestSnap,
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
    expect(RAIL_W).toBe(48);
    expect(TOOLS_W).toBe(48);
    expect(DRAWER_W).toEqual({ tablet: 320, laptop: 352, wide: 360 });
    expect(SHEET_PEEK_H).toBe(240);
    expect(SHEET_HALF_VH).toBe(0.55);
    expect(SHEET_FULL_VH).toBe(0.92);
  });

  it("peek สูงพอสำหรับทุกแถวที่ต้องเห็นเสมอ", () => {
    // ถ้าอันนี้แดง แปลว่าบรรทัดเครดิตหลุดขอบล่างของจอ และเครดิตภาพดาวเทียม
    // (Esri ToU / EOX CC BY-NC-SA) ไม่ "มองเห็นได้" อีกต่อไป — เป็นการผิดเงื่อนไข
    // การใช้ข้อมูล ไม่ใช่แค่เรื่องเลย์เอาต์ ห้ามแก้ด้วยการลดค่าความสูงรายแถว
    const worstCase =
      SHEET_GRIP_H + SHEET_SUMMARY_MAX_H + TIMELINE_DENSE_H + ATTRIBUTION_MAX_H + SHEET_PEEK_GAPS;
    expect(SHEET_PEEK_H).toBeGreaterThanOrEqual(worstCase);
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

  it("phone: ซ้าย/ขวา 8 และ bottom = ความสูง peek + 8", () => {
    expect(computeSafeArea({ tier: "phone", drawerOpen: true, dockHeight: 0 })).toEqual({
      left: 8,
      right: 8,
      top: 72,
      bottom: SHEET_PEEK_H + 8,
    });
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

  it("≥ tablet: ซ้าย = 12+48+drawer+12, ขวา = 72, bottom = 12 + dock (drawer ไม่ถูกวัด แต่เป็นค่าคงที่)", () => {
    expect(
      computeSafeArea({ tier: "tablet", drawerOpen: false, dockHeight: 60 }),
    ).toEqual({ left: 72, right: 72, top: 72, bottom: 72 });
    expect(computeSafeArea({ tier: "tablet", drawerOpen: true, dockHeight: 60 }).left).toBe(
      12 + 48 + 320 + 12,
    );
    expect(computeSafeArea({ tier: "laptop", drawerOpen: true, dockHeight: 60 }).left).toBe(
      12 + 48 + 352 + 12,
    );
    expect(computeSafeArea({ tier: "wide", drawerOpen: true, dockHeight: 60 }).left).toBe(
      12 + 48 + 360 + 12,
    );
  });
});

describe("shellLayout — snapHeights", () => {
  it("แปลงสัดส่วนเป็นพิกเซลตามความสูงจอ", () => {
    expect(snapHeights(900)).toEqual({ peek: 240, half: 495, full: 828 });
  });

  it("จอเตี้ยมาก: half/full ไม่มีทางต่ำกว่า peek", () => {
    const h = snapHeights(300);
    expect(h.half).toBeGreaterThanOrEqual(h.peek);
    expect(h.full).toBeGreaterThanOrEqual(h.peek);
  });
});

describe("shellLayout — nearestSnap", () => {
  const heights = snapHeights(900); // peek 240 · half 495 · full 828

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
