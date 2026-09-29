import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { NorthRouteTopology, RiverForecastStation } from "@siahra/shared-types";
import { PROVINCES } from "../data/provinces";
import {
  FORECAST_STALE_MS,
  NO_STATION_PROVINCES,
  buildForecastIndex,
  chartModel,
  copyIsOld,
  firstCrossings,
  forecastPart,
  forecastStationsByProvince,
  observedForChart,
  provinceCodeFromThai,
  publishedState,
  relativeTime,
  stackLabelYs,
  summarizeStation,
} from "./riverForecast";

const H = 3_600_000;
const PUBLISHED = "2026-09-29T03:05:01.000Z";
const PUB_MS = Date.parse(PUBLISHED);

/** ชุดเลียนแบบไฟล์จริง: รายชั่วโมงเวลาไทย (นาที 00) 337 จุด ตั้งแต่ 2026-09-22T06:00+07 ถึง 2026-10-06T06:00+07 */
function series(valueAt: (t: number, i: number) => number): [number, number][] {
  const start = Date.parse("2026-09-22T06:00:00+07:00");
  return Array.from({ length: 337 }, (_, i) => [start + i * H, valueAt(start + i * H, i)] as [number, number]);
}

function station(over: Partial<RiverForecastStation> = {}): RiverForecastStation {
  return {
    code: "C.2",
    hiiCode: "C2",
    kind: "discharge",
    unit: "m3/s",
    nameTh: "ค่ายจิรประวัติ",
    province: "จ.นครสวรรค์",
    thresholds: { alarm: 2988, warning: 3362, critical: 3735 },
    series: series(() => 100),
    publishedAt: PUBLISHED,
    fetchedAt: "2026-09-29T09:05:32.162Z",
    lastError: null,
    ...over,
  };
}

const pts = (...vs: number[]): [number, number][] => vs.map((v, i) => [PUB_MS + (i + 1) * H, v]);

describe("forecastPart", () => {
  it("ข้อมูลจริงรูปเดียวกับไฟล์ HII: 337 จุด → 164 จุดหลัง publishedAt เริ่ม 04:00Z และไม่มีจุดก่อนหน้า", () => {
    const s = station();
    expect(s.series).toHaveLength(337);
    const part = forecastPart(s);
    expect(part).toHaveLength(164);
    expect(part[0][0]).toBe(Date.parse("2026-09-29T04:00:00Z"));
    expect(part[part.length - 1][0]).toBe(Date.parse("2026-10-05T23:00:00Z"));
    expect(part.every(([t]) => t > PUB_MS)).toBe(true);
  });

  it("จุดที่เวลาเท่ากับ publishedAt พอดี ไม่ใช่พยากรณ์ (strictly after)", () => {
    const s = station({ series: [[PUB_MS - H, 1], [PUB_MS, 2], [PUB_MS + 1, 3]] });
    expect(forecastPart(s)).toEqual([[PUB_MS + 1, 3]]);
  });

  it("publishedAt เป็น null หรืออ่านไม่ออก → ไม่มีส่วนพยากรณ์เลย (ไม่เดา)", () => {
    expect(forecastPart(station({ publishedAt: null }))).toEqual([]);
    expect(forecastPart(station({ publishedAt: "not a date" }))).toEqual([]);
  });

  it("เรียงตามเวลา และทิ้งจุดที่ไม่ใช่ตัวเลข", () => {
    const s = station({ series: [[PUB_MS + 3 * H, 3], [PUB_MS + H, 1], [PUB_MS + 2 * H, Number.NaN]] });
    expect(forecastPart(s)).toEqual([[PUB_MS + H, 1], [PUB_MS + 3 * H, 3]]);
  });
});

