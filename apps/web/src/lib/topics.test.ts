import { describe, expect, it } from "vitest";
import { countLayersOn } from "./layerCount";
import { PANEL_KEYS } from "./shellPrefs";
import {
  BADGE_SEVERITY,
  TOPICS,
  TOPIC_KEYS,
  defaultViewOf,
  mostSevereBadge,
  topicByKey,
  topicOf,
  viewForTopic,
} from "./topics";

describe("topics — การจัดแผงเป็นหัวข้อ", () => {
  it("สี่หัวข้อตามลำดับ พร้อมมุมมองย่อยตามสเปก", () => {
    expect(TOPICS.map((t) => t.key)).toEqual([...TOPIC_KEYS]);
    expect(TOPICS.map((t) => [t.key, [...t.views]])).toEqual([
      ["overview", ["impact"]],
      ["water", ["water", "north", "dams", "flood"]],
      ["weather", ["rain", "forecast", "storm"]],
      ["quake", ["quake"]],
    ]);
  });

  it("ทุกแผงอยู่ในหัวข้อเดียวพอดี และไม่มี layers", () => {
    const all = TOPICS.flatMap((t) => t.views);
    expect([...all].sort()).toEqual([...PANEL_KEYS].sort());
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain("layers");
    // ลำดับของ PANEL_KEYS = ลำดับหัวข้อ → มุมมองย่อย
    expect(all).toEqual([...PANEL_KEYS]);
  });

  it("topicOf: การแจ้งเตือนที่เปิดแผงไปถึงหัวข้อที่ถูก", () => {
    expect(topicOf("impact")).toBe("overview");
    expect(topicOf("storm")).toBe("weather");
    expect(topicOf("forecast")).toBe("weather");
    expect(topicOf("rain")).toBe("weather");
    expect(topicOf("flood")).toBe("water");
    expect(topicOf("north")).toBe("water");
    expect(topicOf("dams")).toBe("water");
    expect(topicOf("water")).toBe("water");
    expect(topicOf("quake")).toBe("quake");
  });

  it("defaultViewOf = มุมมองแรกของหัวข้อ", () => {
    expect(defaultViewOf("overview")).toBe("impact");
    expect(defaultViewOf("water")).toBe("water");
    expect(defaultViewOf("weather")).toBe("rain");
    expect(defaultViewOf("quake")).toBe("quake");
    for (const k of TOPIC_KEYS) expect(topicByKey(k).key).toBe(k);
  });

  it("viewForTopic: มุมมองล่าสุดของหัวข้อนั้น ไม่งั้นค่าเริ่มต้น — ไม่รับมุมมองของหัวข้ออื่น", () => {
    expect(viewForTopic("water", {})).toBe("water");
    expect(viewForTopic("water", { water: "dams" })).toBe("dams");
    expect(viewForTopic("weather", { water: "dams", weather: "storm" })).toBe("storm");
    // ค่าที่หลงมาผิดหัวข้อ (ไม่ควรเกิด แต่ห้ามเปิดแผงของหัวข้ออื่นใต้หัวข้อนี้)
    expect(viewForTopic("weather", { weather: "dams" })).toBe("rain");
  });
});

describe("topics — badge ของหัวข้อ", () => {
  it("ลำดับความรุนแรง: count > unreachable > degraded > neverEvaluated", () => {
    expect(BADGE_SEVERITY.count).toBeLessThan(BADGE_SEVERITY.unreachable);
    expect(BADGE_SEVERITY.unreachable).toBeLessThan(BADGE_SEVERITY.degraded);
    expect(BADGE_SEVERITY.degraded).toBeLessThan(BADGE_SEVERITY.neverEvaluated);
  });

  it("เลือกตัวที่รุนแรงที่สุด ข้าม null", () => {
    expect(mostSevereBadge([])).toBeNull();
    expect(mostSevereBadge([null, null])).toBeNull();
    expect(mostSevereBadge([null, { kind: "degraded" }])).toEqual({ kind: "degraded" });
    expect(mostSevereBadge([{ kind: "neverEvaluated" }, { kind: "unreachable" }, { kind: "degraded" }])).toEqual({
      kind: "unreachable",
    });
    expect(mostSevereBadge([{ kind: "unreachable" }, { kind: "count", n: 2 }])).toEqual({ kind: "count", n: 2 });
  });

  it("เสมอกัน = ตัวที่มาก่อนตามลำดับมุมมอง (ไม่บวกจำนวนข้ามแผง)", () => {
    const a = { kind: "count" as const, n: 3, title: "a" };
    const b = { kind: "count" as const, n: 7, title: "b" };
    expect(mostSevereBadge([a, b])).toBe(a);
    expect(mostSevereBadge([null, b, a])).toBe(b);
  });
});

describe("layerCount — ตัวเลขบนปุ่มชั้นข้อมูล", () => {
  it("นับเฉพาะชั้นที่เปิด", () => {
    expect(countLayersOn({ a: true, b: false, c: true })).toBe(2);
    expect(countLayersOn({})).toBe(0);
  });

  it("ไม่นับชั้นที่ build นี้ไม่มีแถวใน legend (เช่น cctv เมื่อปิดทุกแหล่ง)", () => {
    expect(countLayersOn({ imagery: true, cctv: true }, ["cctv"])).toBe(1);
    expect(countLayersOn({ imagery: true, cctv: true }, [])).toBe(2);
  });
});
