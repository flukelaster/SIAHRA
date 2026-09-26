import { describe, expect, it } from "vitest";
import type { HazardLayerDescriptor, StormsResponse, StormTrack } from "@siahra/shared-types";
import {
  fixAgeMs,
  isOldFix,
  isPastValidTime,
  latestFixTime,
  stormDistanceKm,
  stormSourceConditions,
  stormsWithin,
  summarizeStorms,
} from "./storms";

const layer = {} as HazardLayerDescriptor;
const NOW = Date.parse("2026-09-26T11:00:00Z");
const ok = (id: "jma-typhoon" | "gdacs-tc") => ({
  id,
  lastSuccessAt: "2026-09-26T10:51:00Z",
  lastAttemptAt: "2026-09-26T10:51:00Z",
  lastError: null,
});
const resp = (storms: StormTrack[], sources: StormsResponse["sources"]): StormsResponse => ({
  storms,
  layers: { track: layer, circle: layer, past: layer },
  sources,
});
const storm = (over: Partial<StormTrack> = {}): StormTrack => ({
  id: "gdacs:1001326",
  source: "gdacs-tc",
  name: "ONE-26",
  basin: "NIO",
  category: null,
  advisoryIssuedAt: null,
  windAveraging: null,
  past: [
    { observedAt: "2026-09-23T18:00:00Z", lat: 17.8, lon: 83.7, windKt: null, pressureHpa: null },
    { observedAt: "2026-09-24T00:00:00Z", lat: 18.1, lon: 83.7, windKt: null, pressureHpa: null },
  ],
  forecast: [],
  nearestKmByProvince: { "10": 1821 },
  fetchedAt: "2026-09-26T10:51:00Z",
  ...over,
});

describe("summarizeStorms — ทุกกรณี 'ไม่มีรายการ' แยกกัน ไม่มีกรณีไหนเป็น all-clear", () => {
  it("ยังไม่มีคำตอบ: โหลด vs ติดต่อ API ไม่ได้", () => {
    expect(summarizeStorms({ data: null, loading: true, error: null })).toEqual({ kind: "loading" });
    expect(summarizeStorms({ data: null, loading: false, error: { key: "error.loadFailed" } })).toEqual({
      kind: "api-unreachable",
    });
  });

  it("ไม่เคยดึงสำเร็จเลย = never (ไม่ใช่ 'ไม่มีพายุ')", () => {
    const d = resp([], [
      { id: "jma-typhoon", lastSuccessAt: null, lastAttemptAt: null, lastError: null },
      { id: "gdacs-tc", lastSuccessAt: null, lastAttemptAt: "2026-09-26T10:51:00Z", lastError: "HTTP 500" },
    ]);
    expect(summarizeStorms({ data: d, loading: false, error: null })).toEqual({ kind: "never" });
    // แถวที่หายไปจากคำตอบ (api รุ่นเก่า) = never เช่นกัน ไม่ใช่ ok
    expect(summarizeStorms({ data: resp([], []), loading: false, error: null })).toEqual({ kind: "never" });
  });

  it("ทุกแหล่งล้มเหลวในรอบล่าสุด = unchecked", () => {
    const d = resp([], [
      { ...ok("jma-typhoon"), lastError: "HTTP 503" },
      { ...ok("gdacs-tc"), lastError: "timeout" },
    ]);
    expect(summarizeStorms({ data: d, loading: false, error: null })).toEqual({ kind: "unchecked" });
  });

  it("ไม่มีพายุ — พูดแทนได้เฉพาะแหล่งที่ ok", () => {
    const d = resp([], [ok("jma-typhoon"), { ...ok("gdacs-tc"), lastError: "HTTP 503" }]);
    expect(summarizeStorms({ data: d, loading: false, error: null })).toEqual({
      kind: "none-reported",
      reachable: ["jma-typhoon"],
    });
  });

  it("มีพายุ = จำนวน", () => {
    const d = resp([storm()], [ok("jma-typhoon"), ok("gdacs-tc")]);
    expect(summarizeStorms({ data: d, loading: false, error: null })).toEqual({ kind: "storms", n: 1 });
  });
});

