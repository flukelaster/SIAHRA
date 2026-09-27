import { describe, expect, it } from "vitest";
import type { CommunityReport, CommunityReportsResponse } from "@siahra/shared-types";
import {
  COMMUNITY_DISPUTED_FACTOR,
  COMMUNITY_FLOOR_AGE_MS,
  COMMUNITY_FULL_ALPHA_MS,
  COMMUNITY_MIN_ALPHA,
  EMPTY_OVERLAY,
  applyOverlay,
  communityMarkerAlpha,
  communityWindow,
  primaryCategory,
  pruneOverlay,
  reportsInWindow,
  type CommunityOverlay,
} from "./communityReports";

const H = 3_600_000;
const NOW = Date.parse("2026-09-27T12:00:00Z");

function report(id: string, createdMs: number, over: Partial<CommunityReport> = {}): CommunityReport {
  return {
    id,
    lat: 13.75,
    lon: 100.5,
    provinceCode: "10",
    categories: ["flood"],
    description: "",
    imageUrl: null,
    createdAt: new Date(createdMs).toISOString(),
    up: 0,
    down: 0,
    ...over,
  };
}

describe("communityWindow / reportsInWindow — เจ้าของตัดสินใจ: createdAt ∈ [เวลาที่ดู − ช่วง, เวลาที่ดู]", () => {
  const reports = [
    report("future", NOW + 1),
    report("now", NOW),
    report("h1", NOW - H),
    report("edge48", NOW - 48 * H),
    report("h49", NOW - 49 * H),
    report("d8", NOW - 8 * 24 * H),
  ];

  it("ดูสด (atIso null) = หน้าต่างจบที่ตอนนี้ ขอบทั้งสองรวม", () => {
    const win = communityWindow(null, 48, NOW);
    expect(win).toEqual({ startMs: NOW - 48 * H, endMs: NOW });
    expect(reportsInWindow(reports, win).map((r) => r.id)).toEqual(["now", "h1", "edge48"]);
  });

  it("ย้อนหลัง = หน้าต่างจบที่ atIso — รายงานที่ส่งหลังเวลานั้นไม่ปรากฏ", () => {
    const at = new Date(NOW - 2 * H).toISOString();
    const win = communityWindow(at, 48, NOW);
    expect(win.endMs).toBe(NOW - 2 * H);
    expect(reportsInWindow(reports, win).map((r) => r.id)).toEqual(["edge48", "h49"]);
  });

  it("ช่วงใหญ่ขึ้น (7 วัน / 30 วัน) = เห็นรายงานเก่าขึ้น", () => {
    expect(reportsInWindow(reports, communityWindow(null, 7 * 24, NOW)).map((r) => r.id)).toEqual([
      "now",
      "h1",
      "edge48",
      "h49",
    ]);
    expect(reportsInWindow(reports, communityWindow(null, 30 * 24, NOW))).toHaveLength(5);
  });

  it("createdAt ที่อ่านไม่ได้ไม่ถูกแสดง (ไม่เดาเวลา); atIso ที่อ่านไม่ได้ = ตอนนี้", () => {
    expect(reportsInWindow([{ ...report("bad", NOW), createdAt: "nope" }], communityWindow(null, 48, NOW))).toEqual([]);
    expect(communityWindow("nope", 48, NOW).endMs).toBe(NOW);
  });
});

