/**
 * URL ของบัญชีกล้อง (static asset จาก ETL) — แยกเป็นโมดูลเล็กเพื่อให้ `useCctvCatalogue`
 * (อยู่ใน entry chunk) ไม่ import `cctv.ts`/`itic.ts` ทั้งไฟล์: โมดูลที่ entry กับ popup (lazy)
 * ใช้ร่วมกันถูกวางใน entry ทั้งก้อน ทั้งสองไฟล์ re-export ค่าเหล่านี้ ผู้เรียกเดิมไม่ต้องเปลี่ยน
 */

/** บัญชีกล้อง DWR (`npm run build:cctv -w apps/etl`) */
export const CCTV_CATALOGUE_URL = "/cctv/dwr-cameras.json";
/** บัญชีกล้อง iTIC (`npm run build:itic-cctv -w apps/etl`) */
export const ITIC_CATALOGUE_URL = "/cctv/itic-cameras.json";
