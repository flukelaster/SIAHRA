import { describe, expect, it } from "vitest";
import type { LocalAuthorityImpact } from "@siahra/shared-types";
import { rankAffectedAuthorities, type AffectedAuthorityCandidate } from "./affectedAuthorityRanking";

function impact(overrides: Partial<LocalAuthorityImpact> = {}): LocalAuthorityImpact {
  return {
    localAuthorityId: "TH-LAO-0000000",
    authorityAreaKm2: 10,
    floodedAreaKm2: 0,
    floodedFraction: 0,
    facilitiesExposed: { hospitals: [], schools: [], fireStations: [] },
    populationExposed: { estimate: 0, method: "area-weighted", descriptor: DESCRIPTOR },
    buildingsExposed: { estimate: 0, method: "area-weighted", descriptor: DESCRIPTOR },
    descriptor: DESCRIPTOR,
    computedAt: "2026-08-23T00:00:00Z",
    ...overrides,
  };
}

const DESCRIPTOR = {
  id: "local-authority-flood-impact",
  epistemicClass: "observed" as const,
  liveOrStatic: "live" as const,
  fetchedAt: "2026-08-23T00:00:00Z",
  sourceIds: [],
};

function candidate(
  id: string,
  overrides: Partial<AffectedAuthorityCandidate> = {},
): AffectedAuthorityCandidate {
  return {
    id,
    nameTh: id,
    type: "subdistrict_admin_org",
    impact: impact(),
    unavailable: false,
    ...overrides,
  };
}

describe("rankAffectedAuthorities", () => {
  it("เรียง measured ตาม floodedFraction มากไปน้อย", () => {
    const out = rankAffectedAuthorities([
      candidate("a", { impact: impact({ floodedFraction: 0.1 }) }),
      candidate("b", { impact: impact({ floodedFraction: 0.8 }) }),
      candidate("c", { impact: impact({ floodedFraction: 0.4 }) }),
    ]);
    expect(out.map((e) => e.id)).toEqual(["b", "c", "a"]);
    expect(out.every((e) => e.bucket === "measured")).toBe(true);
  });

  it("เสมอกันที่ floodedFraction แล้วเรียงตามจำนวนสถานที่สำคัญมากไปน้อย", () => {
    const out = rankAffectedAuthorities([
      candidate("few", {
        impact: impact({ floodedFraction: 0.5, facilitiesExposed: { hospitals: [], schools: [], fireStations: [] } }),
      }),
      candidate("many", {
        impact: impact({
          floodedFraction: 0.5,
          facilitiesExposed: {
            hospitals: [{ osmId: "h1", nameTh: null, lat: 0, lon: 0 }],
            schools: [{ osmId: "s1", nameTh: null, lat: 0, lon: 0 }],
            fireStations: [],
          },
        }),
      }),
    ]);
    expect(out.map((e) => e.id)).toEqual(["many", "few"]);
  });

  it("ไม่เอา floodedFraction: null (ไม่เคยดึงสำเร็จ) มาเรียงปนกับ 0 (ดึงสำเร็จแต่ไม่ท่วม)", () => {
    const out = rankAffectedAuthorities([
      candidate("never-fetched", { impact: impact({ floodedFraction: null, floodedAreaKm2: null }) }),
      candidate("zero-flood", { impact: impact({ floodedFraction: 0 }) }),
      candidate("flooded", { impact: impact({ floodedFraction: 0.2 }) }),
    ]);
    // measured (รวม 0 จริง) มาก่อนเสมอ ตามด้วย never-fetched
    expect(out.map((e) => e.id)).toEqual(["flooded", "zero-flood", "never-fetched"]);
    expect(out.find((e) => e.id === "never-fetched")?.bucket).toBe("never-fetched");
    expect(out.find((e) => e.id === "zero-flood")?.bucket).toBe("measured");
  });

  it("อปท. ที่คำขอ /impact ของตัวเองล้มเหลว (unavailable) อยู่ท้ายสุดเสมอ", () => {
    const out = rankAffectedAuthorities([
      candidate("failed", { impact: null, unavailable: true }),
      candidate("never-fetched", { impact: impact({ floodedFraction: null }) }),
      candidate("flooded", { impact: impact({ floodedFraction: 0.9 }) }),
    ]);
    expect(out.map((e) => e.id)).toEqual(["flooded", "never-fetched", "failed"]);
    expect(out.find((e) => e.id === "failed")?.bucket).toBe("unavailable");
  });

  it("ภายในกลุ่มเดียวกัน (never-fetched/unavailable) เรียงตามชื่อไทยเพื่อผลลัพธ์นิ่ง", () => {
    const out = rankAffectedAuthorities([
      candidate("z", { nameTh: "ฮ", impact: impact({ floodedFraction: null }) }),
      candidate("a", { nameTh: "ก", impact: impact({ floodedFraction: null }) }),
    ]);
    expect(out.map((e) => e.id)).toEqual(["a", "z"]);
  });
});