describe("summarizeStation: ค่าสูงสุดและรูปร่าง", () => {
  const sum = (values: number[], thresholds = station().thresholds) =>
    summarizeStation(station({ series: pts(...values), thresholds }));

  it("ยอดอยู่ตรงกลาง = interior", () => {
    const s = sum([1, 5, 9, 4, 2]);
    expect(s.status).toBe("ok");
    expect(s.peak).toEqual({ t: PUB_MS + 3 * H, value: 9 });
    expect(s.shape).toBe("interior");
  });

  it("ยอดคือจุดแรก = peak-at-start (ลดลงต่อจากนั้น)", () => {
    const s = sum([9, 8, 5, 2]);
    expect(s.peak?.t).toBe(PUB_MS + H);
    expect(s.shape).toBe("peak-at-start");
  });

  it("ยอดคือจุดสุดท้าย = peak-at-end (ยังสูงขึ้นเมื่อหน้าต่างจบ)", () => {
    const s = sum([1, 2, 3, 9]);
    expect(s.peak?.t).toBe(PUB_MS + 4 * H);
    expect(s.shape).toBe("peak-at-end");
  });

  it("ค่าสูงสุดเท่ากันหลายจุด ใช้จุดแรก", () => {
    const s = sum([1, 9, 3, 9, 2]);
    expect(s.peak?.t).toBe(PUB_MS + 2 * H);
    expect(s.shape).toBe("interior");
  });

  it("ชุดที่ทุกค่าเท่ากัน = flat ไม่ใช่ 'ลดลง'; จุดเดียว = ไม่มีรูปร่าง", () => {
    expect(sum([4, 4, 4]).shape).toBe("flat");
    const one = sum([4]);
    expect(one.peak?.value).toBe(4);
    expect(one.shape).toBeNull();
  });

  it("ไม่มีจุดหลัง publishedAt → status empty, ไม่มี peak; fetchedAt null → never-fetched; publishedAt null → no-publish-time", () => {
    expect(summarizeStation(station({ series: [[PUB_MS - H, 5]] })).status).toBe("empty");
    expect(summarizeStation(station({ series: [], fetchedAt: null, publishedAt: null })).status).toBe("never-fetched");
    const s = summarizeStation(station({ publishedAt: null }));
    expect(s.status).toBe("no-publish-time");
    expect(s.peak).toBeNull();
    expect(s.points).toEqual([]);
  });
});

describe("เกณฑ์ที่ HII เผยแพร่", () => {
  const T = { alarm: 927.2, warning: 1043.1, critical: 1159 };

  it("จุดแรกที่ค่า > เกณฑ์ (เท่าพอดีไม่นับ) ต่อระดับ อิสระจากกัน", () => {
    const c = firstCrossings(pts(900, 927.2, 1000, 1100, 1200), T);
    expect(c).toEqual({ alarm: PUB_MS + 3 * H, warning: PUB_MS + 4 * H, critical: PUB_MS + 5 * H });
  });

  it("ไม่ถึงเกณฑ์ใดเลย → null ทุกระดับ และ highest เป็น null", () => {
    const s = summarizeStation(station({ series: pts(1, 2, 3) }));
    expect(s.crossings).toEqual({ alarm: null, warning: null, critical: null });
    expect(s.highest).toBeNull();
    expect(s.hasThresholds).toBe(true);
  });

  it("เกณฑ์เป็น null = ไม่เทียบระดับนั้น (ไม่ใช่ 0); ไม่มีเกณฑ์เลย = hasThresholds false", () => {
    expect(firstCrossings(pts(5, 6), { alarm: null, warning: 5.5, critical: null })).toEqual({
      alarm: null,
      warning: PUB_MS + 2 * H,
      critical: null,
    });
    const none = summarizeStation(station({ series: pts(5, 6), thresholds: null }));
    expect(none.hasThresholds).toBe(false);
    expect(none.highest).toBeNull();
    const allNull = summarizeStation(station({ series: pts(5, 6), thresholds: { alarm: null, warning: null, critical: null } }));
    expect(allNull.hasThresholds).toBe(false);
  });

  it("ไม่สมมติว่า critical > warning (ไฟล์จริงของ N1 มี warning > critical): รายงานระดับตามชื่อ critical ก่อน", () => {
    const s = summarizeStation(station({ series: pts(1000, 1080), thresholds: { alarm: 973.6, warning: 1095.3, critical: 1066 } }));
    expect(s.crossings).toEqual({ alarm: PUB_MS + H, warning: null, critical: PUB_MS + 2 * H });
    expect(s.highest).toEqual({ level: "critical", t: PUB_MS + 2 * H, threshold: 1066 });
  });

  it("ระดับสูงสุดที่ถึง: ถึงแค่ alarm/warning ก็รายงานตามนั้น", () => {
    const s = summarizeStation(station({ series: pts(1000, 1100), thresholds: T }));
    expect(s.highest).toEqual({ level: "warning", t: PUB_MS + 2 * H, threshold: 1043.1 });
  });
});

