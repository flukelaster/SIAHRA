import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
  ObservationsResponse,
  RainfallObservation,
  StationRef,
  WaterLevelObservation,
} from "@siahra/shared-types";
import {
  FREEBOARD_NEAR_M,
  OVERVIEW_MAX_READING_AGE_MS,
  OVERVIEW_WATCH_MAX,
  classifyRain,
  readingFreshness,
  summarizeOverview,
  type OverviewInput,
  type OverviewSummary,
} from "./overviewSummary";
import { FREEBOARD_NEAR_M as ROUTE_FREEBOARD_NEAR_M } from "./northRoute";
import { SHEET_MAX_READING_AGE_MS } from "./stationSheetField";

const NOW = Date.parse("2026-09-26T06:00:00Z");
const FETCHED = "2026-09-26T05:55:00.000Z";
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;
const HOUR = 3_600_000;

function station(id: number): StationRef {
  return {
    id,
    nameTh: `สถานี ${id}`,
    nameEn: null,
    lat: 13.8,
    lon: 100.6,
    provinceCode: "10",
    provinceNameTh: null,
    amphoeNameTh: null,
    basinNameTh: null,
    agencyShortTh: null,
    ridCode: null,
    subBasinId: null,
    isKeyStation: false,
  };
}

function wl(id: number, over: Partial<WaterLevelObservation> = {}): WaterLevelObservation {
  return {
    station: station(id),
    waterlevelMsl: 2,
    waterlevelLocalM: null,
    minBankMsl: 4,
    groundLevelMsl: null,
    freeboardM: 2,
    situationLevel: 3,
    storagePercent: null,
    dischargeM3s: null,
    qmaxM3s: null,
    criticalLevelMsl: null,
    observedAt: iso(NOW - 20 * MIN),
    ...over,
  };
}

function rf(id: number, rain24h: number | null, over: Partial<RainfallObservation> = {}): RainfallObservation {
  return { station: station(id), rain24h, rain1h: null, observedAt: iso(NOW - 20 * MIN), ...over };
}

function data(
  waterlevel: WaterLevelObservation[],
  rainfall: RainfallObservation[] = [],
  fetchedAt: string | null = FETCHED,
): ObservationsResponse {
  return {
    layer: {} as ObservationsResponse["layer"],
    summary: {
      provinceCode: "10",
      rainfallStationCount: rainfall.length,
      waterlevelStationCount: waterlevel.length,
      maxRain24h: null,
      meanRain24h: null,
      stationsAboveWarning: 0,
      latestObservedAt: null,
      fetchedAt,
      sourceAttribution: "ThaiWater",
    },
    rainfall,
    waterlevel,
  };
}

function input(over: Partial<OverviewInput>): OverviewInput {
  return { data: null, loading: false, error: null, atIso: null, nowMs: NOW, ...over };
}

function ready(s: OverviewSummary) {
  if (s.state !== "ready") throw new Error(`expected ready, got ${s.state}`);
  return s;
}

