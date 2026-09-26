import { describe, expect, it } from "vitest";
import {
  apiStationList,
  buildReachLine,
  buildTopology,
  checkStationOrder,
  cumulativeKm,
  gapRanges,
  parseLiveDams,
  parseLiveStations,
  parseSource,
  projectOnLine,
  resolveStation,
  shouldReverse,
  simplifyLine,
  type LonLat,
  type RouteSource,
} from "./build-north-route.js";
import type { ProvincePolygon } from "./provincePolygons.js";

/**
 * เรขาคณิตสังเคราะห์ทั้งหมด (ไม่ใช่ลำน้ำจริง): "แม่น้ำ" สองสายวิ่งตามเส้นลองจิจูด/ละติจูด
 * ให้คิดระยะในหัวได้ — 0.01° ละติจูด ≈ 1.11 กม.
 */

/** source สองลำน้ำ: สาขา "wang" ไหลลง "chao-phraya" */
function source(overrides: Partial<{ trib: string[]; main: string[] }> = {}): RouteSource {
  return {
    reaches: [
      {
        id: "wang",
        nameTh: "สาขา",
        nameEn: "Tributary",
        osmName: "สาขา",
        joinsReachId: "chao-phraya",
        stations: overrides.trib ?? ["T.1", "T.2"],
        citations: ["https://example.org/trib"],
      },
      {
        id: "chao-phraya",
        nameTh: "สายหลัก",
        nameEn: "Main",
        osmName: "สายหลัก",
        joinsReachId: null,
        stations: overrides.main ?? ["M.1", "M.2"],
        citations: ["https://example.org/main"],
      },
    ],
    dams: [],
  };
}

/** สาขาไหลจากเหนือลงใต้ที่ลองจิจูด 100.0 จาก 16.0 ถึง 15.5 แล้วสายหลักไหลต่อจาก 15.5 ลงใต้ถึง 15.0 */
const TRIB_WAYS: LonLat[][] = [
  // ส่งมาในทิศกลับ (ใต้ → เหนือ) โดยตั้งใจ: ทิศต้องถูกตัดสินจากลำน้ำปลายทาง ไม่ใช่ลำดับใน OSM
  [
    [100.0, 15.5],
    [100.0, 15.75],
    [100.0, 16.0],
  ],
];
const MAIN_WAYS: LonLat[][] = [
  [
    [100.0, 15.0],
    [100.0, 15.25],
    [100.0, 15.49],
  ],
];

function liveBody(records: { code: string; id: number; lat: number; lon: number }[]) {
  return {
    waterlevel_data: {
      data: records.map((r) => ({
        station: {
          id: r.id,
          tele_station_oldcode: r.code,
          tele_station_lat: r.lat,
          tele_station_long: r.lon,
          tele_station_name: { th: `สถานี ${r.code}` },
        },
      })),
    },
  };
}

const LIVE = [
  { code: "T.1", id: 11, lat: 15.9, lon: 100.0 },
  { code: "T.2", id: 12, lat: 15.6, lon: 100.001 },
  { code: "M.1", id: 21, lat: 15.4, lon: 100.0 },
  { code: "M.2", id: 22, lat: 15.1, lon: 99.999 },
];

const PROVINCES: ProvincePolygon[] = [
  {
    code: "60",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [99, 15],
          [101, 15],
          [101, 17],
          [99, 17],
          [99, 15],
        ],
      ],
    },
  },
];

function build(src: RouteSource, live = LIVE) {
  return buildTopology({
    source: src,
    waysByReach: new Map([
      ["wang", TRIB_WAYS],
      ["chao-phraya", MAIN_WAYS],
    ]),
    live: parseLiveStations(liveBody(live)),
    dams: new Map(),
    provinces: PROVINCES,
    builtAt: "2026-09-26T03:00:00.000Z",
    osmExtractAt: null,
  });
}

