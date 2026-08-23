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

/**
 * คำที่อ่านออกมาเป็นการพยากรณ์ ความน่าจะเป็น หรือคะแนนความเสี่ยง
 *
 * **ห้ามใส่แฟล็ก `g`** — ตัวนี้ถูกใช้กับ `.test()` ในลูป และ regex ที่มี `g` จะจำ
 * `lastIndex` ข้ามการเรียก ทำให้ผลสลับจริง/เท็จไปมาตามลำดับคีย์
 */
const BANNED =
  /forecast|probabilit|probable|chance of|likelihood|likely|predict|risk score|โอกาสเกิด|ความน่าจะเป็น|คาดการณ์|พยากรณ์/i;

/**
 * ประโยคปฏิเสธได้รับการยกเว้น — ข้อห้ามคือการ "กล่าวอ้าง" ว่ามีการพยากรณ์หรือ
 * ความน่าจะเป็น ไม่ใช่การ "ปฏิเสธ" ว่าไม่มี (E10.4 ใช้ข้อยกเว้นนี้เต็ม ๆ:
 * "ไม่ใช่การพยากรณ์ ไม่ใช่ความน่าจะเป็น" / "not a forecast, not a probability")
 *
 * ตั้งใจให้เป็น **allow-list ของคำต้องห้ามที่ถูกปฏิเสธ** ไม่ใช่ "อะไรก็ได้ที่มี
 * ไม่ใช่นำหน้า" — ไม่งั้นประโยคหนึ่งที่มีคำว่า "ไม่ใช่" อยู่คนละท่อนจะปลดล็อกคำ
 * ต้องห้ามในท่อนอื่นของประโยคเดียวกันไปด้วย ข้อยกเว้นจึงถูกรัดไว้สองชั้น:
 *
 *   - ฝั่งอังกฤษ: คั่นได้ **ไม่เกินหนึ่งคำ** (`(\w+ )?`) ระหว่าง "not a" กับคำ
 *     ต้องห้าม — พอดีกับข้อความจริงที่ยาวที่สุดคือ "not a flood forecast" ถ้าวันหน้า
 *     ต้องเขียนยาวกว่านี้ เทสจะแดงก่อน แล้วค่อยผ่อนอย่างตั้งใจ ไม่ใช่ผ่อนไว้ล่วงหน้า
 *   - ฝั่งไทย: **ไม่ให้คั่นเลย** — `ไม่ใช่` ตามด้วย `การ` (ถ้ามี) แล้วคำต้องห้ามติดกัน
 *     เท่านั้น (เดิมมี `[ก-๙]*` ต่อท้าย ซึ่งกลืนอักษรไทยที่ตามมาทั้งพรวดจนถึงคำ
 *     ต้องห้ามคำถัดไปในประโยคเดียวกันได้ — ภาษาไทยไม่เว้นวรรคระหว่างคำ ช่องโหว่จึง
 *     กว้างกว่าฝั่งอังกฤษด้วยซ้ำ)
 *
 * ขอบที่รู้ตัวและยอมรับ: คำที่คั่นได้หนึ่งคำนั้นถูกกลืนไปด้วย ("not a likely forecast"
 * จึงไม่ถูกจับ) — แต่ประโยคแบบนั้นยังเป็นการ "ปฏิเสธ" อยู่ดี ไม่ใช่การกล่าวอ้าง จึงไม่ใช่
 * ช่องโหว่ของข้อยกเว้น ส่วนสิ่งที่แพตเทิร์นนี้ไม่ได้คุมเลยคือประโยคที่เลี่ยงคำในลิสต์
 * ทั้งหมด ("7 in 10 that it floods") — นั่นเป็นขอบของ `BANNED` ไม่ใช่ของข้อยกเว้น
 *
 * มี `g` ได้เพราะถูกใช้กับ `.replace()` เท่านั้น (replace รีเซ็ต `lastIndex` ให้เอง)
 */
const NEGATED =
  /not an? (\w+ )?(forecast|prediction|probability|likelihood)|ไม่ใช่(การ)?(พยากรณ์|คาดการณ์|ความน่าจะเป็น|โอกาสเกิด)/gi;

/** ยังเหลือคำต้องห้ามอยู่ไหม หลังตัดประโยคปฏิเสธออกแล้ว */
const flagsAsClaim = (s: string) => BANNED.test(s.replace(NEGATED, ""));

