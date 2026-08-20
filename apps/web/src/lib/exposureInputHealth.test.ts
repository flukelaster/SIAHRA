import type { SourceStatus } from "@siahra/shared-types";
import { describe, expect, it } from "vitest";
import { exposureInputsAreDegraded } from "./exposureInputHealth";

const thaiwater = (detail: SourceStatus["detail"]): SourceStatus => ({
  id: "thaiwater",
  labelTh: "ThaiWater",
  labelEn: "ThaiWater",
  health: "degraded",
  fetchedAt: "2026-08-19T12:00:00.000Z",
  latestObservedAt: "2026-08-19T11:30:00.000Z",
  lastAttemptAt: "2026-08-19T12:00:00.000Z",
  lastError: "dams: upstream shape changed",
  detail,
  staleAfterSeconds: 900,
  observedLagSeconds: 7200,
  nextAttemptAt: null,
});

describe("exposureInputsAreDegraded", () => {
  it("does not degrade exposure for a dam-only ThaiWater failure", () => {
    expect(
      exposureInputsAreDegraded(
        thaiwater({ rainfallHealth: "ok", waterlevelHealth: "ok", damsError: "upstream shape changed" }),
      ),
    ).toBe(false);
  });

  it("degrades exposure when either required station feed is not healthy", () => {
    expect(exposureInputsAreDegraded(thaiwater({ rainfallHealth: "ok", waterlevelHealth: "degraded" }))).toBe(true);
  });

  it("does not treat missing per-feed metadata as fresh", () => {
    expect(exposureInputsAreDegraded(thaiwater({ damsError: "upstream shape changed" }))).toBe(true);
  });
});
