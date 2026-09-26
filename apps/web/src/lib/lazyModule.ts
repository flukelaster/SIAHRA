/**
 * ตัวโหลดโมดูลแบบ lazy ที่ "ลองใหม่ได้" — ใช้แทน `React.lazy` ทุกจุดที่แยก chunk
 * (แผงใน `panelRegistry.ts`, ป๊อปอัป/แผงกล้องของแผนที่, ศูนย์การแจ้งเตือน,
 * แคตตาล็อกภาษาอังกฤษ)
 *
 * เหตุที่ไม่ใช้ `React.lazy` ตรง ๆ: มันจำ promise ที่ **ล้มเหลว** ไว้ตลอดอายุของ
 * คอมโพเนนต์ ปุ่ม "ลองใหม่" ของ error boundary จึงได้ error เดิมกลับมาทุกครั้ง
 * แม้เน็ตจะกลับมาแล้ว ที่นี่เก็บ promise ไว้ระดับโมดูล (StrictMode เรนเดอร์ซ้ำก็ไม่
 * import สองรอบ) แต่ **ลบทิ้งเมื่อ reject** — การเรียก `load()` ครั้งถัดไปจึงเรียก
 * `import()` ใหม่จริง
 *
 * ไฟล์นี้ไม่มี React เลย (เทสได้ใน environment: "node")
 */
export interface LazyModule<T> {
  /**
   * promise **ตัวเดียวกัน** ทุกครั้ง (รวมหลัง resolve — `use()` ของ React ติดตามสถานะ
   * ตาม identity ของ promise) จนกว่าจะ reject — reject แล้วครั้งถัดไป import ใหม่
   */
  load(): Promise<T>;
  /** ค่าที่โหลดเสร็จแล้ว หรือ `undefined` ถ้ายัง (ใช้เรนเดอร์ตรง ๆ ไม่ต้อง suspend) */
  peek(): T | undefined;
}

export function lazyModule<T>(importer: () => Promise<T>): LazyModule<T> {
  let pending: Promise<T> | null = null;
  let value: { v: T } | null = null;
  return {
    load() {
      pending ??= importer().then(
        (v) => {
          value = { v };
          return v;
        },
        (err: unknown) => {
          // ไม่จำความล้มเหลว — ครั้งหน้าต้องได้ขอใหม่จริง (ออฟไลน์ชั่วคราว)
          pending = null;
          throw err;
        },
      );
      return pending;
    },
    peek() {
      return value?.v;
    },
  };
}

/**
 * ปุ่มที่กล่อง "โหลดส่วนนี้ไม่สำเร็จ" เสนอ ตามจำนวนครั้งที่ล้มติดกัน
 *
 * ครั้งแรกเสนอ "ลองใหม่" อย่างเดียว (เน็ตหลุดชั่วคราวคือกรณีที่พบบ่อยที่สุด) ถ้าลองใหม่
 * แล้วยังล้มอีก เพิ่ม "โหลดหน้าใหม่": หลัง deploy ไฟล์ chunk ชื่อเดิม (hash เดิม) ไม่มี
 * อยู่แล้ว และ URL ที่ Worker ไม่รู้จักได้ SPA shell กลับมาเป็น `200 text/html`
 * (AGENTS.md) — import URL เดิมซ้ำจะล้มแบบเดิมตลอดไป ทางออกเดียวคือโหลด index.html
 * ใหม่ที่ชี้ไปยัง chunk ชุดใหม่ ไม่โหลดหน้าใหม่เองโดยอัตโนมัติ (ผู้ใช้ที่ออฟไลน์จะติด
 * วงวนรีโหลด) ให้ผู้ใช้เป็นคนกด
 *
 * วัดจริง (Chromium ของ playwright-cli, 2026-09-26): เมื่อ `import()` ของ URL หนึ่งล้มแล้ว
 * เบราว์เซอร์จำความล้มเหลวนั้นใน module map — "ลองใหม่" ของ URL เดิมล้มทันทีแม้เน็ตกลับมา
 * แล้ว ทางที่กู้ได้จริงบน Chromium คือ "โหลดหน้าใหม่" ซึ่งปุ่มนี้โผล่ตั้งแต่การกดลองใหม่
 * ครั้งแรกที่ล้ม ส่วน `lazyModule` ยังเรียก `import()` ใหม่ทุกครั้ง เผื่อเบราว์เซอร์ที่ลองใหม่ได้
 */
export function chunkErrorActions(failures: number): { retry: true; reload: boolean } {
  return { retry: true, reload: failures >= 2 };
}

/**
 * error นี้มาจากการโหลด **โค้ด** ของ chunk ไม่สำเร็จหรือไม่ (ต่างจากโค้ดที่โหลดมาแล้วแต่เรนเดอร์พัง)
 * — `ChunkBoundary` ใช้เลือกข้อความ: "โหลดส่วนนี้ไม่สำเร็จ" กับ "ส่วนนี้แสดงผลไม่สำเร็จ"
 *
 * เบราว์เซอร์ไม่มีชนิด error เฉพาะสำหรับกรณีนี้ (ทุกตัวโยน `TypeError`) จึงดูจากข้อความ:
 *   - Chromium: "Failed to fetch dynamically imported module: …" (รวมกรณี SPA shell ตอบ
 *     `200 text/html` แทน chunk ที่ไม่มีแล้วหลัง deploy)
 *   - Firefox:  "error loading dynamically imported module: …"
 *   - Safari:   "Importing a module script failed."
 *   - ข้อความที่พูดถึง MIME type ของ module script (เบราว์เซอร์ที่รายงานเหตุตรง ๆ)
 *   - Vite: "Unable to preload CSS for …" (preload ของ CSS ที่ผูกกับ chunk ล้ม)
 * ไม่ตรงรูปแบบใด = ถือเป็น error ตอนเรนเดอร์ (ข้อความกลาง ๆ ไม่อ้างว่าเป็นเรื่องเครือข่าย)
 */
const CHUNK_LOAD_ERROR =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|module script.*mime type|mime type.*module script|unable to preload css/i;

export function isChunkLoadError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return CHUNK_LOAD_ERROR.test(err.message);
}