/**
 * ข้อยกเว้นเดียวที่ยอมให้ "กล่าวอ้าง" คำว่าพยากรณ์ได้: ชั้นข้อมูลพยากรณ์ของ TMD
 * (E12) ซึ่งเป็นแบบจำลองเชิงตัวเลขของหน่วยงานภายนอกที่อ้างอิงได้จริง — ข้อห้ามเดิม
 * มีไว้กันเรา "แต่งตัวเลขอนาคตขึ้นเอง" ไม่ได้ห้ามอ้างถึงแบบจำลองที่มีเจ้าของ
 *
 * รัดไว้สองชั้น ไม่ใช่ปลดล็อกทั้งแคตาล็อก:
 *
 *   - **ผูกกับคีย์** (`ELIGIBLE_KEY`): เฉพาะคีย์ตระกูลพยากรณ์เท่านั้นที่มีสิทธิ์ —
 *     คีย์อื่นที่มีคำว่า forecast/พยากรณ์ ยังแดงเหมือนเดิม ถ้ายกเว้นตาม "ค่า" อย่างเดียว
 *     ประโยคไหนก็ตามที่เผลอพิมพ์คำว่า TMD ลงไปจะปลดล็อกตัวเองได้ทันที
 *   - **ต้องมีคำว่า "TMD" ในค่าเดียวกัน**: ประโยคต้องแบกที่มาของมันเองไปด้วยเสมอ
 *     ผู้ใช้ที่อ่านชิปนั้นต้องรู้ทันทีว่าใครเป็นคนพยากรณ์ ไม่ใช่โครงการนี้
 *
 * และข้อยกเว้นนี้ยก **เฉพาะคำตระกูลพยากรณ์** (`FORECAST_FAMILY`) ออกก่อนส่งค่าที่
 * เหลือให้ `flagsAsClaim` ตัวเดิมตัดสิน — คำตระกูลความน่าจะเป็น (probabilit,
 * chance of, likelihood, likely, risk score, โอกาสเกิด, ความน่าจะเป็น) ไม่เคยถูก
 * ตัดออก จึงยังโดน `BANNED` เต็ม ๆ แม้บนคีย์ที่มีสิทธิ์: การพยากรณ์เชิงกำหนด
 * (deterministic) ของ TMD ไม่ใช่ความน่าจะเป็น และห้ามเขียนให้อ่านเป็นอย่างนั้น
 */
const ELIGIBLE_KEY = /^(badge\.forecast|freshness\.missing\.forecast|forecast\.)/;

/**
 * คำตระกูล "พยากรณ์" ล้วน ๆ — ตัวเดียวที่ข้อยกเว้นข้างบนยกออกได้
 * มี `g` ได้เพราะใช้กับ `.replace()` เท่านั้น (replace รีเซ็ต `lastIndex` ให้เอง)
 */
const FORECAST_FAMILY = /forecast|predict|คาดการณ์|พยากรณ์/gi;

