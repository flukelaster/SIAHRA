import { vi } from "vitest";

/**
 * ตัวช่วยร่วมของเทส normalisation (E5.6) — ไม่ใช่ไฟล์เทส (ไม่ลงท้าย .test.ts)
 * จึงไม่ถูกเก็บไปรัน
 *
 * ทุกไฟล์ในโฟลเดอร์นี้สตับ `globalThis.fetch` ตรง ๆ เพราะ pool 0.22 ไม่ export
 * `fetchMock` จาก "cloudflare:test" อีกแล้ว (ดูเหตุผลเต็มใน
 * test/earthquakeFeedCredentials.test.ts)
 */
export function respondJson(body: unknown, init?: ResponseInit): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(JSON.stringify(body), {
        headers: { "Content-Type": "application/json" },
        ...init,
      }),
  );
}

export function respondText(text: string, init?: ResponseInit): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(text, init));
}

export function respondBytes(bytes: ArrayBuffer): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(bytes));
}

/** URL ที่ adapter ยิงออกไปจริงในการเรียกครั้งล่าสุด — ใช้ตรวจพารามิเตอร์ที่ประกอบเอง */
export function lastRequestUrl(): string {
  const spy = globalThis.fetch as unknown as { mock: { calls: [RequestInfo | URL][] } };
  const calls = spy.mock.calls;
  const input = calls[calls.length - 1][0];
  return input instanceof Request ? input.url : String(input);
}
