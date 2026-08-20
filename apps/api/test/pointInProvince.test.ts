import { describe, expect, it } from "vitest";
import {
  distanceToRingsKm,
  nearestProvinces,
  pointInRings,
  provinceDistanceKm,
  type ProvinceRingSet,
} from "../src/geo/pointInProvince.js";
import { PROVINCE_RINGS, nearestProvincesForPoint } from "../src/geo/provinceRings.js";
import { PROVINCE_CODES } from "@siahra/shared-types";

/**
 * E10.6 — เรขาคณิตของ "ระยะถึงจังหวัด" ต้องเป็นระยะถึง **รูปหลายเหลี่ยม**
 * ไม่ใช่ระยะถึงจุดศูนย์กลาง เทสชุดนี้ยึดสองอย่างไว้:
 *   1. อยู่ในเขต = 0 กม., นอกเขต = ระยะถึงขอบจริง
 *   2. **ห้ามมีขั้นคัดกรองด้วยศูนย์กลาง** — เทสข้อสุดท้ายแสดงจุดที่อยู่ *ใน*
 *      จังหวัดหนึ่งแล้ว แต่ศูนย์กลางของจังหวัดนั้นอยู่อันดับที่ 5 ของระยะถึง
 *      ศูนย์กลาง ถ้ามีชั้นคัดกรองเหลือสามอันดับแรกก่อน คำตอบที่ถูกจะหายไปเลย
 */

/** จุดศูนย์กลางเชิงเรขาคณิตแบบง่าย (เฉลี่ยจุดยอด) — ใช้ *เฉพาะ* เพื่อพิสูจน์ว่าใช้ไม่ได้ */
function vertexCentre(p: ProvinceRingSet): [number, number] {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const ring of p.rings) {
    for (let i = 0; i < ring.length; i += 2) {
      sx += ring[i];
      sy += ring[i + 1];
      n++;
    }
  }
  return [sx / n, sy / n];
}

const KM_PER_DEG = 111.19492664455873;

function centreDistanceKm(lon: number, lat: number, p: ProvinceRingSet): number {
  const [cx, cy] = vertexCentre(p);
  const kx = KM_PER_DEG * Math.cos((lat * Math.PI) / 180);
  return Math.hypot((cx - lon) * kx, (cy - lat) * KM_PER_DEG);
}

/** สี่เหลี่ยมจัตุรัสกว้าง 1 องศา มุมล่างซ้ายที่ (100, 15) */
function square(code: string): ProvinceRingSet {
  return {
    code,
    nameTh: `สี่เหลี่ยม ${code}`,
    nameEn: `Square ${code}`,
    bbox: [100, 15, 101, 16],
    rings: [[100, 15, 101, 15, 101, 16, 100, 16, 100, 15]],
  };
}

describe("pointInRings / distanceToRingsKm", () => {
  const sq = square("01");

  it("จุดในรูป = inside, ระยะเป็น 0", () => {
    expect(pointInRings(100.5, 15.5, sq.rings)).toBe(true);
    expect(provinceDistanceKm(100.5, 15.5, sq)).toEqual({ distanceKm: 0, inside: true });
  });

  it("จุดนอกรูปแต่ชิดขอบ = ระยะตั้งฉากถึงขอบ", () => {
    // 0.01 องศาลองจิจูดที่ละติจูด 15 ≈ 1.074 กม.
    const expected = 0.01 * KM_PER_DEG * Math.cos((15.5 * Math.PI) / 180);
    const d = provinceDistanceKm(101.01, 15.5, sq);
    expect(d.inside).toBe(false);
    expect(d.distanceKm).toBeGreaterThan(expected * 0.98);
    expect(d.distanceKm).toBeLessThan(expected * 1.02);
  });

  it("รูในรูป (วงใน) นับเป็นนอกเขต", () => {
    const donut: ProvinceRingSet = {
      ...sq,
      rings: [...sq.rings, [100.4, 15.4, 100.6, 15.4, 100.6, 15.6, 100.4, 15.6, 100.4, 15.4]],
    };
    expect(pointInRings(100.5, 15.5, donut.rings)).toBe(false);
    expect(distanceToRingsKm(100.5, 15.5, donut.rings)).toBeGreaterThan(0);
  });
});

describe("nearestProvinces — ไม่มีขั้นคัดกรองด้วยศูนย์กลาง", () => {
  it("จังหวัดยาวเรียวที่ขอบพาดผ่านใกล้จุด ชนะจังหวัดกะทัดรัดที่ศูนย์กลางใกล้กว่า", () => {
    // แถบยาว 4 องศาในแนวตะวันออก-ตะวันตก ศูนย์กลางอยู่ไกลจากจุดที่ถามมาก
    const elongated: ProvinceRingSet = {
      code: "99",
      nameTh: "แถบยาว",
      nameEn: "Elongated",
      bbox: [96, 15, 100, 15.1],
      rings: [[96, 15, 100, 15, 100, 15.1, 96, 15.1, 96, 15]],
    };
    const compact: ProvinceRingSet = {
      code: "98",
      nameTh: "ก้อนกลม",
      nameEn: "Compact",
      bbox: [100.3, 14.7, 100.7, 15.1],
      rings: [[100.3, 14.7, 100.7, 14.7, 100.7, 15.1, 100.3, 15.1, 100.3, 14.7]],
    };
    const lon = 100.05;
    const lat = 15.05;

    // ศูนย์กลางของแถบยาวอยู่ไกลกว่าศูนย์กลางของก้อนกลมชัดเจน
    expect(centreDistanceKm(lon, lat, elongated)).toBeGreaterThan(
      centreDistanceKm(lon, lat, compact),
    );

    const ranked = nearestProvinces(lon, lat, [compact, elongated]);
    expect(ranked[0].provinceCode).toBe("99");
    expect(ranked[0].distanceKm).toBeLessThan(ranked[1].distanceKm);
  });
});

