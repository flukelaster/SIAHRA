import { describe, expect, it } from "vitest";
import {
  BASEMAP_BOUNDS,
  beyondBasemap,
  boundsOf,
  createProjection,
  fitBounds,
  geometryRings,
  kmToDegrees,
  KM_PER_DEG_LAT,
  placeLabels,
  polylinePath,
  ringsBounds,
  ringsPath,
  stormContentBounds,
  THAILAND_BOUNDS,
} from "./stormMap";
import type { StormTrack } from "@siahra/shared-types";

describe("kmToDegrees", () => {
  it("ที่เส้นศูนย์สูตร 1° ละติจูด = 1° ลองจิจูด", () => {
    const r = kmToDegrees(KM_PER_DEG_LAT, 0);
    expect(r.dLat).toBeCloseTo(1, 6);
    expect(r.dLon).toBeCloseTo(1, 6);
  });

  it("แก้ลองจิจูดด้วย cos(lat): ที่ 60° รัศมีเดียวกันกินลองจิจูดเป็นสองเท่า", () => {
    const r = kmToDegrees(KM_PER_DEG_LAT, 60);
    expect(r.dLat).toBeCloseTo(1, 6);
    expect(r.dLon).toBeCloseTo(2, 6);
  });

  it("ไม่คืน Infinity ใกล้ขั้วโลก", () => {
    expect(Number.isFinite(kmToDegrees(100, 90).dLon)).toBe(true);
  });
});

describe("createProjection", () => {
  const bounds = { minLon: 100, minLat: 0, maxLon: 120, maxLat: 20 };
  const proj = createProjection(bounds, 400);

  it("มุมซ้ายบน = (0,0), มุมขวาล่าง = (width,height)", () => {
    expect(proj.project(100, 20)).toEqual({ x: 0, y: 0 });
    const br = proj.project(120, 0);
    expect(br.x).toBeCloseTo(400, 6);
    expect(br.y).toBeCloseTo(proj.height, 6);
  });

  it("ความสูงเป็นไปตามสัดส่วนจริงหลังคูณ cos ของละติจูดกลาง", () => {
    const k = Math.cos((10 * Math.PI) / 180);
    expect(proj.height).toBeCloseTo(400 / k, 6);
  });

  it("วงกลม กม. บนจอเกือบกลมที่ละติจูดกลาง (rx ≈ ry) และรีขึ้นเมื่อห่างออกไป", () => {
    const mid = proj.radiusPx(200, 10);
    expect(mid.rx / mid.ry).toBeCloseTo(1, 6);
    const north = proj.radiusPx(200, 30);
    expect(north.rx).toBeGreaterThan(north.ry);
  });
});

describe("paths", () => {
  const proj = createProjection({ minLon: 0, minLat: 0, maxLon: 10, maxLat: 10 }, 100);

  it("polylinePath: M แล้ว L ตามลำดับจุด; น้อยกว่า 2 จุด = ไม่มีเส้น", () => {
    const d = polylinePath(
      [
        { lon: 0, lat: 10 },
        { lon: 5, lat: 10 },
      ],
      proj,
    );
    expect(d.startsWith("M0,0 L")).toBe(true);
    expect(polylinePath([{ lon: 1, lat: 1 }], proj)).toBe("");
  });

  it("ringsPath ปิดทุกวงด้วย Z และข้ามวงเสื่อม", () => {
    const d = ringsPath(
      [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
        [
          [0, 0],
          [1, 1],
        ],
      ],
      proj,
    );
    expect(d.match(/Z/g)?.length).toBe(1);
  });

  it("geometryRings แบน MultiPolygon (กรวย GDACS อาจเป็นหลายก้อน)", () => {
    const rings = geometryRings({
      type: "MultiPolygon",
      coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[5, 5], [6, 5], [6, 6], [5, 5]]]],
    });
    expect(rings).toHaveLength(2);
    expect(ringsBounds(rings)).toEqual({ minLon: 0, minLat: 0, maxLon: 6, maxLat: 6 });
    expect(geometryRings(null)).toEqual([]);
  });
});

