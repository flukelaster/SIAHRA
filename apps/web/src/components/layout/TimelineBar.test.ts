import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LANGS, translator, type Lang } from "../../i18n";
import { LanguageContext } from "../../i18n/context";
import { floodCss } from "../../lib/floodStyle";
import { formatFetchedAt } from "../../lib/time";
import { applyRangeChange } from "../../lib/timelineRange";
import { TimelineBar, type TimelineMark } from "./TimelineBar";

/**
 * เรนเดอร์แถบเวลาจริงด้วย react-dom/server แล้วอ่านขีดรอบบิน Sentinel-1 (E14.F5):
 * ขีดในช่วง 72 ชม. (ช่วงเริ่มต้น) ต้องอยู่ที่ตำแหน่งจริง ขีดนอกช่วงต้องไม่ถูกวาด
 * และเวลาที่เลือกซึ่งเก่ากว่าช่วงต้องมีชิป "นอกช่วงของแถบเลื่อน"
 */
const NOW = Date.parse("2026-09-02T12:00:00Z");

function render(lang: Lang, props: { atIso: string | null; variant: "dense" | "full"; marks?: TimelineMark[] }): string {
  return renderToStaticMarkup(
    createElement(
      LanguageContext.Provider,
      { value: { lang, setLang: () => {}, t: translator(lang) } },
      createElement(TimelineBar, { ...props, onChange: () => {} }),
    ),
  );
}

const marks: TimelineMark[] = [
  // 36 ชม. ก่อน → กึ่งกลางของช่วง 72 ชม.
  { atIso: "2026-09-01T00:00:00.000Z", flooded: true, label: "flooded pass" },
  // 6 ชม. ก่อน → 11/12 ของราง
  { atIso: "2026-09-02T06:00:00.000Z", flooded: false, label: "dry pass" },
  // 10 วันก่อน → นอกช่วง 72 ชม. ห้ามวาด
  { atIso: "2026-08-23T12:00:00.000Z", flooded: true, label: "out of range pass" },
];

/** ปุ่มขีดที่เรนเดอร์: (data-flooded, style left) */
function markButtons(html: string): { flooded: string; left: string; title: string }[] {
  return [...html.matchAll(/<button[^>]*title="([^"]*)"[^>]*data-flooded="([01])"[^>]*style="left:([^"]*)"/g)].map((m) => ({
    title: m[1],
    flooded: m[2],
    left: m[3],
  }));
}

