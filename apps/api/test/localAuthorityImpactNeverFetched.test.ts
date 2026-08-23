import { exports as workerExports } from "cloudflare:workers";
import type { LocalAuthorityImpactResponse } from "@siahra/shared-types";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * E11.4 — the "GISTDA has never been fetched successfully" case, against the
 * real `/impact` route (not just `computeLocalAuthorityImpact` called
 * directly). Kept in its own file for the same reason as
 * `localAuthorityImpactZeroFlood.test.ts`: `FloodExtentDO` storage is shared
 * within one test file and isolated across files, so a cached successful
 * pull from another file would defeat the always-failing mock below and
 * this would silently become the zero-overlap case instead of the null one.
 */
afterEach(() => {
  vi.restoreAllMocks();
});

const call = (path: string) => workerExports.default.fetch(new Request(`https://siahra-radar.co${path}`));

describe("GET /api/v1/local-authorities/:id/impact — GISTDA never fetched successfully", () => {
  it("TH-LAO-3300102: floodedAreaKm2/floodedFraction are null, not 0 — distinguishable from a real zero", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("simulated upstream failure — GISTDA never reachable");
    });
    const res = await call("/api/v1/local-authorities/TH-LAO-3300102/impact");
    expect(res.status).toBe(200);
    const body = (await res.json()) as LocalAuthorityImpactResponse;
    expect(body.impact.floodedAreaKm2).toBeNull();
    expect(body.impact.floodedFraction).toBeNull();
    expect(body.impact.facilitiesExposed.hospitals).toHaveLength(0);
    expect(body.impact.populationExposed.estimate).toBeNull();
    expect(body.impact.buildingsExposed.estimate).toBeNull();
    // Never fetched — fetchedAt must be null, never backdated to "now".
    expect(body.impact.descriptor.fetchedAt).toBeNull();
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  }, 20_000);
});
