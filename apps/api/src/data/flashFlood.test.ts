import { describe, expect, it } from "vitest";
import { deriveFlashFloodRisk } from "./flashFlood.js";

describe("flashFlood module", () => {
  it("classifies flat terrain as low risk", () => {
    const risk = deriveFlashFloodRisk(2.0, 5.0, []);
    expect(risk.riskLevel).toBe("low");
    expect(risk.descriptor.epistemicClass).toBe("illustrative");
  });

  it("classifies moderate mountain slope as moderate risk", () => {
    const risk = deriveFlashFloodRisk(10.0, 15.0, ["tambon-1"]);
    expect(risk.riskLevel).toBe("moderate");
  });

  it("classifies steep mountain slope with large catchment as high/critical risk", () => {
    const highRisk = deriveFlashFloodRisk(16.0, 25.0, ["tambon-2"]);
    expect(highRisk.riskLevel).toBe("high");

    const criticalRisk = deriveFlashFloodRisk(22.0, 60.0, ["tambon-3"]);
    expect(criticalRisk.riskLevel).toBe("critical");
  });
});
