/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "0" = ถอดชั้นกล้อง CCTV ทั้งชั้นทุกแหล่ง (E15) — ดู `lib/featureFlags.ts` */
  readonly VITE_FEATURE_CCTV?: string;
  /** รายชื่อ `CameraSourceId` คั่นด้วยจุลภาคที่ต้องถอดออกจาก build นี้ (E15.3) เช่น "itic-cctv" */
  readonly VITE_FEATURE_CCTV_DISABLE?: string;
  /** "0" = ชื่อเล่นหนึ่งรุ่นของ `VITE_FEATURE_CCTV_DISABLE=itic-cctv` (E15.2) — ดู `lib/featureFlags.ts` */
  readonly VITE_FEATURE_ITIC?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
