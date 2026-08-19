import { describe, expect, it } from "vitest";
import { en } from "./en";
import { th } from "./th";
import { CATALOGS, LANGS, translate } from "./index";

/**
 * `en.ts` ประกาศชนิดเป็น `Record<keyof typeof th, string>` อยู่แล้ว คีย์ที่ขาด/เกิน
 * จึงเป็น error ของ tsc — แต่ tsc ไม่ใช่เทส และ AC ของงานนี้เขียนไว้ว่า "คำแปลที่
 * หายไปต้องทำให้เทสแดง" ไฟล์นี้จึงตรวจซ้ำสามอย่างที่ชนิดข้อมูลจับไม่ได้:
 *
 *   1. ชุดคีย์เท่ากันทั้งสองทาง (กันกรณีที่ cast หรือ any เล็ดลอดเข้ามาวันหน้า)
 *   2. ไม่มีค่าไหนเป็นสตริงว่าง/เว้นวรรคล้วน — ค่าว่างคือคำแปลที่ "หายไปแบบเงียบ ๆ"
 *      ซึ่งเป็นอาการที่ AC ห้ามไว้ตรง ๆ
 *   3. ตัวแปร `{...}` ในแต่ละคีย์ตรงกันทุกภาษา — `{n}` ที่หายไปฝั่งเดียวแปลว่า
 *      ตัวเลขหล่นออกจากประโยคโดยไม่มีอะไรฟ้อง
 *
 * ข้อ 4 เป็นเรื่องความซื่อสัตย์ต่อข้อมูล: ห้ามมีคำที่อ่านออกมาเป็นการพยากรณ์
 * ความน่าจะเป็น หรือคะแนนความเสี่ยง เว้นแต่จะอยู่ในประโยคปฏิเสธ ("ไม่ใช่การพยากรณ์"
 * / "not a forecast")
 */

const keysOf = (o: Record<string, string>) => Object.keys(o).sort();

describe("i18n catalogs", () => {
  it("มีคีย์ชุดเดียวกันทั้งสองภาษา", () => {
    const thKeys = keysOf(th);
    const enKeys = keysOf(en);
    expect(enKeys.filter((k) => !thKeys.includes(k))).toEqual([]);
    expect(thKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
    expect(enKeys).toEqual(thKeys);
  });

  it.each(LANGS)("ไม่มีข้อความว่างใน catalog %s", (lang) => {
    const empty = Object.entries(CATALOGS[lang])
      .filter(([, v]) => v.trim() === "")
      .map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it("ตัวแปร {…} ของแต่ละคีย์ตรงกันทั้งสองภาษา", () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const mismatched = keysOf(th).filter(
      (k) =>
        vars(th[k as keyof typeof th]).join(",") !== vars(en[k as keyof typeof th]).join(","),
    );
    expect(mismatched).toEqual([]);
  });

  /**
   * คำต้องห้าม: ถ้าโผล่มาโดยไม่มีคำปฏิเสธนำหน้า แปลว่ามีข้อความที่อ่านเป็น
   * การพยากรณ์/ความน่าจะเป็น/คะแนนความเสี่ยง ซึ่งไม่มีแบบจำลองไหนรองรับ
   */
  it("ไม่มีข้อความไหนอ่านเป็นการพยากรณ์ ความน่าจะเป็น หรือคะแนนความเสี่ยง", () => {
    const banned =
      /forecast|probabilit|probable|chance of|likelihood|likely|predict|risk score|โอกาสเกิด|ความน่าจะเป็น|คาดการณ์|พยากรณ์/i;
    const negated = /not an? [\w ]*forecast|ไม่ใช่(การ)?พยากรณ์[ก-๙]*/gi;
    const offenders: string[] = [];
    for (const lang of LANGS) {
      for (const [key, value] of Object.entries(CATALOGS[lang])) {
        if (!banned.test(value)) continue;
        // ตัดประโยคปฏิเสธออกก่อน แล้วดูว่ายังเหลือคำต้องห้ามอยู่ไหม
        if (banned.test(value.replace(negated, ""))) offenders.push(`${lang}:${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("แทนค่าตัวแปร และคงวงเล็บไว้เมื่อไม่ได้ส่งค่ามา", () => {
    expect(translate("en", "time.minutesAgo", { n: 12 })).toBe("12 min ago");
    expect(translate("th", "time.minutesAgo", { n: 12 })).toBe("12 นาทีที่แล้ว");
    expect(translate("en", "time.minutesAgo", {})).toBe("{n} min ago");
  });

  /** ป้ายชนิดความรู้และสถานะแหล่งข้อมูลคือข้อความที่ห้ามเพี้ยนความหมาย (E3.2–E3.5) */
  it("แยก delayed ออกจาก stale ได้ในทั้งสองภาษา", () => {
    for (const lang of LANGS) {
      expect(CATALOGS[lang]["health.delayed"]).not.toBe(CATALOGS[lang]["health.stale"]);
      expect(CATALOGS[lang]["freshness.missing.observed"]).not.toBe(
        CATALOGS[lang]["freshness.missing.staticReference"],
      );
    }
    expect(en["health.delayed"]).toMatch(/not published/i);
    expect(en["health.stale"]).toMatch(/stale/i);
    expect(en["time.neverReceived"]).toMatch(/never received/i);
    expect(en["freshness.missing.staticReference"]).toMatch(/not recorded/i);
  });
});