/** เหมือน `flagsAsClaim` แต่รู้จักคีย์ จึงยกข้อยกเว้นของชั้นพยากรณ์ TMD ได้ */
const flagsAsClaimForKey = (key: string, value: string) =>
  ELIGIBLE_KEY.test(key) && value.includes("TMD")
    ? flagsAsClaim(value.replace(FORECAST_FAMILY, ""))
    : flagsAsClaim(value);

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
    const offenders: string[] = [];
    for (const lang of LANGS) {
      for (const [key, value] of Object.entries(CATALOGS[lang])) {
        if (!BANNED.test(value)) continue;
        // ตัดประโยคปฏิเสธออกก่อน แล้วดูว่ายังเหลือคำต้องห้ามอยู่ไหม
        // (คีย์ตระกูลพยากรณ์ที่อ้าง TMD ไว้ในประโยคเดียวกันได้รับการยกเว้นเฉพาะคำพยากรณ์)
        if (flagsAsClaimForKey(key, value)) offenders.push(`${lang}:${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * ตัวคุมของการยกเว้นข้างบน — ใช้ `BANNED`/`NEGATED` **ตัวเดียวกัน** กับเทสข้างบน
   * โดยตั้งใจ ถ้าคัดลอกแพตเทิร์นมาไว้ที่นี่อีกชุด วันหนึ่งเทสข้างบนจะถูกผ่อน แล้ว
   * ตัวคุมยังเขียวอยู่เพราะมันคุมแพตเทิร์นคนละตัว
   *
   * สองกลุ่มที่ต้องถูกจับให้ได้เสมอ:
   *   1. ประโยคที่ "กล่าวอ้าง" ตรง ๆ (ไม่มีคำปฏิเสธเลย)
   *   2. **ประโยคที่เอาคำปฏิเสธมาบังคำต้องห้ามในท่อนอื่นของประโยคเดียวกัน** — กลุ่มนี้
   *      คือสิ่งเดียวที่คุมขอบของข้อยกเว้นได้จริง กลุ่มแรกไม่ได้แตะข้อยกเว้นเลย
   */
  it("ยังจับข้อความที่กล่าวอ้างความน่าจะเป็นได้ แม้จะผ่อนให้ประโยคปฏิเสธแล้ว", () => {
    // 1. กล่าวอ้างตรง ๆ
    expect(flagsAsClaim("โอกาสเกิดน้ำท่วม 70%")).toBe(true);
    expect(flagsAsClaim("a 70% chance of flooding")).toBe(true);
    expect(flagsAsClaim("ความน่าจะเป็นของน้ำท่วมพรุ่งนี้")).toBe(true);

    // 2. เอาคำปฏิเสธมาบังคำต้องห้ามที่อยู่คนละท่อนของประโยคเดียวกัน
    expect(flagsAsClaim("not a forecast but the flood probability is 70 percent")).toBe(true);
    expect(flagsAsClaim("not a seventy percent chance of flooding forecast")).toBe(true);
    expect(flagsAsClaim("This is not a prediction; likelihood of flooding is high")).toBe(true);
    // ภาษาไทยไม่เว้นวรรคระหว่างคำ คำปฏิเสธจึงติดกับคำต้องห้ามคำถัดไปได้เลย
    expect(flagsAsClaim("ไม่ใช่การพยากรณ์แต่โอกาสเกิดน้ำท่วม 70%")).toBe(true);
    expect(flagsAsClaim("ไม่ใช่ความน่าจะเป็นแต่คาดการณ์ว่าน้ำจะขึ้นพรุ่งนี้")).toBe(true);

    // และประโยคปฏิเสธที่ใช้จริงในแคตาล็อกต้องผ่าน
    expect(
      flagsAsClaim("คำนวณเองจากภูมิประเทศ + ค่าตรวจวัดจริง ไม่ใช่การพยากรณ์ ไม่ใช่ความน่าจะเป็น"),
    ).toBe(false);
    expect(flagsAsClaim("ประมาณจากความสูงภูมิประเทศ ไม่ใช่การพยากรณ์น้ำท่วม")).toBe(false);
    expect(
      flagsAsClaim(
        "Computed here from terrain plus real measurements — not a forecast, not a probability",
      ),
    ).toBe(false);
    expect(flagsAsClaim("Estimated from terrain elevation; not a flood forecast")).toBe(false);
  });

  /**
   * ตัวคุมของข้อยกเว้น "ชั้นพยากรณ์ TMD" — ใช้ `flagsAsClaimForKey` ตัวเดียวกับที่
   * เทสข้างบนใช้จริง ข้อยกเว้นนี้ต้องแคบสามทาง: ผูกกับคีย์ · ต้องมี TMD · ยกได้เฉพาะ
   * คำตระกูลพยากรณ์ ไม่ใช่คำตระกูลความน่าจะเป็น
   */
  it("ข้อยกเว้นของชั้นพยากรณ์ TMD ผูกกับคีย์ ต้องอ้าง TMD และไม่เคยปลดคำความน่าจะเป็น", () => {
    // ผ่าน: คีย์ที่มีสิทธิ์ + มี TMD อยู่ในประโยคเดียวกัน
    expect(flagsAsClaimForKey("badge.forecast", "พยากรณ์จากแบบจำลอง TMD")).toBe(false);
    expect(flagsAsClaimForKey("badge.forecast.title", "TMD numerical model forecast")).toBe(false);
    expect(
      flagsAsClaimForKey("freshness.missing.forecast", "ยังไม่เคยได้รับผลพยากรณ์จาก TMD"),
    ).toBe(false);

    // 1. คีย์ที่มีสิทธิ์แต่ไม่ได้อ้าง TMD → ยังต้องแดง (ประโยคไม่ได้แบกที่มาไปด้วย)
    expect(flagsAsClaimForKey("badge.forecast", "พยากรณ์อากาศ")).toBe(true);
    expect(flagsAsClaimForKey("badge.forecast.title", "A weather forecast")).toBe(true);

    // 2. คีย์ที่มีสิทธิ์แต่ใช้คำตระกูลความน่าจะเป็น → ยังต้องแดง แม้จะมี TMD
    expect(flagsAsClaimForKey("badge.forecast", "TMD บอกโอกาสเกิดฝน 70%")).toBe(true);
    expect(
      flagsAsClaimForKey("badge.forecast.title", "TMD forecast: 70% chance of flooding"),
    ).toBe(true);
    expect(flagsAsClaimForKey("forecast.note", "TMD forecast probability of rain")).toBe(true);

    // 3. คีย์ที่ไม่มีสิทธิ์ ต่อให้มี TMD ก็ยังแดง
    expect(flagsAsClaimForKey("badge.observed", "พยากรณ์ฝนจาก TMD")).toBe(true);
    expect(flagsAsClaimForKey("water.note", "TMD forecast for tomorrow")).toBe(true);
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
