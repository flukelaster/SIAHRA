import { exports as workerExports } from "cloudflare:workers";
import type { LocalAuthoritiesResponse, LocalAuthorityDetailResponse } from "@siahra/shared-types";
import { describe, expect, it } from "vitest";
import { getLocalAuthorityById, LOCAL_AUTHORITIES, queryLocalAuthorities } from "../src/data/localAuthorities.js";

/**
 * E11.1 — ทะเบียน อปท. ที่ build จริงแล้ว (`apps/api/src/data/localAuthorities.json`,
 * commit อยู่ในโค้ด) ทดสอบกับตัวเลขที่ตรวจกับ SOURCE.md แล้วจริง ไม่ใช่ tautology
 * แบบ `toBeGreaterThan(0)`
 */

const call = (path: string) => workerExports.default.fetch(new Request(`https://siahra-radar.co${path}`));

describe("LOCAL_AUTHORITIES (baked registry)", () => {
  it("has a plausible national total (SOURCE.md: 7,849 distinct รหัส อปท.)", () => {
    expect(LOCAL_AUTHORITIES.length).toBe(7849);
  });

  it("covers 76 provinces, not 77 — Bangkok is legitimately absent from this dataset", () => {
    const provinceCodes = new Set(LOCAL_AUTHORITIES.map((a) => a.provinceCode));
    expect(provinceCodes.size).toBe(76);
    // 10 = กรุงเทพมหานคร — must not be synthesized
    expect(provinceCodes.has("10")).toBe(false);
  });

  it("round-trips a known real record: เมืองพัทยา (special_admin_area, provinceCode 20)", () => {
    const pattaya = queryLocalAuthorities({ query: "เมืองพัทยา" });
    expect(pattaya).toHaveLength(1);
    expect(pattaya[0]).toMatchObject({
      id: "TH-LAO-3200408",
      dlaCode: "3200408",
      type: "special_admin_area",
      provinceCode: "20",
      areaKm2: 208.1,
    });
  });

  it("filters by provinceCode — Songkhla (90) has real records with the right province", () => {
    const songkhla = queryLocalAuthorities({ provinceCode: "90" });
    expect(songkhla.length).toBeGreaterThan(0);
    for (const a of songkhla) expect(a.provinceCode).toBe("90");
  });

  it("getLocalAuthorityById resolves both the full id and the bare dlaCode", () => {
    const byFullId = getLocalAuthorityById("TH-LAO-3200408");
    const byDlaCode = getLocalAuthorityById("3200408");
    expect(byFullId).not.toBeNull();
    expect(byFullId).toEqual(byDlaCode);
  });

  it("getLocalAuthorityById returns null for an unknown id", () => {
    expect(getLocalAuthorityById("TH-LAO-0000000")).toBeNull();
  });
});

describe("GET /api/v1/local-authorities", () => {
  it("returns the full registry with an honest static-reference descriptor", async () => {
    const res = await call("/api/v1/local-authorities");
    expect(res.status).toBe(200);
    const body = (await res.json()) as LocalAuthoritiesResponse;
    expect(body.total).toBe(7849);
    expect(body.localAuthorities).toHaveLength(7849);
    expect(body.layer.epistemicClass).toBe("static-reference");
    expect(body.layer.liveOrStatic).toBe("static");
    expect(body.layer.sourceIds).toEqual(["dla"]);
    // ค่าจริงจาก SOURCE.md — ต้นทางไม่มี field เวลาที่ machine อ่านได้เอง
    expect(body.layer.publishedAt).toBe("2026-06-10T00:00:00Z");
    expect(body.layer.fetchedAt).toBe("2026-08-23T00:00:00Z");
  });

  it("filters by ?province= and rejects an invalid province with 400", async () => {
    const ok = await call("/api/v1/local-authorities?province=90");
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as LocalAuthoritiesResponse;
    expect(body.total).toBeGreaterThan(0);
    for (const a of body.localAuthorities) expect(a.provinceCode).toBe("90");

    const bad = await call("/api/v1/local-authorities?province=99");
    expect(bad.status).toBe(400);
  });

  it("filters by ?type= and rejects an unknown type with 400", async () => {
    const ok = await call("/api/v1/local-authorities?type=provincial_admin_org");
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as LocalAuthoritiesResponse;
    // SOURCE.md: อบจ. count = 76
    expect(body.total).toBe(76);

    const bad = await call("/api/v1/local-authorities?type=not-a-real-type");
    expect(bad.status).toBe(400);
  });

  it("searches by ?q= against nameTh", async () => {
    const res = await call(`/api/v1/local-authorities?${new URLSearchParams({ q: "เมืองพัทยา" })}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as LocalAuthoritiesResponse;
    expect(body.total).toBe(1);
    expect(body.localAuthorities[0].dlaCode).toBe("3200408");
  });
});

describe("GET /api/v1/local-authorities/:id", () => {
  it("returns a real record by dlaCode", async () => {
    const res = await call("/api/v1/local-authorities/3200408");
    expect(res.status).toBe(200);
    const body = (await res.json()) as LocalAuthorityDetailResponse;
    expect(body.localAuthority.nameTh).toBe("เมืองพัทยา");
    expect(body.layer.sourceIds).toEqual(["dla"]);
  });

  it("returns a real record by the full TH-LAO id", async () => {
    const res = await call("/api/v1/local-authorities/TH-LAO-3200408");
    expect(res.status).toBe(200);
    const body = (await res.json()) as LocalAuthorityDetailResponse;
    expect(body.localAuthority.dlaCode).toBe("3200408");
  });

  it("returns 404 for an unknown id", async () => {
    const res = await call("/api/v1/local-authorities/TH-LAO-0000000");
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("No such local authority") });
  });
});
