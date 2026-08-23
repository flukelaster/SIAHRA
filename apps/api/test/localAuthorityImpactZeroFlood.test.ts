import { exports as workerExports } from "cloudflare:workers";
import type { LocalAuthorityImpactResponse } from "@siahra/shared-types";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * E11.4 — the "fetched successfully, nothing currently overlaps" case,
 * against the real `/impact` route. Kept in its own file: `FloodExtentDO`
 * caches its last successful pull for the whole DO instance, and this
 * repo's vitest-pool-workers setup shares storage *within* one test file but
 * isolates it *across* files (see `apps/api/vitest.config.ts`'s header
 * comment) — sharing this test with `localAuthorityImpact.test.ts` would let
 * its cached non-empty scene leak into this one and silently defeat the
 * empty-scene mock below.
 */
afterEach(() => {
  vi.restoreAllMocks();
});

const call = (path: string) => workerExports.default.fetch(new Request(`https://siahra-radar.co${path}`));

describe("GET /api/v1/local-authorities/:id/impact — fetched successfully, zero overlap right now", () => {
  it("TH-LAO-3300102: real 0, distinguishable from the never-fetched null case", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ type: "FeatureCollection", features: [] }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    const res = await call("/api/v1/local-authorities/TH-LAO-3300102/impact");
    expect(res.status).toBe(200);
    const body = (await res.json()) as LocalAuthorityImpactResponse;
    expect(body.impact.floodedAreaKm2).toBe(0);
    expect(body.impact.floodedFraction).toBe(0);
    expect(body.impact.facilitiesExposed.hospitals).toHaveLength(0);
    expect(body.impact.facilitiesExposed.schools).toHaveLength(0);
    expect(body.impact.facilitiesExposed.fireStations).toHaveLength(0);
    // GISTDA answered (with an empty scene) — fetchedAt is real, not null.
    expect(body.impact.descriptor.fetchedAt).not.toBeNull();
    expect(body.impact.populationExposed.estimate).toBe(0);
    expect(body.impact.buildingsExposed.estimate).toBe(0);
  }, 20_000);
});
