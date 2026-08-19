import { exports as workerExports } from "cloudflare:workers";
import {
  LIVE_SOURCE_IDS,
  SOURCE_IDS,
  worstHealth,
  type HazardLayerDescriptor,
  type HealthResponse,
} from "@siahra/shared-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * สัญญาข้อมูล (E3.1/E3.2): ทุก route ที่ส่งข้อมูลภัยพิบัติต้องมี
 * `layer.sourceIds` ที่อ้าง id ซึ่ง /api/v1/health รายงานสถานะไว้จริง —
 * ไม่ใช่ชื่อที่ตั้งกันเองคนละที่ และเวลาทุกช่องต้องเป็น ISO หรือ null เท่านั้น
 *
 * ทุกเทสในไฟล์นี้ตัดเน็ตทิ้ง (stub globalThis.fetch) จึงเป็นการวัดสองอย่างพร้อมกัน:
 * รูปร่างของ response และพฤติกรรมของ Durable Object ที่ยัง "เย็น" คือยังไม่เคย
 * ดึงต้นทางสำเร็จเลย ซึ่งต้องได้ fetchedAt === null ไม่ใช่เวลาปลอม
 */
/**
 * `mayFail503` = route ที่ตอบ 503 อย่างซื่อสัตย์เมื่อยังไม่เคยดึงต้นทางสำเร็จ
 * (ประวัติระดับน้ำต้องยิงต้นทางรายสถานี) — ตอบ 503 ก็ยังต้องไม่มีเวลาปลอมในบอดี้
 * ส่วน /api/v1/archive/* ไม่อยู่ในรายการนี้เพราะไม่ได้ส่ง layer descriptor และ
 * ตอบ 404 เมื่อ R2 ว่าง
 */
const DATA_ROUTES: { path: string; mayFail503?: boolean }[] = [
  { path: "/api/v1/observations" },
  { path: "/api/v1/observations?province=50" },
  { path: "/api/v1/dams" },
  { path: "/api/v1/flood-extent/summary" },
  { path: "/api/v1/provinces/50/flood-extent" },
  { path: "/api/v1/radar/frames?hours=1" },
  { path: "/api/v1/stations/1/history?hours=24", mayFail503: true },
  { path: "/api/v1/earthquakes/recent?limit=5" },
];

const call = (path: string) => workerExports.default.fetch(new Request(`https://siahra-radar.co${path}`));

/** เวลาที่ยอมรับได้มีสองแบบเท่านั้น: null หรือ instant จริงในรูป ISO */
function expectIsoOrNull(value: unknown, where: string): void {
  if (value === null || value === undefined) return;
  expect(typeof value, `${where} ต้องเป็นสตริงหรือ null`).toBe("string");
  const s = value as string;
  expect(s, `${where} ห้ามเป็นค่าว่างหรือคำว่า now`).not.toBe("");
  expect(s.toLowerCase(), `${where} ห้ามเป็นคำว่า now`).not.toBe("now");
  expect(Number.isFinite(Date.parse(s)), `${where} ต้อง parse เป็นเวลาได้ (${s})`).toBe(true);
}

/**
 * เวลาที่ต้นทาง "เผยแพร่" ต้องไม่มีทางใหม่กว่าเวลาที่เรา "ได้รับ" — ถ้าล้ำหน้าได้
 * แปลว่ามีการเอาเวลาฝั่งเราไปสวมเป็นเวลาฝั่งต้นทาง (เคสจริง: WFS `timeStamp`
 * ของ GISTDA ซึ่งคือเวลาที่ GeoServer สร้าง response)
 */
