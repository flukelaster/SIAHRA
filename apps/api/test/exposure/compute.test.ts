import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ExposureFactors,
  ExposureLevel,
  RainfallObservation,
  SituationLevel,
  StationRef,
  WaterLevelObservation,
} from "@siahra/shared-types";
import {
  computeExposure,
  DEFAULT_EXPOSURE_THRESHOLDS as T,
  levelOf,
  type ExposureObservations,
  type StationHourlyLevels,
} from "../../src/exposure/compute";
import { fetchRainfall, fetchWaterLevel, fetchWaterLevelHistory } from "../../src/ingestion/thaiwater";
import graphFixture from "../fixtures/thaiwater-waterlevel-graph.json";
import rainFixture from "../fixtures/thaiwater-rain24h.json";
import waterFixture from "../fixtures/thaiwater-waterlevel-load.json";
import { respondJson } from "../ingestion/mockFetch";

/**
 * E10.2 — การคำนวณ "ระดับการเผชิญน้ำ (ภาพประกอบ)"
 *
 * สิ่งที่เทสนี้ยึดไว้ ไล่ตาม AC ของ E10.2 และกติกาความซื่อสัตย์ต่อข้อมูลใน AGENTS.md:
 *   - **deterministic** — อินพุตชุดเดิม (รวมถึงสลับลำดับที่ต้นทางส่งมา) ให้ผลลัพธ์
 *     ไบต์ต่อไบต์เหมือนเดิม และได้ `runId` เดิม
 *   - **หนึ่งเทสต่อหนึ่งแถวของตารางเกณฑ์** ทั้งห้าปัจจัย
 *   - **ค่าที่ขาดต้องไม่ถูกกุขึ้น** — `factors.*` เป็น null แล้วระดับมาจากปัจจัยที่มีจริง
 *   - **ศูนย์สถานีคือ run ที่ถูกต้อง** ไม่ใช่ error
 *   - **`provinceCode` คัดลอกมาตรง ๆ และคง null** (ตรวจกับ fixture จริงของ E5.6)
 *   - **`fetchedAt: null` ต้องยังเป็น null** ทั้งใน `inputs` และใน `layer`
 */

const NOW = new Date("2026-08-19T02:30:00.000Z");

function stationRef(over: Partial<StationRef> = {}): StationRef {
  return {
    id: 1,
    nameTh: null,
    nameEn: null,
    lat: 15,
    lon: 100,
    provinceCode: "16",
    provinceNameTh: null,
    amphoeNameTh: null,
    basinNameTh: null,
    agencyShortTh: null,
    ...over,
  };
}

function rain(over: Partial<RainfallObservation> & { id?: number } = {}): RainfallObservation {
  const { id, ...rest } = over;
  return {
    station: stationRef({ id: id ?? 1 }),
    rain24h: null,
    rain1h: null,
    observedAt: "2026-08-19T02:00:00.000Z",
    ...rest,
  };
}

function water(over: Partial<WaterLevelObservation> & { id?: number } = {}): WaterLevelObservation {
  const { id, ...rest } = over;
  return {
    station: stationRef({ id: id ?? 2 }),
    waterlevelMsl: null,
    waterlevelLocalM: null,
    minBankMsl: null,
    groundLevelMsl: null,
    freeboardM: null,
    situationLevel: null,
    storagePercent: null,
    observedAt: "2026-08-19T02:20:00.000Z",
    ...rest,
  };
}

function obs(over: Partial<ExposureObservations> = {}): ExposureObservations {
  return {
    rainfall: [],
    waterlevel: [],
    fetchedAt: "2026-08-19T02:25:00.000Z",
    ...over,
  };
}

const noFactors: ExposureFactors = {
  rain1hMm: null,
  rain24hMm: null,
  freeboardM: null,
  freeboardTrendMPerH: null,
  situationLevel: null,
};

const factorsWith = (over: Partial<ExposureFactors>): ExposureFactors => ({ ...noFactors, ...over });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("namespace ของสถานี", () => {
  it("ไม่รวมฝนกับระดับน้ำเพียงเพราะรหัสตัวเลขตรงกัน", () => {
    const run = computeExposure(
      obs({
        rainfall: [rain({ id: 42, rain24h: 120, observedAt: "2026-08-19T02:00:00.000Z" })],
        waterlevel: [water({ id: 42, freeboardM: 4, observedAt: "2026-08-19T02:20:00.000Z" })],
      }),
      [],
      T,
      NOW,
    );

    expect(run.stations).toHaveLength(2);
    expect(run.stations).toEqual([
      expect.objectContaining({
        stationId: 42,
        stationKind: "rainfall",
        factors: expect.objectContaining({ rain24hMm: 120, freeboardM: null }),
      }),
      expect.objectContaining({
        stationId: 42,
        stationKind: "waterlevel",
        factors: expect.objectContaining({ rain24hMm: null, freeboardM: 4 }),
      }),
    ]);
  });
});

