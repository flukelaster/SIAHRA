import { describe, expect, it } from "vitest";
import type { NorthRouteHistoryPoint } from "@siahra/shared-types";
import { FREEBOARD_NEAR_M, type NodeReading } from "./northRoute";
import { classifyWater, OVERVIEW_SITUATION_MIN } from "./overviewSummary";
import { classifyReading, provinceSeverities, SEVERITY_SITUATION_MIN } from "./provinceSeverity";

describe("classifyReading = สำเนาของ classifyWater (overviewSummary)", () => {
  it("ค่าคงที่เท่ากัน", () => {
    expect(SEVERITY_SITUATION_MIN).toBe(OVERVIEW_SITUATION_MIN);
  });
  it("ให้ผลเท่ากันทุกกรณีของ situationLevel × freeboard", () => {
    const levels = [null, 1, 2, 3, 4, 5] as const;
    const fbs = [null, -1, 0, 0.01, FREEBOARD_NEAR_M, FREEBOARD_NEAR_M + 0.01, 3, Number.NaN];
    for (const situationLevel of levels) {
      for (const freeboardM of fbs) {
        expect(classifyReading({ situationLevel, freeboardM })).toEqual(classifyWater({ situationLevel, freeboardM } as never));
      }
    }
  });
});

const H = 3_600_000;
const END = Date.parse("2026-09-26T06:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

function reading(over: Partial<NodeReading> = {}): NodeReading {
  return {
    level: 10,
    levelDatum: "msl",
    dischargeM3s: 100,
    qmaxPct: 50,
    freeboardM: 3,
    criticalMarginM: null,
    situationLevel: 3,
    observedAt: iso(END - H),
    trendMPerH: null,
    missing: false,
    stale: false,
    ...over,
  };
}
const MISSING = reading({ missing: true, level: null, dischargeM3s: null, qmaxPct: null, freeboardM: null, situationLevel: null, observedAt: null });
const noHist = new Map<string, readonly NorthRouteHistoryPoint[]>();
const map = (o: Record<string, NodeReading>) => new Map(Object.entries(o));
const st = (ridCode: string, provinceCode: string | null) => ({ ridCode, provinceCode });

describe("provinceSeverities", () => {
  it("ThaiWater ระดับ 5 → severe, 4 → high, 3 → none; จังหวัดเรียงตามความรุนแรง", () => {
    const rows = provinceSeverities(
      [st("A", "50"), st("B", "60"), st("C", "17")],
      map({ A: reading({ situationLevel: 3 }), B: reading({ situationLevel: 4 }), C: reading({ situationLevel: 5 }) }),
      noHist,
      END,
    );
    expect(rows.map((r) => [r.provinceCode, r.tone, r.worstCode, r.worstRule])).toEqual([
      ["17", "severe", "C", "situation"],
      ["60", "high", "B", "situation"],
      ["50", "none", null, null],
    ]);
  });

  it("ไม่มีระดับ ThaiWater → กฎตลิ่ง: ≤ 0 severe, ≤ FREEBOARD_NEAR_M high, มากกว่านั้น none", () => {
    const at = (fb: number) => reading({ situationLevel: null, freeboardM: fb });
    const rows = provinceSeverities(
      [st("A", "1"), st("B", "2"), st("C", "3"), st("D", "4")],
      map({ A: at(0), B: at(FREEBOARD_NEAR_M), C: at(FREEBOARD_NEAR_M + 0.01), D: at(-0.4) }),
      noHist,
      END,
    );
    const by = Object.fromEntries(rows.map((r) => [r.provinceCode, r]));
    expect(by["1"].tone).toBe("severe");
    expect(by["2"].tone).toBe("high");
    expect(by["3"].tone).toBe("none");
    expect(by["4"].tone).toBe("severe");
    expect(by["1"].worstRule).toBe("bank");
  });

  it("แย่สุดในจังหวัด: severe ชนะ high, เท่ากันเลือกระยะถึงตลิ่งน้อยกว่า แล้วรหัสน้อยกว่า", () => {
    const rows = provinceSeverities(
      [st("Z", "50"), st("B", "50"), st("A", "50"), st("C", "50")],
      map({
        Z: reading({ situationLevel: 4, freeboardM: 0.2 }),
        B: reading({ situationLevel: 5, freeboardM: -0.5 }),
        A: reading({ situationLevel: 5, freeboardM: -0.5 }),
        C: reading({ situationLevel: 5, freeboardM: -0.1 }),
      }),
      noHist,
      END,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].worstCode).toBe("A");
    expect(rows[0].stationCount).toBe(4);
    expect(rows[0].counted).toBe(4);
  });

  it("ค่าค้างไม่ถูกนับเข้า tone แต่ถูกนับแยก; ไม่มีค่าปัจจุบันเลย = no-data ไม่ใช่ none", () => {
    const rows = provinceSeverities(
      [st("A", "50"), st("B", "60")],
      map({
        A: reading({ situationLevel: 5, stale: true }),
        B: reading({ situationLevel: 3, stale: true }),
      }),
      noHist,
      END,
    );
    for (const row of rows) {
      expect(row.tone).toBe("no-data");
      expect(row.counted).toBe(0);
      expect(row.stale).toBe(1);
      expect(row.worstCode).toBeNull();
    }
  });

  it("ค่าค้างข้างค่าปัจจุบัน: tone มาจากค่าปัจจุบันเท่านั้น", () => {
    const [row] = provinceSeverities(
      [st("A", "50"), st("B", "50")],
      map({ A: reading({ situationLevel: 5, stale: true }), B: reading({ situationLevel: 3 }) }),
      noHist,
      END,
    );
    expect(row.tone).toBe("none");
    expect(row.stale).toBe(1);
    expect(row.counted).toBe(1);
  });

  it("ไม่มีเวลาตรวจวัด (undated) และไม่มีค่า (missing/ไม่อยู่ในแผนที่) นับแยก", () => {
    const [row] = provinceSeverities(
      [st("A", "50"), st("B", "50"), st("C", "50")],
      map({ A: reading({ observedAt: null, stale: true, situationLevel: 5 }), B: MISSING }),
      noHist,
      END,
    );
    expect(row.tone).toBe("no-data");
    expect(row.undated).toBe(1);
    expect(row.missing).toBe(2);
    expect(row.stale).toBe(0);
  });

  it("ค่าปัจจุบันที่จัดระดับไม่ได้ (ไม่มีระดับและไม่มีตลิ่ง) ไม่ทำให้เป็น none", () => {
    const [row] = provinceSeverities(
      [st("A", "50")],
      map({ A: reading({ situationLevel: null, freeboardM: null }) }),
      noHist,
      END,
    );
    expect(row.tone).toBe("no-data");
    expect(row.unclassified).toBe(1);
    expect(row.counted).toBe(0);
  });

  it("ไม่มีแถวของจังหวัดที่ไม่มีสถานี และข้ามสถานีที่ provinceCode เป็น null", () => {
    const rows = provinceSeverities([st("A", null), st("B", "50")], map({ A: reading(), B: reading() }), noHist, END);
    expect(rows.map((r) => r.provinceCode)).toEqual(["50"]);
    expect(provinceSeverities([], new Map(), noHist, END)).toEqual([]);
  });

  it("ยอด 48 ชม. ของสถานีที่แย่สุดเท่านั้น และเฉพาะเมื่อมีจุดระดับน้ำ", () => {
    const hist = (values: (number | null)[]): NorthRouteHistoryPoint[] =>
      values.map((value, i) => ({ t: iso(END - (values.length - 1 - i) * H), value, discharge: null }));
    const worstHist = hist([5, 9, 7, 6]);
    const rows = provinceSeverities(
      [st("A", "50"), st("B", "50"), st("C", "60"), st("D", "17")],
      map({
        A: reading({ situationLevel: 5 }),
        B: reading({ situationLevel: 3 }),
        C: reading({ situationLevel: 5 }),
        D: reading({ situationLevel: 3 }),
      }),
      new Map([
        ["A", worstHist],
        ["B", hist([50, 90])],
        ["C", hist([null, null])],
        ["D", hist([1, 2])],
      ]),
      END,
    );
    const by = Object.fromEntries(rows.map((r) => [r.provinceCode, r]));
    expect(by["50"].peak).toEqual({ value: 9, t: iso(END - 2 * H) });
    expect(by["60"].peak).toBeNull(); // สถานีแย่สุดไม่มีจุดระดับน้ำ
    expect(by["17"].peak).toBeNull(); // ไม่มีสถานีที่แย่สุด (none) → ไม่มีแถวยอด
  });

  it("focusCode = สถานีที่แย่สุด ไม่มีก็สถานีแรกของจังหวัด; เรียงเท่ากันคงลำดับตามผัง", () => {
    const rows = provinceSeverities(
      [st("X", "60"), st("Y", "60"), st("P", "50"), st("Q", "50")],
      map({ X: reading(), Y: reading(), P: reading({ situationLevel: 3 }), Q: reading({ situationLevel: 4 }) }),
      noHist,
      END,
    );
    expect(rows.map((r) => [r.provinceCode, r.focusCode])).toEqual([
      ["50", "Q"],
      ["60", "X"],
    ]);
  });
});
