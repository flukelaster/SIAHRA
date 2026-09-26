/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" = เปิดชั้นภาพกล้อง CCTV ของกรมทรัพยากรน้ำ (E15) — ดู `lib/featureFlags.ts` */
  readonly VITE_FEATURE_CCTV?: string;
  /** "0" = ถอดวิดีโอสดกล้องถนนของ iTIC (E15.2) — ดู `lib/featureFlags.ts` */
  readonly VITE_FEATURE_ITIC?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
