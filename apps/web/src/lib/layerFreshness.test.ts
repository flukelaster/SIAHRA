import { describe, expect, it } from "vitest";
import type { EpistemicClass, HazardLayerDescriptor } from "@siahra/shared-types";
import {
  describeLayerFreshness,
  EPISTEMIC_BADGE,
  formatObservedAt,
  missingFetchedAtKey,
  OBSERVED_AT_FULL_DATE_AFTER_MS,
} from "./layerFreshness";
import { formatFullDateTime, formatTime, neverReceived } from "./time";
import { LANGS, translate, translator, type Lang } from "../i18n";

const NOW = Date.parse("2026-08-19T10:00:00+07:00");
const KINDS: EpistemicClass[] = [
  "observed",
  "static-reference",
  "illustrative",
  "probabilistic",
  "forecast",
];

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

const describe_ = (
  d: HazardLayerDescriptor,
  health: Parameters<typeof describeLayerFreshness>[1],
  lang: Lang = "th",
) => describeLayerFreshness(d, health, NOW, lang, translator(lang));

const missingText = (kind: EpistemicClass, lang: Lang) =>
  translate(lang, missingFetchedAtKey(kind));

describe("missingFetchedAtKey", () => {
  it("เลือกข้อความตามชนิดของชั้นข้อมูล ไม่ใช่ตามความเป็น null อย่างเดียว (th)", () => {
    expect(missingText("observed", "th")).toBe(neverReceived("th"));
    expect(missingText("static-reference", "th")).toBe("ไม่ได้บันทึกเวลาที่ดึงข้อมูล");
    expect(missingText("illustrative", "th")).toContain("ไม่มีการดึงข้อมูลรายครั้ง");
    expect(missingText("probabilistic", "th")).toContain("ยังไม่เคยได้รับผล");
    // ชั้นพยากรณ์ต้องบอกด้วยว่าเป็นผลของ TMD ไม่ใช่ของโครงการนี้
    expect(missingText("forecast", "th")).toContain("TMD");
  });

  it("ภาษาอังกฤษก็ต้องแยกความหมายเดียวกันไว้", () => {
    expect(missingText("observed", "en")).toBe(neverReceived("en"));
    expect(missingText("static-reference", "en")).toMatch(/not recorded/i);
    expect(missingText("illustrative", "en")).toMatch(/computed from terrain/i);
    expect(missingText("probabilistic", "en")).toMatch(/model output/i);
    expect(missingText("forecast", "en")).toMatch(/TMD/);
  });

  it.each(LANGS)(
    "ชั้นอ้างอิงคงที่ที่ไม่เคยจดเวลาไว้ ต้องไม่ถูกกล่าวหาว่า 'ดึงไม่สำเร็จ' (%s)",
    (lang) => {
      expect(missingText("static-reference", lang)).not.toBe(neverReceived(lang));
    },
  );
});

