import { loadCatalog } from "./index";

/**
 * vitest `setupFiles` (vitest.config.ts): แคตตาล็อกอังกฤษเป็น chunk แยกที่แอปโหลดด้วย
 * `loadCatalog("en")` ก่อนสลับภาษา — เทสจำนวนมากเรียก `translator("en")` ตรง ๆ จึงโหลด
 * ผ่านตัวโหลดจริงตัวเดียวกันก่อนทุกไฟล์เทส (ไม่ได้ลงทะเบียนแคตตาล็อกเองทางลัด)
 */
await loadCatalog("en");