describe("parseSource — ไฟล์ topology เป็นสตริงล้วน", () => {
  it("ยอมรับ source ที่ถูกต้อง", () => {
    expect(parseSource(source()).reaches).toHaveLength(2);
  });

  it("ปฏิเสธตัวเลขที่ไหนก็ได้ในเอกสาร (พิกัด/ค่าที่พิมพ์มือห้ามอยู่ในไฟล์นี้)", () => {
    const bad = { ...source(), reaches: [{ ...source().reaches[0], lat: 15.2 }, source().reaches[1]] };
    expect(() => parseSource(bad)).toThrow(/strings only/);
  });

  it("ปฏิเสธรหัสสถานีซ้ำ และลำน้ำที่ไหลลงลำน้ำที่ไม่มีอยู่", () => {
    expect(() => parseSource(source({ trib: ["T.1", "M.1"] }))).toThrow(/listed twice/);
    const orphan = source();
    orphan.reaches[0] = { ...orphan.reaches[0], joinsReachId: "nan" };
    expect(() => parseSource(orphan)).toThrow(/unknown reach/);
  });
});

describe("resolveStation — รหัส RID ต้องชี้สถานีเดียวในฟีดสด", () => {
  const live = parseLiveStations(
    liveBody([
      ...LIVE,
      { code: "X.9", id: 91, lat: 15, lon: 100 },
      { code: "X.9", id: 92, lat: 15, lon: 100 },
    ]),
  );
  it("ไม่มีในฟีด → ปฏิเสธ", () => {
    expect(() => resolveStation("Q.404", live)).toThrow(/not in the live/);
  });
  it("หนึ่งรหัสหลายสถานี → ปฏิเสธ ไม่เลือกให้เอง", () => {
    expect(() => resolveStation("X.9", live)).toThrow(/ambiguous/);
  });
  it("ตรงตัว → id + พิกัดจากฟีด", () => {
    expect(resolveStation("T.1", live)).toMatchObject({ thaiwaterId: 11, lat: 15.9, lon: 100 });
  });
});

describe("เรขาคณิต", () => {
  it("chainage ตามเส้น + ระยะตั้งฉาก", () => {
    const line: LonLat[] = [
      [100, 16],
      [100, 15],
    ];
    const p = projectOnLine([100.01, 15.5], line);
    expect(p.chainageKm).toBeCloseTo(55.6, 0);
    expect(p.offsetKm).toBeCloseTo(1.07, 1);
    expect(cumulativeKm(line).at(-1)).toBeCloseTo(111.2, 0);
  });

  it("เชื่อมช่องว่างของ OSM ด้วยเส้นตรง แล้วประกาศช่วงนั้นเป็น gap", () => {
    const { line, bridge } = buildReachLine([
      [
        [100, 16],
        [100, 15.8],
      ],
      [
        [100, 15.7],
        [100, 15.5],
      ],
    ]);
    expect(line).toHaveLength(4);
    expect(bridge.filter(Boolean)).toHaveLength(1);
    const gaps = gapRanges(line, bridge);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].toKm - gaps[0].fromKm).toBeCloseTo(11.1, 0);
  });

  it("ช่องว่างที่ยาวเกินเพดานไม่ถูกเชื่อม — ชิ้นเล็กกว่าถูกทิ้งและนับไว้", () => {
    const r = buildReachLine(
      [
        [
          [100, 16],
          [100, 15],
        ],
        [
          [100, 14],
          [100, 13.9],
        ],
      ],
      50,
    );
    expect(r.droppedKm).toBeCloseTo(11.1, 0);
  });

  it("ทิศของสาขามาจากลำน้ำปลายทาง ไม่ใช่ลำดับของ way", () => {
    const trib: LonLat[] = [
      [100, 15.5],
      [100, 16],
    ];
    expect(shouldReverse(trib, { parentLine: MAIN_WAYS[0] })).toBe(true);
    expect(shouldReverse(MAIN_WAYS[0], { tributaryMouths: [[100, 15.5]] })).toBe(true);
  });

  it("ลดรูปแต่เก็บจุดที่บังคับไว้", () => {
    const line: LonLat[] = [
      [100, 16],
      [100, 15.9],
      [100, 15.8],
      [100, 15.7],
    ];
    expect(simplifyLine(line, 0.2)).toHaveLength(2);
    expect(simplifyLine(line, 0.2, [false, true, false, false])).toHaveLength(3);
  });
});

