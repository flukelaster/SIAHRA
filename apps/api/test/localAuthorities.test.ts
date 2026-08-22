import { exports as workerExports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

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
});