/**
 * หนึ่งเทสต่อหนึ่งแถวของตาราง `docs/methodology/flood-exposure.md` — ถ้าตัวเลขในเอกสาร
 * กับในโค้ดเลื่อนออกจากกัน แถวใดแถวหนึ่งจะแดงทันที
 */
describe("ตารางเกณฑ์: หนึ่งเทสต่อหนึ่งแถว", () => {
  const rows: [string, ExposureFactors, ExposureLevel][] = [
    // rain24hMm — เกณฑ์ฝนของกรมอุตุนิยมวิทยา (≤10 / >10 / >35 / >90 มม./24 ชม.)
    ["rain24hMm ≤ 10 → low", factorsWith({ rain24hMm: 10 }), "low"],
    ["rain24hMm > 10 → elevated", factorsWith({ rain24hMm: 10.1 }), "elevated"],
    ["rain24hMm > 35 → high", factorsWith({ rain24hMm: 35.1 }), "high"],
    ["rain24hMm > 90 → severe", factorsWith({ rain24hMm: 90.1 }), "severe"],
    // rain1hMm — ข้อตกลงของโปรเจกต์ ประกาศไว้ในเอกสาร
    ["rain1hMm ≤ 10 → low", factorsWith({ rain1hMm: 10 }), "low"],
    ["rain1hMm > 10 → elevated", factorsWith({ rain1hMm: 10.1 }), "elevated"],
    ["rain1hMm > 30 → high", factorsWith({ rain1hMm: 30.1 }), "high"],
    ["rain1hMm > 60 → severe", factorsWith({ rain1hMm: 60.1 }), "severe"],
    // freeboardM — เมตรที่เหลือถึงตลิ่งต่ำสุด (ยิ่งน้อยยิ่งหนัก)
    ["freeboardM ≥ 3 → low", factorsWith({ freeboardM: 3 }), "low"],
    ["freeboardM < 3 → elevated", factorsWith({ freeboardM: 2.99 }), "elevated"],
    ["freeboardM < 1 → high", factorsWith({ freeboardM: 0.99 }), "high"],
    ["freeboardM < 0.3 → severe", factorsWith({ freeboardM: 0.29 }), "severe"],
    // freeboardTrendMPerH — อัตราที่ freeboard ลดลง (ค่าลบ = น้ำขึ้นเข้าหาตลิ่ง)
    ["trend ≥ −0.15 → low", factorsWith({ freeboardTrendMPerH: -0.15 }), "low"],
    ["trend < −0.15 → elevated", factorsWith({ freeboardTrendMPerH: -0.151 }), "elevated"],
    ["trend < −0.35 → high", factorsWith({ freeboardTrendMPerH: -0.351 }), "high"],
    ["trend < −0.75 → severe", factorsWith({ freeboardTrendMPerH: -0.751 }), "severe"],
    // situationLevel — ส่งผ่านจาก ThaiWater ตรง ๆ ห้ามคำนวณใหม่
    ["situationLevel 1 → low", factorsWith({ situationLevel: 1 }), "low"],
    ["situationLevel 2 → low", factorsWith({ situationLevel: 2 }), "low"],
    ["situationLevel 3 → low", factorsWith({ situationLevel: 3 }), "low"],
    ["situationLevel 4 → high", factorsWith({ situationLevel: 4 }), "high"],
    ["situationLevel 5 → severe", factorsWith({ situationLevel: 5 }), "severe"],
  ];

  it.each(rows)("%s", (_name, factors, expected) => {
    expect(levelOf(factors, T)).toBe(expected);
  });

  it("ระดับของสถานี = แถบที่สูงที่สุดของปัจจัยเดียว ไม่ใช่คะแนนรวม", () => {
    // ฝนหนักมากอย่างเดียวก็ severe ได้ ทั้งที่ระดับน้ำยังห่างตลิ่ง 8 เมตร
    expect(levelOf(factorsWith({ rain24hMm: 120, freeboardM: 8 }), T)).toBe("severe");
    // และปัจจัยที่เบากว่าไม่เคยดึงระดับลง
    expect(levelOf(factorsWith({ rain24hMm: 0, situationLevel: 4 }), T)).toBe("high");
  });

  it("ตารางเกณฑ์ถูกส่งเข้ามาได้ ไม่ใช่ค่าฝังตาย", () => {
    const strict = { ...T, rain24hMm: [{ level: "severe" as const, above: 1 }] };
    expect(levelOf(factorsWith({ rain24hMm: 2 }), strict)).toBe("severe");
    expect(levelOf(factorsWith({ rain24hMm: 2 }), T)).toBe("low");
  });
});

