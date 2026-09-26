import { describe, expect, it } from "vitest";
import type { FloodExtentFeature, FloodExtentResponse } from "@siahra/shared-types";
import {
  bboxContains,
  featureBbox,
  gistdaExtentState,
  groupByTambon,
  m2ToRai,
  responseAcquisitions,
  sensorLabel,
} from "./gistdaFlood";

function cell(id: string, tambonCode: string | null, areaM2: number, lon: number, extra: Partial<FloodExtentFeature["properties"]> = {}): FloodExtentFeature {
  return {
    type: "Feature",
    id,
    properties: {
      h3: id,
      provinceCode: "14",
      provinceTh: "จ.พระนครศรีอยุธยา",
      amphoeCode: "1411",
      amphoeTh: "อ.วังน้อย",
      tambonCode,
      tambonTh: tambonCode ? `ต.${tambonCode}` : null,
      floodAreaM2: areaM2,
      acquisitions: [{ sensor: "rd2", acquiredAt: "2026-09-25T23:13:00.000Z" }],
      observedAt: "2026-09-25T23:13:00.000Z",
      publishedAt: "2026-09-26T06:51:21.687Z",
      firstSeenAt: "2026-09-26T08:00:00.000Z",
      ...extra,
    },
    geometry: {
      type: "MultiPolygon",
      coordinates: [[[[lon, 14], [lon + 0.01, 14], [lon + 0.01, 14.01], [lon, 14.01], [lon, 14]]]],
    },
  };
}

function response(over: Partial<FloodExtentResponse>): FloodExtentResponse {
  return {
    layer: { id: "gistda-flood-extent", epistemicClass: "observed", liveOrStatic: "live", fetchedAt: null, sourceIds: ["gistda-flood"] },
    retrievedAt: null,
    provinceCode: "14",
    granularity: "h3-cell",
    matched: null,
    acquisitions: [],
    observedAt: null,
    features: [],
    ...over,
  };
}

describe("gistdaExtentState — ถามแล้วได้ 0 ≠ ยังไม่เคยถาม ≠ ไม่มีฉากที่เก็บไว้", () => {
  it("แยกทุกสถานะ", () => {
    expect(gistdaExtentState(null)).toBe("loading");
    expect(gistdaExtentState(response({}))).toBe("never-fetched");
    expect(gistdaExtentState(response({ reason: "no-archived-scene" }))).toBe("no-archived-scene");
    expect(gistdaExtentState(response({ retrievedAt: "2026-09-26T08:00:00Z", matched: 0 }))).toBe("none-detected");
    expect(
      gistdaExtentState(response({ retrievedAt: "2026-09-26T08:00:00Z", matched: 1, features: [cell("a", "141104", 1, 100)] })),
    ).toBe("detected");
  });
});

describe("groupByTambon", () => {
  it("รวมเซลล์เป็นรายตำบล เรียงพื้นที่มากสุดก่อน จุดกึ่งกลางถ่วงพื้นที่", () => {
    const groups = groupByTambon([
      cell("a", "141104", 1000, 100),
      cell("b", "141104", 3000, 100.1),
      cell("c", "141105", 500, 100.5, { observedAt: "2026-09-22T11:19:00.000Z", firstSeenAt: "2026-09-25T00:00:00.000Z" }),
    ]);
    expect(groups.map((g) => [g.key, g.cells, g.areaM2])).toEqual([
      ["141104", 2, 4000],
      ["141105", 1, 500],
    ]);
    // (100.005×1000 + 100.105×3000) / 4000
    expect(groups[0]!.lon).toBeCloseTo(100.08, 6);
    expect(groups[1]!.firstSeenAt).toBe("2026-09-25T00:00:00.000Z");
  });

  it("เซลล์ที่รูปทรงว่างนับพื้นที่ แต่ไม่ดึงจุดกึ่งกลาง", () => {
    const empty = { ...cell("e", "141106", 20, 0), geometry: { type: "MultiPolygon" as const, coordinates: [] } };
    const [g] = groupByTambon([empty]);
    expect(g).toMatchObject({ cells: 1, areaM2: 20, lon: null, lat: null });
  });
});

describe("featureBbox / bboxContains", () => {
  it("กรอบของ outer ring, null เมื่อรูปทรงว่าง", () => {
    const f = cell("a", "1", 1, 100);
    const box = featureBbox(f)!;
    expect(box[0]).toBe(100);
    expect(box[2]).toBeCloseTo(100.01, 9);
    expect(bboxContains(box, 100.005, 14.005)).toBe(true);
    expect(bboxContains(box, 100.02, 14.005)).toBe(false);
    expect(featureBbox({ ...f, geometry: { type: "MultiPolygon", coordinates: [] } })).toBeNull();
  });
});

describe("หน่วยและชื่อดาวเทียม", () => {
  it("m² → ไร่ (1 ไร่ = 1,600 m²)", () => {
    expect(m2ToRai(16000)).toBe(10);
  });
  it("รหัสที่รู้จักเป็นชื่อเต็ม ที่ไม่รู้จักแสดงตามต้นทาง", () => {
    expect(sensorLabel("S1C")).toBe("Sentinel-1C");
    expect(sensorLabel("S1D")).toBe("Sentinel-1D");
    expect(sensorLabel("rd2")).toBe("RADARSAT-2");
    expect(sensorLabel("xyz9")).toBe("xyz9");
  });
});

describe("responseAcquisitions", () => {
  it("ใช้รายการระดับคำตอบ ถ้าไม่มีรวมจาก feature ใหม่สุดก่อน", () => {
    expect(responseAcquisitions(null)).toEqual([]);
    const a = [{ sensor: "S1D", acquiredAt: "2026-09-22T11:19:00.000Z" }];
    expect(responseAcquisitions(response({ acquisitions: a }))).toBe(a);
    const merged = responseAcquisitions(
      response({
        features: [
          cell("a", "1", 1, 100),
          cell("b", "1", 1, 100, { acquisitions: [{ sensor: "S1D", acquiredAt: "2026-09-22T11:19:00.000Z" }] }),
        ],
      }),
    );
    expect(merged.map((x) => x.sensor)).toEqual(["rd2", "S1D"]);
  });
});