/*
 * ข้อควรรู้: ในไฟล์นี้ `fetch` ถูก stub ให้ reject ทุกเคส DO จึงเย็นและ `fetchedAt`
 * เป็น null เสมอ — การ์ดข้างล่างเลย early-return ทุกเส้นทาง ที่นี่มันจึงเป็น
 * "ลวดสะดุด" สำหรับเทสเส้นทางที่ DO อุ่นซึ่งจะเพิ่มเข้ามาภายหลัง ไม่ใช่ความ
 * คุ้มครองที่ทำงานอยู่จริง ตัวที่จับเคส GISTDA ได้จริงคือ floodLayer.test.ts
 * ซึ่ง stub ให้ refresh สำเร็จก่อน แล้ว assert publishedAt เป็น null ตรง ๆ
 */
function expectPublishedNotAfterFetched(layer: HazardLayerDescriptor | undefined, where: string): void {
  if (!layer?.publishedAt || !layer.fetchedAt) return;
  expect(
    Date.parse(layer.publishedAt),
    `${where}: publishedAt (${layer.publishedAt}) ใหม่กว่า fetchedAt (${layer.fetchedAt})`,
  ).toBeLessThanOrEqual(Date.parse(layer.fetchedAt));
}

const TIME_KEY_RE = /(At|Time)$|^(asOf|t|time|updated)$/;

/** ไล่ทุกคีย์ที่หน้าตาเหมือนเวลาใน payload ทั้งก้อน */
function walkTimestamps(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.slice(0, 20).forEach((v, i) => walkTimestamps(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (TIME_KEY_RE.test(k) && (typeof v === "string" || v === null)) expectIsoOrNull(v, `${path}.${k}`);
      else walkTimestamps(v, `${path}.${k}`);
    }
  }
}

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network disabled in tests"));
});
afterEach(() => {
  fetchSpy.mockRestore();
});

async function healthIds(): Promise<Set<string>> {
  const res = await call("/api/v1/health");
  expect(res.status).toBe(200);
  const body = (await res.json()) as HealthResponse;
  return new Set(body.sources.map((s) => s.id));
}

describe("/api/v1/health", () => {
  it("รายงานเฉพาะ id ที่อยู่ในทะเบียน และครบทุกแหล่งที่เป็น live", async () => {
    const res = await call("/api/v1/health");
    const body = (await res.json()) as HealthResponse;
    for (const s of body.sources) {
      expect(SOURCE_IDS, `id ที่ไม่มีในทะเบียน: ${s.id}`).toContain(s.id);
      expect(s.labelTh.length).toBeGreaterThan(0);
      expect(s.labelEn.length).toBeGreaterThan(0);
      expectIsoOrNull(s.fetchedAt, `${s.id}.fetchedAt`);
      expectIsoOrNull(s.latestObservedAt, `${s.id}.latestObservedAt`);
      expectIsoOrNull(s.lastAttemptAt, `${s.id}.lastAttemptAt`);
    }
    const ids = new Set(body.sources.map((s) => s.id));
    for (const id of LIVE_SOURCE_IDS) expect([...ids], `แหล่ง live ที่ไม่มีใน /health: ${id}`).toContain(id);
    expectIsoOrNull(body.serverTime, "serverTime");
  });

  /**
   * E3.3: ความเงียบไม่ใช่ความแข็งแรง — ในเทสนี้เน็ตถูกตัด ทุก DO จึงเย็นสนิท
   * (`unknown`) และ `ok` ต้องเป็นเท็จ ไม่ใช่ true เพราะ "ยังไม่มีใครบ่น"
   */
  it("ok เป็นเท็จเมื่อมีแหล่งใด down หรือ unknown และ worst ตรงกับสถานะที่แย่ที่สุด", async () => {
    const res = await call("/api/v1/health");
    const body = (await res.json()) as HealthResponse;
    expect(body.sources.some((s) => s.health === "down" || s.health === "unknown")).toBe(true);
    expect(body.ok).toBe(false);
    expect(body.worst).toBe(worstHealth(body.sources.map((s) => s.health)));
    for (const s of body.sources) {
      expectIsoOrNull(s.nextAttemptAt, `${s.id}.nextAttemptAt`);
      expect(typeof s.observedLagSeconds === "number" || s.observedLagSeconds === null).toBe(true);
    }
  });
});