describe("communityMarkerAlpha — ความจางตามอายุและโหวตค้าน", () => {
  it("อายุ < 6 ชม. = ทึบเต็ม; 7 วันขึ้นไป = พื้น; ระหว่างนั้นลดลงเป็นเส้นตรง", () => {
    expect(communityMarkerAlpha(report("a", NOW), NOW)).toBe(1);
    expect(communityMarkerAlpha(report("a", NOW - COMMUNITY_FULL_ALPHA_MS), NOW)).toBe(1);
    expect(communityMarkerAlpha(report("a", NOW - COMMUNITY_FLOOR_AGE_MS), NOW)).toBe(COMMUNITY_MIN_ALPHA);
    expect(communityMarkerAlpha(report("a", NOW - 20 * COMMUNITY_FLOOR_AGE_MS), NOW)).toBe(COMMUNITY_MIN_ALPHA);
    const mid = (COMMUNITY_FULL_ALPHA_MS + COMMUNITY_FLOOR_AGE_MS) / 2;
    expect(communityMarkerAlpha(report("a", NOW - mid), NOW)).toBeCloseTo((1 + COMMUNITY_MIN_ALPHA) / 2, 6);
  });

  it("ไม่เคยหายไป — ทุกอายุ/คะแนน ความทึบ > 0", () => {
    const worst = communityMarkerAlpha(report("a", NOW - 29 * 24 * H, { up: 0, down: 4 }), NOW);
    expect(worst).toBeCloseTo(COMMUNITY_MIN_ALPHA * COMMUNITY_DISPUTED_FACTOR, 6);
    expect(worst).toBeGreaterThan(0);
  });

  it("down > up = จางลงอีก; down = up ไม่จาง", () => {
    expect(communityMarkerAlpha(report("a", NOW, { up: 1, down: 2 }), NOW)).toBe(COMMUNITY_DISPUTED_FACTOR);
    expect(communityMarkerAlpha(report("a", NOW, { up: 2, down: 2 }), NOW)).toBe(1);
  });

  it("เวลาในเครื่องช้ากว่า server (อายุติดลบ) = ทึบเต็ม; ย้อนหลังคิดอายุจากเวลาที่ดู", () => {
    expect(communityMarkerAlpha(report("a", NOW + H), NOW)).toBe(1);
    expect(communityMarkerAlpha(report("a", NOW - 7 * 24 * H), NOW - 7 * 24 * H + H)).toBe(1);
  });

  it("หมวดหลัก = หมวดแรก", () => {
    expect(primaryCategory({ categories: ["power-out", "flood"] })).toBe("power-out");
  });
});

describe("overlay ในเครื่อง — การกระทำของผู้ใช้ทับรายการที่แคชไว้จนกว่า server จะเห็น", () => {
  const base: CommunityReportsResponse = {
    fetchedAt: new Date(NOW).toISOString(),
    reports: [report("r1", NOW - H, { up: 1, down: 0 }), report("r2", NOW - 2 * H)],
    hiddenCount: 2,
    layer: {
      id: "community-reports",
      epistemicClass: "crowdsourced",
      liveOrStatic: "live",
      publishedAt: null,
      fetchedAt: new Date(NOW).toISOString(),
      sourceIds: ["community-report"],
    },
  };
  const ov = (o: Partial<CommunityOverlay>): CommunityOverlay => ({ ...EMPTY_OVERLAY, ...o });

  it("overlay ว่าง = คำตอบเดิม (อ็อบเจ็กต์เดิม)", () => {
    expect(applyOverlay(base, EMPTY_OVERLAY)).toBe(base);
  });

  it("ตัวนับโหวตจาก server ทับค่าในรายการ; ถูกซ่อน = ออกจากรายการและนับใน hiddenCount (ไม่หายเงียบ)", () => {
    const up = applyOverlay(base, ov({ votes: new Map([["r1", { up: 2, down: 0, hidden: false, atMs: NOW + 1 }]]) }));
    expect(up.reports.find((r) => r.id === "r1")?.up).toBe(2);
    const hidden = applyOverlay(base, ov({ votes: new Map([["r2", { up: 0, down: 5, hidden: true, atMs: NOW + 1 }]]) }));
    expect(hidden.reports.map((r) => r.id)).toEqual(["r1"]);
    expect(hidden.hiddenCount).toBe(3);
  });

  it("ลบเอง = ออกจากรายการ; ใส่เอง = อยู่หน้าสุดจนกว่า server จะส่งมาเอง", () => {
    expect(applyOverlay(base, ov({ removals: new Map([["r1", NOW + 1]]) })).reports.map((r) => r.id)).toEqual(["r2"]);
    const mine = report("mine", NOW + 5);
    const withMine = applyOverlay(base, ov({ upserts: new Map([["mine", { report: mine, atMs: NOW + 5 }]]) }));
    expect(withMine.reports.map((r) => r.id)).toEqual(["mine", "r1", "r2"]);
  });

  it("คำตอบที่ DO อ่านหลังการแก้ในเครื่อง = ทิ้ง overlay นั้น; คำตอบที่อ่านก่อน (แคชขอบ) = เก็บไว้", () => {
    const o = ov({
      votes: new Map([["r1", { up: 2, down: 0, hidden: false, atMs: NOW + 1000 }]]),
      removals: new Map([["r2", NOW - 1000]]),
    });
    const pruned = pruneOverlay(o, new Date(NOW).toISOString());
    expect([...pruned.votes.keys()]).toEqual(["r1"]);
    expect(pruned.removals.size).toBe(0);
    expect(pruneOverlay(pruned, new Date(NOW).toISOString())).toBe(pruned);
    expect(pruneOverlay(o, "not-a-time")).toBe(o);
  });
});