describe("TimelineBar — ขีดรอบบิน Sentinel-1", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["dense", "full"] as const)("วาดเฉพาะขีดในช่วง 72 ชม. ที่ตำแหน่งจริง (%s)", (variant) => {
    const html = render("th", { atIso: null, variant, marks });
    const btns = markButtons(html);
    expect(btns.map((b) => b.title)).toEqual(["flooded pass", "dry pass"]);
    expect(html).not.toContain("out of range pass");
    // 36/72 = 0.5 และ 66/72 = 0.91667 ของราง (นับจากกึ่งกลางหัวเลื่อน)
    expect(btns[0].left).toContain("0.50000");
    expect(btns[1].left).toContain("0.91667");
    expect(btns[0].flooded).toBe("1");
    expect(btns[1].flooded).toBe("0");
    // ขีดที่ท่วมใช้สีเดียวกับชั้น GFM บนแผนที่ (lib/floodStyle.ts) ไม่ใช่สีที่เลือกแยก
    expect(html).toContain(floodCss("extent"));
  });

  it("ไม่มีขีด → ไม่มีชั้นขีดเลย (ไม่ใช่กล่องว่าง)", () => {
    const t = translator("th");
    const html = render("th", { atIso: null, variant: "full", marks: [] });
    expect(html).not.toContain(`aria-label="${t("timeline.marks")}"`);
    expect(markButtons(html)).toEqual([]);
    // และมีขีด → มีชั้นขีดพร้อมชื่อกลุ่ม
    expect(render("th", { atIso: null, variant: "full", marks })).toContain(`aria-label="${t("timeline.marks")}"`);
  });

  it.each(LANGS)("เวลาที่เลือกเก่ากว่าช่วงของแถบ → ชิป 'นอกช่วงของแถบเลื่อน' (%s)", (lang) => {
    const t = translator(lang);
    const old = render(lang, { atIso: "2024-09-13T11:30:00.000Z", variant: "dense" });
    expect(old).toContain(t("timeline.outOfRange"));
    const oldFull = render(lang, { atIso: "2024-09-13T11:30:00.000Z", variant: "full" });
    expect(oldFull).toContain(t("timeline.outOfRange"));
    // ในช่วง → ไม่มีชิป
    const recent = render(lang, { atIso: "2026-09-01T00:00:00.000Z", variant: "dense" });
    expect(recent).not.toContain(t("timeline.outOfRange"));
    const live = render(lang, { atIso: null, variant: "dense" });
    expect(live).not.toContain(t("timeline.outOfRange"));
  });

  it.each(LANGS)("dense (มือถือ, overflow-hidden): ชิป 'นอกช่วง' *แทน* ชิปคลังถาวร ไม่ใช่ต่อท้ายจนถูกตัด (%s)", (lang) => {
    const t = translator(lang);
    // ปี 2024 = ทั้งนอกช่วง 72 ชม. และเก่ากว่า 7 วัน (มาจากคลัง) — dense แสดงชิปเดียว
    const old = render(lang, { atIso: "2024-09-13T11:30:00.000Z", variant: "dense" });
    expect(old).toContain(t("timeline.outOfRange"));
    expect(old).not.toContain(t("timeline.fromArchive"));
    // ชิปต้องมาก่อนป้ายวันเวลาที่มองเห็น (ท้ายแถบคือส่วนที่ถูกตัดก่อน) — ป้ายเดียวกัน
    // ปรากฏก่อนหน้าใน aria-valuetext ของ slider ด้วย จึงเทียบกับตำแหน่งสุดท้าย
    expect(old.indexOf(t("timeline.outOfRange"))).toBeLessThan(old.lastIndexOf(formatFetchedAt(lang, "2024-09-13T11:30:00.000Z")));
    // full (แถบสองบรรทัด flex-wrap) มีที่พอ — ยังแสดงทั้งสองชิปเหมือนเดิม
    const oldFull = render(lang, { atIso: "2024-09-13T11:30:00.000Z", variant: "full" });
    expect(oldFull).toContain(t("timeline.outOfRange"));
    expect(oldFull).toContain(t("timeline.fromArchive"));
    // ในช่วง 72 ชม. → ไม่มีชิปใดเลย
    const recent = render(lang, { atIso: "2026-09-01T00:00:00.000Z", variant: "dense" });
    expect(recent).not.toContain(t("timeline.outOfRange"));
    expect(recent).not.toContain(t("timeline.fromArchive"));
  });
});

describe("TimelineBar — เปลี่ยนช่วงของแถบ", () => {
  it("เปลี่ยนช่วง (72 ชม. / 7 วัน / 30 วัน) หยุดเล่นและเลื่อน viewport เท่านั้น — ไม่รีเซ็ต atIso กลับเป็นสด", () => {
    const setPlaying = vi.fn();
    const setRangeIdx = vi.fn();
    // ตัวจัดการนี้ไม่มี `onChange` ให้เรียกเลย: เลือกเหตุการณ์ปี 2024 แล้วกด "30 วัน"
    // ต้องยังอยู่ที่เหตุการณ์นั้น (ชิป "นอกช่วง" เป็นคนบอกว่าหัวเลื่อนไม่ครอบเวลานี้)
    for (const i of [0, 1, 2]) applyRangeChange(i, { setPlaying, setRangeIdx });
    expect(setRangeIdx.mock.calls).toEqual([[0], [1], [2]]);
    expect(setPlaying.mock.calls).toEqual([[false], [false], [false]]);
    expect(applyRangeChange.length).toBe(2);
  });

  it("เวลาที่เลือกไว้ยังเป็นป้ายวันเวลา (ไม่ใช่ 'สด') ทั้งสองแบบ", () => {
    const t = translator("th");
    const iso = "2024-09-13T11:30:00.000Z";
    for (const variant of ["dense", "full"] as const) {
      const html = render("th", { atIso: iso, variant });
      expect(html).toContain(formatFetchedAt("th", iso));
      expect(html).not.toContain(`>${t("timeline.live")}<`);
    }
  });
});