describe("provinceRings.json (artefact จริง 77 จังหวัด)", () => {
  it("มีครบทั้ง 77 จังหวัด และทุกจังหวัดมีวงอย่างน้อยหนึ่งวง", () => {
    expect(PROVINCE_RINGS).toHaveLength(77);
    const codes = PROVINCE_RINGS.map((p) => p.code).sort();
    expect(codes).toEqual([...PROVINCE_CODES].sort());
    for (const p of PROVINCE_RINGS) {
      expect(p.rings.length).toBeGreaterThan(0);
      for (const ring of p.rings) expect(ring.length).toBeGreaterThanOrEqual(6);
    }
  });

  it("จุดกลางกรุงเทพฯ = อยู่ในเขต กทม. ระยะ 0 และเป็นอันดับหนึ่ง", () => {
    const nearest = nearestProvincesForPoint(100.5018, 13.7563);
    expect(nearest[0]).toMatchObject({ provinceCode: "10", distanceKm: 0, inside: true });
    expect(nearest).toHaveLength(3);
    // อันดับรอง ๆ ต้องเป็นระยะจริงที่มากกว่า 0 และเรียงจากน้อยไปมาก
    expect(nearest[1].inside).toBe(false);
    expect(nearest[1].distanceKm).toBeGreaterThan(0);
    expect(nearest[2].distanceKm).toBeGreaterThanOrEqual(nearest[1].distanceKm);
  });

  /**
   * หมายเหตุ: ขอบเขตจาก OSM รวมพื้นที่ทางทะเลของบางจังหวัดไว้ด้วย จุดกลางอ่าวไทย
   * บางจุดจึงอยู่ "ในเขต" จริง ๆ ตามต้นทาง — จุดที่ใช้ที่นี่จึงเลือกให้อยู่นอก
   * ทุกวงชัดเจน (ตรวจกับ artefact แล้ว)
   */
  it("จุดนอกเขตทุกจังหวัด = ไม่ inside เลย แต่ยังมีจังหวัดที่ใกล้ที่สุด", () => {
    const nearest = nearestProvincesForPoint(101.5, 11.0);
    expect(nearest.every((n) => !n.inside)).toBe(true);
    expect(nearest[0].distanceKm).toBeGreaterThan(0);
  });

  /**
   * นี่คือเทสที่พิสูจน์ว่าขั้นคัดกรองด้วยศูนย์กลาง "ตัดคำตอบที่ถูกทิ้ง" จริง ๆ:
   * จุดนี้อยู่ *ใน* เขตเชียงใหม่ (ระยะถึงรูปหลายเหลี่ยม = 0 จึงเป็นอันดับหนึ่ง)
   * แต่เชียงใหม่ยาวเหนือ-ใต้มาก ศูนย์กลางเชิงเรขาคณิตจึงอยู่ห่างจากจุดนี้เกิน
   * 100 กม. และตกอันดับ 3 แรกของ "ระยะถึงศูนย์กลาง" ไปเลย
   */
  it("จุดในเขตจังหวัดที่ยาวเรียว ยังเป็นอันดับหนึ่ง ทั้งที่อันดับตามศูนย์กลางตกไปหลังอันดับสาม", () => {
    const lon = 98.5;
    const lat = 17.4;
    const polygonRanked = [...PROVINCE_RINGS]
      .map((p) => ({ code: p.code, ...provinceDistanceKm(lon, lat, p) }))
      .sort((a, b) => a.distanceKm - b.distanceKm);
    const winner = polygonRanked[0];
    expect(winner.inside).toBe(true);

    const centroidRank =
      [...PROVINCE_RINGS]
        .map((p) => ({ code: p.code, d: centreDistanceKm(lon, lat, p) }))
        .sort((a, b) => a.d - b.d)
        .findIndex((p) => p.code === winner.code) + 1;
    // เกินจำนวนอันดับที่ระบบรายงาน = ชั้นคัดกรองด้วยศูนย์กลางจะโยนคำตอบนี้ทิ้ง
    const limit = 3;
    expect(
      centroidRank,
      `centroid rank of the containing province was ${centroidRank}; a centroid shortlist of ${limit} would still have kept it`,
    ).toBeGreaterThan(limit);

    const nearest = nearestProvincesForPoint(lon, lat);
    expect(nearest[0].provinceCode).toBe(winner.code);
    expect(nearest[0]).toMatchObject({ distanceKm: 0, inside: true });
  });
});