describe("checkStationOrder", () => {
  it("สถานีห่างเส้นเกินเพดาน = ไม่ได้อยู่บนลำน้ำนี้", () => {
    expect(checkStationOrder("ping", [{ code: "P.4A", chainageKm: 10, offsetKm: 4.2 }])[0]).toMatch(/not on this reach/);
  });
  it("chainage ย้อนลำดับที่เขียนไว้ = ปฏิเสธ", () => {
    const errors = checkStationOrder("ping", [
      { code: "A", chainageKm: 20, offsetKm: 0.1 },
      { code: "B", chainageKm: 10, offsetKm: 0.1 },
    ]);
    expect(errors[0]).toMatch(/contradicts the listed order/);
  });
});

describe("buildTopology", () => {
  it("ประกอบผัง: ทิศถูก, chainage เรียง, จุดบรรจบ, จังหวัด, descriptor static-reference", () => {
    const t = build(parseSource(source()));
    const trib = t.reaches.find((r) => r.id === "wang")!;
    // สาขาถูกกลับทิศให้ไหลจากเหนือลงใต้ (ต้นเส้น = 16.0)
    expect(trib.polyline[0][1]).toBe(16);
    expect(trib.joinsReachId).toBe("chao-phraya");
    expect(trib.joinsAtKm).toBeCloseTo(0, 0);
    const main = t.reaches.find((r) => r.id === "chao-phraya")!;
    expect(main.polyline[0][1]).toBeCloseTo(15.49, 5);
    expect(t.stations.map((s) => s.ridCode)).toEqual(["T.1", "T.2", "M.1", "M.2"]);
    const [t1, t2] = t.stations;
    expect(t2.chainageKm).toBeGreaterThan(t1.chainageKm);
    expect(t1.provinceCode).toBe("60");
    expect(main.upstreamProvinceCodes).toEqual(["60"]);
    expect(t.layer).toMatchObject({ epistemicClass: "static-reference", fetchedAt: "2026-09-26T03:00:00.000Z", publishedAt: null });
    expect(t.layer.sourceIds).toEqual(["osm", "thaiwater"]);
    expect(apiStationList(t).stations[0]).toEqual({ ridCode: "T.1", thaiwaterId: 11, reachId: "wang" });
  });

  it("ปฏิเสธเมื่อลำดับที่เขียนไว้ขัดกับเส้น", () => {
    expect(() => build(parseSource(source({ trib: ["T.2", "T.1"] })))).toThrow(/contradicts the listed order/);
  });

  it("ปฏิเสธเมื่อรหัสไม่อยู่ในฟีดสด", () => {
    expect(() => build(parseSource(source({ main: ["M.1", "M.404"] })))).toThrow(/M\.404 is not in the live/);
  });

  it("ปฏิเสธสถานีที่ห่างเส้นลำน้ำ", () => {
    const live = LIVE.map((s) => (s.code === "M.2" ? { ...s, lon: 100.1 } : s));
    expect(() => build(parseSource(source()), live)).toThrow(/M\.2 is .* km from the river line/);
  });
});

describe("parseLiveDams", () => {
  it("รวม id ของแถวรายวันและรายชั่วโมงของเขื่อนชื่อเดียวกัน (รายวันก่อน)", () => {
    const dams = parseLiveDams({
      data: {
        dam_hourly: [{ dam: { id: 43, dam_name: { th: "ภูมิพล" }, dam_lat: 17.2, dam_long: 98.9 } }],
        dam_daily: [{ dam: { id: 1, dam_name: { th: "ภูมิพล" }, dam_lat: 17.2, dam_long: 98.9 } }],
      },
    });
    expect(dams.get("ภูมิพล")?.ids).toEqual([1, 43]);
  });
});
