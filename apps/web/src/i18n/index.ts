/**
 * i18n ขนาดเล็กที่เขียนเอง — ไม่มี runtime ของ framework ไหนเลย
 *
 * ทั้งแอปมีข้อความคงที่ไม่กี่ร้อยคีย์ และไม่ต้องการ pluralisation แบบ ICU
 * (ภาษาไทยไม่มีพหูพจน์ ส่วนอังกฤษที่ใช้ก็เป็นวลีนับหน่วยตรง ๆ) การลง i18next
 * ทั้งชุดจึงเป็นน้ำหนักบันเดิลที่ไม่ได้ซื้ออะไรกลับมา แทนที่ด้วย:
 *   - `th.ts` เป็นแหล่งความจริงของคีย์ · `en.ts` ผูกชนิดกับมันด้วย tsc
 *   - แทนค่าตัวแปรด้วย `{name}` แบบตรงไปตรงมา
 *
 * **ภาษาเริ่มต้นคือภาษาไทยเสมอ** (มติเจ้าของโครงการ, docs/roadmap.md §4) —
 * ห้ามเดาภาษาจาก `navigator.language` หรือ `Accept-Language` เด็ดขาด ผู้ใช้ไทย
 * ที่เบราว์เซอร์ตั้งเป็น en-US ต้องได้หน้าภาษาไทย ภาษาอังกฤษเข้าถึงได้ทาง
 * ปุ่มสลับหรือ `?lang=en` เท่านั้น
 */
import { th } from "./th";
import { en } from "./en";

export type Lang = "th" | "en";

export const LANGS = ["th", "en"] as const;

/** มติเจ้าของโครงการ: ไทยเสมอ ไม่ว่าเบราว์เซอร์จะตั้งภาษาอะไรไว้ */
export const DEFAULT_LANG: Lang = "th";

/** คีย์ที่ใช้เก็บภาษาที่ผู้ใช้เลือกไว้เอง (เลือกเอง = ตั้งใจ จึงจำข้ามการโหลดได้) */
export const LANG_STORAGE_KEY = "siahra.lang";

export type MessageKey = keyof typeof th;
export type MessageVars = Record<string, string | number>;
export type TFunction = (key: MessageKey, vars?: MessageVars) => string;

export const CATALOGS: Record<Lang, Record<MessageKey, string>> = { th, en };

export function isLang(value: unknown): value is Lang {
  return value === "th" || value === "en";
}

/** locale ของ `Intl.*` ต่อภาษา — เขตเวลาถูกตรึงไว้ที่ Asia/Bangkok แยกต่างหาก */
export const INTL_LOCALE: Record<Lang, string> = { th: "th-TH", en: "en-GB" };

const VAR_RE = /\{(\w+)\}/g;

/**
 * แปลหนึ่งคีย์ พร้อมแทนค่า `{name}`
 *
 * ตัวแปรที่ไม่ได้ส่งมาจะถูกทิ้งไว้เป็น `{name}` ให้เห็นคาตา ไม่ใช่แทนด้วยค่าว่าง —
 * ช่องว่างที่หายไปเงียบ ๆ คือสิ่งที่ทำให้ตัวเลขหล่นออกจากประโยคโดยไม่มีใครรู้
 */
export function translate(lang: Lang, key: MessageKey, vars?: MessageVars): string {
  const template = CATALOGS[lang][key];
  if (!vars) return template;
  return template.replace(VAR_RE, (whole, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : whole,
  );
}

/** ตัวแปลที่ผูกภาษาไว้แล้ว — ใช้ในโมดูล pure ที่ไม่มี React context */
export function translator(lang: Lang): TFunction {
  return (key, vars) => translate(lang, key, vars);
}

export { th, en };
