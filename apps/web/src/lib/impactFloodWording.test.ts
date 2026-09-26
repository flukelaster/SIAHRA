import { describe, expect, it } from "vitest";
import { translate } from "../i18n";
import { impactFloodWording } from "./impactFloodWording";

describe("impactFloodWording", () => {
  it("fresh keeps the present-tense wording", () => {
    expect(impactFloodWording(false)).toEqual({
      sectionKey: "impact.section.flood",
      facilitiesNoneKey: "impact.facilitiesExposed.none",
    });
  });

  it("dimmed (stale scene / source not ok) never claims 'current' or 'now' and dates the image", () => {
    const w = impactFloodWording(true);
    for (const lang of ["th", "en"] as const) {
      const section = translate(lang, w.sectionKey, { date: "10 Sep" });
      const none = translate(lang, w.facilitiesNoneKey);
      expect(section).toContain("10 Sep");
      for (const text of [section, none]) {
        expect(text).not.toMatch(/ปัจจุบัน|ตอนนี้|current|right now/i);
      }
    }
  });
});
