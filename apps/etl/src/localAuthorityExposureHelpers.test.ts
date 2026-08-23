import { describe, expect, it } from "vitest";
import {
  buildingsPerThousandPop,
  dedupeFacilityNodes,
  geometryBbox,
  geometryToFlatRings,
  groupRoadLengthByClass,
  haversineKm,
  lineLengthKm,
  pointInPolygon,
  pointInRings,
  polygonVertexCentroid,
  sumAaiGridPopulation,
  type GeoJsonGeometry,
} from "./localAuthorityExposureHelpers.js";

describe("sumAaiGridPopulation", () => {
  it("sums valid pixels, skipping the declared NODATA_value and any negative value", () => {
    const text = [
      "ncols        4",
      "nrows        2",
      "xllcorner    100.0",
      "yllcorner    7.0",
      "cellsize     0.000833333",
      "NODATA_value  -9999",
      "1.5 2.5 -9999 3.0",
      "-1 0 4.25 -9999",
    ].join("\n");
    const result = sumAaiGridPopulation(text);
    expect(result.sum).toBeCloseTo(1.5 + 2.5 + 3.0 + 0 + 4.25, 5);
    expect(result.validPixelCount).toBe(5);
    expect(result.skippedCount).toBe(3);
    expect(result.ncols).toBe(4);
    expect(result.nrows).toBe(2);
    expect(result.nodataValue).toBe(-9999);
  });

  it("works with 5-line headers (no NODATA_value declared) — still skips negatives", () => {
    const text = ["ncols 2", "nrows 1", "xllcorner 0", "yllcorner 0", "cellsize 1", "3 -5"].join("\n");
    const result = sumAaiGridPopulation(text);
    expect(result.sum).toBe(3);
    expect(result.validPixelCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(result.nodataValue).toBeNull();
  });

  it("returns zero valid pixels for an all-nodata crop (a real, honest failure mode)", () => {
    const text = ["ncols 2", "nrows 1", "xllcorner 0", "yllcorner 0", "cellsize 1", "NODATA_value -9999", "-9999 -9999"].join(
      "\n",
    );
    const result = sumAaiGridPopulation(text);
    expect(result.validPixelCount).toBe(0);
    expect(result.sum).toBe(0);
  });
});

describe("geometryToFlatRings / pointInRings / pointInPolygon", () => {
  const square: GeoJsonGeometry = {
    type: "Polygon",
    coordinates: [
      [
        [100, 7],
        [100, 8],
        [101, 8],
        [101, 7],
        [100, 7],
      ],
    ],
  };

  it("flattens a Polygon's rings and tests containment with even-odd rule", () => {
    const rings = geometryToFlatRings(square);
    expect(rings).toHaveLength(1);
    expect(pointInRings(100.5, 7.5, rings)).toBe(true);
    expect(pointInRings(105, 7.5, rings)).toBe(false);
  });

  it("pointInPolygon matches pointInRings(geometryToFlatRings(...))", () => {
    expect(pointInPolygon(100.5, 7.5, square)).toBe(true);
    expect(pointInPolygon(50, 7.5, square)).toBe(false);
  });

  it("handles MultiPolygon geometries", () => {
    const multi: GeoJsonGeometry = { type: "MultiPolygon", coordinates: [square.coordinates as number[][][]] };
    expect(pointInPolygon(100.5, 7.5, multi)).toBe(true);
  });
});

describe("geometryBbox", () => {
  it("computes min/max lon/lat over nested coordinate arrays", () => {
    const geom: GeoJsonGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [100, 7],
          [100.5, 7.2],
          [100.2, 6.9],
          [100, 7],
        ],
      ],
    };
    expect(geometryBbox(geom)).toEqual({ minLon: 100, minLat: 6.9, maxLon: 100.5, maxLat: 7.2 });
  });
});

describe("polygonVertexCentroid", () => {
  it("averages the outer ring's vertices", () => {
    const geom: GeoJsonGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [0, 2],
          [2, 2],
          [2, 0],
        ],
      ],
    };
    expect(polygonVertexCentroid(geom)).toEqual([1, 1]);
  });

  it("returns null for a degenerate/empty geometry", () => {
    expect(polygonVertexCentroid({ type: "LineString", coordinates: [] })).toBeNull();
  });
});

describe("haversineKm / lineLengthKm", () => {
  it("computes a plausible real-world distance (1 degree of latitude ~ 111 km)", () => {
    const km = haversineKm([100, 7], [100, 8]);
    expect(km).toBeGreaterThan(110);
    expect(km).toBeLessThan(112);
  });

  it("sums consecutive segment lengths for a multi-point line", () => {
    const total = lineLengthKm([
      [100, 7],
      [100, 7.5],
      [100, 8],
    ]);
    const direct = haversineKm([100, 7], [100, 8]);
    expect(total).toBeCloseTo(direct, 3);
  });
});

describe("groupRoadLengthByClass", () => {
  it("sums km per raw highway class, not a fixed enum", () => {
    const byClass = groupRoadLengthByClass([
      { highwayClass: "residential", km: 1 },
      { highwayClass: "residential", km: 2 },
      { highwayClass: "track", km: 0.5 },
    ]);
    expect(byClass).toEqual({ residential: 3, track: 0.5 });
  });
});

describe("dedupeFacilityNodes", () => {
  it("drops a node facility that falls inside a same-type facility polygon", () => {
    const polygon: GeoJsonGeometry = {
      type: "Polygon",
      coordinates: [
        [
          [100, 7],
          [100, 8],
          [101, 8],
          [101, 7],
          [100, 7],
        ],
      ],
    };
    const nodes = [
      { osmId: "node/1", nameTh: "in", lat: 7.5, lon: 100.5 },
      { osmId: "node/2", nameTh: "out", lat: 20, lon: 20 },
    ];
    const result = dedupeFacilityNodes(nodes, [polygon]);
    expect(result).toHaveLength(1);
    expect(result[0].osmId).toBe("node/2");
  });

  it("keeps every node when there are no facility polygons to dedupe against", () => {
    const nodes = [{ osmId: "node/1", nameTh: null, lat: 1, lon: 1 }];
    expect(dedupeFacilityNodes(nodes, [])).toEqual(nodes);
  });
});

describe("buildingsPerThousandPop", () => {
  it("computes a raw ratio when population is positive", () => {
    expect(buildingsPerThousandPop(50, 1000)).toBe(50);
  });

  it("returns null (never a fabricated ratio) when population is 0 or unavailable", () => {
    expect(buildingsPerThousandPop(50, 0)).toBeNull();
  });
});