describe("summarizeOverview — สถานะที่ต้องแยกกันให้ออก", () => {
  it("ยังไม่มีข้อมูล + กำลังโหลด = loading", () => {
    expect(summarizeOverview(input({ loading: true })).state).toBe("loading");
  });

  it("ยังไม่มีข้อมูล + error = error (ไม่ใช่ loading ไม่ใช่ไม่มีสถานี)", () => {
    const s = summarizeOverview(input({ error: { key: "error.apiUnreachable" } }));
    expect(s).toEqual({ state: "error", error: { key: "error.apiUnreachable" } });
  });

  it("มีข้อมูลเดิมระหว่างโหลดรอบใหม่ = ยังแสดงสรุปจากข้อมูลเดิม", () => {
    const s = summarizeOverview(input({ data: data([wl(1)]), loading: true }));
    expect(s.state).toBe("ready");
  });

  it("fetchedAt null = never-fetched แม้จะมีรายการ — ห้ามกลายเป็นเวลา", () => {
    expect(summarizeOverview(input({ data: data([wl(1, { situationLevel: 5 })], [], null) })).state).toBe(
      "never-fetched",
    );
    expect(summarizeOverview(input({ data: data([], [], null) })).state).toBe("never-fetched");
  });

  it("สด + ไม่มีสถานีเลย = no-stations; ย้อนหลัง + ไม่มีค่า = no-values-at-time (ไม่ใช่ไม่มีสถานี)", () => {
    expect(summarizeOverview(input({ data: data([]) }))).toEqual({ state: "no-stations", fetchedAt: FETCHED });
    const at = iso(NOW - 3 * 24 * HOUR);
    expect(summarizeOverview(input({ data: data([]), atIso: at }))).toEqual({ state: "no-values-at-time", atIso: at });
  });

  it("ไม่มีสถานีที่เกินเกณฑ์ = tone none ไม่ใช่สถานะพิเศษ และยังบอกเวลา", () => {
    const s = ready(summarizeOverview(input({ data: data([wl(1), wl(2, { situationLevel: 2 })]) })));
    expect(s.tone).toBe("none");
    expect(s.watch).toEqual([]);
    expect(s.water.current).toBe(2);
    expect(s.describedAt).toBe(FETCHED);
  });
});

describe("summarizeOverview — การนับระดับของ ThaiWater", () => {
  it("นับระดับ 5 และ 4 แยกกัน ระดับ 1–3 ไม่นับ", () => {
    const s = ready(
      summarizeOverview(
        input({
          data: data([
            wl(1, { situationLevel: 5, freeboardM: -0.2 }),
            wl(2, { situationLevel: 4, freeboardM: 0.4 }),
            wl(3, { situationLevel: 4, freeboardM: 0.9 }),
            wl(4, { situationLevel: 1 }),
            wl(5, { situationLevel: 3 }),
          ]),
        }),
      ),
    );
    expect(s.water).toMatchObject({ current: 5, level5: 1, level4: 2, atBank: 0, nearBank: 0 });
    expect(s.tone).toBe("severe");
    expect(s.watchTotal).toBe(3);
  });

  it("ค่าสดที่ไม่มีระดับจาก ThaiWater ใช้ระยะถึงตลิ่ง (กฎเดียวกับหมุด) และนับแยกกลุ่ม", () => {
    const s = ready(
      summarizeOverview(
        input({
          data: data([
            wl(1, { situationLevel: null, freeboardM: 0 }),
            wl(2, { situationLevel: null, freeboardM: 1 }),
            wl(3, { situationLevel: null, freeboardM: 1.01 }),
            wl(4, { situationLevel: null, freeboardM: null }),
          ]),
        }),
      ),
    );
    expect(s.water).toMatchObject({ level5: 0, level4: 0, atBank: 1, nearBank: 1, unclassified: 1 });
    expect(s.watch.map((r) => r.kind === "waterlevel" && r.rule)).toEqual(["bank", "bank"]);
  });
});

