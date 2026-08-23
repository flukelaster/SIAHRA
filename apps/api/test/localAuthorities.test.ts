import { exports as workerExports } from "cloudflare:workers";
import type {
  LocalAuthoritiesResponse,
  LocalAuthorityDetailResponse,
  LocalAuthorityExposureResponse,
} from "@siahra/shared-types";
import { describe, expect, it } from "vitest";
import { getLocalAuthorityById, LOCAL_AUTHORITIES, queryLocalAuthorities } from "../src/data/localAuthorities.js";
import { getExposureByLocalAuthorityId } from "../src/data/localAuthorityExposure.js";

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

/**
 * E11.3 — baseline exposure. Real assertions against the baked
 * `apps/api/src/data/localAuthorityExposure.json`, produced by
 * `npm run build:local-authority-exposure -w apps/etl` against the real
 * WorldPop 2020 UN-adjusted raster and the real cached OSM extract.
 */
describe("GET /api/v1/local-authorities/:id/exposure", () => {
  it("returns a plausible real population for Hat Yai (TH-LAO-3901101, has an E11.2 boundary)", async () => {
    const res = await call("/api/v1/local-authorities/TH-LAO-3901101/exposure");
    expect(res.status).toBe(200);
    const body = (await res.json()) as LocalAuthorityExposureResponse;
    expect(body.exposure.localAuthorityId).toBe("TH-LAO-3901101");
    // Hat Yai is a real city of meaningful size — real numbers from the ETL
    // run (npm run build:local-authority-exposure -w apps/etl), 2026-08-23:
    // pop=111,896.69 buildings=30,920 roads=462.255km facilities=5/21/3.
    // Bounded rather than pinned exactly, since re-running against a refreshed
    // WorldPop/OSM extract will shift these slightly without being wrong.
    expect(body.exposure.population.estimate).toBeGreaterThan(90_000);
    expect(body.exposure.population.estimate).toBeLessThan(140_000);
    expect(body.exposure.population.descriptor.sourceIds).toEqual(["worldpop"]);
    expect(body.exposure.population.descriptor.fetchedAt).not.toBeNull();
    expect(body.exposure.buildings.count).toBeGreaterThan(25_000);
    expect(body.exposure.buildings.perThousandPop).not.toBeNull();
    expect(body.exposure.roads.totalKm).toBeGreaterThan(400);
    expect(Object.keys(body.exposure.roads.byClass).length).toBeGreaterThan(0);
    expect(body.exposure.facilities.hospitals.length).toBeGreaterThan(0);
    expect(body.exposure.facilities.schools.length).toBeGreaterThan(0);
    // Real OSM ids/coords, never fabricated — spot-check the shape.
    for (const h of body.exposure.facilities.hospitals) {
      expect(h.osmId).toMatch(/^(node|way)\/\d+$/);
      expect(typeof h.lat).toBe("number");
      expect(typeof h.lon).toBe("number");
    }
  });

  it("has the real registry record and a real exposure record consistent with each other", () => {
    const ref = getLocalAuthorityById("TH-LAO-3901101");
    expect(ref).not.toBeNull();
    const exposure = getExposureByLocalAuthorityId("TH-LAO-3901101");
    expect(exposure).not.toBeNull();
    expect(exposure?.localAuthorityId).toBe(ref?.id);
  });

  it("404s specifically from the exposure endpoint (not the registry) for an authority with no E11.2 boundary", async () => {
    // TH-LAO-5380602 (Bueng Kan, provinceCode 38) is a real registry record —
    // Bueng Kan has no local-authorities.geojson from E11.2 (see the E11.2
    // coverage list), so there is no polygon to compute zonal statistics
    // against and this must 404 from /exposure specifically.
    const detail = await call("/api/v1/local-authorities/TH-LAO-5380602");
    expect(detail.status).toBe(200);

    const exposure = await call("/api/v1/local-authorities/TH-LAO-5380602/exposure");
    expect(exposure.status).toBe(404);
    await expect(exposure.json()).resolves.toMatchObject({
      error: expect.stringContaining("No baseline exposure"),
    });
  });

  it("returns 404 for an id that does not exist in the registry at all", async () => {
    const res = await call("/api/v1/local-authorities/TH-LAO-0000000/exposure");
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("No such local authority") });
  });
});
