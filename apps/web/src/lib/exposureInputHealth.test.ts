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

  // Same predicate also backs `App.tsx`'s `observationsStale`, which dims the raw
  // rain/water-level station markers — a dam-only failure must never dim them
  // (round 8: dam failures already have their own banner on `DamCard`, and folding
  // `damsError` in here would mis-dim unrelated, perfectly fresh station data).
  describe("also backs App.tsx's observationsStale (round 8)", () => {
    it("rain and water-level ok, dams failing → not degraded (station markers stay bright)", () => {
      expect(
        exposureInputsAreDegraded(
          thaiwater({ rainfallHealth: "ok", waterlevelHealth: "ok", damsError: "upstream shape changed" }),
        ),
      ).toBe(false);
    });

    it("rain or water-level degraded, regardless of dam health → degraded (station markers dim)", () => {
      // Dams also healthy.
      expect(
        exposureInputsAreDegraded(thaiwater({ rainfallHealth: "degraded", waterlevelHealth: "ok" })),
      ).toBe(true);
      // Dams also failing at the same time — the dam failure must not be the
      // reason this reads degraded, but it must not hide a real feed failure either.
      expect(
        exposureInputsAreDegraded(
          thaiwater({
            rainfallHealth: "ok",
            waterlevelHealth: "degraded",
            damsError: "upstream shape changed",
          }),
        ),
      ).toBe(true);
    });
  });
});
