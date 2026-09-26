import { describe, expect, it } from "vitest";
import {
  clipPolylineToBbox,
  cumulativeKm,
  densify,
  flowSpeedMPerS,
  haversineKm,
  routeSpanAt,
  type LonLat,
} from "./routeRibbon";
import { flowDurationS } from "./northRoute";

const BOX = { minLon: 100, maxLon: 101, minLat: 13, maxLat: 14 };

describe("clipPolylineToBbox", () => {
  it("เส้นที่อยู่ในกรอบทั้งเส้นคงเดิม พร้อมระยะสะสมจากต้นเส้น", () => {
    const line: LonLat[] = [
      [100.2, 13.2],
      [100.4, 13.5],
      [100.6, 13.8],
    ];
    const runs = clipPolylineToBbox(line, BOX);
    expect(runs).toHaveLength(1);
    expect(runs[0].points).toEqual(line);
    expect(runs[0].km).toEqual(cumulativeKm(line));
  });

  it("เส้นที่ไหลเข้ามาจากนอกกรอบ: จุดแรกคือจุดตัดขอบ และระยะนับต่อจากต้นเส้นเดิม", () => {
    const line: LonLat[] = [
      [100.5, 14.5], // นอกกรอบ (เหนือ)
      [100.5, 13.5],
      [100.5, 12.5], // นอกกรอบ (ใต้)
    ];
    const runs = clipPolylineToBbox(line, BOX);
    expect(runs).toHaveLength(1);
    const [run] = runs;
    expect(run.points[0][1]).toBeCloseTo(14, 9);
    expect(run.points[run.points.length - 1][1]).toBeCloseTo(13, 9);
    const full = cumulativeKm(line);
    // ครึ่งช่วงแรกอยู่นอกกรอบ → ระยะที่ขอบบน ≈ ครึ่งหนึ่งของช่วงแรก
    expect(run.km[0]).toBeCloseTo(full[1] / 2, 6);
    expect(run.km[1]).toBeCloseTo(full[1], 9);
  });

  it("เส้นที่ออกนอกกรอบแล้ววกกลับเข้ามาได้สองช่วงแยกกัน (ไม่ลากเส้นข้ามส่วนที่อยู่นอก)", () => {
    const line: LonLat[] = [
      [100.2, 13.5],
      [101.5, 13.5],
      [101.5, 13.7],
      [100.2, 13.7],
    ];
    const runs = clipPolylineToBbox(line, BOX);
    expect(runs).toHaveLength(2);
    expect(runs[0].points[runs[0].points.length - 1][0]).toBeCloseTo(101, 9);
    expect(runs[1].points[0][0]).toBeCloseTo(101, 9);
    expect(runs[1].km[0]).toBeGreaterThan(runs[0].km[runs[0].km.length - 1]);
  });

  it("เส้นที่ไม่แตะกรอบเลย → ว่าง", () => {
    expect(
      clipPolylineToBbox(
        [
          [98, 18],
          [99, 17],
        ],
        BOX,
      ),
    ).toEqual([]);
  });
});

describe("routeSpanAt", () => {
  const stops = [
    { ridCode: "C.35", chainageKm: 224.6 },
    { ridCode: "C.12", chainageKm: 318.8 },
  ];
  it("หาสถานีต้นน้ำ/ท้ายน้ำของช่วง และสถานีที่ใกล้ที่สุด", () => {
    expect(routeSpanAt(250, stops)).toEqual({ nearestCode: "C.35", downstreamCode: "C.12", upstreamCode: "C.35" });
    expect(routeSpanAt(300, stops)).toEqual({ nearestCode: "C.12", downstreamCode: "C.12", upstreamCode: "C.35" });
  });
  it("ก่อนสถานีแรก = ไม่มีต้นน้ำ; เลยสถานีสุดท้าย = ไม่มีท้ายน้ำ (segmentFlow จะไม่ข้ามไปหาสถานีไกลกว่านั้น)", () => {
    expect(routeSpanAt(10, stops)).toEqual({ nearestCode: "C.35", downstreamCode: "C.35", upstreamCode: null });
    expect(routeSpanAt(360, stops)).toEqual({ nearestCode: "C.12", downstreamCode: null, upstreamCode: "C.12" });
  });
  it("reach ที่ไม่มีสถานี → ไม่มีอะไรคุมเลย (สีเทา นิ่ง)", () => {
    expect(routeSpanAt(5, [])).toEqual({ nearestCode: null, downstreamCode: null, upstreamCode: null });
  });
});

describe("densify / flowSpeedMPerS / haversine", () => {
  it("แทรกจุดให้ห่างไม่เกิน maxStep พร้อมระยะเชิงเส้น", () => {
    const d = densify(
      [
        [0, 0],
        [1000, 0],
      ],
      [0, 1],
      300,
    );
    expect(d.xz).toHaveLength(5);
    expect(d.km[2]).toBeCloseTo(0.5, 9);
  });
  it("ความเร็วลายไหล = รอบลายต่อ flowDurationS เดียวกับแผง; ไม่มีค่า = นิ่ง", () => {
    const dur = flowDurationS(50)!;
    expect(flowSpeedMPerS(dur, 1000)).toBeCloseTo(1000 / dur, 9);
    expect(flowSpeedMPerS(flowDurationS(150)!, 1000)).toBeGreaterThan(flowSpeedMPerS(dur, 1000));
    expect(flowSpeedMPerS(null, 1000)).toBe(0);
    expect(flowSpeedMPerS(flowDurationS(null), 1000)).toBe(0);
  });
  it("haversine ~111 กม. ต่อองศาละติจูด", () => {
    expect(haversineKm([100, 13], [100, 14])).toBeCloseTo(111.2, 0);
  });
});
