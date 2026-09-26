import { describe, expect, it } from "vitest";
import type { SourceStatus } from "@siahra/shared-types";
import { floodSourceAgeParts, type FloodSourceAgeInput } from "./floodSourceAge";

const NOW = Date.parse("2026-09-26T06:00:00.000Z");
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

function status(over: Partial<SourceStatus>): SourceStatus {
  return {
    id: "gistda-flood",
    labelTh: "",
    labelEn: "",
    health: "ok",
    fetchedAt: iso(NOW - 3 * H),
    latestObservedAt: null,
    lastAttemptAt: null,
    lastError: null,
    detail: {},
    staleAfterSeconds: 10800,
    observedLagSeconds: null,
    nextAttemptAt: null,
    ...over,
  };
}

function input(over: Partial<FloodSourceAgeInput> = {}, gfm: Partial<FloodSourceAgeInput["gfm"]> = {}): FloodSourceAgeInput {
  return {
    apiDown: false,
    gistda: status({}),
    atIso: null,
    ...over,
    gfm: {
      sceneObservedAt: iso(NOW - 5 * 24 * H),
      noSceneInWindow: false,
      missing: false,
      error: false,
      loading: false,
      health: status({ id: "copernicus-gfm", health: "ok" }),
      ...gfm,
    },
  };
}

const text = (i: FloodSourceAgeInput, lang: "th" | "en" = "th") =>
  Object.fromEntries(floodSourceAgeParts(i, lang, NOW).map((p) => [p.key, p]));

describe("floodSourceAgeParts — GISTDA", () => {
  it("ปกติ: อัปเดตกี่ชั่วโมงก่อน", () => {
    const g = text(input()).gistda;
    expect(g.value).toBe("อัปเดต 3 ชม.ที่แล้ว");
    expect(g.tone).toBe("ok");
    expect(text(input(), "en").gistda.value).toBe("updated 3 h ago");
  });

  it("down: ไม่ได้ข้อมูลตั้งแต่เวลาที่ได้ข้อมูลสำเร็จครั้งสุดท้าย (ไม่ใช่อายุแบบ 'อัปเดต' และไม่อ้างว่ารู้ว่าล่มเมื่อไร)", () => {
    const input_ = input({ gistda: status({ health: "down", fetchedAt: "2026-09-10T02:00:00.000Z" }) });
    const g = text(input_).gistda;
    expect(g.value).toMatch(/^ไม่ได้ข้อมูลตั้งแต่ 10 ก\.ย\./);
    expect(text(input_, "en").gistda.value).toMatch(/^no data since /);
    expect(g.tone).toBe("bad");
  });

  it("fetchedAt null → 'ยังไม่เคยได้รับข้อมูล' ไม่ใช่ 'เมื่อสักครู่' — แม้สถานะจะเป็น down", () => {
    for (const health of ["down", "ok", "unknown"] as const) {
      const g = text(input({ gistda: status({ health, fetchedAt: null }) })).gistda;
      expect(g.value).toBe("ยังไม่เคยได้รับข้อมูล");
      expect(g.value).not.toMatch(/สักครู่/);
    }
    expect(text(input({ gistda: status({ fetchedAt: null }) }), "en").gistda.value).toBe("Never received any data");
  });

  it("ถาม /health ไม่ได้ ≠ GISTDA ล่ม", () => {
    const g = text(input({ apiDown: true })).gistda;
    expect(g.value).toBe("ตรวจสถานะไม่ได้ (ติดต่อ API ไม่ได้)");
    expect(g.value).not.toMatch(/ไม่ได้ข้อมูลตั้งแต่/);
  });

  it("stale/degraded: อายุ + ป้ายค้าง; ยังไม่ได้ /health: ยังไม่ทราบ", () => {
    expect(text(input({ gistda: status({ health: "stale" }) })).gistda.value).toBe("อัปเดตล่าสุด 3 ชม.ที่แล้ว · ค้าง");
    expect(text(input({ gistda: null })).gistda.value).toBe("ยังไม่ทราบสถานะ");
  });
});

describe("floodSourceAgeParts — Sentinel-1", () => {
  it("ฉากที่แสดงอยู่: กี่วันก่อน", () => {
    const s = text(input()).s1;
    expect(s.label).toBe("Sentinel-1 ผ่านล่าสุด");
    expect(s.value).toBe("5 วันที่แล้ว");
    expect(s.tone).toBe("warn");
    expect(text(input({}, { sceneObservedAt: iso(NOW - 20 * H) })).s1.tone).toBe("ok");
  });

  it("เลื่อนเวลาย้อนหลัง: อายุนับจากเวลาที่เลือก ไม่ใช่จากตอนนี้", () => {
    const s = text(input({ atIso: iso(NOW - 4 * 24 * H) })).s1;
    expect(s.value).toBe("1 วันที่แล้ว (นับจากเวลาที่เลือก)");
  });

  it("ไม่มีภาพในหน้าต่าง ≠ จังหวัดไม่มีฉากเลย ≠ โหลดไม่ได้", () => {
    expect(text(input({}, { sceneObservedAt: null, noSceneInWindow: true })).s1.value).toBe("ไม่มีภาพในช่วงนี้");
    expect(text(input({}, { sceneObservedAt: null, missing: true })).s1.value).toBe("ยังไม่มีภาพของจังหวัดนี้ในระบบ");
    expect(text(input({}, { sceneObservedAt: null, error: true })).s1.value).toBe("โหลดรายการภาพไม่ได้");
    expect(text(input({}, { sceneObservedAt: null })).s1.value).toBe("ยังไม่ทราบสถานะ");
  });

  it("job ดึงภาพค้าง → ต่อท้ายว่าไม่ได้อัปเดตตั้งแต่เมื่อไหร่ (อาจมีรอบบินใหม่กว่าที่ยังไม่ได้ดึง)", () => {
    const s = text(
      input({}, { sceneObservedAt: iso(NOW - 20 * H), health: status({ id: "copernicus-gfm", health: "stale", fetchedAt: "2026-09-02T14:47:50Z" }) }),
    ).s1;
    expect(s.value).toMatch(/^20 ชม\.ที่แล้ว · ระบบดึงภาพไม่ได้อัปเดตตั้งแต่ 2 ก\.ย\./);
    expect(s.tone).toBe("warn");
    const never = text(input({}, { health: status({ id: "copernicus-gfm", health: "unknown", fetchedAt: null }) })).s1;
    expect(never.value).toMatch(/ระบบดึงภาพยังไม่เคยทำงานสำเร็จ$/);
  });
});

describe("floodSourceAgeParts — ลำดับ", () => {
  it("ดาวเทียมที่เห็นจริงและยังได้ภาพมาก่อน: Sentinel-1 แล้วค่อย GISTDA", () => {
    expect(floodSourceAgeParts(input(), "th", NOW).map((p) => p.key)).toEqual(["s1", "gistda"]);
  });
});
