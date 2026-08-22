import { exports as workerExports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { LocalAuthorityBaselineExposure, LocalAuthorityExposureResponse } from "@siahra/shared-types";

const workerFetch = (url: string, init: RequestInit = {}) =>
  workerExports.default.fetch(new Request(url, init));

describe("Local Authorities Endpoints", () => {
  it("GET /api/v1/local-authorities returns a list of local authorities", async () => {
    const res = await workerFetch("https://siahra-radar.co/api/v1/local-authorities");
    expect(res.status).toBe(200);

    const data = (await res.json()) as { total: number; localAuthorities: Array<{ id: string; nameTh: string }> };
    expect(data.total).toBeGreaterThan(0);
    expect(Array.isArray(data.localAuthorities)).toBe(true);
    expect(data.localAuthorities.some((lao) => lao.id === "TH-LAO-901101")).toBe(true);
  });

  it("filters by province code (e.g. Songkhla = 90)", async () => {
    const res = await workerFetch("https://siahra-radar.co/api/v1/local-authorities?province=90");
    expect(res.status).toBe(200);

    const data = (await res.json()) as { total: number; localAuthorities: Array<{ provinceCode: string }> };
    expect(data.total).toBeGreaterThan(0);
    expect(data.localAuthorities.every((lao) => lao.provinceCode === "90")).toBe(true);
  });

  it("returns 400 for invalid province code", async () => {
    const res = await workerFetch("https://siahra-radar.co/api/v1/local-authorities?province=999");
    expect(res.status).toBe(400);

    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("Invalid province code");
  });

  it("filters by search query text", async () => {
    const res = await workerFetch("https://siahra-radar.co/api/v1/local-authorities?q=หาดใหญ่");
    expect(res.status).toBe(200);

    const data = (await res.json()) as { total: number; localAuthorities: Array<{ nameTh: string }> };
    expect(data.total).toBeGreaterThan(0);
    expect(data.localAuthorities.some((lao) => lao.nameTh.includes("หาดใหญ่"))).toBe(true);
  });

  it("GET /api/v1/local-authorities/:id returns specific local authority detail", async () => {
    const res = await workerFetch("https://siahra-radar.co/api/v1/local-authorities/TH-LAO-901101");
    expect(res.status).toBe(200);

    const data = (await res.json()) as { id: string; dlaCode: string; nameTh: string };
    expect(data.id).toBe("TH-LAO-901101");
    expect(data.dlaCode).toBe("901101");
    expect(data.nameTh).toBe("เทศบาลนครหาดใหญ่");
  });

  it("GET /api/v1/local-authorities/:id returns 404 for unknown ID", async () => {
    const res = await workerFetch("https://siahra-radar.co/api/v1/local-authorities/TH-LAO-000000");
    expect(res.status).toBe(404);

    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("not found");
  });

  it("GET /api/v1/local-authorities/:id/exposure returns baseline exposure with data honesty", async () => {
    const res = await workerFetch("https://siahra-radar.co/api/v1/local-authorities/TH-LAO-901101/exposure");
    expect(res.status).toBe(200);

    const data = (await res.json()) as LocalAuthorityExposureResponse;
    expect(data.baseline).toBeDefined();
    expect(data.baseline.localAuthorityId).toBe("TH-LAO-901101");
    expect(data.baseline.populationTotal).toBeGreaterThan(100000);
    expect(data.baseline.buildingsTotal).toBeGreaterThan(10000);
    expect(data.baseline.roadsTotalKm).toBeGreaterThan(100);
    expect(data.baseline.criticalFacilities.hospitals).toBeGreaterThan(0);

    // Data honesty checks (AGENTS.md)
    expect(data.baseline.descriptor.epistemicClass).toBe("static-reference");
    expect(data.baseline.descriptor.sourceIds).toContain("worldpop");
    expect(data.baseline.descriptor.sourceIds).toContain("osm");
    expect(data.baseline.populationSource).toBe("WorldPop-2020-UNadj");
  });

  it("GET /api/v1/local-authorities/:id/exposure returns 404 for unknown ID", async () => {
    const res = await workerFetch("https://siahra-radar.co/api/v1/local-authorities/TH-LAO-999999/exposure");
    expect(res.status).toBe(404);

    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("not found");
  });

  it("GET /api/v1/local-authorities/exposure returns all baseline exposures", async () => {
    const res = await workerFetch("https://siahra-radar.co/api/v1/local-authorities/exposure");
    expect(res.status).toBe(200);

    const data = (await res.json()) as { total: number; exposures: LocalAuthorityBaselineExposure[] };
    expect(data.total).toBeGreaterThan(0);
    expect(data.exposures.some((e) => e.localAuthorityId === "TH-LAO-100000")).toBe(true);
  });

  it("GET /api/v1/local-authorities/exposure?province=90 filters by province", async () => {
    const res = await workerFetch("https://siahra-radar.co/api/v1/local-authorities/exposure?province=90");
    expect(res.status).toBe(200);

    const data = (await res.json()) as { total: number; exposures: LocalAuthorityBaselineExposure[] };
    expect(data.total).toBeGreaterThan(0);
    expect(data.exposures.every((e) => e.provinceCode === "90")).toBe(true);
  });

  it("GET /api/v1/local-authorities/:id/impact returns live observed impact", async () => {
    const res = await workerFetch("https://siahra-radar.co/api/v1/local-authorities/TH-LAO-901101/impact");
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      classification: string;
      severity: string;
      exposure: { populationTotal: number; populationExposed: number };
      layer: { epistemicClass: string; sourceIds: string[] };
    };

    expect(data.classification).toBe("observed");
    expect(["low", "elevated", "high", "severe"]).toContain(data.severity);
    expect(data.exposure.populationTotal).toBeGreaterThan(100000);
    expect(data.layer.epistemicClass).toBe("observed");
    expect(data.layer.sourceIds).toContain("gistda-flood");
  });

  it("GET /api/v1/local-authorities/impact?province=90 returns province impact ranking", async () => {
    const res = await workerFetch("https://siahra-radar.co/api/v1/local-authorities/impact?province=90");
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      total: number;
      provinceCode: string;
      impacts: Array<{ localAuthority: { id: string }; severity: string }>;
    };

    expect(data.total).toBeGreaterThan(0);
    expect(data.provinceCode).toBe("90");
    expect(Array.isArray(data.impacts)).toBe(true);
  });

  it("GET /api/v1/local-authorities/impact returns 400 when missing province query", async () => {
    const res = await workerFetch("https://siahra-radar.co/api/v1/local-authorities/impact");
    expect(res.status).toBe(400);

    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("Missing required query parameter");
  });
});