describe("ค่าที่ขาดต้องไม่ถูกกุขึ้น", () => {
  it("สถานีที่มีแต่ฝน: ปัจจัยฝั่งน้ำเป็น null ไม่ใช่ 0 และระดับมาจากฝนอย่างเดียว", () => {
    const run = computeExposure(obs({ rainfall: [rain({ id: 7, rain24h: 40, rain1h: null })] }), [], T, NOW);
    expect(run.stations).toHaveLength(1);
    expect(run.stations[0].factors).toEqual({
      rain1hMm: null,
      rain24hMm: 40,
      freeboardM: null,
      freeboardTrendMPerH: null,
      situationLevel: null,
    });
    expect(run.stations[0].level).toBe("high");
  });

  it("ไม่มีปัจจัยใดเลย → low พร้อม factors ที่เป็น null ทั้งหมด (อ่านว่า 'ไม่มีข้อมูล')", () => {
    const run = computeExposure(obs({ waterlevel: [water({ id: 9 })] }), [], T, NOW);
    expect(run.stations[0].factors).toEqual(noFactors);
    expect(run.stations[0].level).toBe("low");
  });

  it("ประวัติที่มีจุดเดียว หรือค่าว่าง → freeboardTrendMPerH เป็น null ไม่ใช่ 0", () => {
    const oneOnly: StationHourlyLevels[] = [
      { stationId: 9, points: [{ t: "2026-08-19T02:00:00.000Z", value: 3, discharge: null }] },
    ];
    expect(
      computeExposure(obs({ waterlevel: [water({ id: 9 })] }), oneOnly, T, NOW).stations[0].factors
        .freeboardTrendMPerH,
    ).toBeNull();

    const empties: StationHourlyLevels[] = [
      {
        stationId: 9,
        points: [
          { t: "2026-08-19T01:00:00.000Z", value: null, discharge: null },
          { t: "2026-08-19T02:00:00.000Z", value: null, discharge: null },
        ],
      },
    ];
    expect(
      computeExposure(obs({ waterlevel: [water({ id: 9 })] }), empties, T, NOW).stations[0].factors
        .freeboardTrendMPerH,
    ).toBeNull();
  });

  it("จุดที่อยู่นอกหน้าต่าง historyWindowH ไม่ถูกนับ", () => {
    // 4 ชม. ก่อน `now` อยู่นอกหน้าต่าง 3 ชม. จึงเหลือจุดเดียว → null
    const outside: StationHourlyLevels[] = [
      {
        stationId: 9,
        points: [
          { t: "2026-08-18T22:30:00.000Z", value: 3, discharge: null },
          { t: "2026-08-19T02:00:00.000Z", value: 3.5, discharge: null },
        ],
      },
    ];
    expect(
      computeExposure(obs({ waterlevel: [water({ id: 9 })] }), outside, T, NOW).stations[0].factors
        .freeboardTrendMPerH,
    ).toBeNull();
  });

  it("น้ำขึ้น 0.5 ม. ใน 1 ชม. → trend = −0.5 ม./ชม. (freeboard ลดลง)", () => {
    const rising: StationHourlyLevels[] = [
      {
        stationId: 9,
        points: [
          { t: "2026-08-19T01:00:00.000Z", value: 3, discharge: null },
          { t: "2026-08-19T02:00:00.000Z", value: 3.5, discharge: null },
        ],
      },
    ];
    const run = computeExposure(obs({ waterlevel: [water({ id: 9 })] }), rising, T, NOW);
    expect(run.stations[0].factors.freeboardTrendMPerH).toBe(-0.5);
    expect(run.stations[0].level).toBe("high");
  });

  it("สถานีที่ไม่มีประวัติเลย ก็ยังอยู่ใน run โดย trend เป็น null", () => {
    const run = computeExposure(obs({ waterlevel: [water({ id: 9, freeboardM: 5 })] }), [], T, NOW);
    expect(run.stations[0].factors.freeboardTrendMPerH).toBeNull();
    expect(run.stations[0].level).toBe("low");
  });
});

describe("run ที่ไม่มีสถานีเลย", () => {
  it("เป็น run ที่ถูกต้อง ไม่ใช่ error", () => {
    const run = computeExposure(obs(), [], T, NOW);
    expect(run.stations).toEqual([]);
    expect(run.runId).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]{16}$/);
    expect(run.computedAt).toBe("2026-08-19T02:30:00.000Z");
    expect(run.layer.epistemicClass).toBe("illustrative");
    expect(run.layer.methodologyUrl).toBe("/methodology/flood-exposure");
    // ไม่มีสถานี = ไม่มีเวลาที่วัดจริง ต้องไม่มี observedAt ปลอม ๆ
    expect(run.layer.observedAt).toBeUndefined();
  });
});

