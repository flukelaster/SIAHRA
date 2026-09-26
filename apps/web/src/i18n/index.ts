/**
 * i18n ขนาดเล็กที่เขียนเอง — ไม่มี runtime ของ framework ไหนเลย
 *
 * ทั้งแอปมีข้อความคงที่ไม่กี่ร้อยคีย์ และไม่ต้องการ pluralisation แบบ ICU
 * (ภาษาไทยไม่มีพหูพจน์ ส่วนอังกฤษที่ใช้ก็เป็นวลีนับหน่วยตรง ๆ) การลง i18next
 * ทั้งชุดจึงเป็นน้ำหนักบันเดิลที่ไม่ได้ซื้ออะไรกลับมา แทนที่ด้วย:
 *   - `th.ts` เป็นแหล่งความจริงของคีย์ · `en.ts` ผูกชนิดกับมันด้วย tsc
 *   - แทนค่าตัวแปรด้วย `{name}` แบบตรงไปตรงมา
 *   - `th.ts` อยู่ในบันเดิลหลัก (ภาษาเริ่มต้นต้องขึ้นทันที) ส่วน `en.ts` เป็น chunk แยก
 *     ที่โหลดด้วย `loadCatalog("en")` — `main.tsx` รอมันก่อนเรนเดอร์ครั้งแรกเมื่อภาษา
 *     เริ่มต้นของแท็บเป็นอังกฤษ และ `LanguageProvider` รอมันก่อนสลับภาษา จึงไม่มีจังหวะ
 *     ที่ `lang === "en"` แต่แคตตาล็อกยังไม่มา
 *
 * **ภาษาเริ่มต้นคือภาษาไทยเสมอ** (มติเจ้าของโครงการ, docs/roadmap.md §4) —
 * ห้ามเดาภาษาจาก `navigator.language` หรือ `Accept-Language` เด็ดขาด ผู้ใช้ไทย
 * ที่เบราว์เซอร์ตั้งเป็น en-US ต้องได้หน้าภาษาไทย ภาษาอังกฤษเข้าถึงได้ทาง
 * ปุ่มสลับหรือ `?lang=en` เท่านั้น
 */
import { lazyModule } from "../lib/lazyModule";
import { th } from "./th";

export type Lang = "th" | "en";

export const LANGS = ["th", "en"] as const;

/** มติเจ้าของโครงการ: ไทยเสมอ ไม่ว่าเบราว์เซอร์จะตั้งภาษาอะไรไว้ */
export const DEFAULT_LANG: Lang = "th";

/** คีย์ที่ใช้เก็บภาษาที่ผู้ใช้เลือกไว้เอง (เลือกเอง = ตั้งใจ จึงจำข้ามการโหลดได้) */
export const LANG_STORAGE_KEY = "siahra.lang";

export type MessageKey = keyof typeof th;
export type MessageVars = Record<string, string | number>;
export type TFunction = (key: MessageKey, vars?: MessageVars) => string;

type Catalog = Record<MessageKey, string>;

/** แคตตาล็อกที่โหลดแล้ว — ไทยมีเสมอ อังกฤษมีหลัง `loadCatalog("en")` สำเร็จ */
const CATALOGS: Partial<Record<Lang, Catalog>> = { th };

const LOADERS: Record<Exclude<Lang, "th">, () => Promise<Catalog>> = {
  en: lazyModule(() => import("./en").then((m) => m.en)).load,
};

/** แคตตาล็อกของภาษานี้พร้อมใช้แล้วหรือยัง (ไทย = พร้อมเสมอ) */
export function hasCatalog(lang: Lang): boolean {
  return CATALOGS[lang] !== undefined;
}

/**
 * โหลดแคตตาล็อกของภาษา (ครั้งเดียว — เรียกซ้ำได้ ไม่ import ซ้ำ) reject เมื่อโหลด
 * chunk ไม่สำเร็จ และครั้งถัดไปจะลองใหม่จริง (`lazyModule`)
 */
export async function loadCatalog(lang: Lang): Promise<void> {
  if (lang === "th" || CATALOGS[lang]) return;
  CATALOGS[lang] = await LOADERS[lang]();
}

/** แคตตาล็อกของภาษาที่โหลดแล้ว — โยน error ถ้ายังไม่ได้โหลด (ใช้ในเทส) */
export function catalogFor(lang: Lang): Catalog {
  const c = CATALOGS[lang];
  if (!c) throw new Error(`i18n: catalog "${lang}" not loaded — await loadCatalog("${lang}") first`);
  return c;
}

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
 *
 * ภาษาที่แคตตาล็อกยังไม่มา (ไม่ควรเกิด — ดูหัวไฟล์) ได้ข้อความไทยแทน ไม่ใช่ `undefined`
 */
export function translate(lang: Lang, key: MessageKey, vars?: MessageVars): string {
  const template = (CATALOGS[lang] ?? th)[key];
  if (!vars) return template;
  return template.replace(VAR_RE, (whole, name: string) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : whole,
  );
}

/** ตัวแปลที่ผูกภาษาไว้แล้ว — ใช้ในโมดูล pure ที่ไม่มี React context */
export function translator(lang: Lang): TFunction {
  return (key, vars) => translate(lang, key, vars);
}

export { th };
