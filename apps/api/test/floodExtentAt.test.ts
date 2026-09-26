import { env, exports as workerExports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import type { FloodExtentResponse } from "@siahra/shared-types";
import { beforeAll, describe, expect, it } from "vitest";
import type { AppEnv } from "../src/types";
import { keys as archiveKeys } from "../src/archive";

/**
 * `GET /provinces/{NN}/flood-extent?at=` ตามเส้นเวลาของ TimelineBar (E14.F1 → E16.PR0):
 *   - `at` หลังรอบแรกของ API ใหม่ → PK (province_code, retrieved_ms) ≤ at → ไฟล์ `archive/flood-v2/`
 *   - `at` ก่อนรอบแรกของ API ใหม่ แต่หลังฉาก WFS เดิม → ฉาก WFS (`archive/flood/`) ที่แปลงรูปแล้ว
 *     พร้อม retrievedAt เก่าของมันเอง (ช่องว่าง 2026-09-10..cutover ยังมองเห็นได้)
 *   - `at` ก่อนทุกฉาก → features ว่าง + reason (ไม่ใช่ "ไม่มีน้ำท่วม")
 *   - `at` พัง → 400
 *
 * seed ตรงลง SQLite ของ DO + R2 (ไม่ผ่าน alarm) เพื่อคุมเวลาเอง; storage แยกต่อไฟล์เทส
 * และ DO ชื่อ "gistda" คือตัวที่ route เรียกใช้ — ไม่มี fetch ใด ๆ เพราะ ?at= ไม่แตะต้นทาง
 */
const appEnv = env as unknown as AppEnv;
const LEGACY_MS = Date.parse("2026-09-09T10:00:00.000Z");
const NEW1_MS = Date.parse("2026-09-26T08:00:00.000Z");
const NEW2_MS = Date.parse("2026-09-26T12:00:00.000Z");
const LEGACY_KEY = archiveKeys.flood(new Date(LEGACY_MS).toISOString());
const NEW1_KEY = archiveKeys.floodV2(new Date(NEW1_MS).toISOString(), "10");
const NEW2_KEY = archiveKeys.floodV2(new Date(NEW2_MS).toISOString(), "10");
const MISSING_KEY = archiveKeys.floodV2(new Date(NEW2_MS).toISOString(), "11");

const SQUARE = { type: "MultiPolygon", coordinates: [[[[100.4, 13.6], [100.6, 13.6], [100.6, 13.8], [100.4, 13.6]]]] };

async function putGz(key: string, value: unknown): Promise<void> {
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream("gzip"));
  await appEnv.HAZARD_BUCKET.put(key, await new Response(stream).arrayBuffer(), {
    httpMetadata: { contentType: "application/json", contentEncoding: "gzip" },
  });
}

function v2Body(retrievedMs: number, ids: string[]): FloodExtentResponse {
  const retrievedAt = new Date(retrievedMs).toISOString();
  return {
    provinceCode: "10",
    granularity: "h3-cell",
    matched: ids.length,
    acquisitions: [{ sensor: "S1D", acquiredAt: "2026-09-22T11:19:00.000Z" }],
    observedAt: "2026-09-22T11:19:00.000Z",
    features: ids.map((id) => ({
      type: "Feature",
      id,
      properties: {
        h3: id,
        provinceCode: "10",
        provinceTh: "กรุงเทพมหานคร",
        amphoeCode: "1001",
        amphoeTh: "A",
        tambonCode: "100101",
        tambonTh: "T",
        floodAreaM2: 1000,
        acquisitions: [{ sensor: "S1D", acquiredAt: "2026-09-22T11:19:00.000Z" }],
        observedAt: "2026-09-22T11:19:00.000Z",
        publishedAt: "2026-09-26T06:00:00.000Z",
        firstSeenAt: new Date(NEW1_MS).toISOString(),
      },
      geometry: SQUARE as FloodExtentResponse["features"][number]["geometry"],
    })),
    retrievedAt,
    layer: {
      id: "gistda-flood-extent",
      epistemicClass: "observed",
      liveOrStatic: "live",
      fetchedAt: retrievedAt,
      sourceIds: ["gistda-flood"],
    },
  };
}

async function get(path: string): Promise<Response> {
  return workerExports.default.fetch(new Request(`https://siahra-radar.co${path}`));
}

const at = (ms: number) => `/api/v1/provinces/10/flood-extent?at=${encodeURIComponent(new Date(ms).toISOString())}`;