describe("เวลา: fetchedAt / computedAt / observedAt เป็นคนละอย่างกัน", () => {
  it("ยังไม่เคยดึง ThaiWater สำเร็จ → fetchedAt คง null ทั้งใน inputs และ layer", () => {
    const run = computeExposure(obs({ fetchedAt: null, rainfall: [rain({ id: 3, rain1h: 1 })] }), [], T, NOW);
    expect(run.inputs.thaiwaterFetchedAt).toBeNull();
    expect(run.layer.fetchedAt).toBeNull();
    // ห้ามหยิบ computedAt มาแทน
    expect(run.layer.fetchedAt).not.toBe(run.computedAt);
    expect(run.stations).toHaveLength(1);
  });

  it("สถานีคนละ namespace เก็บ observedAt ของตัวเอง ไม่ลดความสดของกันและกัน", () => {
    const run = computeExposure(
      obs({
        rainfall: [rain({ id: 5, rain24h: 1, observedAt: "2026-08-19T00:00:00.000Z" })],
        waterlevel: [water({ id: 5, freeboardM: 4, observedAt: "2026-08-19T02:20:00.000Z" })],
      }),
      [],
      T,
      NOW,
    );
    expect(run.stations).toEqual([
      expect.objectContaining({ stationKind: "rainfall", observedAt: "2026-08-19T00:00:00.000Z" }),
      expect.objectContaining({ stationKind: "waterlevel", observedAt: "2026-08-19T02:20:00.000Z" }),
    ]);
  });

  it("layer.observedAt คือค่าที่ใหม่ที่สุดในบรรดาสถานี", () => {
    const run = computeExposure(
      obs({
        rainfall: [
          rain({ id: 1, observedAt: "2026-08-19T00:00:00.000Z" }),
          rain({ id: 2, observedAt: "2026-08-19T02:10:00.000Z" }),
        ],
      }),
      [],
      T,
      NOW,
    );
    expect(run.layer.observedAt).toBe("2026-08-19T02:10:00.000Z");
  });

  it("layer.observedAt ยึดเวลาดิบของการอ่านล่าสุด ไม่ถูกถอยหลังตาม freeboardTrendMPerH ของสถานี", () => {
    // สถานีนี้ถูกถอยหลังไปที่ 01:00 (ดูเทสถัดไป) แต่ตัวชั้นทั้งหมดต้องยังอ่านว่าใหม่ที่สุด
    // คือ 02:20 (เวลาอ่านค่าระดับน้ำจริง) — ไม่ใช่ผลของการถอยหลังระดับสถานี ซึ่งเป็น
    // คนละสัญญากับ `StationExposure.observedAt` (ดูหมายเหตุใน compute.ts)
    const history: StationHourlyLevels[] = [
      {
        stationId: 9,
        points: [
          { t: "2026-08-19T01:00:00.000Z", value: 3, discharge: null },
          { t: "2026-08-19T02:00:00.000Z", value: 3.5, discharge: null },
        ],
      },
    ];
    const run = computeExposure(
      obs({ waterlevel: [water({ id: 9, freeboardM: 1, observedAt: "2026-08-19T02:20:00.000Z" })] }),
      history,
      T,
      NOW,
    );
    expect(run.stations[0].observedAt).toBe("2026-08-19T01:00:00.000Z");
    expect(run.layer.observedAt).toBe("2026-08-19T02:20:00.000Z");
    // `latestObservedAt` ของสถานีเองก็ต้องยึดเวลาดิบเดียวกัน (02:20) ไม่ใช่เวลาที่
    // ถูกถอยหลังแล้ว (01:00) — มันคือสิ่งที่ `scopeToProvince` ใช้คำนวณ
    // `layer.observedAt` ของจังหวัด (review round 6, ดูเทสใน routes.test.ts)
    expect(run.stations[0].latestObservedAt).toBe("2026-08-19T02:20:00.000Z");
  });

  it("สถานีที่ต้นทางไม่ได้ส่งเวลามา → observedAt เป็น null ไม่ใช่ now", () => {
    const run = computeExposure(obs({ rainfall: [rain({ id: 4, observedAt: null })] }), [], T, NOW);
    expect(run.stations[0].observedAt).toBeNull();
  });

  it("มี freeboardTrendMPerH → observedAt ต้องเก่าเท่ากับจุดประวัติที่เก่าที่สุดที่ trend ใช้ ไม่ใช่แค่เวลาของค่าระดับน้ำล่าสุด", () => {
    // ค่าระดับน้ำล่าสุดอ่านตอน 02:20 แต่ trend คำนวณจากจุดย้อนหลังตั้งแต่ 01:00 —
    // run นี้จึง "ไม่ใหม่กว่า" 01:00 แม้ค่าตัวที่แสดง (freeboardM) จะอ่านทีหลังก็ตาม
    const history: StationHourlyLevels[] = [
      {
        stationId: 9,
        points: [
          { t: "2026-08-19T01:00:00.000Z", value: 3, discharge: null },
          { t: "2026-08-19T02:00:00.000Z", value: 3.5, discharge: null },
        ],
      },
    ];
    const run = computeExposure(
      obs({ waterlevel: [water({ id: 9, freeboardM: 1, observedAt: "2026-08-19T02:20:00.000Z" })] }),
      history,
      T,
      NOW,
    );
    expect(run.stations[0].factors.freeboardTrendMPerH).toBe(-0.5);
    expect(run.stations[0].observedAt).toBe("2026-08-19T01:00:00.000Z");
  });

  it("ไม่มี freeboardTrendMPerH (trend เป็น null) → observedAt ยังเป็นเวลาของค่าระดับน้ำล่าสุดตามเดิม", () => {
    const run = computeExposure(
      obs({ waterlevel: [water({ id: 9, freeboardM: 1, observedAt: "2026-08-19T02:20:00.000Z" })] }),
      [],
      T,
      NOW,
    );
    expect(run.stations[0].factors.freeboardTrendMPerH).toBeNull();
    expect(run.stations[0].observedAt).toBe("2026-08-19T02:20:00.000Z");
  });
});

