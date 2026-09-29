import { describe, expect, it } from "vitest";
import type { BasinDam, BasinStation, BasinsResponse } from "@siahra/shared-types";
import {
  BASIN_DAMS_STALE_MS,
  BASIN_FREEBOARD_NEAR_M,
  BASIN_MAX_READING_AGE_MS,
  BASIN_SITUATION_MIN,
  BASIN_EDGE_MAX_AGE_MS,
  basinAgeMs,
  basinStaleLimitMs,
  bucketFor,
  classifyBasinReading,
  damsFreshness,
  evaluateStation,
  filterBasins,
  isBasinsStale,
  knownProvinceCode,
  pickerRows,
  provinceRows,
  rankStations,
  readingFreshness,
  sameSelection,
  sortDams,
  summarizeStations,
} from "./basinView";
import { BASINS_INTERVAL_MS } from "./pollSchedule";
import { FREEBOARD_NEAR_M } from "./northRoute";
import { classifyWater, OVERVIEW_MAX_READING_AGE_MS, OVERVIEW_SITUATION_MIN } from "./overviewSummary";
import { classifyReading } from "./provinceSeverity";
import { SHEET_MAX_READING_AGE_MS } from "./stationSheetField";

const H = 3_600_000;
const NOW = Date.parse("2026-09-29T06:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

function st(id: number, over: Partial<BasinStation> = {}): BasinStation {
  return {
    id,
    nameTh: `สถานี ${id}`,
    provinceCode: "50",
    lat: 15,
    lon: 100,
    waterlevelMsl: 10,
    freeboardM: 3,
    situationLevel: 3,
    dischargeM3s: null,
    qmaxM3s: null,
    observedAt: iso(NOW - H),
    ...over,
  };
}

describe("ค่าคงที่และ classifyBasinReading = สำเนาที่เทสยืนยันว่าเท่ากับต้นฉบับ", () => {
  it("ค่าคงที่เท่ากับของภาพรวม / แผ่นน้ำ / แผงน้ำเหนือ", () => {
    expect(BASIN_MAX_READING_AGE_MS).toBe(OVERVIEW_MAX_READING_AGE_MS);
    expect(BASIN_MAX_READING_AGE_MS).toBe(SHEET_MAX_READING_AGE_MS);
    expect(BASIN_SITUATION_MIN).toBe(OVERVIEW_SITUATION_MIN);
    expect(BASIN_FREEBOARD_NEAR_M).toBe(FREEBOARD_NEAR_M);
  });

  it("ค่าเก่าของเขื่อนตรงกับ staleAfterSeconds ของ descriptor thaiwater-dams (3 ชม. = 10800 วิ)", () => {
    expect(BASIN_DAMS_STALE_MS).toBe(10_800 * 1000);
  });

  it("ให้ผลเท่ากับ classifyWater และ classifyReading ทุกกรณีของ situationLevel × freeboard", () => {
    const levels = [null, 1, 2, 3, 4, 5] as const;
    const fbs = [null, -1, 0, 0.01, FREEBOARD_NEAR_M, FREEBOARD_NEAR_M + 0.01, 3, Number.NaN];
    for (const situationLevel of levels) {
      for (const freeboardM of fbs) {
        const mine = classifyBasinReading({ situationLevel, freeboardM });
        expect(mine).toEqual(classifyWater({ situationLevel, freeboardM } as never));
        expect(mine).toEqual(classifyReading({ situationLevel, freeboardM }));
      }
    }
  });
});

describe("readingFreshness / evaluateStation", () => {
  it("ขอบ 6 ชม. พอดียังนับ; เกินหนึ่ง ms = ค้าง; ไม่มีเวลา/อ่านไม่ออก = ไม่มีเวลา", () => {
    expect(readingFreshness(iso(NOW - BASIN_MAX_READING_AGE_MS), NOW)).toBe("current");
    expect(readingFreshness(iso(NOW - BASIN_MAX_READING_AGE_MS - 1), NOW)).toBe("stale");
    expect(readingFreshness(null, NOW)).toBe("undated");
    expect(readingFreshness("not a date", NOW)).toBe("undated");
  });

  it("ค่าค้างและไม่มีเวลาไม่ถูกจัดระดับ แม้ระดับของ ThaiWater จะเป็น 5", () => {
    expect(evaluateStation(st(1, { situationLevel: 5, observedAt: iso(NOW - 7 * H) }), NOW).status).toBe("stale");
    expect(evaluateStation(st(1, { situationLevel: 5, observedAt: null }), NOW).status).toBe("undated");
    expect(evaluateStation(st(1, { situationLevel: 5 }), NOW)).toMatchObject({ status: "severe", rule: "situation" });
  });

  it("ไม่มีระดับของ ThaiWater → กฎตลิ่ง; ไม่มีทั้งสอง = จัดระดับไม่ได้ (ไม่ใช่ none)", () => {
    expect(evaluateStation(st(1, { situationLevel: null, freeboardM: 0 }), NOW)).toMatchObject({ status: "severe", rule: "bank" });
    expect(evaluateStation(st(1, { situationLevel: null, freeboardM: 0.5 }), NOW)).toMatchObject({ status: "high", rule: "bank" });
    expect(evaluateStation(st(1, { situationLevel: null, freeboardM: 5 }), NOW)).toMatchObject({ status: "none", rule: "bank" });
    expect(evaluateStation(st(1, { situationLevel: null, freeboardM: null }), NOW)).toMatchObject({ status: "unclassified", rule: null });
  });
});

describe("summarizeStations", () => {
  it("นับตามเกณฑ์ที่ประกาศ และนับค่าค้าง/ไม่มีเวลา/จัดไม่ได้แยก", () => {
    const s = summarizeStations(
      [
        st(1, { situationLevel: 5 }),
        st(2, { situationLevel: 4 }),
        st(3, { situationLevel: null, freeboardM: -0.2 }),
        st(4, { situationLevel: null, freeboardM: 0.4 }),
        st(5, { situationLevel: 2 }),
        st(6, { situationLevel: null, freeboardM: null }),
        st(7, { observedAt: iso(NOW - 9 * H) }),
        st(8, { observedAt: null }),
      ],
      NOW,
    );
    expect(s).toMatchObject({
      stationCount: 8,
      counted: 5,
      level5: 1,
      level4: 1,
      atBank: 1,
      nearBank: 1,
      belowThreshold: 1,
      unclassified: 1,
      stale: 1,
      undated: 1,
      tone: "severe",
    });
    expect(s.latestObservedAt).toBe(iso(NOW - H));
  });

  it("ไม่มีสถานีเกินเกณฑ์ = none (เทากลาง ไม่ใช่ปลอดภัย); ไม่มีค่าปัจจุบันที่จัดได้เลย = no-data ไม่ใช่ none", () => {
    expect(summarizeStations([st(1), st(2)], NOW).tone).toBe("none");
    expect(summarizeStations([st(1, { observedAt: iso(NOW - 10 * H) }), st(2, { observedAt: null })], NOW).tone).toBe("no-data");
    expect(summarizeStations([st(1, { situationLevel: null, freeboardM: null })], NOW).tone).toBe("no-data");
    expect(summarizeStations([], NOW).tone).toBe("no-data");
  });

  it("ค่าที่ค้างไม่ทำให้กลุ่มดูรุนแรงขึ้นหรือปลอดภัยขึ้น: ค้าง severe + ปัจจุบัน none = none", () => {
    expect(summarizeStations([st(1, { situationLevel: 5, observedAt: iso(NOW - 8 * H) }), st(2)], NOW).tone).toBe("none");
  });
});

describe("rankStations / provinceRows", () => {
  it("แย่สุดก่อน: severe → high → none → จัดไม่ได้ → ค้าง → ไม่มีเวลา; เสมอกันตามระยะถึงตลิ่งแล้ว id", () => {
    const ranked = rankStations(
      [
        st(9, { observedAt: null }),
        st(8, { observedAt: iso(NOW - 8 * H) }),
        st(7, { situationLevel: null, freeboardM: null }),
        st(6),
        st(5, { situationLevel: 4, freeboardM: 2 }),
        st(4, { situationLevel: 4, freeboardM: 0.5 }),
        st(3, { situationLevel: 5 }),
      ],
      NOW,
    );
    expect(ranked.map((r) => r.station.id)).toEqual([3, 4, 5, 6, 7, 8, 9]);
  });

  it("จังหวัดเรียงแย่สุดก่อน แต่ละจังหวัดใช้สถานีที่แย่สุดเป็นตัวเปิดบนแผนที่", () => {
    const rows = provinceRows(
      [
        st(1, { provinceCode: "50", situationLevel: 3 }),
        st(2, { provinceCode: "60", situationLevel: 4 }),
        st(3, { provinceCode: "17", situationLevel: 5 }),
        st(4, { provinceCode: "17", situationLevel: 4 }),
      ],
      NOW,
    );
    expect(rows.map((r) => [r.provinceCode, r.tone, r.worst?.station.id ?? null, r.focus.id])).toEqual([
      ["17", "severe", 3, 3],
      ["60", "high", 2, 2],
      ["50", "none", null, 1],
    ]);
  });

  it("จังหวัดที่ไม่มีค่าปัจจุบันเลย = no-data (ท้ายสุด ไม่ใช่เขียว); จำนวนที่ไม่นับแสดงแยก", () => {
    const rows = provinceRows(
      [
        st(1, { provinceCode: "50", observedAt: iso(NOW - 10 * H) }),
        st(2, { provinceCode: "50", observedAt: null }),
        st(3, { provinceCode: "60" }),
      ],
      NOW,
    );
    expect(rows.map((r) => [r.provinceCode, r.tone])).toEqual([
      ["60", "none"],
      ["50", "no-data"],
    ]);
    const p50 = rows[1]!;
    expect(p50.summary).toMatchObject({ stale: 1, undated: 1, counted: 0, stationCount: 2 });
    // แถวยังเปิดสถานีได้ (id น้อยสุด) แม้ไม่มีค่าปัจจุบัน
    expect(p50.focus.id).toBe(1);
  });

  it("สถานีที่ไม่มีจังหวัดถูกรวมเป็นแถว null ท้ายสุดของระดับเดียวกัน — ไม่ถูกทิ้ง", () => {
    const rows = provinceRows([st(1, { provinceCode: null }), st(2, { provinceCode: "50" })], NOW);
    expect(rows.map((r) => r.provinceCode)).toEqual(["50", null]);
    expect(rows[1]!.summary.stationCount).toBe(1);
  });

  it("รหัส 10499 (สถานีนอกประเทศของ ThaiWater) ไม่ใช่จังหวัด: รวมเป็นแถว null ไม่ใช่จังหวัดปลอม และเปิดบนแผนที่ไม่ได้", () => {
    expect(knownProvinceCode("10499")).toBeNull();
    expect(knownProvinceCode("50")).toBe("50");
    expect(knownProvinceCode(null)).toBeNull();
    const rows = provinceRows([st(1, { provinceCode: "10499" }), st(2, { provinceCode: null }), st(3, { provinceCode: "50" })], NOW);
    // แถว null รวมสองสถานี (10499 + null) จึงนับได้มากกว่าจึงขึ้นก่อน "50" ที่ tone เท่ากัน
    expect(rows.map((r) => r.provinceCode)).toEqual([null, "50"]);
    expect(rows[0]!.summary.stationCount).toBe(2);
  });

  it("ลำดับไม่ขึ้นกับลำดับอินพุต", () => {
    const list = [st(1, { provinceCode: "50" }), st(2, { provinceCode: "60", situationLevel: 4 }), st(3, { provinceCode: "17" }), st(4, { provinceCode: null })];
    expect(provinceRows(list, NOW).map((r) => r.provinceCode)).toEqual(provinceRows([...list].reverse(), NOW).map((r) => r.provinceCode));
  });
});

function dam(id: number, over: Partial<BasinDam> = {}): BasinDam {
  return { id, nameTh: `เขื่อน ${id}`, nameEn: null, kind: "large", provinceCode: "50", storagePercent: 50, storageMcm: 100, observedAt: iso(NOW - H), ...over };
}

describe("ความค้างของชุดที่ถืออยู่ (ท่อที่ปกติดีต้องไม่ถูกหาว่าเก่า)", () => {
  const STALE_AFTER = 900;
  const at = (ageMs: number) => iso(NOW - ageMs);

  it("เกณฑ์ = staleAfterSeconds + แคชขอบ 300 วิ + รอบถามของเว็บ 10 นาที (30 นาที)", () => {
    expect(BASIN_EDGE_MAX_AGE_MS).toBe(300_000);
    expect(basinStaleLimitMs(STALE_AFTER)).toBe(STALE_AFTER * 1000 + 300_000 + BASINS_INTERVAL_MS);
    expect(basinStaleLimitMs(STALE_AFTER)).toBe(30 * 60_000);
  });

  it("อายุ 14 นาที 59 วิ (ระหว่างรอบถาม 10 นาที) ไม่ค้าง; ขอบพอดียังไม่ค้าง; เกินเกณฑ์รวม = ค้าง", () => {
    expect(isBasinsStale(at(14 * 60_000 + 59_000), STALE_AFTER, NOW)).toBe(false);
    expect(isBasinsStale(at(20 * 60_000), STALE_AFTER, NOW)).toBe(false);
    expect(isBasinsStale(at(basinStaleLimitMs(STALE_AFTER)), STALE_AFTER, NOW)).toBe(false);
    expect(isBasinsStale(at(basinStaleLimitMs(STALE_AFTER) + 1), STALE_AFTER, NOW)).toBe(true);
  });

  it("fetchedAt null / อ่านไม่ได้ = ไม่รู้อายุ (ไม่ใช่ตอนนี้ และไม่ตัดสินว่าค้าง)", () => {
    expect(basinAgeMs(null, NOW)).toBeNull();
    expect(basinAgeMs("garbage", NOW)).toBeNull();
    expect(isBasinsStale(null, STALE_AFTER, NOW)).toBe(false);
  });
});

describe("เขื่อน", () => {
  it("damsFreshness: null = never (ไม่ใช่ไม่มีเขื่อน), เก่ากว่า 3 ชม. = stale, ขอบพอดี = ok", () => {
    expect(damsFreshness(null, NOW)).toBe("never");
    expect(damsFreshness("garbage", NOW)).toBe("never");
    expect(damsFreshness(iso(NOW - BASIN_DAMS_STALE_MS), NOW)).toBe("ok");
    expect(damsFreshness(iso(NOW - BASIN_DAMS_STALE_MS - 1), NOW)).toBe("stale");
  });

  it("sortDams: เขื่อนใหญ่ก่อน แล้วความจุมากก่อน (ไม่มีค่าท้าย) แล้ว id", () => {
    const sorted = sortDams([
      dam(1, { kind: "medium", storagePercent: 99 }),
      dam(2, { storagePercent: null }),
      dam(3, { storagePercent: 80 }),
      dam(4, { storagePercent: 80 }),
    ]);
    expect(sorted.map((d) => d.id)).toEqual([3, 4, 2, 1]);
  });
});

function response(over: Partial<BasinsResponse> = {}): BasinsResponse {
  return {
    layer: { id: "thaiwater-basins", epistemicClass: "observed", liveOrStatic: "live", publishedAt: null, fetchedAt: iso(NOW), sourceIds: ["thaiwater"] },
    fetchedAt: iso(NOW),
    damsFetchedAt: null,
    basins: [
      { key: "ปิง", nameTh: "ลุ่มน้ำปิง", stations: [st(1), st(2)], dams: [] },
      { key: "ยม", nameTh: "ลุ่มน้ำยม", stations: [st(3, { situationLevel: 5 })], dams: [dam(1)] },
      { key: "ชี", nameTh: "ลุ่มน้ำชี", stations: [st(4, { observedAt: null })], dams: [] },
    ],
    outsideThailand: { stations: [st(5)], dams: [] },
    unassigned: { stations: [], dams: [] },
    ...over,
  };
}

describe("ตัวเลือกลุ่มน้ำ", () => {
  it("เรียงแย่สุดก่อน แล้วสถานีมากก่อน; นอกประเทศไทยแยกเป็น 'others' ไม่ใช่ลุ่มน้ำ; กลุ่มว่างไม่โผล่", () => {
    const { basins, others } = pickerRows(response(), "", NOW);
    expect(basins.map((r) => (r.selection.kind === "basin" ? r.selection.key : "?"))).toEqual(["ยม", "ปิง", "ชี"]);
    expect(basins.map((r) => r.tone)).toEqual(["severe", "none", "no-data"]);
    expect(others.map((r) => r.selection.kind)).toEqual(["outside"]);
    expect(others[0]).toMatchObject({ stationCount: 1, nameTh: null });
  });

  it("ตัวกรองข้อความตัดเฉพาะลุ่มน้ำ ส่วน outside/unassigned ยังเห็นเสมอ", () => {
    const r = response({ unassigned: { stations: [st(6)], dams: [] } });
    const { basins, others } = pickerRows(r, "ปิ", NOW);
    expect(basins).toHaveLength(1);
    expect(others.map((o) => o.selection.kind)).toEqual(["outside", "unassigned"]);
    expect(filterBasins(r.basins, "  ")).toHaveLength(3);
    expect(filterBasins(r.basins, "ไม่มีชื่อนี้")).toEqual([]);
  });

  it("bucketFor / sameSelection", () => {
    const r = response();
    expect(bucketFor(r, { kind: "basin", key: "ยม" })?.nameTh).toBe("ลุ่มน้ำยม");
    expect(bucketFor(r, { kind: "basin", key: "ไม่มี" })).toBeNull();
    expect(bucketFor(r, { kind: "outside" })?.bucket.stations).toHaveLength(1);
    expect(sameSelection({ kind: "basin", key: "ยม" }, { kind: "basin", key: "ยม" })).toBe(true);
    expect(sameSelection({ kind: "basin", key: "ยม" }, { kind: "basin", key: "ปิง" })).toBe(false);
    expect(sameSelection({ kind: "outside" }, { kind: "unassigned" })).toBe(false);
    expect(sameSelection(null, null)).toBe(true);
    expect(sameSelection(null, { kind: "outside" })).toBe(false);
  });
});
