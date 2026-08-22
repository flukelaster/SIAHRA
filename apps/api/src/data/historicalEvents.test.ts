import { describe, expect, it } from "vitest";
import { getHistoricalEventById, queryHistoricalEvents } from "./historicalEvents.js";

describe("historicalEvents module", () => {
  it("queries all benchmark historical events", () => {
    const res = queryHistoricalEvents();
    expect(res.total).toBeGreaterThanOrEqual(5);
    expect(res.events.some((e) => e.id === "EVENT-2011-CHAOPHRAYA")).toBe(true);
  });

  it("filters historical events by affected province", () => {
    const res = queryHistoricalEvents("50"); // Chiang Mai
    expect(res.total).toBeGreaterThan(0);
    expect(res.events.every((e) => e.affectedProvinces.includes("50"))).toBe(true);
  });

  it("gets event detail by ID", () => {
    const event = getHistoricalEventById("EVENT-2011-CHAOPHRAYA");
    expect(event).toBeDefined();
    expect(event?.year).toBe(2011);
    expect(event?.peakFloodAreaKm2).toBeGreaterThan(10000);
  });

  it("returns null for non-existent event ID", () => {
    const event = getHistoricalEventById("EVENT-NON-EXISTENT");
    expect(event).toBeNull();
  });
});
