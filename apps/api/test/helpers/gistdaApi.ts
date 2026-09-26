import { env } from "cloudflare:workers";
import { vi } from "vitest";

/**
 * ต้นทาง GISTDA API gateway ปลอม (E16.PR0) — ไม่ใช่ไฟล์เทส (ไม่ลงท้าย .test.ts)
 *
 * ตอบตาม `pv_idn`/`offset`/`limit` ของ URL จริง แนบ `links[].href` ที่ **สะท้อนกุญแจ**
 * กลับมาแบบเดียวกับต้นทางจริง (วัดจริง 2026-09-26) เพื่อให้เทสพิสูจน์ได้ว่ามันไม่ถูกเก็บ
 * กุญแจถูกใส่/ถอดชัดเจนทุกเทส ไม่พึ่งว่าเครื่องที่รันมี `.dev.vars` หรือไม่
 */
export const TEST_GISTDA_KEY = "test-gistda-key-5f0c1e9a7b";

export function setGistdaKey(value: string | undefined): void {
  const mutable = env as unknown as Record<string, string | undefined>;
  if (value === undefined) delete mutable.GISTDA_API_KEY;
  else mutable.GISTDA_API_KEY = value;
}

export interface CellOptions {
  h3: string;
  province: string;
  tambon?: number;
  area?: number;
  fileName?: string;
  createdAt?: string;
  /** มุมล่างซ้ายของสี่เหลี่ยมเล็ก ๆ ที่ใช้เป็นรูปทรงของเซลล์ */
  lon?: number;
  lat?: number;
  /** แทนรูปทรงสี่เหลี่ยมเล็กทั้งก้อน (MultiPolygon coordinates) */
  coordinates?: number[][][][];
}

/** หนึ่งเซลล์ในรูปของต้นทาง — มี property นอก allowlist ปนมาด้วย (population ฯลฯ) */
export function gistdaCell(o: CellOptions): Record<string, unknown> {
  const lon = o.lon ?? 100.5;
  const lat = o.lat ?? 14.2;
  const d = 0.00223456789;
  return {
    type: "Feature",
    id: `mongo-${o.h3}`,
    geometry: {
      type: "MultiPolygon",
      coordinates: o.coordinates ?? [
        [
          [
            [lon + 0.000000001, lat],
            [lon + d, lat],
            [lon + d, lat + d],
            [lon, lat + d],
            [lon + 0.000000001, lat],
          ],
        ],
      ],
    },
    properties: {
      _area: o.area ?? 12345.678,
      _createdAt: o.createdAt ?? "2026-09-26T06:51:21.687Z",
      _id: `mongo-${o.h3}`,
      ap_idn: Number(`${o.province}01`),
      ap_tn: "อ.ตัวอย่าง",
      building: 3,
      f_area: o.area ?? 12345.678,
      file_name: o.fileName ?? "rd2_20260926_0613, S1D_20260922_1819",
      h3_address: o.h3,
      hospital: 1,
      mongo_id: "secret-internal-id",
      population: 42,
      pv_idn: Number(o.province),
      pv_tn: "จ.ตัวอย่าง",
      tb_idn: o.tambon ?? Number(`${o.province}0101`),
      tb_tn: "ต.ตัวอย่าง",
    },
  };
}

export interface ServeOptions {
  /** HTTP status ต่อจังหวัด (ไม่ระบุ = 200) */
  status?: (province: string) => number | undefined;
  /** แทน numberMatched ที่ต้นทางรายงาน */
  matched?: (province: string, actual: number) => number;
}

/** จำนวนคำขอที่ไปถึง GISTDA — เทสใช้ยืนยันว่าเส้นทางไหน "ไม่ยิง" */
export function gistdaCalls(): { url: string; headers: Headers }[] {
  const spy = globalThis.fetch as unknown as { mock?: { calls: [RequestInfo | URL, RequestInit | undefined][] } };
  return (spy.mock?.calls ?? [])
    .map(([input, init]) => ({
      url: input instanceof Request ? input.url : String(input),
      headers: new Headers(input instanceof Request ? input.headers : init?.headers),
    }))
    .filter((c) => c.url.includes("api-gateway.gistda.or.th"));
}

/**
 * mock fetch: `cells[NN]` คือเซลล์ทั้งหมดของจังหวัดนั้น (จังหวัดที่ไม่มีคีย์ = 0 เซลล์)
 * แบ่งหน้าตาม offset/limit ของ URL ที่ adapter ส่งมา
 */
export function serveGistda(cells: Record<string, Record<string, unknown>[]>, options: ServeOptions = {}): void {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.host !== "api-gateway.gistda.or.th") throw new Error(`unexpected upstream call to ${url.host}`);
    const province = String(Number(url.searchParams.get("pv_idn"))).padStart(2, "0");
    const status = options.status?.(province);
    if (status && status !== 200) {
      // body จริงของต้นทางตอนล้มอาจมีอะไรก็ได้ — ใส่กุญแจไว้เพื่อพิสูจน์ว่าไม่ถูกคัดลอกไปไหน
      return new Response(`upstream said no; key=${new Headers(init?.headers).get("API-Key")}`, { status });
    }
    const all = cells[province] ?? [];
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "10");
    const page = all.slice(offset, offset + limit);
    const key = new Headers(init?.headers).get("API-Key") ?? "";
    const body = {
      type: "FeatureCollection",
      features: page,
      links: [{ href: `${url.origin}${url.pathname}?${url.searchParams.toString()}&api_key=${key}`, rel: "self" }],
      numberMatched: options.matched ? options.matched(province, all.length) : all.length,
      numberReturned: page.length,
      timeStamp: new Date().toISOString(),
    };
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  });
}

/** ให้ DO ชื่อ `name` ดึงหนึ่งรอบผ่าน alarm() (ทางเดียวที่ยิงต้นทางได้) */
export async function runFloodAlarm(name = "gistda"): Promise<void> {
  const { runInDurableObject } = await import("cloudflare:test");
  const ns = (env as unknown as { FLOOD_EXTENT: DurableObjectNamespace<import("../../src/durable-objects/flood-extent").FloodExtentDO> }).FLOOD_EXTENT;
  await runInDurableObject(ns.getByName(name), (i) => i.alarm());
}
