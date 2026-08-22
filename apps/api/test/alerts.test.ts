import { exports as workerExports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { ActiveAlertsResponse, ThresholdRulesResponse } from "@siahra/shared-types";

const workerFetch = (url: string, init: RequestInit = {}) =>
  workerExports.default.fetch(new Request(url, init));

describe("Alerts and Threshold Endpoints", () => {
  it("GET /api/v1/alerts/rules returns configured threshold rules", async () => {
    const res = await workerFetch("https://siahra-radar.co/api/v1/alerts/rules");
    expect(res.status).toBe(200);

    const data = (await res.json()) as ThresholdRulesResponse;
    expect(data.total).toBeGreaterThan(0);
    expect(Array.isArray(data.rules)).toBe(true);
    expect(data.rules.some((r) => r.id === "RULE-90-01-WARN")).toBe(true);
  });

  it("GET /api/v1/alerts/rules?stationId=9001 filters by station", async () => {
    const res = await workerFetch("https://siahra-radar.co/api/v1/alerts/rules?stationId=9001");
    expect(res.status).toBe(200);

    const data = (await res.json()) as ThresholdRulesResponse;
    expect(data.total).toBeGreaterThan(0);
    expect(data.rules.every((r) => r.stationId === 9001)).toBe(true);
  });

  it("POST /api/v1/alerts/evaluate evaluates telemetry and records active alerts in DO", async () => {
    const res = await workerFetch("https://siahra-radar.co/api/v1/alerts/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        readings: [
          {
            stationId: 9001,
            telemetry: {
              water_level_msl: 4.8, // Exceeds RULE-90-01-WARN (>= 4.2)
            },
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as ActiveAlertsResponse;
    expect(data.total).toBeGreaterThan(0);
    expect(data.alerts.some((a) => a.ruleId === "RULE-90-01-WARN")).toBe(true);
  });

  it("GET /api/v1/alerts/active returns current active alerts", async () => {
    const res = await workerFetch("https://siahra-radar.co/api/v1/alerts/active");
    expect(res.status).toBe(200);

    const data = (await res.json()) as ActiveAlertsResponse;
    expect(data.evaluatedAt).toBeDefined();
    expect(Array.isArray(data.alerts)).toBe(true);
  });

  it("GET /api/v1/alerts/active?province=90 filters by province code", async () => {
    const res = await workerFetch("https://siahra-radar.co/api/v1/alerts/active?province=90");
    expect(res.status).toBe(200);

    const data = (await res.json()) as ActiveAlertsResponse;
    expect(data.alerts.every((a) => a.provinceCode === "90")).toBe(true);
  });

  it("POST /api/v1/alerts/evaluate clears alerts when telemetry falls below hysteresis clearValue", async () => {
    // When station water level drops below clearValue (3.8) e.g. to 3.2
    const res = await workerFetch("https://siahra-radar.co/api/v1/alerts/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        readings: [
          {
            stationId: 9001,
            telemetry: {
              water_level_msl: 3.2,
            },
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as ActiveAlertsResponse;
    expect(data.alerts.some((a) => a.ruleId === "RULE-90-01-WARN")).toBe(false);
  });
});
