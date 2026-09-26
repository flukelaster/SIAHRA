import { describe, expect, it } from "vitest";
import type { NorthRouteStationState, NorthRouteTopology, WaterLevelObservation } from "@siahra/shared-types";
import topologyJson from "../../public/rivers/north-route.json";
import {
  FLOW_PCT_MAX,
  flowDurationS,
  freeboardTrendMPerH,
  layoutSchematic,
  nodeColor,
  nodeReading,
  peaks48h,
  percentOfQmax,
  pointAt,
  routeView,
  segmentFlow,
  STALE_OBS_MS,
  type NodeReading,
} from "./northRoute";

const NOW = Date.parse("2026-09-26T06:00:00.000Z");
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

function latest(over: Partial<WaterLevelObservation> = {}): WaterLevelObservation {
  return {
    station: {
      id: 2795,
      nameTh: "ค่ายจิรประวัติ",
      nameEn: null,
      lat: 15.7,
      lon: 100.1,
      provinceCode: "60",
      provinceNameTh: null,
      amphoeNameTh: null,
      basinNameTh: null,
      agencyShortTh: null,
      ridCode: "C.2",
      subBasinId: 240,
      isKeyStation: true,
    },
    waterlevelMsl: 22.25,
    waterlevelLocalM: null,
    minBankMsl: 25.7,
    groundLevelMsl: null,
    freeboardM: 3.45,
    situationLevel: 3,
    storagePercent: null,
    dischargeM3s: 1824,
    qmaxM3s: 3735,
    criticalLevelMsl: 26.2,
    observedAt: iso(NOW - H),
    ...over,
  };
}

/** C.2 รายชั่วโมง: ระดับขึ้น 0.1 ม./ชม., อัตราการไหลยอดที่ −10 ชม. */
function station(over: Partial<NorthRouteStationState> = {}): NorthRouteStationState {
  const history48h = Array.from({ length: 49 }, (_, i) => {
    const t = NOW - (48 - i) * H;
    return { t: iso(t), value: 20 + i * 0.1, discharge: i === 38 ? 2000 : 1500 + i };
  });
  return { ridCode: "C.2", thaiwaterId: 2795, reachId: "chao-phraya", latest: latest(), datum: "msl", history48h, historyFetchedAt: iso(NOW - 20 * 60_000), ...over };
}

describe("routeView — แผงเดินตาม atIso", () => {
  it("สด / ภายใน 48 ชม. / นอกช่วง", () => {
    expect(routeView(null, NOW)).toEqual({ mode: "live" });
    expect(routeView(iso(NOW - 47 * H), NOW)).toEqual({ mode: "at", atMs: NOW - 47 * H });
    expect(routeView(iso(NOW - 49 * H), NOW)).toEqual({ mode: "outside" });
  });
});

describe("pointAt", () => {
  it("จุดล่าสุดที่ไม่เกินเวลาที่เลือก และไม่เก่ากว่าเพดาน", () => {
    const h = station().history48h;
    expect(pointAt(h, NOW - 5.5 * H)?.t).toBe(iso(NOW - 6 * H));
    expect(pointAt([{ t: iso(NOW - 5 * H), value: 1, discharge: null }], NOW)).toBeNull();
  });
});

describe("freeboardTrendMPerH — สูตรเดียวกับ apps/api/src/exposure/compute.ts", () => {
  it("น้ำขึ้น 0.1 ม./ชม. = freeboard −0.1 ม./ชม.", () => {
    expect(freeboardTrendMPerH(station().history48h, NOW)).toBe(-0.1);
  });
  it("น้อยกว่าสองจุดในหน้าต่าง → null (ไม่ต่อเส้นเอง)", () => {
    expect(freeboardTrendMPerH([{ t: iso(NOW - H), value: 1, discharge: null }], NOW)).toBeNull();
  });
  it("เวลาเท่ากัน: เรียงด้วย (เวลา, ค่า) — จุดแรกค่าน้อยสุด จุดท้ายค่ามากสุด", () => {
    const pts = [
      { t: iso(NOW), value: 2, discharge: null },
      { t: iso(NOW - 2 * H), value: 1.5, discharge: null },
      { t: iso(NOW), value: 1, discharge: null },
      { t: iso(NOW - 2 * H), value: 1, discharge: null },
    ];
    expect(freeboardTrendMPerH(pts, NOW)).toBe(-0.5);
  });
});