describe("summarizeOverview — ค่าเก่า", () => {
  it("ใช้ค่าคงที่ 6 ชม. เดียวกับแผ่นน้ำจำลอง", () => {
    expect(OVERVIEW_MAX_READING_AGE_MS).toBe(SHEET_MAX_READING_AGE_MS);
    expect(OVERVIEW_MAX_READING_AGE_MS).toBe(6 * HOUR);
  });

  it("อายุ 6 ชม. พอดียังนับ เกินไป 1 ms = ค่าเก่า; ไม่มีเวลา = นับแยก", () => {
    expect(readingFreshness(iso(NOW - 6 * HOUR), NOW)).toBe("current");
    expect(readingFreshness(iso(NOW - 6 * HOUR - 1), NOW)).toBe("stale");
    expect(readingFreshness(null, NOW)).toBe("undated");
    expect(readingFreshness("not-a-date", NOW)).toBe("undated");
  });

  it("ค่าเก่าไม่เข้ากลุ่มเกินเกณฑ์ ไม่อยู่ในรายการ แต่ถูกนับแยก — ไม่หายเงียบ", () => {
    const s = ready(
      summarizeOverview(
        input({
          data: data(
            [
              wl(1, { situationLevel: 5, observedAt: iso(NOW - 6 * HOUR) }),
              wl(2, { situationLevel: 5, observedAt: iso(NOW - 6 * HOUR - MIN) }),
              wl(3, { situationLevel: 5, observedAt: null }),
            ],
            [rf(10, 120, { observedAt: iso(NOW - 7 * HOUR) })],
          ),
        }),
      ),
    );
    expect(s.water).toMatchObject({ current: 1, level5: 1, stale: 1, undated: 1 });
    expect(s.rain).toMatchObject({ current: 0, severe: 0, stale: 1 });
    expect(s.watch.map((r) => r.obs.station.id)).toEqual([1]);
  });

  it("ย้อนหลัง: อายุนับจาก atIso ไม่ใช่จากตอนนี้", () => {
    const atMs = NOW - 2 * 24 * HOUR;
    const s = ready(
      summarizeOverview(
        input({
          data: data([
            wl(1, { situationLevel: null, freeboardM: -0.1, observedAt: iso(atMs - HOUR) }),
            wl(2, { situationLevel: null, freeboardM: -0.1, observedAt: iso(atMs - 7 * HOUR) }),
          ]),
          atIso: iso(atMs),
        }),
      ),
    );
    expect(s.water).toMatchObject({ current: 1, atBank: 1, stale: 1 });
  });
});

describe("เกณฑ์ที่ประกาศซ้ำต้องเท่ากับต้นฉบับเสมอ", () => {
  it("ใกล้ตลิ่ง = FREEBOARD_NEAR_M ของ lib/northRoute.ts (กฎเดียวกับหมุด freeboardColor)", () => {
    expect(FREEBOARD_NEAR_M).toBe(ROUTE_FREEBOARD_NEAR_M);
  });
});

describe("summarizeOverview — ย้อนหลัง", () => {
  const atMs = NOW - 3 * 24 * HOUR;
  const at = iso(atMs);

  it("ไม่มีระดับ ThaiWater → ระยะถึงตลิ่ง: ≤ 0 = ถึงตลิ่ง, ≤ 1 ม. = ใกล้ตลิ่ง, ไกลกว่านั้นไม่นับ", () => {
    const s = ready(
      summarizeOverview(
        input({
          data: data([
            wl(1, { situationLevel: null, freeboardM: -0.3, observedAt: iso(atMs - 10 * MIN) }),
            wl(2, { situationLevel: null, freeboardM: 0.5, observedAt: iso(atMs - 10 * MIN) }),
            wl(3, { situationLevel: null, freeboardM: 3, observedAt: iso(atMs - 10 * MIN) }),
          ]),
          atIso: at,
        }),
      ),
    );
    expect(s.historical).toBe(true);
    expect(s.describedAt).toBe(at);
    expect(s.water).toMatchObject({ level5: 0, level4: 0, atBank: 1, nearBank: 1 });
    expect(s.tone).toBe("severe");
  });

  it("ย้อนหลังแต่สถานีมีระดับของ ThaiWater → นับตามระดับนั้น (กฎต่อสถานี ไม่ใช่ต่อโหมด)", () => {
    const s = ready(
      summarizeOverview(
        input({ data: data([wl(1, { situationLevel: 5, freeboardM: 0.4, observedAt: iso(atMs) })]), atIso: at }),
      ),
    );
    expect(s.water).toMatchObject({ level5: 1, atBank: 0, nearBank: 0 });
  });

  it("ไม่มีรายการฝนในเวลานั้น = rainMissing (ไม่ใช่ฝนเป็นศูนย์)", () => {
    const s = ready(
      summarizeOverview(
        input({ data: data([wl(1, { situationLevel: null, observedAt: iso(atMs) })]), atIso: at }),
      ),
    );
    expect(s.rainMissing).toBe(true);
    expect(s.rain.current).toBe(0);
  });

  it("ฝนที่เติมจากคลังรายชั่วโมง (เกิน 7 วัน) ยังถูกนับตามแถบ TMD", () => {
    const old = NOW - 10 * 24 * HOUR;
    const s = ready(
      summarizeOverview(
        input({
          data: data([], [rf(10, 95, { observedAt: iso(old - 30 * MIN) })]),
          atIso: iso(old),
        }),
      ),
    );
    expect(s.rainMissing).toBe(false);
    expect(s.rain.severe).toBe(1);
  });
});