describe("stormSourceConditions — partial ≠ failing", () => {
  it("ได้รายการแต่บางลูกโหลดไม่ขึ้น (lastSuccessAt = lastAttemptAt + lastError) = partial", () => {
    const [jma] = stormSourceConditions(
      resp([], [{ ...ok("jma-typhoon"), lastError: "jma-typhoon: TC2633 forecast.json HTTP 500" }, ok("gdacs-tc")]),
    );
    expect(jma).toEqual({
      id: "jma-typhoon",
      kind: "partial",
      lastSuccessAt: "2026-09-26T10:51:00Z",
      lastError: "jma-typhoon: TC2633 forecast.json HTTP 500",
    });
  });

  it("ติดต่อไม่ได้ (lastSuccessAt เก่ากว่า lastAttemptAt) = failing; ไม่มี lastAttemptAt = failing (ข้างปลอดภัย)", () => {
    const [jma, gdacs] = stormSourceConditions(
      resp([], [
        { id: "jma-typhoon", lastSuccessAt: "2026-09-26T08:00:00Z", lastAttemptAt: "2026-09-26T10:51:00Z", lastError: "HTTP 503" },
        { id: "gdacs-tc", lastSuccessAt: "2026-09-26T08:00:00Z", lastAttemptAt: null, lastError: "x" },
      ]),
    );
    expect(jma.kind).toBe("failing");
    expect(gdacs.kind).toBe("failing");
  });

  it("ไม่มีพายุในมือ + แหล่งเดียวที่ติดต่อได้เป็น partial → unchecked (ไม่ใช่ 'ไม่ได้รายงานพายุ')", () => {
    const d = resp([], [
      { ...ok("jma-typhoon"), lastError: "jma-typhoon: TC2633 HTTP 500" },
      { id: "gdacs-tc", lastSuccessAt: "2026-09-26T08:00:00Z", lastAttemptAt: "2026-09-26T10:51:00Z", lastError: "HTTP 503" },
    ]);
    expect(summarizeStorms({ data: d, loading: false, error: null })).toEqual({ kind: "unchecked" });
  });
});

describe("stormSourceConditions", () => {
  it("เรียงคงที่ JMA → GDACS และแยก never / failing / ok", () => {
    const conds = stormSourceConditions(
      resp([], [{ ...ok("gdacs-tc"), lastSuccessAt: "2026-09-26T08:00:00Z", lastError: "HTTP 503" }, ok("jma-typhoon")]),
    );
    expect(conds.map((c) => [c.id, c.kind])).toEqual([
      ["jma-typhoon", "ok"],
      ["gdacs-tc", "failing"],
    ]);
    expect(stormSourceConditions(null).map((c) => c.kind)).toEqual(["never", "never"]);
  });
});

describe("เวลาของพายุ", () => {
  it("ONE-26 (จุดล่าสุด 24 ก.ย. 00Z) เก่ากว่า 24 ชม. ณ 26 ก.ย. 11Z", () => {
    const s = storm();
    expect(latestFixTime(s)).toBe("2026-09-24T00:00:00Z");
    expect(fixAgeMs(s, NOW)).toBe(NOW - Date.parse("2026-09-24T00:00:00Z"));
    expect(isOldFix(s, NOW)).toBe(true);
  });

  it("JMA ให้เวลาเฉพาะจุดล่าสุด — จุดก่อนหน้าเป็น null ไม่ถูกเดา", () => {
    const s = storm({
      past: [
        { observedAt: null, lat: 14, lon: 140, windKt: null, pressureHpa: null },
        { observedAt: "2026-09-26T09:00:00Z", lat: 23.2, lon: 126.9, windKt: 55, pressureHpa: 990 },
      ],
    });
    expect(latestFixTime(s)).toBe("2026-09-26T09:00:00Z");
    expect(isOldFix(s, NOW)).toBe(false);
    expect(latestFixTime(storm({ past: [{ observedAt: null, lat: 1, lon: 1, windKt: null, pressureHpa: null }] }))).toBeNull();
    expect(isOldFix(storm({ past: [] }), NOW)).toBe(false);
  });

  it("ตำแหน่งพยากรณ์ที่เวลาใช้ได้ผ่านไปแล้ว", () => {
    expect(isPastValidTime("2026-09-25T00:00:00Z", NOW)).toBe(true);
    expect(isPastValidTime("2026-09-27T00:00:00Z", NOW)).toBe(false);
  });
});

describe("ระยะถึงจังหวัด", () => {
  it("ไม่มีค่า = null (ไม่ใช่ 0) และ stormsWithin ใช้เกณฑ์ ≤", () => {
    const s = storm({ nearestKmByProvince: { "10": 300, "57": 0 } });
    expect(stormDistanceKm(s, "10")).toBe(300);
    expect(stormDistanceKm(s, "57")).toBe(0);
    expect(stormDistanceKm(s, "90")).toBeNull();
    const d = resp([s], [ok("gdacs-tc")]);
    expect(stormsWithin(d, "10")).toHaveLength(1);
    expect(stormsWithin(d, "10", 299)).toHaveLength(0);
    expect(stormsWithin(d, "90")).toHaveLength(0);
  });
});