describe("ความเป็น deterministic", () => {
  const observations = obs({
    rainfall: [rain({ id: 12, rain24h: 40 }), rain({ id: 3, rain1h: 12 })],
    waterlevel: [water({ id: 7, freeboardM: 0.5, situationLevel: 4 })],
  });
  const history: StationHourlyLevels[] = [
    {
      stationId: 7,
      points: [
        { t: "2026-08-19T01:00:00.000Z", value: 2, discharge: null },
        { t: "2026-08-19T02:00:00.000Z", value: 2.2, discharge: null },
      ],
    },
  ];

  it("อินพุตเดิม → ผลลัพธ์เดิมทุกไบต์ และ runId เดิม", () => {
    const a = computeExposure(observations, history, T, NOW);
    const b = computeExposure(observations, history, T, NOW);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(b.runId).toBe(a.runId);
  });

  it("สลับลำดับที่ต้นทางส่งมา → runId เดิม (สถานีถูกเรียงตาม namespace แล้ว stationId)", () => {
    const a = computeExposure(observations, history, T, NOW);
    const shuffled = obs({
      rainfall: [...observations.rainfall].reverse(),
      waterlevel: [...observations.waterlevel],
    });
    const b = computeExposure(shuffled, history, T, NOW);
    expect(b.runId).toBe(a.runId);
    expect(b.stations.map((s) => [s.stationKind, s.stationId])).toEqual([
      ["rainfall", 3],
      ["rainfall", 12],
      ["waterlevel", 7],
    ]);
  });

  it("ต้นทางส่งสถานีซ้ำ: สลับลำดับแล้วยังได้ค่าเดิมและ runId เดิม", () => {
    const first = rain({ id: 20, rain24h: 40, observedAt: "2026-08-19T02:00:00.000Z" });
    const second = rain({ id: 20, rain24h: null, observedAt: "2026-08-19T01:00:00.000Z" });
    const a = computeExposure(obs({ rainfall: [first, second] }), [], T, NOW);
    const b = computeExposure(obs({ rainfall: [second, first] }), [], T, NOW);
    expect(a.stations).toHaveLength(1);
    // ระเบียนที่เวลาวัดใหม่กว่าเป็นตัวชนะ ไม่ใช่ระเบียนที่มาทีหลังในอาเรย์
    expect(a.stations[0].factors.rain24hMm).toBe(40);
    expect(b.runId).toBe(a.runId);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("สถานีซ้ำที่เวลาวัดเท่ากันทั้งคู่ ก็ยังให้ผลเดิมทุกลำดับ", () => {
    const x = water({ id: 21, freeboardM: 2, observedAt: "2026-08-19T02:00:00.000Z" });
    const y = water({ id: 21, freeboardM: 0.5, observedAt: "2026-08-19T02:00:00.000Z" });
    const a = computeExposure(obs({ waterlevel: [x, y] }), [], T, NOW);
    const b = computeExposure(obs({ waterlevel: [y, x] }), [], T, NOW);
    expect(a.stations).toHaveLength(1);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(b.runId).toBe(a.runId);
  });

  it("ค่าที่วัดได้เปลี่ยนโดยระดับไม่เปลี่ยน → runId ใหม่ (E10.3 ใช้ข้อนี้ตัดสินว่าจะเผยแพร่)", () => {
    const a = computeExposure(observations, history, T, NOW);
    const nudged = obs({
      ...observations,
      waterlevel: [water({ id: 7, freeboardM: 0.51, situationLevel: 4 })],
    });
    const b = computeExposure(nudged, history, T, NOW);
    expect(b.stations.find((s) => s.stationKind === "waterlevel")?.level).toBe(
      a.stations.find((s) => s.stationKind === "waterlevel")?.level,
    );
    expect(b.runId).not.toBe(a.runId);
  });

  it("เวลาต่างกันโดยเนื้อหาเท่าเดิม → ส่วน hash เท่าเดิม ส่วนเวลาต่างกัน", () => {
    const a = computeExposure(observations, history, T, NOW);
    const later = computeExposure(observations, history, T, new Date("2026-08-19T02:31:00.000Z"));
    expect(later.runId.split("-")[1]).toBe(a.runId.split("-")[1]);
    expect(later.runId.split("-")[0]).toBe("20260819T023100Z");
  });
});

describe("provinceCode: สำเนา ณ เวลาคำนวณ", () => {
  it("คัดลอกมาตรง ๆ จาก fixture ของ ThaiWater (E5.6) รวมถึงรูปแบบสองหลัก", async () => {
    respondJson(rainFixture);
    const rainfall = await fetchRainfall();
    respondJson(waterFixture);
    const waterlevel = await fetchWaterLevel();
    respondJson(graphFixture);
    const points = await fetchWaterLevelHistory(201, 3, NOW.getTime());

    const run = computeExposure(
      { rainfall, waterlevel, fetchedAt: "2026-08-19T02:25:00.000Z" },
      [{ stationId: 201, points }],
      T,
      NOW,
    );
    const byId = new Map(run.stations.map((s) => [s.stationId, s]));
    expect(byId.get(101)?.provinceCode).toBe("50");
    expect(byId.get(201)?.provinceCode).toBe("16");
    expect(byId.get(202)?.provinceCode).toBe("10");
    // min_bank = 0 ที่ต้นทางแปลว่า "ไม่มีค่าสำรวจ" → freeboard ต้องเป็น null ไม่ใช่ 0
    expect(byId.get(202)?.factors.freeboardM).toBeNull();
    expect(byId.get(202)?.level).toBe("low");
    // กราฟย้อนหลังของสถานี 201: 13.41 → 13.42 ใน 10 นาที = ระดับน้ำขึ้น 0.06 ม./ชม.
    expect(byId.get(201)?.factors.freeboardTrendMPerH).toBe(-0.06);
    expect(byId.get(201)?.factors.situationLevel).toBe(2);
  });

  it("สถานีที่ต้นทางไม่มีรหัสจังหวัด → null คงไว้ ไม่เดาจากพิกัด", () => {
    const run = computeExposure(
      obs({ rainfall: [rain({ id: 8, station: stationRef({ id: 8, provinceCode: null }) })] }),
      [],
      T,
      NOW,
    );
    expect(run.stations[0].provinceCode).toBeNull();
  });

  it("รหัสซ้ำข้าม namespace คงจังหวัดและพิกัดของแต่ละระเบียน", () => {
    const run = computeExposure(
      obs({
        rainfall: [rain({ id: 6, station: stationRef({ id: 6, provinceCode: "16", lat: 15, lon: 100 }) })],
        waterlevel: [water({ id: 6, station: stationRef({ id: 6, provinceCode: "17", lat: 16, lon: 101 }) })],
      }),
      [],
      T,
      NOW,
    );
    expect(run.stations).toEqual([
      expect.objectContaining({ stationKind: "rainfall", provinceCode: "16", lat: 15, lon: 100 }),
      expect.objectContaining({ stationKind: "waterlevel", provinceCode: "17", lat: 16, lon: 101 }),
    ]);
  });
});

describe("ไม่มีอะไรใน run ที่อ่านเป็นความน่าจะเป็นหรือการพยากรณ์", () => {
  it("ไม่มีคีย์ไหนชื่อ probability/chance/likelihood/risk/forecast", () => {
    const run = computeExposure(
      obs({
        rainfall: [rain({ id: 1, rain24h: 100 })],
        waterlevel: [water({ id: 2, freeboardM: 0.1, situationLevel: 5 as SituationLevel })],
      }),
      [],
      T,
      NOW,
    );
    const keys = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === "object") {
        for (const [k, val] of Object.entries(v)) {
          keys.add(k);
          walk(val);
        }
      }
    };
    walk(run);
    expect([...keys].filter((k) => /probab|chance|likelihood|risk|forecast|predict/i.test(k))).toEqual([]);
    expect(run.layer.epistemicClass).not.toBe("probabilistic");
  });
});

