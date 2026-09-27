/**
 * Cloudflare Turnstile — ตัวยืนยันว่าเป็นคน ก่อนขอ token นิรนามสำหรับโหวต (`POST /community/session`)
 *
 * - สคริปต์ `challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` ถูกโหลด **ตอนโหวตครั้งแรกเท่านั้น**
 *   (ไม่ใช่ตอนเปิดหน้า ไม่ใช่ตอนเปิดแผงรายงาน) และครั้งเดียวต่อหน้า — CSP อนุญาตโฮสต์นี้ใน `script-src` +
 *   `frame-src` (`public/_headers`, `docs/security.md`)
 * - widget ถูก render ลงกล่องที่ผู้เรียกให้มา (ในแถวโหวตของแผงรายงาน) แบบ `interaction-only`: มองไม่เห็นเว้นแต่
 *   Cloudflare ต้องให้ผู้ใช้กดยืนยันเอง — token ใช้ได้ครั้งเดียว จึง render ใหม่ทุกครั้งที่ต้องการ token แล้ว
 *   ถอด widget ทิ้งเมื่อได้ token/ล้มเหลว
 * - ไม่มี site key ใน build (`VITE_TURNSTILE_SITE_KEY` ว่าง) = ไม่มี Turnstile เลย: แผงรายงานบอก "ยังไม่เปิดให้
 *   โหวต" และไม่ส่งอะไร
 *
 * โมดูลนี้อยู่ใน chunk ของแผงรายงานเท่านั้น ไม่อยู่ใน entry
 */

export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
/** รอผู้ใช้ผ่านการยืนยัน (อาจต้องกดเอง) ไม่เกินนี้ แล้วถือว่าไม่สำเร็จ */
export const TURNSTILE_TIMEOUT_MS = 120_000;

interface TurnstileRenderOptions {
  sitekey: string;
  callback: (token: string) => void;
  "error-callback": (code?: string) => void;
  "expired-callback": () => void;
  "timeout-callback": () => void;
  appearance: "always" | "execute" | "interaction-only";
  theme: "light" | "dark" | "auto";
  language?: string;
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string | undefined;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** site key ของ build นี้ — null = ไม่ได้ตั้ง (โหวตปิดอยู่ ไม่โหลดสคริปต์) */
export function turnstileSiteKey(): string | null {
  const raw = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  const key = typeof raw === "string" ? raw.trim() : "";
  return key === "" ? null : key;
}

/** ความล้มเหลวของ Turnstile — `kind` ให้ UI เลือกข้อความ (โหลดสคริปต์ไม่ได้ ≠ ยืนยันไม่ผ่าน) */
export class TurnstileError extends Error {
  readonly kind: "script" | "challenge" | "timeout";
  constructor(kind: "script" | "challenge" | "timeout", message: string) {
    super(message);
    this.kind = kind;
    this.name = "TurnstileError";
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

/** โหลดสคริปต์ครั้งเดียวต่อหน้า — ล้มเหลว = ลืม promise ให้ครั้งถัดไปลองใหม่ */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = TURNSTILE_SCRIPT_URL;
    el.async = true;
    el.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new TurnstileError("script", "Turnstile script loaded without an API"));
    };
    el.onerror = () => {
      el.remove();
      reject(new TurnstileError("script", "Turnstile script could not be loaded"));
    };
    document.head.appendChild(el);
  }).catch((err: unknown) => {
    scriptPromise = null;
    throw err;
  });
  return scriptPromise;
}

/**
 * ขอ token หนึ่งใบ: render widget ลง `container` แล้วรอ callback — ถอด widget ทิ้งเสมอเมื่อจบ
 * (token ใช้ได้ครั้งเดียว ครั้งถัดไป render ใหม่)
 */
export async function getTurnstileToken(container: HTMLElement, siteKey: string, lang: string): Promise<string> {
  const api = await loadTurnstile();
  return new Promise<string>((resolve, reject) => {
    let widgetId: string | undefined;
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      if (widgetId !== undefined) {
        try {
          api.remove(widgetId);
        } catch {
          // ถอดไม่ได้ (กล่องถูกถอดไปแล้ว) — ไม่มีอะไรต้องทำต่อ
        }
      }
      fn();
    };
    const timer = window.setTimeout(
      () => finish(() => reject(new TurnstileError("timeout", "Turnstile timed out"))),
      TURNSTILE_TIMEOUT_MS,
    );
    try {
      widgetId = api.render(container, {
        sitekey: siteKey,
        callback: (token) => finish(() => resolve(token)),
        "error-callback": (code) =>
          finish(() => reject(new TurnstileError("challenge", `Turnstile error${code ? ` ${code}` : ""}`))),
        "expired-callback": () => finish(() => reject(new TurnstileError("challenge", "Turnstile token expired"))),
        "timeout-callback": () => finish(() => reject(new TurnstileError("timeout", "Turnstile challenge timed out"))),
        appearance: "interaction-only",
        theme: "dark",
        language: lang,
      });
    } catch (err) {
      finish(() => reject(new TurnstileError("challenge", err instanceof Error ? err.message : String(err))));
    }
  });
}
