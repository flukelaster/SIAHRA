/**
 * ของใช้ร่วมของเทสต์บัญชีกล้อง (`cameraCatalogue.test.ts`, `build-*-cctv.test.ts`) — ไม่ใช่ชุดเทสต์เอง
 * (ชื่อไม่ตรง glob `*.test.ts` ของ vitest) แต่ `tsc --noEmit` ยังตรวจชนิดให้
 */
import type { ProvincePolygon } from "./provincePolygons.js";

/** จังหวัดสี่เหลี่ยมสมมุติ 99 ครอบ lon 100..101, lat 13..14 */
export const PROVINCES: ProvincePolygon[] = [
  {
    code: "99",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [100, 13],
          [101, 13],
          [101, 14],
          [100, 14],
          [100, 13],
        ],
      ],
    },
  },
];

export interface FakeResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  /** จำลองปลายทางช้า (ให้ทดสอบ timeout) */
  delayMs?: number;
}

export interface FakeCall {
  url: string;
  method: string;
  /** header `Origin` ที่ส่งไป — probe ต้องส่งเสมอ (DWR สะท้อน origin ใน CORS) */
  origin: string | null;
}

/**
 * `fetch` ปลอมจากตาราง url → คำตอบ: คีย์ที่ลงท้าย `*` จับคู่แบบ prefix; url ที่ไม่มีในตาราง หรือ
 * `delayMs` เกิน signal = โยน (เหมือนเครือข่ายล่ม/timeout → `unreachable`); ทุกคำขอถูกบันทึกใน `calls`
 */
export function fakeFetch(table: Record<string, FakeResponse | ((init: RequestInit | undefined) => FakeResponse)>): {
  fetch: typeof fetch;
  calls: FakeCall[];
} {
  const calls: FakeCall[] = [];
  const lookup = (url: string) => {
    if (url in table) return table[url]!;
    for (const [k, v] of Object.entries(table)) {
      if (k.endsWith("*") && url.startsWith(k.slice(0, -1))) return v;
    }
    return null;
  };
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers);
    calls.push({ url, method: (init?.method ?? "GET").toUpperCase(), origin: headers.get("origin") });
    const entry = lookup(url);
    if (entry === null) throw new TypeError("fetch failed");
    const r = typeof entry === "function" ? entry(init) : entry;
    if (r.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, r.delayMs);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }
    const body = r.body === undefined ? null : typeof r.body === "string" ? r.body : Buffer.from(r.body);
    return new Response(body, { status: r.status ?? 200, headers: r.headers ?? {} });
  };
  return { fetch: impl as typeof fetch, calls };
}