describe("peaks48h — ยอดที่เกิดแล้วเท่านั้น", () => {
  it("ระดับสูงสุด = ปลายหน้าต่าง, อัตราการไหลสูงสุด = ตอน −10 ชม.", () => {
    const p = peaks48h(station().history48h, NOW);
    expect(p.level?.t).toBe(iso(NOW));
    expect(p.discharge).toEqual({ value: 2000, t: iso(NOW - 10 * H) });
  });
  it("หน้าต่างจบที่เวลาที่เลือก — ไม่มีจุดหลังเวลานั้นหลุดเข้ามา", () => {
    const p = peaks48h(station().history48h, NOW - 12 * H);
    expect(Date.parse(p.level!.t)).toBeLessThanOrEqual(NOW - 12 * H);
    expect(p.discharge?.value).not.toBe(2000);
  });
});

describe("percentOfQmax", () => {
  it("ต้องมีทั้งสองค่าและ qmax > 0", () => {
    expect(percentOfQmax(1824, 3735)).toBe(48.8);
    expect(percentOfQmax(null, 3735)).toBeNull();
    expect(percentOfQmax(100, null)).toBeNull();
    expect(percentOfQmax(100, 0)).toBeNull();
  });
});

describe("nodeReading", () => {
  it("สด: ค่าล่าสุด + % qmax + ระยะถึงระดับวิกฤต + แนวโน้ม", () => {
    const r = nodeReading(station(), { mode: "live" }, NOW);
    expect(r).toMatchObject({
      level: 22.25,
      dischargeM3s: 1824,
      qmaxPct: 48.8,
      freeboardM: 3.45,
      criticalMarginM: 3.95,
      situationLevel: 3,
      missing: false,
      stale: false,
      trendMPerH: -0.1,
    });
  });

  it("ภายใน 48 ชม.: ค่าจากประวัติ ไม่มีระดับสถานการณ์ สีจากระยะต่ำกว่าตลิ่ง", () => {
    const r = nodeReading(station(), { mode: "at", atMs: NOW - 10 * H }, NOW);
    expect(r.situationLevel).toBeNull();
    expect(r.observedAt).toBe(iso(NOW - 10 * H));
    expect(r.dischargeM3s).toBe(2000);
    expect(r.level).toBeCloseTo(23.8, 6);
    expect(r.freeboardM).toBeCloseTo(25.7 - 23.8, 3);
    expect(nodeColor(r)).toBe("#38bdf8");
  });

  it("นอกช่วง 48 ชม.: ไม่มีค่าเลย (ไม่แสดงค่าปัจจุบันแทน)", () => {
    const r = nodeReading(station(), { mode: "outside" }, NOW);
    expect(r.missing).toBe(true);
    expect(r.level).toBeNull();
    expect(r.observedAt).toBeNull();
  });

  it("ค่าล่าสุดเก่ากว่าเพดาน = ค้าง (หรี่) แต่ยังแสดงอยู่", () => {
    const r = nodeReading(station({ latest: latest({ observedAt: iso(NOW - STALE_OBS_MS - 60_000) }) }), { mode: "live" }, NOW);
    expect(r.stale).toBe(true);
    expect(r.missing).toBe(false);
  });

  it("ไม่มีเวลาตรวจวัด = ค้าง ไม่ใช่ 'ตอนนี้'", () => {
    const r = nodeReading(station({ latest: latest({ observedAt: null }) }), { mode: "live" }, NOW);
    expect(r.stale).toBe(true);
    expect(r.observedAt).toBeNull();
  });

  it("สถานีไม่อยู่ในฟีด / แถวก่อน E16 ที่ไม่มีฟิลด์ใหม่", () => {
    expect(nodeReading(station({ latest: null }), { mode: "live" }, NOW).missing).toBe(true);
    const legacy = latest();
    delete (legacy as Partial<WaterLevelObservation>).dischargeM3s;
    delete (legacy as Partial<WaterLevelObservation>).qmaxM3s;
    const r = nodeReading(station({ latest: legacy }), { mode: "live" }, NOW);
    expect(r.dischargeM3s).toBeNull();
    expect(r.qmaxPct).toBeNull();
  });
});

