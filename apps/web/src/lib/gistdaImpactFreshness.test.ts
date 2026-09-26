import { describe, expect, it } from "vitest";
import {
  deriveGistdaImpactFreshness,
  gistdaSourceStatus,
  newestImpactDescriptor,
} from "./gistdaImpactFreshness";

// ค่าจริงของ prod 2026-09-26: ฉากล่าสุดที่ดึงได้ 10 ก.ย., staleAfterSeconds 10800 (3 ชม.)
const STALE_AFTER = 10_800;
const NOW = Date.parse("2026-09-26T07:00:00Z");
const FRESH = { fetchedAt: "2026-09-26T06:30:00Z", staleAfterSeconds: STALE_AFTER };
const OLD = { fetchedAt: "2026-09-10T07:04:20Z", staleAfterSeconds: STALE_AFTER };

describe("deriveGistdaImpactFreshness", () => {
  it("fresh: fetched within staleAfterSeconds and health ok → not dimmed", () => {
    expect(deriveGistdaImpactFreshness(FRESH, { health: "ok", lastError: null }, NOW)).toEqual({
      kind: "fresh",
      dim: false,
      fetchedAt: FRESH.fetchedAt,
    });
  });

  it("stale by age: health ok but the scene is older than staleAfterSeconds → dimmed, no claim about the source", () => {
    const f = deriveGistdaImpactFreshness(OLD, { health: "ok", lastError: null }, NOW);
    expect(f).toEqual({ kind: "old", dim: true, fetchedAt: OLD.fetchedAt });
  });

  it("stale by health: prod's 401 (down + lastError) → unreachable, even if the age alone were fresh", () => {
    const down = { health: "down" as const, lastError: "GISTDA WFS failed: 401 Unauthorized" };
    expect(deriveGistdaImpactFreshness(OLD, down, NOW).kind).toBe("unreachable");
    expect(deriveGistdaImpactFreshness(FRESH, down, NOW)).toEqual({
      kind: "unreachable",
      dim: true,
      fetchedAt: FRESH.fetchedAt,
    });
    expect(deriveGistdaImpactFreshness(FRESH, { health: "degraded", lastError: null }, NOW).kind).toBe(
      "unreachable",
    );
  });

  it("health stale without a lastError is not proof of an unreachable source — only 'old'", () => {
    expect(deriveGistdaImpactFreshness(OLD, { health: "stale", lastError: null }, NOW).kind).toBe("old");
    expect(deriveGistdaImpactFreshness(OLD, { health: "stale", lastError: "timeout" }, NOW).kind).toBe(
      "unreachable",
    );
  });

  it("delayed = reached but no new scene — dimmed, distinct from unreachable", () => {
    expect(deriveGistdaImpactFreshness(FRESH, { health: "delayed", lastError: null }, NOW)).toEqual({
      kind: "no-new-scene",
      dim: true,
      fetchedAt: FRESH.fetchedAt,
    });
  });

  it("unknown health dims (not ok) but never claims the source is unreachable", () => {
    expect(deriveGistdaImpactFreshness(FRESH, { health: "unknown", lastError: null }, NOW).kind).toBe("old");
  });

  it("null fetchedAt → never-fetched, never a time, whatever /health says", () => {
    const nullDesc = { fetchedAt: null, staleAfterSeconds: STALE_AFTER };
    for (const gistda of [undefined, null, { health: "down" as const, lastError: "x" }]) {
      expect(deriveGistdaImpactFreshness(nullDesc, gistda, NOW)).toEqual({
        kind: "never-fetched",
        dim: false,
        fetchedAt: null,
      });
    }
    expect(deriveGistdaImpactFreshness(null, undefined, NOW).kind).toBe("never-fetched");
  });

  it("missing health (not loaded / no gistda-flood row) → decided by age alone, no source claim", () => {
    expect(deriveGistdaImpactFreshness(FRESH, undefined, NOW).kind).toBe("fresh");
    expect(deriveGistdaImpactFreshness(FRESH, null, NOW).kind).toBe("fresh");
    expect(deriveGistdaImpactFreshness(OLD, undefined, NOW)).toEqual({
      kind: "old",
      dim: true,
      fetchedAt: OLD.fetchedAt,
    });
  });
});

describe("gistdaSourceStatus", () => {
  it("picks the gistda-flood row, undefined when absent or health not loaded", () => {
    const row = {
      id: "gistda-flood" as const,
      labelTh: "",
      labelEn: "",
      health: "down" as const,
      fetchedAt: OLD.fetchedAt,
      latestObservedAt: null,
      lastAttemptAt: null,
      lastError: "401",
      detail: {},
      staleAfterSeconds: STALE_AFTER,
      observedLagSeconds: null,
      nextAttemptAt: null,
    };
    expect(gistdaSourceStatus({ sources: [row] })).toBe(row);
    expect(gistdaSourceStatus({ sources: [] })).toBeUndefined();
    expect(gistdaSourceStatus(null)).toBeUndefined();
  });
});

describe("newestImpactDescriptor", () => {
  it("takes the newest fetchedAt, ignores nulls once a real one exists, null for an empty list", () => {
    expect(newestImpactDescriptor([OLD, FRESH, { fetchedAt: null, staleAfterSeconds: STALE_AFTER }])).toBe(FRESH);
    expect(newestImpactDescriptor([{ fetchedAt: null, staleAfterSeconds: STALE_AFTER }, OLD])).toBe(OLD);
    expect(newestImpactDescriptor([])).toBeNull();
  });
});