describe("describeLayerFreshness", () => {
  it.each(LANGS)(
    "fetchedAt = null ไม่เคยกลายเป็นเวลาหรือคำว่า 'ตอนนี้' ในทุกชนิด (%s)",
    (lang) => {
      for (const kind of KINDS) {
        const f = describe_(descriptor(kind, null), null, lang);
        expect(f.timeText).toContain(missingText(kind, lang));
        expect(f.timeText).not.toMatch(/ตอนนี้|เมื่อสักครู่|just now/i);
        // ไม่มีเวลาแบบ HH:mm ในส่วนของ "ดึงข้อมูล" (เวลาที่ตรวจวัดยังแสดงได้)
        expect(f.timeText.split(" · ")[1]).not.toMatch(/\d{1,2}:\d{2}/);
        expect(f.badge.label).toBe(translate(lang, EPISTEMIC_BADGE[kind].labelKey));
      }
    },
  );

  it("ข้อมูลสด: แสดงเวลาตรวจวัดและอายุของการดึง โดยไม่เป็นสีเหลือง", () => {
    const f = describe_(descriptor("observed", "2026-08-19T09:55:00+07:00"), "ok");
    expect(f.timeText).toContain("ตรวจวัด 09:50");
    expect(f.timeText).toContain("ดึงข้อมูล 5 นาทีที่แล้ว");
    expect(f.amber).toBe(false);
    expect(f.statusText).toBeNull();

    const fEn = describe_(descriptor("observed", "2026-08-19T09:55:00+07:00"), "ok", "en");
    expect(fEn.timeText).toContain("observed 09:50");
    expect(fEn.timeText).toContain("retrieved 5 min ago");
  });

  /**
   * ฉาก Sentinel-1 (E14.F4) อายุเป็นวันหรือปีได้ — "ตรวจวัด 06:14" ของฉากเมื่อวานซืน
   * อ่านเหมือนของวันนี้ทุกประการ จึงต้องมีวันกำกับเมื่อเก่ากว่า 24 ชม. ส่วนแหล่ง
   * ราย 5 นาที (ภายใน 24 ชม.) ยังเป็นเวลานาฬิกาอย่างเดิม
   */
  it.each(LANGS)("observedAt เก่ากว่า 24 ชม. แสดงวัน-เดือน-ปี + เวลา ไม่ใช่เวลาอย่างเดียว (%s)", (lang) => {
    const old = "2026-08-31T23:14:35Z"; // ~37 ชม. ก่อน NOW ของเทสด้านล่าง
    const now = Date.parse("2026-09-02T12:00:00Z");
    const d: HazardLayerDescriptor = {
      ...descriptor("observed", "2026-09-02T11:55:00Z"),
      id: "flood-gfm-extent",
      observedAt: old,
    };
    const f = describeLayerFreshness(d, "ok", now, lang, translator(lang));
    expect(f.timeText).toContain(formatFullDateTime(lang, old));
    expect(f.timeText).toContain(translate(lang, "freshness.observedAt", { time: formatFullDateTime(lang, old) }));
    // ปีต้องอยู่ในข้อความ (ฉากปี 2024 ต้องไม่อ่านเป็นปีนี้)
    const scene2024 = "2024-09-13T11:21:00Z";
    expect(formatObservedAt(lang, scene2024, now)).toBe(formatFullDateTime(lang, scene2024));
    expect(formatObservedAt(lang, scene2024, now)).toMatch(/2024|2567/);
  });

  it.each(LANGS)("observedAt ภายใน 24 ชม. ยังเป็นเวลานาฬิกาอย่างเดียว — ชั้นอื่นไม่เปลี่ยน (%s)", (lang) => {
    const f = describe_(descriptor("observed", "2026-08-19T09:55:00+07:00"), "ok", lang);
    expect(f.timeText).toContain(translate(lang, "freshness.observedAt", { time: formatTime(lang, "2026-08-19T09:50:00+07:00") }));
    expect(f.timeText).not.toContain("2026");
    // ขอบพอดี 24 ชม. ยังเป็นเวลาอย่างเดียว; เกินหนึ่งมิลลิวินาทีจึงเป็นวัน-เวลาเต็ม
    const iso = "2026-08-18T10:00:00+07:00";
    const edge = Date.parse(iso) + OBSERVED_AT_FULL_DATE_AFTER_MS;
    expect(formatObservedAt(lang, iso, edge)).toBe(formatTime(lang, iso));
    expect(formatObservedAt(lang, iso, edge + 1)).toBe(formatFullDateTime(lang, iso));
  });

  it("เกิน staleAfterSeconds = เหลือง; ชั้นคงที่ที่ไม่มีเวลาดึง = ไม่เหลือง", () => {
    expect(describe_(descriptor("observed", "2026-08-19T09:00:00+07:00"), "ok").amber).toBe(true);
    expect(describe_(descriptor("observed", null), null).amber).toBe(true);
    expect(describe_(descriptor("static-reference", null), null).amber).toBe(false);
    expect(describe_(descriptor("illustrative", null), null).amber).toBe(false);
    // ชั้นพยากรณ์มีรอบดึงจริง ดึงไม่สำเร็จจึงต้องเหลืองเหมือนข้อมูลตรวจวัด
    expect(describe_(descriptor("forecast", null), null).amber).toBe(true);
  });

  it("delayed พูดคนละประโยคกับข้อมูลค้าง (E3.3) แต่ยังเตือนด้วยสีเหมือนกัน", () => {
    const f = describe_(descriptor("observed", "2026-08-19T09:59:00+07:00"), "delayed");
    expect(f.statusText).toBe("ต้นทางยังไม่ส่งค่าใหม่");
    expect(f.amber).toBe(true);
    expect(describe_(descriptor("observed", "2026-08-19T09:59:00+07:00"), "stale").statusText).toBe(
      "ข้อมูลค้าง",
    );
  });

  it.each(LANGS)("delayed กับ stale ยังเป็นคนละข้อความในภาษา %s", (lang) => {
    const at = "2026-08-19T09:59:00+07:00";
    const delayed = describe_(descriptor("observed", at), "delayed", lang).statusText;
    const stale = describe_(descriptor("observed", at), "stale", lang).statusText;
    expect(delayed).not.toBe(stale);
    expect(delayed).toBeTruthy();
    expect(stale).toBeTruthy();
  });
});
