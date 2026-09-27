/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "0" = ถอดชั้นกล้อง CCTV ทั้งชั้นทุกแหล่ง (E15) — ดู `lib/featureFlags.ts` */
  readonly VITE_FEATURE_CCTV?: string;
  /** รายชื่อ `CameraSourceId` คั่นด้วยจุลภาคที่ต้องถอดออกจาก build นี้ (E15.3) เช่น "itic-cctv" */
  readonly VITE_FEATURE_CCTV_DISABLE?: string;
  /** "0" = ชื่อเล่นหนึ่งรุ่นของ `VITE_FEATURE_CCTV_DISABLE=itic-cctv` (E15.2) — ดู `lib/featureFlags.ts` */
  readonly VITE_FEATURE_ITIC?: string;
  /**
   * site key ของ Cloudflare Turnstile (สาธารณะ ไม่ใช่ความลับ) สำหรับโหวตรายงานจากประชาชน — ไม่ตั้ง = แผงรายงาน
   * บอก "ยังไม่เปิดให้โหวต" และไม่โหลดสคริปต์/ไม่ส่งอะไร (`lib/turnstile.ts`) ตอน dev ใช้ test key ของ Cloudflare
   * `1x00000000000000000000AA` (ผ่านเสมอ) คู่กับ test secret ฝั่ง api
   */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