describe("fitBounds", () => {
  it("รวมประเทศไทยเสมอ แม้เนื้อหาจะอยู่ไกล", () => {
    const content = boundsOf([{ lon: 140, lat: 20 }]);
    const view = fitBounds(content);
    expect(view.minLon).toBeLessThanOrEqual(THAILAND_BOUNDS.minLon);
    expect(view.maxLon).toBeGreaterThanOrEqual(140);
  });

  it("ขยายเท่านั้น — ขอบวงกลม 70 % ที่ไกลที่สุดยังอยู่ในกรอบ", () => {
    // จุดจริงของ Surigae +117 ชม. (JMA 2026-09-26): 31.9°N 138.5°E รัศมี 460 กม.
    const content = boundsOf([{ lon: 138.5, lat: 31.9, radiusKm: 460 }]);
    const view = fitBounds(content);
    const r = kmToDegrees(460, 31.9);
    expect(view.maxLat).toBeGreaterThanOrEqual(31.9 + r.dLat);
    expect(view.maxLon).toBeGreaterThanOrEqual(138.5 + r.dLon);
    // และบอกว่าเลยขอบแผนที่ฐาน (35°N) ไม่ใช่ปล่อยให้อ่านเป็นทะเล
    expect(beyondBasemap(content)).toBe(true);
  });

  it("คุมสัดส่วนภาพไว้ในช่วง", () => {
    const wide = fitBounds(boundsOf([{ lon: 80, lat: 15 }, { lon: 150, lat: 16 }]), { minAspect: 0.5, maxAspect: 1 });
    const k = Math.cos((((wide.minLat + wide.maxLat) / 2) * Math.PI) / 180);
    const aspect = (wide.maxLat - wide.minLat) / ((wide.maxLon - wide.minLon) * k);
    expect(aspect).toBeGreaterThanOrEqual(0.5 - 1e-9);
    expect(aspect).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("ไม่มีเนื้อหา = กรอบรอบประเทศไทย และไม่เลยแผนที่ฐาน", () => {
    const view = fitBounds(null);
    expect(view.minLon).toBeLessThan(THAILAND_BOUNDS.minLon);
    expect(beyondBasemap(null)).toBe(false);
    expect(beyondBasemap(BASEMAP_BOUNDS)).toBe(false);
  });
});

describe("placeLabels", () => {
  it("ทุกจุดได้ป้ายเสมอ — ที่แคบจนข้อความเต็มไม่พอ ถอยเหลือแค่ลำดับ ไม่หายไป", () => {
    const anchors = [0, 1, 2, 3].map(() => ({ x: 30, y: 15, fullWidth: 50, shortWidth: 6 }));
    const placed = placeLabels(anchors, { width: 60, height: 30 });
    expect(placed.map((p) => p.index)).toEqual([0, 1, 2, 3]);
    expect(placed.some((p) => !p.full)).toBe(true);
  });

  it("จุดที่ห่างกันได้ป้ายเต็มติดจุด ไม่มีเส้นนำ", () => {
    const anchors = [
      { x: 10, y: 20, fullWidth: 40, shortWidth: 8 },
      { x: 10, y: 80, fullWidth: 40, shortWidth: 8 },
    ];
    const placed = placeLabels(anchors, { width: 200, height: 100 });
    expect(placed.every((p) => p.full && !p.leader)).toBe(true);
  });

  it("ป้ายไม่ทับกัน ไม่ทับสิ่งกีดขวาง และที่ย้ายห่างจากจุดได้เส้นนำ", () => {
    const anchors = [0, 1, 2].map(() => ({ x: 100, y: 50, fullWidth: 40, shortWidth: 8 }));
    const obstacle = { x: 104, y: 40, w: 60, h: 20 }; // บังทางขวาทั้งแถบ
    const placed = placeLabels(anchors, { width: 200, height: 100 }, 10, [obstacle]);
    const boxes = placed.map((p) => p.box);
    const hit = (a: typeof obstacle, b: typeof obstacle) =>
      a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (let i = 0; i < boxes.length; i++) {
      expect(hit(boxes[i], obstacle)).toBe(false);
      for (let j = i + 1; j < boxes.length; j++) expect(hit(boxes[i], boxes[j])).toBe(false);
    }
    expect(placed.some((p) => p.leader)).toBe(true);
  });
});

describe("stormContentBounds", () => {
  it("รวมทุกจุด ขอบวงกลม และกรวย MultiPolygon", () => {
    const s = {
      past: [{ observedAt: null, lat: 10, lon: 120, windKt: null, pressureHpa: null }],
      forecast: [
        { validAt: "x", lat: 20, lon: 130, windKt: null, pressureHpa: null, category: null, circleRadiusKm: KM_PER_DEG_LAT },
      ],
      gdacsCone: {
        type: "MultiPolygon",
        coordinates: [[[[85, 5], [86, 5], [86, 6], [85, 5]]]],
      },
    } as unknown as StormTrack;
    const b = stormContentBounds([s]);
    expect(b?.minLon).toBe(85);
    expect(b?.minLat).toBe(5);
    expect(b?.maxLat).toBeCloseTo(21, 6);
    expect(b?.maxLon).toBeGreaterThan(131);
    expect(stormContentBounds([])).toBeNull();
  });
});