describe("layoutSchematic — ผังจริงที่ ETL สร้าง", () => {
  const topology = topologyJson as unknown as NorthRouteTopology;
  const s = layoutSchematic(topology);
  const y = (code: string) => s.nodes.find((n) => n.ridCode === code)!.y;

  it("ทุกสถานีมีโหนด และทุกโหนดอยู่ในกรอบ", () => {
    expect(s.nodes).toHaveLength(topology.stations.length);
    for (const n of s.nodes) {
      expect(n.y).toBeGreaterThan(0);
      expect(n.y).toBeLessThan(s.height);
      expect(n.x).toBeGreaterThan(0);
      expect(n.x).toBeLessThan(s.width);
    }
  });

  it("ต้นน้ำอยู่บน ท้ายน้ำอยู่ล่าง: เรียงตาม chainage ในทุก reach, สาขาอยู่เหนือจุดบรรจบ, เจ้าพระยาอยู่ใต้", () => {
    for (const reach of topology.reaches) {
      const ys = topology.stations.filter((st) => st.reachId === reach.id).map((st) => y(st.ridCode));
      expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    }
    expect(y("P.17")).toBeLessThan(s.confluence.y);
    expect(y("N.67")).toBeLessThan(s.confluence.y);
    expect(y("C.2")).toBeGreaterThan(s.confluence.y);
    expect(y("C.35")).toBeGreaterThan(y("C.2"));
    expect(y("C.12")).toBeGreaterThan(y("C.35"));
  });

  it("ปลายทางของผัง = สถานีท้ายสุดของเจ้าพระยา คือ C.12 สามเสน ในกรุงเทพฯ", () => {
    expect(s.terminalCode).toBe("C.12");
    const terminal = topology.stations.find((st) => st.ridCode === s.terminalCode)!;
    expect(terminal.provinceCode).toBe("10");
    expect(Math.max(...s.nodes.map((n) => n.y))).toBe(y("C.12"));
  });

  it("ช่วงเส้นประ: ต่อกันเป็นลำดับโหนดของแต่ละลำน้ำ ปลายตรงกับโหนด และ y เพิ่มขึ้น (ทิศ = ท้ายน้ำ)", () => {
    const parse = (d: string) =>
      d.split(" ").map((tok) => {
        const [x, yy] = tok.slice(1).split(",").map(Number);
        return { x, y: yy };
      });
    const node = (code: string) => s.nodes.find((n) => n.ridCode === code)!;
    for (const reach of topology.reaches) {
      const segs = s.segments.filter((g) => g.reachId === reach.id);
      const codes = topology.stations
        .filter((st) => st.reachId === reach.id)
        .sort((a, b) => a.chainageKm - b.chainageKm)
        .map((st) => st.ridCode);
      // หัวเส้น → สถานีแรก → … → สถานีสุดท้าย → ปาก
      expect(segs.map((g) => g.downstreamCode)).toEqual([...codes, null]);
      expect(segs.map((g) => g.upstreamCode)).toEqual([null, ...codes]);
      for (const g of segs) {
        const pts = parse(g.d);
        for (let i = 1; i < pts.length; i++) expect(pts[i].y).toBeGreaterThanOrEqual(pts[i - 1].y);
        if (g.upstreamCode) {
          expect(pts[0].x).toBeCloseTo(node(g.upstreamCode).x, 0);
          expect(pts[0].y).toBeCloseTo(node(g.upstreamCode).y, 0);
        }
        if (g.downstreamCode) {
          expect(pts[pts.length - 1].x).toBeCloseTo(node(g.downstreamCode).x, 0);
          expect(pts[pts.length - 1].y).toBeCloseTo(node(g.downstreamCode).y, 0);
        }
      }
    }
  });
});