describe("แถบฝน TMD (bandRain24h, เกินเกณฑ์แบบ >)", () => {
  it("35 พอดี = ไม่นับ, 35.1 = high, 90 พอดี = high, 90.1 = severe, null = ไม่มีค่า", () => {
    expect(classifyRain(rf(1, 35))).toBe("none");
    expect(classifyRain(rf(1, 35.1))).toBe("high");
    expect(classifyRain(rf(1, 90))).toBe("high");
    expect(classifyRain(rf(1, 90.1))).toBe("severe");
    expect(classifyRain(rf(1, null))).toBe("none");
  });

  it("นับ severe/high และสถานีที่ไม่มีค่าฝนแยกกัน", () => {
    const s = ready(
      summarizeOverview(input({ data: data([], [rf(1, 35), rf(2, 36), rf(3, 90), rf(4, 91), rf(5, null)]) })),
    );
    expect(s.rain).toMatchObject({ current: 5, severe: 1, high: 2, noValue: 1 });
  });
});

describe("ลำดับของรายการ ควรดูก่อน", () => {
  it("ระดับน้ำก่อนฝน; ในระดับน้ำ: severe ก่อน high → ระยะถึงตลิ่งน้อยก่อน → id; ฝน: severe ก่อน → มากก่อน → id", () => {
    const s = ready(
      summarizeOverview(
        input({
          data: data(
            [
              wl(7, { situationLevel: 4, freeboardM: 0.2 }),
              wl(6, { situationLevel: 5, freeboardM: 0.1 }),
              wl(5, { situationLevel: 5, freeboardM: -0.5 }),
              wl(4, { situationLevel: 4, freeboardM: null }),
            ],
            [rf(20, 40), rf(21, 150), rf(22, 91)],
          ),
        }),
      ),
    );
    expect(s.watchTotal).toBe(7);
    expect(s.watch).toHaveLength(OVERVIEW_WATCH_MAX);
    expect(s.watch.map((r) => `${r.kind[0]}${r.obs.station.id}`)).toEqual(["w5", "w6", "w7", "w4", "r21"]);
  });

  it("ค่าเท่ากันทุกอย่าง → id น้อยก่อน (ลำดับไม่ขึ้นกับลำดับที่ API ส่งมา)", () => {
    const a = ready(
      summarizeOverview(
        input({
          data: data(
            [wl(9, { situationLevel: 4, freeboardM: 0.3 }), wl(3, { situationLevel: 4, freeboardM: 0.3 })],
            [rf(8, 50), rf(2, 50)],
          ),
        }),
      ),
    );
    expect(a.watch.map((r) => r.obs.station.id)).toEqual([3, 9, 2, 8]);
  });

  it("ระดับจาก ThaiWater กับกฎตลิ่งอยู่ในลำดับเดียวกันตามระดับ แล้วระยะถึงตลิ่ง", () => {
    const s = ready(
      summarizeOverview(
        input({
          data: data([
            wl(1, { situationLevel: 4, freeboardM: 0.5 }),
            wl(2, { situationLevel: null, freeboardM: -0.1 }),
            wl(3, { situationLevel: null, freeboardM: 0.2 }),
          ]),
        }),
      ),
    );
    expect(s.watch.map((r) => r.obs.station.id)).toEqual([2, 3, 1]);
  });
});

describe("ความบริสุทธิ์ของโมดูล", () => {
  it("ไม่มี fetch / WebSocket / timer / dynamic import / console", () => {
    const src = readFileSync(fileURLToPath(new URL("./overviewSummary.ts", import.meta.url)), "utf8");
    for (const banned of ["fetch(", "WebSocket", "setInterval", "setTimeout", "import(", "console."]) {
      expect(src.includes(banned), banned).toBe(false);
    }
  });
});