/**
 * ลำดับที่ต้นทางส่งมาต้องไม่มีผลต่อผลลัพธ์ **ทุกจุด** ไม่ใช่เฉพาะลำดับของสถานี
 *
 * E10.3 ใช้ `runId` ที่เท่ากันเป็นเงื่อนไขว่าจะเผยแพร่ run ใหม่หรือไม่ ถ้าอาเรย์ที่เนื้อหา
 * เท่ากันแต่สลับที่ให้ `runId` ต่างกัน ระบบจะเขียน run ใหม่ทั้งที่ไม่มีอะไรเปลี่ยน และ
 * ที่หนักกว่านั้นคือ **ระดับที่เผยแพร่ของสถานีพลิกได้ตามลำดับของอาเรย์**
 */
describe("deterministic: ลำดับของอินพุตต้องไม่มีผลเลย", () => {
  /** ทุกการเรียงสับเปลี่ยนของอาเรย์ (ใช้กับอาเรย์สั้น ๆ ในเทสเท่านั้น) */
  function permutations<T>(items: readonly T[]): T[][] {
    if (items.length <= 1) return [[...items]];
    const out: T[][] = [];
    for (let i = 0; i < items.length; i++) {
      const rest = [...items.slice(0, i), ...items.slice(i + 1)];
      for (const p of permutations(rest)) out.push([items[i], ...p]);
    }
    return out;
  }

  it("ระเบียนซ้ำสามระเบียน (หนึ่งในนั้นไม่มีเวลาวัด): ทั้งหกลำดับได้ runId เดียว", () => {
    const rows = [
      rain({ id: 20, rain24h: 2, observedAt: null }),
      rain({ id: 20, rain24h: 3, observedAt: "2026-08-19T02:00:00.000Z" }),
      rain({ id: 20, rain24h: 1, observedAt: "2026-08-19T01:00:00.000Z" }),
    ];
    const perms = permutations(rows);
    expect(perms).toHaveLength(6);
    const runs = perms.map((rainfall) => computeExposure(obs({ rainfall }), [], T, NOW));
    expect(new Set(runs.map((r) => r.runId)).size).toBe(1);
    expect(new Set(runs.map((r) => JSON.stringify(r))).size).toBe(1);
    for (const run of runs) {
      expect(run.stations).toHaveLength(1);
      // ระเบียนที่เวลาวัดใหม่ที่สุดชนะ — ไม่ใช่ระเบียนที่ไม่มีเวลา และไม่ใช่ตัวที่มาก่อน/หลัง
      expect(run.stations[0].factors.rain24hMm).toBe(3);
      expect(run.stations[0].observedAt).toBe("2026-08-19T02:00:00.000Z");
    }
  });

  it("ระเบียนที่ไม่มีเวลาวัด (หรือเวลาที่อ่านไม่ออก) แพ้ระเบียนที่มีเวลาเสมอ", () => {
    const timed = rain({ id: 20, rain24h: 3, observedAt: "2026-08-19T02:00:00.000Z" });
    for (const missing of [
      rain({ id: 20, rain24h: 2, observedAt: null }),
      rain({ id: 20, rain24h: 2, observedAt: "ไม่ใช่วันที่" }),
    ]) {
      for (const rainfall of [
        [timed, missing],
        [missing, timed],
      ]) {
        const run = computeExposure(obs({ rainfall }), [], T, NOW);
        expect(run.stations).toHaveLength(1);
        expect(run.stations[0].factors.rain24hMm).toBe(3);
        // สถานีต้องไม่รายงาน observedAt เป็น null ทั้งที่มีค่าที่วัดพร้อมเวลาอยู่ในชุด
        expect(run.stations[0].observedAt).toBe("2026-08-19T02:00:00.000Z");
      }
    }
  });

  it("จุดประวัติที่เวลาเท่ากัน: ทุกลำดับได้ trend เดียวและระดับเดียว", () => {
    const points = [
      { t: "2026-08-19T01:00:00.000Z", value: 2, discharge: null },
      { t: "2026-08-19T01:00:00.000Z", value: 3, discharge: null },
      { t: "2026-08-19T02:00:00.000Z", value: 3.5, discharge: null },
    ];
    const runs = permutations(points).map((p) =>
      computeExposure(obs({ waterlevel: [water({ id: 9 })] }), [{ stationId: 9, points: p }], T, NOW),
    );
    expect(runs).toHaveLength(6);
    expect(new Set(runs.map((r) => r.runId)).size).toBe(1);
    // เวลาแรกใช้ค่าน้อยสุด (2) เวลาสุดท้ายใช้ค่ามากสุด (3.5) → น้ำขึ้น 1.5 ม./ชม.
    expect(runs[0].stations[0].factors.freeboardTrendMPerH).toBe(-1.5);
    expect(new Set(runs.map((r) => r.stations[0].level)).size).toBe(1);
    expect(runs[0].stations[0].level).toBe("severe");
  });

  it("ประวัติของสถานีเดียวกันหลายก้อน: รวมกัน ไม่ทับกัน และลำดับก้อนไม่มีผล", () => {
    const early: StationHourlyLevels = {
      stationId: 9,
      points: [{ t: "2026-08-19T01:00:00.000Z", value: 3, discharge: null }],
    };
    const late: StationHourlyLevels = {
      stationId: 9,
      points: [{ t: "2026-08-19T02:00:00.000Z", value: 3.5, discharge: null }],
    };
    const observations = obs({ waterlevel: [water({ id: 9 })] });
    const a = computeExposure(observations, [early, late], T, NOW);
    const b = computeExposure(observations, [late, early], T, NOW);
    // ถ้าก้อนหลังทับก้อนแรก จะเหลือจุดเดียว → trend เป็น null
    expect(a.stations[0].factors.freeboardTrendMPerH).toBe(-0.5);
    expect(b.runId).toBe(a.runId);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("สลับลำดับทุกอาเรย์แบบสุ่ม (seed คงที่) 200 รอบ → runId เดียว", () => {
    // สุ่มด้วย LCG ที่ seed คงที่ ไม่ใช้ Math.random: เทสความเป็น deterministic
    // ที่ตัวมันเองไม่ deterministic คือเทสที่แดงแบบทำซ้ำไม่ได้
    let seed = 0x2f6e2b1;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x80000000;
    };
    const shuffle = <T>(items: readonly T[]): T[] => {
      const a = [...items];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };

    const rainfall: RainfallObservation[] = [
      rain({ id: 12, rain24h: 40 }),
      rain({ id: 3, rain1h: 12 }),
      rain({ id: 3, rain1h: 9, observedAt: null }),
      rain({ id: 20, rain24h: 2, observedAt: null }),
      rain({ id: 20, rain24h: 3, observedAt: "2026-08-19T02:00:00.000Z" }),
      rain({ id: 20, rain24h: 1, observedAt: "2026-08-19T01:00:00.000Z" }),
      // สถานีเดียวกับระเบียนระดับน้ำข้างล่าง แต่ไม่มีเวลาวัด — ทางรวมข้ามชนิด (`older`)
      // ต้องไม่ทำให้สถานีรายงาน observedAt เป็น null ทั้งที่ฝั่งระดับน้ำมีเวลาจริง
      rain({ id: 9, rain1h: 5, observedAt: null }),
    ];
    const waterlevel: WaterLevelObservation[] = [
      water({ id: 7, freeboardM: 0.5, situationLevel: 4 }),
      water({ id: 9 }),
      water({ id: 9, freeboardM: 2, observedAt: "2026-08-19T02:00:00.000Z" }),
    ];
    const hourlyLevels: StationHourlyLevels[] = [
      {
        stationId: 7,
        points: [
          { t: "2026-08-19T01:00:00.000Z", value: 2, discharge: null },
          { t: "2026-08-19T01:00:00.000Z", value: 2.4, discharge: null },
          { t: "2026-08-19T02:00:00.000Z", value: 2.2, discharge: null },
        ],
      },
      // สองก้อนของสถานี 9 ต้องมีก้อนละ ≥2 จุด ไม่ใช่ก้อนละจุดเดียว มิฉะนั้นเทสนี้จะ
      // มองไม่เห็นบั๊ก "ก้อนหลังทับก้อนแรก": ถ้าทับ แต่ละก้อนเหลือจุดเดียว trend เป็น
      // null ทั้งคู่ ผลจึงเท่ากันโดยบังเอิญ พอแต่ละก้อนมีสองจุดที่ไม่เท่ากัน การทับจะให้
      // trend ของก้อนที่บังเอิญมาทีหลัง ซึ่งเปลี่ยนไปตามลำดับที่สลับ = เทสจับได้
      {
        stationId: 9,
        points: [
          { t: "2026-08-19T00:30:00.000Z", value: 1, discharge: null },
          { t: "2026-08-19T01:30:00.000Z", value: 1.4, discharge: null },
        ],
      },
      {
        stationId: 9,
        points: [
          { t: "2026-08-19T02:30:00.000Z", value: 1.2, discharge: null },
          { t: "2026-08-19T03:30:00.000Z", value: 0.6, discharge: null },
        ],
      },
    ];

    const ids = new Set<string>();
    const bodies = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const run = computeExposure(
        obs({ rainfall: shuffle(rainfall), waterlevel: shuffle(waterlevel) }),
        shuffle(hourlyLevels).map((h) => ({ stationId: h.stationId, points: shuffle(h.points) })),
        T,
        NOW,
      );
      ids.add(run.runId);
      bodies.add(JSON.stringify(run));
      const s9 = run.stations.find((s) => s.stationKind === "rainfall" && s.stationId === 9);
      expect(s9?.factors.rain1hMm).toBe(5);
      // สถานีฝนไม่มีเวลา จึงคง null; เวลาของสถานีน้ำคนละ namespace ห้ามถูกนำมาเติม
      expect(s9?.observedAt).toBeNull();
    }
    expect([...ids]).toHaveLength(1);
    expect([...bodies]).toHaveLength(1);
  });
});