describe("data routes", () => {
  it("ทุก layer.sourceIds เป็นสับเซ็ตของ id ใน /api/v1/health", async () => {
    const ids = await healthIds();
    for (const { path, mayFail503 } of DATA_ROUTES) {
      const res = await call(path);
      if (mayFail503 && res.status === 503) continue; // ต้นทางล่ม = ตอบตามจริง ไม่มี layer ให้ตรวจ
      expect(res.status, path).toBe(200);
      const body = (await res.json()) as { layer?: HazardLayerDescriptor };
      expect(body.layer, `${path} ไม่มี layer descriptor`).toBeTruthy();
      const layer = body.layer as HazardLayerDescriptor;
      expect(layer.sourceIds.length, `${path} layer.sourceIds ว่าง`).toBeGreaterThan(0);
      expectPublishedNotAfterFetched(layer, path);
      for (const id of layer.sourceIds) {
        expect([...ids], `${path} อ้าง source "${id}" ที่ /health ไม่รายงาน`).toContain(id);
      }
    }
  }, 30_000);

  it("ไม่มี route ไหนส่งเวลาเป็น \"\" หรือ \"now\" และเวลาที่ยังไม่มีคือ null", async () => {
    for (const path of [...DATA_ROUTES.map((r) => r.path), "/api/v1/health"]) {
      const res = await call(path);
      walkTimestamps(await res.json(), path);
    }
  }, 30_000);

  it("Durable Object ที่ยังเย็น (ดึงต้นทางไม่สำเร็จเลย) ให้ fetchedAt = null ไม่ใช่เวลาปลอม", async () => {
    for (const { path, mayFail503 } of DATA_ROUTES) {
      const res = await call(path);
      if (mayFail503 && res.status === 503) continue;
      const body = (await res.json()) as { layer?: HazardLayerDescriptor };
      expect(body.layer?.fetchedAt, `${path} fetchedAt ต้องเป็น null ตอนยังไม่เคยดึงสำเร็จ`).toBeNull();
      expectIsoOrNull(body.layer?.publishedAt, `${path} publishedAt`);
    }
  }, 30_000);
});

describe("/api/v1/earthquakes", () => {
  it("recent มี descriptor แบบ observed/live ที่ชี้ไปยัง source \"earthquakes\"", async () => {
    const res = await call("/api/v1/earthquakes/recent?limit=5");
    const body = (await res.json()) as { layer: HazardLayerDescriptor; asOf: string };
    expect(body.layer.epistemicClass).toBe("observed");
    expect(body.layer.liveOrStatic).toBe("live");
    expect(body.layer.sourceIds).toEqual(["earthquakes"]);
    expectIsoOrNull(body.layer.fetchedAt, "earthquakes layer.fetchedAt");
    expectIsoOrNull(body.asOf, "earthquakes asOf");
  });

  it("เฟรม snapshot บน WebSocket แนบ layer มาด้วย", async () => {
    const res = await workerExports.default.fetch(
      new Request("https://siahra-radar.co/api/v1/earthquakes/live", { headers: { Upgrade: "websocket" } }),
    );
    expect(res.status).toBe(101);
    const ws = res.webSocket;
    expect(ws).toBeTruthy();
    const first = new Promise<string>((resolve, reject) => {
      ws!.addEventListener("message", (ev) => resolve(String(ev.data)));
      ws!.addEventListener("close", () => reject(new Error("closed before snapshot")));
    });
    ws!.accept();
    const msg = JSON.parse(await first) as { type: string; layer?: HazardLayerDescriptor };
    expect(msg.type).toBe("snapshot");
    expect(msg.layer?.sourceIds).toEqual(["earthquakes"]);
    expect(msg.layer?.fetchedAt ?? null).toBeNull();
    ws!.close();
  }, 15_000);
});