describe("flowDurationS — ความเร็วเส้นประจาก % ของความจุที่วัดได้", () => {
  it("ไม่มีค่า / ไม่ใช่ตัวเลข / ไม่มีการไหล / ไหลย้อน → null (ไม่เคลื่อนไหว)", () => {
    expect(flowDurationS(null)).toBeNull();
    expect(flowDurationS(Number.NaN)).toBeNull();
    expect(flowDurationS(Number.POSITIVE_INFINITY)).toBeNull();
    expect(flowDurationS(0)).toBeNull();
    expect(flowDurationS(-12)).toBeNull();
  });

  it("% มากขึ้น = รอบสั้นลง (เร็วขึ้น) และหนีบที่ FLOW_PCT_MAX", () => {
    const d10 = flowDurationS(10)!;
    const d50 = flowDurationS(50)!;
    const d100 = flowDurationS(100)!;
    expect(d10).toBeGreaterThan(d50);
    expect(d50).toBeGreaterThan(d100);
    expect(flowDurationS(FLOW_PCT_MAX)).toBe(flowDurationS(FLOW_PCT_MAX * 3));
    expect(flowDurationS(0.001)).toBeLessThanOrEqual(2.5);
    expect(flowDurationS(FLOW_PCT_MAX)).toBeGreaterThan(0.3);
  });

  it("ปัดสองตำแหน่ง (ค่าเดิม = สไตล์เดิม ไม่แตะ DOM)", () => {
    const d = flowDurationS(37.3)!;
    expect(Math.round(d * 100) / 100).toBe(d);
  });
});

describe("segmentFlow — ค่าจากปลายท้ายน้ำ ไม่มีจึงใช้ปลายต้นน้ำของช่วงเดียวกัน", () => {
  const reading = (over: Partial<NodeReading>): NodeReading => ({
    level: 1,
    levelDatum: "msl",
    dischargeM3s: 100,
    qmaxPct: 50,
    freeboardM: 1,
    criticalMarginM: null,
    situationLevel: null,
    observedAt: iso(NOW),
    trendMPerH: null,
    missing: false,
    stale: false,
    ...over,
  });

  it("ใช้สถานีปลายท้ายน้ำก่อน", () => {
    const m = new Map([
      ["A", reading({ qmaxPct: 20 })],
      ["B", reading({ qmaxPct: 90 })],
    ]);
    expect(segmentFlow({ upstreamCode: "A", downstreamCode: "B" }, m)).toEqual({
      durationS: flowDurationS(90),
      fromCode: "B",
      stale: false,
    });
  });

  it("ปลายท้ายน้ำไม่มีอัตราการไหล (เช่น C.12) → ใช้ปลายต้นน้ำ", () => {
    const m = new Map([
      ["C.35", reading({ qmaxPct: 99 })],
      ["C.12", reading({ dischargeM3s: null, qmaxPct: null })],
    ]);
    expect(segmentFlow({ upstreamCode: "C.35", downstreamCode: "C.12" }, m)?.fromCode).toBe("C.35");
  });

  it("ทั้งสองปลายไม่มีค่า หรือไม่มีสถานีเลย → null; ค่าค้างยังไหลแต่ถูกติดธง stale", () => {
    const none = new Map([
      ["A", reading({ missing: true, qmaxPct: null })],
      ["B", reading({ qmaxPct: null })],
    ]);
    expect(segmentFlow({ upstreamCode: "A", downstreamCode: "B" }, none)).toBeNull();
    expect(segmentFlow({ upstreamCode: null, downstreamCode: null }, none)).toBeNull();
    const stale = new Map([["B", reading({ qmaxPct: 40, stale: true })]]);
    expect(segmentFlow({ upstreamCode: null, downstreamCode: "B" }, stale)?.stale).toBe(true);
  });
});
