import { describe, expect, it } from "vitest";
import type { ThresholdRule } from "@siahra/shared-types";
import { buildRules, mergeRules, stationKey } from "./buildAlertRules.js";

function rule(kind: "rainfall" | "waterlevel", stationId: number, ids: string[]): ThresholdRule {
  return {
    id: `alert-rule-${kind}-${stationId}`,
    stationId,
    stationKind: kind,
    affectedLocalAuthorityIds: ids,
    alertAtLevel: "high",
    minimumDurationMinutes: 30,
    cooldownMinutes: 60,
    version: "1",
  };
}

describe("mergeRules", () => {
  const prev = [
    rule("rainfall", 1, ["TH-LAO-1"]), // present today, unchanged
    rule("rainfall", 2, ["TH-LAO-2"]), // absent from today's feed → kept
    rule("waterlevel", 3, ["TH-LAO-3"]), // present today, no longer inside any boundary → dropped
    rule("waterlevel", 4, ["TH-LAO-4"]), // present today, now also inside a district → changed
  ];
  const fresh = [
    rule("rainfall", 1, ["TH-LAO-1"]),
    rule("waterlevel", 4, ["TH-LAO-4", "TH-BMA-osm9"]),
    rule("waterlevel", 5, ["TH-BMA-osm9"]), // new (e.g. a Bangkok station)
  ];
  const present = new Set([
    stationKey("rainfall", 1),
    stationKey("waterlevel", 3),
    stationKey("waterlevel", 4),
    stationKey("waterlevel", 5),
  ]);

  it("keeps rules of stations merely absent from today's snapshot, drops only verifiable misses", () => {
    const { rules, report } = mergeRules(prev, fresh, present);
    expect(rules.map((r) => r.id)).toEqual([
      "alert-rule-rainfall-1",
      "alert-rule-rainfall-2",
      "alert-rule-waterlevel-4",
      "alert-rule-waterlevel-5",
    ]);
    expect(report).toEqual({
      keptAbsent: ["alert-rule-rainfall-2"],
      added: ["alert-rule-waterlevel-5"],
      droppedPresent: ["alert-rule-waterlevel-3"],
      changed: ["alert-rule-waterlevel-4"],
    });
    expect(rules.find((r) => r.stationId === 4)?.affectedLocalAuthorityIds).toEqual(["TH-LAO-4", "TH-BMA-osm9"]);
    // one station per rule, always
    expect(new Set(rules.map((r) => stationKey(r.stationKind, r.stationId))).size).toBe(rules.length);
  });
});

describe("buildRules — a Bangkok district binds a station exactly like an อปท.", () => {
  it("point-in-polygon against a TH-BMA boundary", () => {
    const boundaries = [
      {
        id: "TH-BMA-osm92053",
        geometry: {
          type: "Polygon" as const,
          coordinates: [[[100.48, 13.73], [100.52, 13.73], [100.52, 13.78], [100.48, 13.78], [100.48, 13.73]]],
        },
      },
    ];
    const rules = buildRules([{ id: 7, lat: 13.75, lon: 100.5 }], [{ id: 8, lat: 14.5, lon: 100.5 }], boundaries);
    expect(rules).toEqual([rule("rainfall", 7, ["TH-BMA-osm92053"])]);
  });
});
