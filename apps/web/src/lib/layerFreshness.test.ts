import { describe, expect, it } from "vitest";
import type { EpistemicClass, HazardLayerDescriptor } from "@siahra/shared-types";
import { describeLayerFreshness, EPISTEMIC_BADGE, missingFetchedAtText } from "./layerFreshness";
import { NEVER_RECEIVED_TH } from "./time";

const NOW = Date.parse("2026-08-19T10:00:00+07:00");
const KINDS: EpistemicClass[] = ["observed", "static-reference", "illustrative", "probabilistic"];

function descriptor(kind: EpistemicClass, fetchedAt: string | null): HazardLayerDescriptor {
  return {
    id: `test-${kind}`,
    epistemicClass: kind,
    liveOrStatic: kind === "observed" ? "live" : "static",
    observedAt: "2026-08-19T09:50:00+07:00",
    publishedAt: null,
    fetchedAt,
    staleAfterSeconds: 1800,
    sourceIds: ["thaiwater"],
  };
}

describe("missingFetchedAtText", () => {
  it("เลือกข้อความตามชนิดของชั้นข้อมูล ไม่ใช่ตามความเป็น null อย่างเดียว", () => {
    expect(missingFetchedAtText("observed")).toBe(NEVER_RECEIVED_TH);
    expect(missingFetchedAtText("static-reference")).toBe("ไม่ได้บันทึกเวลาที่ดึงข้อมูล");
    expect(missingFetchedAtText("illustrative")).toContain("ไม่มีการดึงข้อมูลรายครั้ง");
    expect(missingFetchedAtText("probabilistic")).toContain("ยังไม่เคยได้รับผล");
    // ชั้นอ้างอิงคงที่ที่ไม่เคยจดเวลาไว้ ต้องไม่ถูกกล่าวหาว่า "ดึงไม่สำเร็จ"
    expect(missingFetchedAtText("static-reference")).not.toBe(NEVER_RECEIVED_TH);
  });
});

describe("describeLayerFreshness", () => {
  it("fetchedAt = null ไม่เคยกลายเป็นเวลาหรือคำว่า 'ตอนนี้' ในทุกชนิด", () => {
    for (const kind of KINDS) {
      const f = describeLayerFreshness(descriptor(kind, null), null, NOW);
      expect(f.timeText).toContain(missingFetchedAtText(kind));
      expect(f.timeText).not.toMatch(/ตอนนี้|เมื่อสักครู่/);
      // ไม่มีเวลาแบบ HH:mm ในส่วนของ "ดึงข้อมูล" (เวลาที่ตรวจวัดยังแสดงได้)
      expect(f.timeText.split(" · ")[1]).not.toMatch(/\d{1,2}:\d{2}/);
      expect(f.badge).toBe(EPISTEMIC_BADGE[kind]);
    }
  });

  it("ข้อมูลสด: แสดงเวลาตรวจวัดและอายุของการดึง โดยไม่เป็นสีเหลือง", () => {
    const f = describeLayerFreshness(
      descriptor("observed", "2026-08-19T09:55:00+07:00"),
      "ok",
      NOW,
    );
    expect(f.timeText).toContain("ตรวจวัด 09:50");
    expect(f.timeText).toContain("ดึงข้อมูล 5 นาทีที่แล้ว");
    expect(f.amber).toBe(false);
    expect(f.statusText).toBeNull();
  });

  it("เกิน staleAfterSeconds = เหลือง; ชั้นคงที่ที่ไม่มีเวลาดึง = ไม่เหลือง", () => {
    expect(describeLayerFreshness(descriptor("observed", "2026-08-19T09:00:00+07:00"), "ok", NOW).amber).toBe(true);
    expect(describeLayerFreshness(descriptor("observed", null), null, NOW).amber).toBe(true);
    expect(describeLayerFreshness(descriptor("static-reference", null), null, NOW).amber).toBe(false);
    expect(describeLayerFreshness(descriptor("illustrative", null), null, NOW).amber).toBe(false);
  });

  it("delayed พูดคนละประโยคกับข้อมูลค้าง (E3.3) แต่ยังเตือนด้วยสีเหมือนกัน", () => {
    const f = describeLayerFreshness(descriptor("observed", "2026-08-19T09:59:00+07:00"), "delayed", NOW);
    expect(f.statusText).toBe("ต้นทางยังไม่ส่งค่าใหม่");
    expect(f.amber).toBe(true);
    expect(describeLayerFreshness(descriptor("observed", "2026-08-19T09:59:00+07:00"), "stale", NOW).statusText).toBe(
      "ข้อมูลค้าง",
    );
  });
});
