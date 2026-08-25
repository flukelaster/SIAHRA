import { env, exports as workerExports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import type { FloodExtentResponse } from "@siahra/shared-types";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../src/types";
import { keys as archiveKeys } from "../src/archive";

/**
 * E14.F1 — `GET /provinces/{NN}/flood-extent?at=` ตามเส้นเวลาของ TimelineBar:
 *   - ไม่มี `at`   → พฤติกรรมเดิมทุกไบต์ (ฉากล่าสุด)
 *   - `at` ≤ 30 วัน → กรอง polygon ด้วยช่วง first/last_seen จากตาราง hot,
 *                     `retrievedAt` = เวลาของฉากล่าสุดที่ดึงมาก่อน/ตรง `at`
 *   - `at` ก่อนฉากแรกที่บันทึกไว้ → features ว่าง + reason (ไม่ใช่ "ไม่มีน้ำท่วม")
 *   - `at` > 30 วัน → หา r2_key ด้วย PK แล้วอ่าน R2 ครั้งเดียว (แคชในหน่วยความจำ)
 *   - `at` พัง → 400
 *
 * seed ตรงลง SQLite ของ DO (ไม่ผ่าน refresh) เพื่อคุมเวลา first/last_seen เอง;
 * storage ของ DO แยกกันต่อไฟล์เทส และ DO ชื่อ "gistda" คือตัวที่ route เรียกใช้
 */
const appEnv = env as unknown as AppEnv;
const DAY = 86_400_000;
const NOW = Date.now();
/** ฉากล่าสุด (ครอบเวลาปัจจุบัน) และฉากก่อนหน้าใน hot window */
const SCENE_LATEST_MS = NOW - 2 * 3_600_000;
const SCENE_MID_MS = NOW - 10 * DAY;
/** ฉากเก่าที่อยู่ใน R2 เท่านั้น */
const SCENE_OLD_MS = NOW - 60 * DAY;
const OLD_KEY = archiveKeys.flood(new Date(SCENE_OLD_MS).toISOString());

const props = (tambonTh: string, provinceCode: string) => ({
  tambonTh,
  amphoeTh: "A",
  provinceTh: "P",
  provinceCode,
  floodAreaRai: 10,
  houses: 1,
  lat: 13.7,
  lon: 100.5,
});
const GEOM = { type: "Polygon", coordinates: [[[100.4, 13.6], [100.6, 13.6], [100.6, 13.8], [100.4, 13.8], [100.4, 13.6]]] };

async function gzipJson(value: unknown): Promise<ArrayBuffer> {
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

async function get(path: string): Promise<Response> {
  return workerExports.default.fetch(new Request(`https://siahra-radar.co${path}`));
}

beforeAll(async () => {
  // ห้ามให้เส้นทาง live ไปยิง GISTDA จริง — ตอบฉากว่างเพื่อให้ ensureFresh() จบเร็ว
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(JSON.stringify({ type: "FeatureCollection", features: [] }), {
        headers: { "Content-Type": "application/json" },
      }),
  );
  await runInDurableObject(appEnv.FLOOD_EXTENT.getByName("gistda"), (_instance, state) => {
    const sql = state.storage.sql;
    // ทำเหมือนเคยดึงสำเร็จแล้ว ณ SCENE_LATEST_MS เพื่อไม่ให้ live path เรียก cold start
    const latestIso = new Date(SCENE_LATEST_MS).toISOString();
    for (const [k, v] of [
      ["retrievedAt", latestIso],
      ["lastAttemptAt", latestIso],
      ["featureCount", "2"],
    ]) {
      sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", k, v);
    }
    const insert = (id: string, code: string, first: number, last: number) =>
      sql.exec(
        "INSERT OR REPLACE INTO flood_features (id, province_code, geom, props, first_seen_ms, last_seen_ms) VALUES (?, ?, ?, ?, ?, ?)",
        id,
        code,
        JSON.stringify(GEOM),
        JSON.stringify(props(id, code)),
        first,
        last,
      );
    // "still": เห็นตั้งแต่ 20 วันก่อนจนถึงตอนนี้ — ครอบทั้งฉากกลางและฉากล่าสุด
    insert("still", "10", NOW - 20 * DAY, SCENE_LATEST_MS);
    // "gone": เห็น 20→5 วันก่อน แล้วหายไป — ครอบฉากกลาง ไม่ครอบฉากล่าสุด
    insert("gone", "10", NOW - 20 * DAY, NOW - 5 * DAY);
    // "new": โผล่ 1 วันก่อน — ครอบฉากล่าสุด ไม่ครอบฉากกลาง
    insert("new", "10", NOW - 1 * DAY, SCENE_LATEST_MS);
    // จังหวัดอื่น ต้องไม่หลุดมา
    insert("other", "50", NOW - 20 * DAY, SCENE_LATEST_MS);
    for (const [ms, n] of [
      [SCENE_OLD_MS, 2],
      [SCENE_MID_MS, 2],
      [SCENE_LATEST_MS, 2],
    ] as const) {
      sql.exec(
        "INSERT OR REPLACE INTO flood_scenes (retrieved_ms, r2_key, feature_count) VALUES (?, ?, ?)",
        ms,
        archiveKeys.flood(new Date(ms).toISOString()),
        n,
      );
    }
  });
  await appEnv.HAZARD_BUCKET.put(
    OLD_KEY,
    await gzipJson({
      retrievedAt: new Date(SCENE_OLD_MS).toISOString(),
      featureCount: 2,
      features: [
        { type: "Feature", id: "old-10", properties: props("old-10", "10"), geometry: GEOM },
        { type: "Feature", id: "old-50", properties: props("old-50", "50"), geometry: GEOM },
      ],
    }),
    { httpMetadata: { contentType: "application/json", contentEncoding: "gzip" } },
  );
});

describe("/api/v1/provinces/10/flood-extent?at=", () => {
  it("(a) ไม่มี at → ฉากล่าสุดเหมือนเดิม ไม่มี reason", async () => {
    const res = await get("/api/v1/provinces/10/flood-extent");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=600");
    const body = (await res.json()) as FloodExtentResponse;
    expect(body.retrievedAt).toBe(new Date(SCENE_LATEST_MS).toISOString());
    expect(body.features.map((f) => f.id).sort()).toEqual(["new", "still"]);
    expect("reason" in body).toBe(false);
    expect(body.features[0]!.properties.firstSeenAt).not.toBeNull();
  }, 20_000);

  it("(b) at ใน hot window → เฉพาะ polygon ที่ครอบเวลานั้น และ retrievedAt = เวลาฉากที่ครอบ", async () => {
    const at = new Date(SCENE_MID_MS + 3_600_000).toISOString(); // 1 ชม.หลังฉากกลาง
    const res = await get(`/api/v1/provinces/10/flood-extent?at=${encodeURIComponent(at)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FloodExtentResponse;
    expect(body.retrievedAt).toBe(new Date(SCENE_MID_MS).toISOString());
    expect(body.features.map((f) => f.id).sort()).toEqual(["gone", "still"]);
    expect(body.layer.fetchedAt).toBe(body.retrievedAt);
    expect(body.reason).toBeUndefined();
    // ฉากที่หาได้ → แคชยาว
    const cc = res.headers.get("cache-control") ?? "";
    expect(Number(/max-age=(\d+)/.exec(cc)?.[1])).toBeGreaterThanOrEqual(3600);
    expect(Number(/s-maxage=(\d+)/.exec(cc)?.[1])).toBeGreaterThanOrEqual(86400);
  });

  it("(b') at หลังรอบดึงล่าสุด (เช่น 1 นาทีก่อน) → ชุดเดียวกับ live ไม่ใช่ศูนย์", async () => {
    // last_seen ประทับตอน refresh (SCENE_LATEST_MS) จึงน้อยกว่า at เสมอ — ต้องเทียบที่เวลาฉาก
    const at = new Date(NOW - 60_000).toISOString();
    const res = await get(`/api/v1/provinces/10/flood-extent?at=${encodeURIComponent(at)}`);
    const body = (await res.json()) as FloodExtentResponse;
    expect(body.retrievedAt).toBe(new Date(SCENE_LATEST_MS).toISOString());
    expect(body.features.map((f) => f.id).sort()).toEqual(["new", "still"]);
  });

  it("(c) at ก่อนฉากแรกที่บันทึกไว้ → features ว่าง, retrievedAt null, reason no-archived-scene", async () => {
    const at = new Date(SCENE_OLD_MS - DAY).toISOString();
    const res = await get(`/api/v1/provinces/10/flood-extent?at=${encodeURIComponent(at)}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as FloodExtentResponse;
    expect(body).toMatchObject({ retrievedAt: null, features: [], reason: "no-archived-scene" });
    expect(body.layer.fetchedAt).toBeNull();
  });

  it("(d) at > 30 วัน → อ่านฉากจาก R2 ครั้งเดียว แล้วตอบจากแคชในหน่วยความจำ", async () => {
    const at = new Date(SCENE_OLD_MS + 3_600_000).toISOString();
    const res = await get(`/api/v1/provinces/10/flood-extent?at=${encodeURIComponent(at)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FloodExtentResponse;
    expect(body.retrievedAt).toBe(new Date(SCENE_OLD_MS).toISOString());
    expect(body.features.map((f) => f.id)).toEqual(["old-10"]);
    // archive ไม่รู้ช่วงที่เห็นแต่ละ polygon — ต้องเป็น null ไม่ใช่เวลาฉากที่แต่งขึ้น
    expect(body.features[0]!.properties.firstSeenAt).toBeNull();
    expect(body.features[0]!.properties.lastSeenAt).toBeNull();
    expect(body.reason).toBeUndefined();

    // ลบไฟล์ใน R2 ทิ้ง — ถ้าคำขอที่สองยังตอบได้เท่าเดิม แปลว่าไม่ได้ get() ซ้ำ
    await appEnv.HAZARD_BUCKET.delete(OLD_KEY);
    const again = await get(`/api/v1/provinces/10/flood-extent?at=${encodeURIComponent(at)}`);
    const body2 = (await again.json()) as FloodExtentResponse;
    expect(body2.features.map((f) => f.id)).toEqual(["old-10"]);
    await runInDurableObject(appEnv.FLOOD_EXTENT.getByName("gistda"), (instance) => {
      const cache = (instance as unknown as { sceneCache: Map<string, unknown> }).sceneCache;
      expect(cache.size).toBe(1);
      expect(cache.has(OLD_KEY)).toBe(true);
    });
  });

  it("(d') แถว flood_scenes มีแต่ไฟล์ R2 หาย → no-archived-scene ไม่ใช่ 500", async () => {
    await runInDurableObject(appEnv.FLOOD_EXTENT.getByName("gistda"), (instance) => {
      (instance as unknown as { sceneCache: Map<string, unknown> }).sceneCache.clear();
    });
    const at = new Date(SCENE_OLD_MS + 3_600_000).toISOString();
    const res = await get(`/api/v1/provinces/10/flood-extent?at=${encodeURIComponent(at)}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FloodExtentResponse;
    expect(body).toMatchObject({ retrievedAt: null, features: [], reason: "no-archived-scene" });
  });

  it("(e) at พัง → 400 ไม่ใช่ 500", async () => {
    const res = await get("/api/v1/provinces/10/flood-extent?at=garbage");
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining("ISO-8601") });
  });
});