beforeAll(async () => {
  await runInDurableObject(appEnv.FLOOD_EXTENT.getByName("gistda"), (_instance, state) => {
    const sql = state.storage.sql;
    sql.exec("INSERT INTO flood_scenes (retrieved_ms, r2_key, feature_count) VALUES (?, ?, ?)", LEGACY_MS, LEGACY_KEY, 2);
    for (const [code, ms, key, n] of [
      ["10", NEW1_MS, NEW1_KEY, 1],
      ["10", NEW2_MS, NEW2_KEY, 2],
      ["11", NEW2_MS, MISSING_KEY, 0],
    ] as const) {
      sql.exec(
        "INSERT INTO flood_province_scenes (province_code, retrieved_ms, r2_key, feature_count, content_hash) VALUES (?, ?, ?, ?, ?)",
        code,
        ms,
        key,
        n,
        `hash-${ms}`,
      );
    }
  });
  await putGz(LEGACY_KEY, {
    retrievedAt: new Date(LEGACY_MS).toISOString(),
    featureCount: 2,
    features: [
      {
        type: "Feature",
        id: "old-10",
        properties: { tambonTh: "ต.เก่า", amphoeTh: "A", provinceTh: "P", provinceCode: "10", floodAreaRai: 10, houses: 1, lat: 13.7, lon: 100.5 },
        geometry: { type: "Polygon", coordinates: [[[100.4, 13.6], [100.6, 13.6], [100.6, 13.8], [100.4, 13.6]]] },
      },
      {
        type: "Feature",
        id: "old-50",
        properties: { tambonTh: "ต.อื่น", amphoeTh: "A", provinceTh: "P", provinceCode: "50", floodAreaRai: 10, houses: 1, lat: 18.7, lon: 98.9 },
        geometry: { type: "Polygon", coordinates: [[[98.9, 18.7], [99.0, 18.7], [99.0, 18.8], [98.9, 18.7]]] },
      },
    ],
  });
  await putGz(NEW1_KEY, v2Body(NEW1_MS, ["89a"]));
  await putGz(NEW2_KEY, v2Body(NEW2_MS, ["89a", "89b"]));
});

describe("/api/v1/provinces/10/flood-extent?at=", () => {
  it("(a) at ระหว่างสองรอบใหม่ → ไฟล์ของรอบแรก, retrievedAt ของรอบนั้น, แคชยาวแบบ archived", async () => {
    const res = await get(at(NEW1_MS + 3_600_000));
    expect(res.status).toBe(200);
    const body = (await res.json()) as FloodExtentResponse;
    expect(body.retrievedAt).toBe(new Date(NEW1_MS).toISOString());
    expect(body.features.map((f) => f.id)).toEqual(["89a"]);
    expect(body.features[0]!.properties.firstSeenAt).toBe(new Date(NEW1_MS).toISOString());
    const cc = res.headers.get("cache-control") ?? "";
    expect(Number(/max-age=(\d+)/.exec(cc)?.[1])).toBeGreaterThanOrEqual(3600);
    expect(Number(/s-maxage=(\d+)/.exec(cc)?.[1])).toBeGreaterThanOrEqual(86400);
  });

  it("(b) at หลังรอบล่าสุด → รอบล่าสุด", async () => {
    const body = (await (await get(at(NEW2_MS + 60_000))).json()) as FloodExtentResponse;
    expect(body.retrievedAt).toBe(new Date(NEW2_MS).toISOString());
    expect(body.features.map((f) => f.id)).toEqual(["89a", "89b"]);
  });

  it("(c) at ก่อนรอบแรกของ API ใหม่ → ฉาก WFS เดิม (legacy reader) พร้อม retrievedAt เก่า — ช่องว่างมองเห็นได้", async () => {
    const res = await get(at(NEW1_MS - 60_000));
    expect(res.status).toBe(200);
    const body = (await res.json()) as FloodExtentResponse;
    expect(body.retrievedAt).toBe(new Date(LEGACY_MS).toISOString());
    expect(body.layer.fetchedAt).toBe(body.retrievedAt);
    expect(body.granularity).toBe("tambon");
    expect(body.features.map((f) => f.id)).toEqual(["old-10"]);
    const p = body.features[0]!.properties;
    // archive เดิมไม่ได้บันทึก h3/ภาพ/firstSeen — null ไม่ใช่ค่าที่แต่งขึ้น
    expect(p).toMatchObject({ h3: null, observedAt: null, firstSeenAt: null, acquisitions: [], floodAreaM2: 16000, tambonTh: "ต.เก่า" });
    expect(body.reason).toBeUndefined();
  });

  it("(d) at ก่อนทุกฉาก → features ว่าง, retrievedAt null, reason no-archived-scene, no-store", async () => {
    const res = await get(at(LEGACY_MS - 86_400_000));
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as FloodExtentResponse;
    expect(body).toMatchObject({ retrievedAt: null, features: [], reason: "no-archived-scene" });
    expect(body.layer.fetchedAt).toBeNull();
  });

  it("(e) ไฟล์ R2 อ่านครั้งเดียวแล้วตอบจากแคชในหน่วยความจำ", async () => {
    await appEnv.HAZARD_BUCKET.delete(NEW1_KEY);
    const body = (await (await get(at(NEW1_MS + 7_200_000))).json()) as FloodExtentResponse;
    expect(body.features.map((f) => f.id)).toEqual(["89a"]);
    await runInDurableObject(appEnv.FLOOD_EXTENT.getByName("gistda"), (instance) => {
      const cache = (instance as unknown as { sceneCache: Map<string, unknown> }).sceneCache;
      expect(cache.has(NEW1_KEY)).toBe(true);
      expect(cache.has(`${LEGACY_KEY}#10`)).toBe(true);
    });
  });

  it("(f) แถว PK มีแต่ไฟล์ R2 หาย → no-archived-scene ไม่ใช่ 500", async () => {
    const res = await get(`/api/v1/provinces/11/flood-extent?at=${encodeURIComponent(new Date(NEW2_MS + 60_000).toISOString())}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FloodExtentResponse;
    expect(body).toMatchObject({ retrievedAt: null, features: [], reason: "no-archived-scene" });
  });

  it("(g) at พัง → 400 ไม่ใช่ 500", async () => {
    const res = await get("/api/v1/provinces/10/flood-extent?at=garbage");
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("ISO-8601") });
  });
});
