import { describe, expect, it } from "vitest";
import { MAX_RECONNECT_DELAY_MS, MIN_RECONNECT_DELAY_MS, nextReconnectDelayMs } from "./backoff";

describe("nextReconnectDelayMs", () => {
  it("starts at 1 s and never exceeds 30 s, whatever the jitter", () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      for (const rand of [0, 0.001, 0.37, 0.5, 0.999]) {
        const d = nextReconnectDelayMs(attempt, rand);
        expect(d).toBeGreaterThanOrEqual(MIN_RECONNECT_DELAY_MS);
        expect(d).toBeLessThanOrEqual(MAX_RECONNECT_DELAY_MS);
      }
    }
  });

  it("grows exponentially at the jitter ceiling", () => {
    expect(nextReconnectDelayMs(0, 0.999)).toBeCloseTo(1000, -1);
    expect(nextReconnectDelayMs(1, 1)).toBe(2000);
    expect(nextReconnectDelayMs(2, 1)).toBe(4000);
    expect(nextReconnectDelayMs(5, 1)).toBe(32_000 > MAX_RECONNECT_DELAY_MS ? MAX_RECONNECT_DELAY_MS : 32_000);
    expect(nextReconnectDelayMs(30, 1)).toBe(MAX_RECONNECT_DELAY_MS);
  });

  it("collapses to the 1 s floor at zero jitter", () => {
    expect(nextReconnectDelayMs(0, 0)).toBe(MIN_RECONNECT_DELAY_MS);
    expect(nextReconnectDelayMs(10, 0)).toBe(MIN_RECONNECT_DELAY_MS);
  });

  it("spreads reconnects across the window instead of stacking them", () => {
    expect(nextReconnectDelayMs(4, 0.5)).toBe(8500); // 1000 + 0.5 * (16000 - 1000)
  });
});
