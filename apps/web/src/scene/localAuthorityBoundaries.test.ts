import { afterEach, describe, expect, it, vi } from "vitest";
import type { AoiManifest } from "@siahra/shared-types";
import {
  loadLocalAuthorityBoundaries,
  parseLocalAuthorityFeatures,
} from "./localAuthorityBoundaries";

const manifest = (localAuthorities: AoiManifest["localAuthorities"]): AoiManifest => ({
  aoiId: "test-aoi",
  bbox: { minLon: 98.94, maxLon: 99.02, minLat: 18.76, maxLat: 18.82 },
  utmZone: "32647",
  originEasting: 494000,
  originNorthing: 2075000,
  terrain: {
    url: "/aoi/test-aoi/terrain.bin",
    width: 4,
    height: 4,
    cellSizeM: 30,
    minZ: 300,
    maxZ: 400,
    demType: "DSM",
  },
  buildings: null,
  localAuthorities,
  version: "2026-08-20",
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseLocalAuthorityFeatures", () => {
  it("keeps each feature's id/nameTh/type — unlike loadBoundaryRings, identity is not discarded", () => {
    const geojson = {
      features: [
        {
          properties: { id: "TH-LAO-1", nameTh: "หนึ่ง", type: "city_municipality" },
          geometry: { type: "Polygon", coordinates: [[[100, 13], [100, 14], [101, 14], [101, 13], [100, 13]]] },
        },
      ],
    };
    const out = parseLocalAuthorityFeatures(geojson);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "TH-LAO-1", nameTh: "หนึ่ง", type: "city_municipality" });
    expect(out[0].rings).toHaveLength(1);
  });

  it("drops a feature missing an identity property rather than guessing one", () => {
    const geojson = {
      features: [
        {
          properties: { nameTh: "ไม่มี id", type: "city_municipality" },
          geometry: { type: "Polygon", coordinates: [[[100, 13], [100, 14], [101, 14], [101, 13], [100, 13]]] },
        },
      ],
    };
    expect(parseLocalAuthorityFeatures(geojson)).toEqual([]);
  });

  it("drops a feature with no geometry / empty rings", () => {
    const geojson = {
      features: [
        { properties: { id: "TH-LAO-1", nameTh: "หนึ่ง", type: "city_municipality" }, geometry: null },
      ],
    };
    expect(parseLocalAuthorityFeatures(geojson)).toEqual([]);
  });
});

describe("loadLocalAuthorityBoundaries", () => {
  it("manifest.localAuthorities absent → no fetch, resolves null (not a failure)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(loadLocalAuthorityBoundaries(manifest(null))).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetch failure (network) resolves null, does not throw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    await expect(
      loadLocalAuthorityBoundaries(manifest({ url: "/aoi/90/local-authorities.geojson" })),
    ).resolves.toBeNull();
  });

  it("non-ok response resolves null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false }),
    );
    await expect(
      loadLocalAuthorityBoundaries(manifest({ url: "/aoi/90/local-authorities.geojson" })),
    ).resolves.toBeNull();
  });

  it("parses a real response into identity-bearing features", async () => {
    const body = {
      features: [
        {
          properties: { id: "TH-LAO-3901101", nameTh: "หาดใหญ่", type: "city_municipality" },
          geometry: { type: "Polygon", coordinates: [[[100.4, 7.0], [100.4, 7.1], [100.5, 7.1], [100.5, 7.0], [100.4, 7.0]]] },
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => body }),
    );
    const result = await loadLocalAuthorityBoundaries(
      manifest({ url: "/aoi/90/local-authorities.geojson" }),
    );
    expect(result).toHaveLength(1);
    expect(result?.[0].nameTh).toBe("หาดใหญ่");
  });
});