describe("ความสด: สองแกนที่แยกกัน", () => {
  it("FORECAST_STALE_MS = 48 ชม. (ข้อตกลงแสดงผลของเรา)", () => {
    expect(FORECAST_STALE_MS).toBe(48 * H);
  });

  it("publishedAt: unknown / fresh / stale (เท่ากับ 48 ชม. พอดียังไม่ stale)", () => {
    expect(publishedState({ publishedAt: null }, PUB_MS)).toEqual({ kind: "unknown" });
    expect(publishedState({ publishedAt: PUBLISHED }, PUB_MS + H)).toEqual({ kind: "fresh", ageMs: H });
    expect(publishedState({ publishedAt: PUBLISHED }, PUB_MS + FORECAST_STALE_MS).kind).toBe("fresh");
    expect(publishedState({ publishedAt: PUBLISHED }, PUB_MS + FORECAST_STALE_MS + 1).kind).toBe("stale");
  });

  it("สำเนาของ API เก่า: fetchedAt เกิน staleAfterSeconds; null ไม่ใช่ 'เก่า'", () => {
    const fetched = "2026-09-29T09:05:32.162Z";
    const ms = Date.parse(fetched);
    expect(copyIsOld({ fetchedAt: fetched }, ms + 10_800_000, 10_800)).toBe(false);
    expect(copyIsOld({ fetchedAt: fetched }, ms + 10_800_001, 10_800)).toBe(true);
    expect(copyIsOld({ fetchedAt: null }, ms + 999_999_999, 10_800)).toBe(false);
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-09-29T12:00:00Z");
  it("ภายในไม่ถึง 1 ชม. = now", () => {
    expect(relativeTime(now + 20 * 60_000, now)).toEqual({ dir: "now" });
    expect(relativeTime(now - 29 * 60_000, now)).toEqual({ dir: "now" });
  });
  it("อนาคตต่ำกว่า 48 ชม. เป็นชั่วโมง ตั้งแต่ 48 ชม. เป็นวัน", () => {
    expect(relativeTime(now + 5 * H, now)).toEqual({ dir: "future", unit: "h", n: 5 });
    expect(relativeTime(now + 47 * H, now)).toEqual({ dir: "future", unit: "h", n: 47 });
    expect(relativeTime(now + 48 * H, now)).toEqual({ dir: "future", unit: "d", n: 2 });
    expect(relativeTime(now + 100 * H, now)).toEqual({ dir: "future", unit: "d", n: 4 });
  });
  it("เวลาที่ผ่านไปแล้วเป็น past (ไม่มีค่าลบ)", () => {
    expect(relativeTime(now - 6 * H, now)).toEqual({ dir: "past", unit: "h", n: 6 });
    expect(relativeTime(now - 72 * H, now)).toEqual({ dir: "past", unit: "d", n: 3 });
  });
});

describe("observedForChart / chartModel", () => {
  const now = Date.parse("2026-09-29T12:00:00Z");
  const hist = [
    { t: new Date(now - 60 * H).toISOString(), value: null, discharge: 500 },
    { t: new Date(now - 6 * H).toISOString(), value: null, discharge: 1000 },
    { t: new Date(now - 3 * H).toISOString(), value: null, discharge: null },
    { t: new Date(now - H).toISOString(), value: null, discharge: 1100 },
  ];

  it("ค่าตรวจวัด: เฉพาะ discharge ในรอบ 48 ชม. ที่ไม่ null; ระดับน้ำ (waterlevel) และไม่มีประวัติ = ว่าง", () => {
    expect(observedForChart("discharge", hist, now).map((p) => p.v)).toEqual([1000, 1100]);
    expect(observedForChart("waterlevel", hist, now)).toEqual([]);
    expect(observedForChart("discharge", null, now)).toEqual([]);
  });

  const base = {
    kind: "discharge" as const,
    observed: [],
    forecast: pts(900, 1500, 1800, 1200),
    thresholds: { alarm: 927.2, warning: 1043.1, critical: 1159 },
    peak: { t: PUB_MS + 3 * H, value: 1800 },
    nowMs: PUB_MS + 2 * H,
    width: 300,
    height: 100,
    pad: 4,
  };

  it("คืน null เมื่อไม่มีจุดพยากรณ์", () => {
    expect(chartModel({ ...base, forecast: [] })).toBeNull();
  });

  it("เกณฑ์วาดเฉพาะที่อยู่ในช่วง y; ยอดและตอนนี้อยู่ในกรอบ", () => {
    const m = chartModel(base)!;
    expect(m.thresholdLines.map((l) => l.level)).toEqual(["critical", "warning", "alarm"]);
    expect(m.peak!.y).toBeGreaterThanOrEqual(4);
    expect(m.peak!.y).toBeLessThan(m.thresholdLines[0].y);
    expect(m.nowX).toBeGreaterThan(4);
    expect(m.forecastPath).toMatch(/^M/);
    expect(m.observedPath).toBeNull();
  });

  it("เกณฑ์ที่อยู่เหนือช่วงข้อมูลไม่ถูกวาดและไม่ยืดแกน (เช่น C.2 สูงสุด 2,335 เกณฑ์ 2,988+)", () => {
    const m = chartModel({
      ...base,
      forecast: pts(2000, 2335, 2100),
      thresholds: { alarm: 2988, warning: 3362, critical: 3735 },
      peak: { t: PUB_MS + 2 * H, value: 2335 },
    })!;
    expect(m.thresholdLines).toEqual([]);
    expect(m.yMax).toBeLessThan(2988);
  });

  it("ตอนนี้อยู่นอกช่วงที่วาด → nowX เป็น null; ช่วง x เริ่มที่ค่าตรวจวัดแรกเมื่อมี", () => {
    const m = chartModel({ ...base, nowMs: PUB_MS - 100 * H, observed: [{ t: PUB_MS - 30 * H, v: 900 }, { t: PUB_MS - 10 * H, v: 950 }] })!;
    expect(m.nowX).toBeNull();
    expect(m.xMin).toBe(PUB_MS - 30 * H);
    expect(m.observedPath).toMatch(/^M/);
  });

  it("ระดับน้ำที่ติดลบ (waterlevel) ไม่ถูกตัดที่ 0 แต่ discharge ไม่ลงต่ำกว่า 0", () => {
    const wl = chartModel({ ...base, kind: "waterlevel", forecast: pts(-1, -0.5, 0.5), thresholds: { alarm: -0.82, warning: 0.74, critical: 2.3 } })!;
    expect(wl.yMin).toBeLessThan(-1);
    expect(wl.thresholdLines.map((l) => l.level)).toEqual(["alarm"]);
    const q = chartModel({ ...base, forecast: pts(0, 1, 2) })!;
    expect(q.yMin).toBe(0);
  });
});

describe("จังหวัด", () => {
  it("provinceCodeFromThai: ตัด 'จ.' ตรงชื่อเต็มเท่านั้น; ไม่ตรง/null = null", () => {
    expect(provinceCodeFromThai("จ.นนทบุรี", PROVINCES)).toBe("12");
    expect(provinceCodeFromThai("จ.พระนครศรีอยุธยา", PROVINCES)).toBe("14");
    expect(provinceCodeFromThai("จังหวัดปทุมธานี", PROVINCES)).toBe("13");
    expect(provinceCodeFromThai("จ.ไม่มีจริง", PROVINCES)).toBeNull();
    expect(provinceCodeFromThai(null, PROVINCES)).toBeNull();
  });

  const topology = JSON.parse(
    readFileSync(new URL("../../public/rivers/north-route.json", import.meta.url), "utf8"),
  ) as NorthRouteTopology;

  it("ผังคงที่: ห้าสถานี C.* อยู่ในจังหวัดตามที่แถวจังหวัดอ้าง และนนทบุรี/ปทุมธานีไม่มีสถานีบนเส้นทาง", () => {
    const at = (c: string) => topology.stations.find((s) => s.ridCode === c)?.provinceCode;
    expect([at("C.2"), at("C.13"), at("C.3"), at("C.7A"), at("C.35")]).toEqual(["60", "18", "17", "15", "14"]);
    for (const row of NO_STATION_PROVINCES) {
      expect(topology.stations.some((s) => s.provinceCode === row.provinceCode)).toBe(false);
    }
    expect(PROVINCES.find((p) => p.code === "12")?.nameEn).toBe("Nonthaburi");
    expect(PROVINCES.find((p) => p.code === "13")?.nameEn).toBe("Pathum Thani");
  });

  it("forecastStationsByProvince: สถานีบนเส้นทางใช้จังหวัดจากผัง, CPY014 ใช้ชื่อที่ HII เผยแพร่ → 12", () => {
    const stations = [
      station({ code: "C.2" }),
      station({ code: "C.35", province: "จ.พระนครศรีอยุธยา" }),
      station({ code: "CPY014", kind: "waterlevel", unit: "m", province: "จ.นนทบุรี" }),
      station({ code: "CPYX", province: null }),
    ];
    const map = forecastStationsByProvince(topology.stations, stations, PROVINCES);
    expect(map.get("60")?.map((s) => s.code)).toEqual(["C.2"]);
    expect(map.get("14")?.map((s) => s.code)).toEqual(["C.35"]);
    expect(map.get("12")?.map((s) => s.code)).toEqual(["CPY014"]);
    expect(map.has("13")).toBe(false);
    expect([...map.values()].flat().some((s) => s.code === "CPYX")).toBe(false);
  });
});

describe("buildForecastIndex: หรี่เมื่อไฟล์เก่า / สำเนาเก่า / คำขอพลาด", () => {
  const fresh = PUB_MS + H;
  const idx = (stations: RiverForecastStation[], nowMs: number, requestFailed = false) =>
    buildForecastIndex(stations, { staleAfterSeconds: 10_800, nowMs, requestFailed });

  it("ไฟล์และสำเนาสด ไม่หรี่", () => {
    const e = idx([station({ fetchedAt: new Date(fresh).toISOString() })], fresh).get("C.2")!;
    expect(e.dim).toBe(false);
    expect(e.summary.status).toBe("ok");
  });

  it("ไฟล์ของ HII เก่ากว่า 48 ชม. = หรี่ (แต่สำเนา API ไม่เก่า)", () => {
    const now = PUB_MS + FORECAST_STALE_MS + H;
    const e = idx([station({ fetchedAt: new Date(now).toISOString() })], now).get("C.2")!;
    expect(e.published.kind).toBe("stale");
    expect(e.copyOld).toBe(false);
    expect(e.dim).toBe(true);
  });

  it("สำเนา API เก่า (API ยืนยันไฟล์ไม่ได้) = หรี่ แม้ไฟล์ของ HII ยังไม่เก่า", () => {
    const now = PUB_MS + 30 * H;
    const e = idx([station({ fetchedAt: new Date(PUB_MS + H).toISOString() })], now).get("C.2")!;
    expect(e.published.kind).toBe("fresh");
    expect(e.copyOld).toBe(true);
    expect(e.dim).toBe(true);
  });

  it("คำขอของเว็บพลาด = หรี่ทุกสถานี; publishedAt null ไม่ใช่ 'เก่า' แต่ไม่มีส่วนพยากรณ์", () => {
    const e = idx([station({ publishedAt: null, fetchedAt: new Date(fresh).toISOString() })], fresh, true).get("C.2")!;
    expect(e.dim).toBe(true);
    expect(e.published.kind).toBe("unknown");
    expect(e.summary.status).toBe("no-publish-time");
    const ok = idx([station({ publishedAt: null, fetchedAt: new Date(fresh).toISOString() })], fresh, false).get("C.2")!;
    expect(ok.dim).toBe(false);
  });
});

describe("stackLabelYs", () => {
  it("ป้ายอยู่เหนือเส้น 2 หน่วย และดันลงให้ห่างกันอย่างน้อย gap", () => {
    expect(stackLabelYs([50], 9)).toEqual([48]);
    expect(stackLabelYs([50, 52, 53], 9)).toEqual([48, 57, 66]);
    expect(stackLabelYs([80, 20], 9)).toEqual([18, 78]);
    expect(stackLabelYs([], 9)).toEqual([]);
  });
  it("ไม่แก้อาร์เรย์ที่รับเข้ามา", () => {
    const ys = [60, 10];
    stackLabelYs(ys, 9);
    expect(ys).toEqual([60, 10]);
  });
});

describe("บรรทัดเกณฑ์ในการ์ด", () => {
  it("การ์ดต่อประโยค crossNote ท้ายบรรทัด cross เสมอเมื่อมี highest", () => {
    const src = readFileSync(new URL("../components/hazard/RiverForecastSection.tsx", import.meta.url), "utf8");
    const at = src.indexOf('t("north.forecast.cross"');
    expect(at).toBeGreaterThan(0);
    expect(src.indexOf('t("north.forecast.crossNote")', at)).toBeGreaterThan(at);
  });
});
