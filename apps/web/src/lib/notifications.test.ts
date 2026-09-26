import { describe, expect, it } from "vitest";
import type {
  ActiveAlertsResponse,
  AlertEvent,
  HazardLayerDescriptor,
  HealthResponse,
  ProvinceForecastResponse,
  SourceStatus,
  StormsResponse,
  StormTrack,
} from "@siahra/shared-types";
import {
  buildNotifications,
  itemsForTab,
  markAllSeen,
  NOTIFICATIONS_STORAGE_KEY,
  notificationTimeText,
  parseSeen,
  readSeen,
  SEEN_CAP,
  tabCounts,
  unreadCount,
  writeSeen,
  type NotificationInputs,
} from "./notifications";

const alert = (id: string, level: "high" | "severe" = "high", stale = false): AlertEvent =>
  ({
    id,
    localAuthorityId: `la-${id}`,
    level,
    triggeredAt: "2026-09-25T01:00:00Z",
    stale,
  }) as unknown as AlertEvent;

const evaluated = (alerts: AlertEvent[]): ActiveAlertsResponse => ({
  total: alerts.length,
  evaluatedAt: "2026-09-25T02:00:00Z",
  alerts,
});

const layer = {} as HazardLayerDescriptor;
const forecastData = (daily: Array<{ validAt: string; rainMm: number | null }>): ProvinceForecastResponse => ({
  layers: { hourly: layer, daily: layer },
  batch: {
    provinceCode: "57",
    batchId: "batch-xyz",
    fetchedAt: "2026-09-25T03:00:00Z",
    queryPoint: { lat: 19.9, lon: 99.8 },
    hourly: [],
    daily: daily.map((d) => ({ ...d, tempC: null, cond: null })),
  },
});

const source = (over: Partial<SourceStatus>): SourceStatus => ({
  id: "thaiwater",
  labelTh: "x",
  labelEn: "x",
  health: "ok",
  fetchedAt: "2026-09-25T03:00:00Z",
  latestObservedAt: "2026-09-25T03:00:00Z",
  lastAttemptAt: "2026-09-25T03:00:00Z",
  lastError: null,
  detail: {},
  staleAfterSeconds: 900,
  observedLagSeconds: 900,
  nextAttemptAt: null,
  ...over,
});
const healthOf = (sources: SourceStatus[]): HealthResponse => ({
  ok: false,
  worst: "down",
  serverTime: "2026-09-25T03:00:00Z",
  sources,
});

const err = { key: "error.loadFailed" } as const;
const base = (over: Partial<NotificationInputs> = {}): NotificationInputs => ({
  provinceCode: "57",
  activeAlerts: { data: evaluated([]), loading: false, error: null },
  forecast: { data: forecastData([]), loading: false, error: null },
  apiHealth: { health: healthOf([source({})]), apiDown: false, checkedAt: "2026-09-25T03:00:00Z" },
  ...over,
});

const PCT = /%|percent|chance|probab|likel|โอกาส|ความน่าจะเป็น/i;

describe("notifications — แจ้งเตือน อปท. (สี่สถานะตาม alertSummary)", () => {
  it("ประเมินแล้วไม่มีอะไร active + ทุกแหล่งปกติ → ไม่มีแถวเลย", () => {
    expect(buildNotifications(base(), "en")).toEqual([]);
  });

  it("กำลังโหลด → ไม่พูดแทนต้นทาง", () => {
    const items = buildNotifications(
      base({
        activeAlerts: { data: null, loading: true, error: null },
        forecast: { data: null, loading: true, error: null },
      }),
      "en",
    );
    expect(items).toEqual([]);
  });

  it("active → แถว observed ต่อหนึ่งแจ้งเตือน id คงที่ + ชื่อ อปท. + ปุ่มเปิดแผงผลกระทบ", () => {
    const items = buildNotifications(
      base({
        activeAlerts: { data: evaluated([alert("a", "severe"), alert("b", "high", true)]), loading: false, error: null },
        authorityNames: new Map([["la-a", "Tambon A"]]),
      }),
      "en",
    );
    expect(items.map((i) => i.id)).toEqual(["alert:a", "alert:b"]);
    expect(items.every((i) => i.kind === "observed" && i.category === "alerts")).toBe(true);
    expect(items[0].title).toContain("Tambon A");
    expect(items[1].title).toContain("la-b"); // ไม่มีชื่อ → id ดิบ ไม่หายไป
    expect(items[0].dim).toBe(false);
    expect(items[1].dim).toBe(true); // stale → หรี่
    expect(items[0].time).toEqual({ kind: "triggeredAt", iso: "2026-09-25T01:00:00Z" });
    expect(items[0].action).toMatchObject({ kind: "open-panel", panel: "impact" });
  });

  it("ติดต่อไม่ได้ → แถวสถานะ ไม่ใช่ 'ไม่มีแจ้งเตือน'", () => {
    const items = buildNotifications(base({ activeAlerts: { data: null, loading: false, error: err } }), "en");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "alerts:unreachable:57", kind: "source-status", category: "alerts", dim: true });
    expect(items[0].title).toMatch(/could not reach/i);
    expect(items[0].title).toMatch(/does not mean there are no alerts/i);
    expect(notificationTimeText(items[0].time, "en")).not.toMatch(/just now|ago/i);
  });

  it("เสื่อม (error && data) → แถวสถานะ + แถวแจ้งเตือนรอบก่อนแบบหรี่", () => {
    const items = buildNotifications(
      base({ activeAlerts: { data: evaluated([alert("a")]), loading: false, error: err } }),
      "en",
    );
    expect(items.map((i) => i.id)).toEqual(["alerts:degraded:57", "alert:a"]);
    expect(items.every((i) => i.dim)).toBe(true);
    // ไม่มีรายการค้างก็ยังเป็นเสื่อม
    const empty = buildNotifications(
      base({ activeAlerts: { data: evaluated([]), loading: false, error: err } }),
      "en",
    );
    expect(empty.map((i) => i.id)).toEqual(["alerts:degraded:57"]);
  });

  it("ยังไม่เคยประเมิน → แถวสถานะ เวลา = 'ยังไม่ได้รับผลการประเมิน'", () => {
    const items = buildNotifications(
      base({ activeAlerts: { data: { total: 0, evaluatedAt: null, alerts: [] }, loading: false, error: null } }),
      "en",
    );
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("alerts:never-evaluated:57");
    expect(notificationTimeText(items[0].time, "en")).toBe("no evaluation received");
  });
});

describe("notifications — ฝนหนักจาก TMD NWP รายวัน", () => {
  it("เฉพาะแถบ high/severe ของ bandRain24h; 35 พอดียังเป็น elevated; null ถูกข้าม", () => {
    const items = buildNotifications(
      base({
        forecast: {
          data: forecastData([
            { validAt: "2026-09-25T00:00:00Z", rainMm: 35 }, // elevated (ต้องมากกว่า 35)
            { validAt: "2026-09-26T00:00:00Z", rainMm: 35.4 }, // high
            { validAt: "2026-09-27T00:00:00Z", rainMm: 90.25 }, // severe
            { validAt: "2026-09-28T00:00:00Z", rainMm: null }, // ไม่ได้ส่งมา ≠ 0
            { validAt: "2026-09-29T00:00:00Z", rainMm: 0 },
          ]),
          loading: false,
          error: null,
        },
      }),
      "en",
    );
    expect(items.map((i) => i.id)).toEqual(["rain:57:2026-09-26:high", "rain:57:2026-09-27:severe"]);
    expect(items.every((i) => i.kind === "forecast" && i.category === "rain" && !i.dim)).toBe(true);
    // ตัวเลขตามที่ TMD ส่งมา ไม่ปัด
    expect(items[0].body).toContain("35.4 mm");
    expect(items[1].body).toContain("90.25 mm");
    expect(items[1].title).toMatch(/very heavy/i);
    // เวลา = เวลาที่ดึงมา ไม่ใช่รอบรันของแบบจำลอง; batchId ไม่โผล่
    for (const i of items) {
      expect(i.time).toEqual({ kind: "fetchedAt", iso: "2026-09-25T03:00:00Z" });
      const text = `${i.title} ${i.body} ${notificationTimeText(i.time, "en")}`;
      expect(text).toMatch(/fetched/);
      expect(text).not.toMatch(/\brun\b|round|cycle|batch-xyz/i);
      expect(text).not.toMatch(PCT);
    }
  });

  it("วันที่ของ id ใช้วันปฏิทินกรุงเทพฯ ไม่ใช่การตัดสตริง UTC", () => {
    const items = buildNotifications(
      base({
        forecast: { data: forecastData([{ validAt: "2026-09-25T18:00:00Z", rainMm: 50 }]), loading: false, error: null },
      }),
      "en",
    );
    expect(items[0].id).toBe("rain:57:2026-09-26:high");
  });

  it("ข้ามวันที่ผ่านไปแล้ว (todayKey) และหรี่เมื่อ tmd-nwp ใน /health ไม่ปกติ", () => {
    const data = forecastData([
      { validAt: "2026-09-24T00:00:00Z", rainMm: 60 }, // เมื่อวาน
      { validAt: "2026-09-25T00:00:00Z", rainMm: 60 }, // วันนี้
    ]);
    const fresh = buildNotifications(
      base({ todayKey: "2026-09-25", forecast: { data, loading: false, error: null } }),
      "en",
    );
    expect(fresh.map((i) => i.id)).toEqual(["rain:57:2026-09-25:high"]);
    expect(fresh[0].dim).toBe(false);
    const staleSource = buildNotifications(
      base({
        todayKey: "2026-09-25",
        forecast: { data, loading: false, error: null },
        apiHealth: {
          health: healthOf([source({ id: "tmd-nwp", health: "stale" })]),
          apiDown: false,
          checkedAt: null,
        },
      }),
      "en",
    );
    expect(staleSource.find((i) => i.id === "rain:57:2026-09-25:high")?.dim).toBe(true);
    // แท็บฝนหนักไม่เงียบ: มีแถวสถานะของต้นทางในหมวด rain ด้วย
    expect(staleSource.find((i) => i.id === "forecast:source-unhealthy:57:stale")?.category).toBe("rain");
  });

  it("batch: null → แถว 'ยังไม่เคยได้รับ' ไม่ใช่ 'ไม่มีฝน' และเวลาเป็น 'ยังไม่เคยดึงสำเร็จ'", () => {
    const data: ProvinceForecastResponse = { layers: { hourly: layer, daily: layer }, batch: null };
    const items = buildNotifications(base({ forecast: { data, loading: false, error: null } }), "en");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "forecast:no-batch:57", kind: "source-status", category: "rain" });
    expect(items[0].title).toMatch(/no TMD forecast received yet/i);
    expect(notificationTimeText(items[0].time, "en")).toBe("never fetched successfully");
  });

  it("hook ดึงพลาดโดยไม่มีข้อมูล → 'ติดต่อไม่ได้'", () => {
    const items = buildNotifications(base({ forecast: { data: null, loading: false, error: err } }), "en");
    expect(items.map((i) => i.id)).toEqual(["forecast:unreachable:57"]);
    expect(items[0].title).toMatch(/could not reach the TMD/i);
  });

  it("ดึงพลาดแต่มีชุดเก่า → แถวฝนหรี่ + แถวสถานะที่เวลาเป็นเวลาดึงของชุดนั้น", () => {
    const items = buildNotifications(
      base({
        forecast: { data: forecastData([{ validAt: "2026-09-26T00:00:00Z", rainMm: 40 }]), loading: false, error: err },
      }),
      "en",
    );
    expect(items.map((i) => i.id)).toEqual(["forecast:degraded:57", "rain:57:2026-09-26:high"]);
    expect(items.every((i) => i.dim)).toBe(true);
    expect(items[0].time).toEqual({ kind: "fetchedAt", iso: "2026-09-25T03:00:00Z" });
  });
});

describe("notifications — สถานะแหล่งข้อมูล (/api/v1/health)", () => {
  it("แหล่งที่ไม่ ok ได้แถวละแหล่ง หรี่ทุกแถว id รวมสถานะ; ok ไม่ออก", () => {
    const items = buildNotifications(
      base({
        apiHealth: {
          health: healthOf([
            source({ id: "thaiwater", health: "ok" }),
            source({ id: "tmd-radar", health: "down", fetchedAt: null, lastError: "HTTP 503" }),
            source({ id: "gistda-flood", health: "stale" }),
            source({ id: "earthquakes", health: "delayed" }),
          ]),
          apiDown: false,
          checkedAt: "2026-09-25T03:00:00Z",
        },
      }),
      "en",
    );
    expect(items.map((i) => i.id)).toEqual([
      "health:tmd-radar:down",
      "health:gistda-flood:stale",
      "health:earthquakes:delayed",
    ]);
    expect(items.every((i) => i.dim && i.category === "system" && i.kind === "source-status")).toBe(true);
    const [down, stale, delayed] = items;
    // "ติดต่อไม่ได้/ดึงล้มเหลว" ≠ "ข้อมูลค้าง" ≠ "ต้นทางยังไม่ปล่อยค่าใหม่"
    expect(down.title).toMatch(/could not reach.*never succeeded/i);
    expect(down.body).toContain("HTTP 503");
    expect(stale.title).toMatch(/stale/i);
    expect(delayed.title).toMatch(/not published/i);
    expect(new Set([down.title, stale.title, delayed.title]).size).toBe(3);
    // fetchedAt: null → "ยังไม่เคยสำเร็จ" ไม่ใช่ "ตอนนี้"
    expect(notificationTimeText(down.time, "en")).toBe("never fetched successfully");
    expect(notificationTimeText(down.time, "th")).toBe("ยังไม่เคยดึงสำเร็จ");
  });

  it("API สถานะล่ม → แถว api ที่เวลาเป็น 'ตรวจล่าสุด' ไม่ใช่ 'ดึงมาเมื่อ'", () => {
    const items = buildNotifications(
      base({ apiHealth: { health: null, apiDown: true, checkedAt: "2026-09-25T03:05:00Z" } }),
      "en",
    );
    expect(items.map((i) => i.id)).toEqual(["health:api:unreachable"]);
    expect(notificationTimeText(items[0].time, "en")).toMatch(/^checked /);
  });
});

// ── ชั้นพายุ v1 ──────────────────────────────────────────────────────────────
const NOW = Date.parse("2026-09-26T11:00:00Z");
const stormTrack = (over: Partial<StormTrack> = {}): StormTrack => ({
  id: "jma:TC2632",
  source: "jma-typhoon",
  name: "Surigae",
  basin: "WNP",
  category: "STS",
  advisoryIssuedAt: "2026-09-26T09:45:00Z",
  windAveraging: "10-min",
  past: [{ observedAt: "2026-09-26T09:00:00Z", lat: 23.2, lon: 126.9, windKt: 55, pressureHpa: 990 }],
  forecast: [],
  nearestKmByProvince: { "57": 250, "10": 900 },
  fetchedAt: "2026-09-26T10:51:00Z",
  ...over,
});
const stormsData = (storms: StormTrack[], sources?: StormsResponse["sources"]): StormsResponse => ({
  storms,
  layers: { track: layer, circle: layer, past: layer },
  sources: sources ?? [
    { id: "jma-typhoon", lastSuccessAt: "2026-09-26T10:51:00Z", lastAttemptAt: "2026-09-26T10:51:00Z", lastError: null },
    { id: "gdacs-tc", lastSuccessAt: "2026-09-26T10:51:00Z", lastAttemptAt: "2026-09-26T10:51:00Z", lastError: null },
  ],
});

describe("notifications — พายุ (STORM_NOTIFY_KM = 300)", () => {
  const withStorms = (storms: StormTrack[], over: Partial<NotificationInputs> = {}) =>
    buildNotifications(
      base({
        storms: { data: stormsData(storms), loading: false, error: null },
        provinceName: "Chiang Rai",
        nowMs: NOW,
        ...over,
      }),
      "en",
    );

  it("≤ 300 กม. → แถว forecast หนึ่งแถว ข้อความบอกเกณฑ์ เวลา = เวลาออกประกาศ ปุ่มเปิดแผงพายุ", () => {
    const items = withStorms([stormTrack()]);
    expect(items).toHaveLength(1);
    const [row] = items;
    expect(row.id).toBe("storm:jma:TC2632:2026-09-26T09:45:00Z");
    expect(row.category).toBe("storm");
    expect(row.kind).toBe("forecast");
    expect(row.title).toBe("Surigae: track (latest or forecast position) comes within 300 km of Chiang Rai");
    // มีวงกลมของ JMA → ข้อความรวมวงกลมด้วย (ตรงกับวิธีคำนวณระยะ)
    const [withCircle] = withStorms([
      stormTrack({
        forecast: [
          { validAt: "2026-09-27T00:00:00Z", lat: 24, lon: 127, windKt: 60, pressureHpa: 985, category: "STS", circleRadiusKm: 65 },
        ],
      }),
    ]);
    expect(withCircle.title).toBe("Surigae: track or JMA's circle comes within 300 km of Chiang Rai");
    expect(row.body).toMatch(/250 km/);
    expect(row.body).toMatch(/≤ 300 km/);
    expect(row.time).toEqual({ kind: "issuedAt", iso: "2026-09-26T09:45:00Z" });
    expect(notificationTimeText(row.time, "en")).toMatch(/^issued /);
    expect(row.action).toEqual({ kind: "open-panel", panel: "storm", labelKey: "storm.notif.open" });
    expect(row.dim).toBe(false);
    // ระยะเป็นเรขาคณิต ไม่ใช่ความน่าจะเป็น — ไม่มีคำตระกูลนั้นในแถว
    expect(`${row.title} ${row.body}`).not.toMatch(PCT);
  });

  it("ขอบเกณฑ์: 300 เข้า, 301 ไม่เข้า, ไม่มีค่าของจังหวัด = ไม่เข้า (ไม่ใช่ 0)", () => {
    expect(withStorms([stormTrack({ nearestKmByProvince: { "57": 300 } })])).toHaveLength(1);
    expect(withStorms([stormTrack({ nearestKmByProvince: { "57": 301 } })])).toEqual([]);
    expect(withStorms([stormTrack({ nearestKmByProvince: {} })])).toEqual([]);
  });

  it("ไม่มีเวลาออกประกาศ (GDACS) → id ใช้เวลาจุดล่าสุด (ไม่ใช่ fetchedAt); เวลาที่แสดงคือ fetchedAt พร้อมป้าย", () => {
    const [row] = withStorms([
      stormTrack({ id: "gdacs:1001326", source: "gdacs-tc", advisoryIssuedAt: null, windAveraging: null }),
    ]);
    expect(row.id).toBe("storm:gdacs:1001326:2026-09-26T09:00:00Z");
    expect(row.time).toEqual({ kind: "fetchedAt", iso: "2026-09-26T10:51:00Z" });
    expect(notificationTimeText(row.time, "en")).not.toMatch(/issued/);
  });

  it("GDACS: ดึงใหม่ (fetchedAt ต่าง) แต่เส้นทางเดิม → id เดิม ไม่เกิดแถวยังไม่อ่านใหม่ทุกรอบ", () => {
    const gdacs = (fetchedAt: string) =>
      stormTrack({ id: "gdacs:1001326", source: "gdacs-tc", advisoryIssuedAt: null, windAveraging: null, fetchedAt });
    const [a] = withStorms([gdacs("2026-09-26T10:21:00Z")]);
    const [b] = withStorms([gdacs("2026-09-26T10:51:00Z")]);
    expect(a.id).toBe(b.id);
    // จุดใหม่ = ข้อมูลเปลี่ยน = id ใหม่
    const [c] = withStorms([
      stormTrack({
        id: "gdacs:1001326",
        source: "gdacs-tc",
        advisoryIssuedAt: null,
        past: [{ observedAt: "2026-09-26T12:00:00Z", lat: 18.5, lon: 83.5, windKt: null, pressureHpa: null }],
      }),
    ]);
    expect(c.id).not.toBe(a.id);
    // ไม่มีเวลาจุดใดเลย → validAt สุดท้าย แล้วค่อย "nofix"
    const [d] = withStorms([
      stormTrack({
        id: "gdacs:1",
        source: "gdacs-tc",
        advisoryIssuedAt: null,
        past: [{ observedAt: null, lat: 18, lon: 84, windKt: null, pressureHpa: null }],
        forecast: [
          { validAt: "2026-09-27T00:00:00Z", lat: 19, lon: 84, windKt: null, pressureHpa: null, category: null, circleRadiusKm: null },
        ],
      }),
    ]);
    expect(d.id).toBe("storm:gdacs:1:2026-09-27T00:00:00Z");
    const [e] = withStorms([
      stormTrack({ id: "gdacs:2", source: "gdacs-tc", advisoryIssuedAt: null, past: [], forecast: [] }),
    ]);
    expect(e.id).toBe("storm:gdacs:2:nofix");
  });

  it("จุดล่าสุดเก่ากว่า 24 ชม. → หรี่ + บอกในเนื้อความ", () => {
    const [row] = withStorms([
      stormTrack({ past: [{ observedAt: "2026-09-24T00:00:00Z", lat: 18, lon: 84, windKt: null, pressureHpa: null }] }),
    ]);
    expect(row.dim).toBe(true);
    expect(row.body).toMatch(/more than 24 h old/);
  });

  it("รอบล่าสุดได้ไม่ครบ (partial) → แถวยังอยู่ หรี่ และไม่มีถ้อยคำ 'ติดต่อไม่ได้'", () => {
    const items = buildNotifications(
      base({
        storms: {
          data: stormsData([stormTrack()], [
            { id: "jma-typhoon", lastSuccessAt: "2026-09-26T10:51:00Z", lastAttemptAt: "2026-09-26T10:51:00Z", lastError: "jma-typhoon: TC2633 specifications.json HTTP 500" },
            { id: "gdacs-tc", lastSuccessAt: "2026-09-26T10:51:00Z", lastAttemptAt: "2026-09-26T10:51:00Z", lastError: null },
          ]),
          loading: false,
          error: null,
        },
        nowMs: NOW,
      }),
      "en",
    );
    expect(items).toHaveLength(1);
    expect(items[0].dim).toBe(true);
    expect(`${items[0].title} ${items[0].body}`).not.toMatch(/could not reach/i);
  });

  it("แหล่งล้มเหลวหรือคำขอรอบล่าสุดของเว็บพลาด → แถวยังอยู่ แต่หรี่", () => {
    const failing = buildNotifications(
      base({
        storms: {
          data: stormsData([stormTrack()], [
            { id: "jma-typhoon", lastSuccessAt: "2026-09-26T08:00:00Z", lastAttemptAt: "2026-09-26T10:51:00Z", lastError: "HTTP 503" },
            { id: "gdacs-tc", lastSuccessAt: "2026-09-26T10:51:00Z", lastAttemptAt: "2026-09-26T10:51:00Z", lastError: null },
          ]),
          loading: false,
          error: null,
        },
        nowMs: NOW,
      }),
      "en",
    );
    expect(failing[0].dim).toBe(true);
    const held = withStorms([stormTrack()], {
      storms: { data: stormsData([stormTrack()]), loading: false, error: err },
    });
    expect(held[0].dim).toBe(true);
  });

  it("ติดต่อ API พายุไม่ได้เลย → แถวสถานะในแท็บพายุ ไม่ใช่ 'ไม่มีพายุ'", () => {
    const items = withStorms([], { storms: { data: null, loading: false, error: err } });
    expect(items.map((i) => i.id)).toEqual(["storm:unreachable"]);
    expect(items[0].category).toBe("storm");
    expect(items[0].kind).toBe("source-status");
    expect(notificationTimeText(items[0].time, "en")).not.toMatch(/\d/);
  });

  it("ไม่มีพายุตามแหล่งที่ติดต่อได้ → ไม่มีแถว (แท็บพายุว่าง ไม่มีแถว 'ปลอดภัย')", () => {
    expect(withStorms([])).toEqual([]);
  });

  it("สถานะ /health ของ jma-typhoon/gdacs-tc อยู่แท็บพายุที่เดียว ไม่ซ้ำในแท็บระบบ", () => {
    const items = buildNotifications(
      base({
        apiHealth: {
          health: healthOf([
            source({ id: "jma-typhoon", health: "down", lastError: "HTTP 500" }),
            source({ id: "gdacs-tc", health: "stale" }),
            source({ id: "tmd-radar", health: "down" }),
          ]),
          apiDown: false,
          checkedAt: "2026-09-25T03:00:00Z",
        },
      }),
      "en",
    );
    const storm = itemsForTab(items, "storm").map((i) => i.id);
    const system = itemsForTab(items, "system").map((i) => i.id);
    expect(storm).toEqual(["health:jma-typhoon:down", "health:gdacs-tc:stale"]);
    expect(system).toEqual(["health:tmd-radar:down"]);
    expect(tabCounts(items)).toEqual({ all: 3, rain: 0, alerts: 0, storm: 2, system: 1 });
  });
});

describe("notifications — แท็บ", () => {
  const items = buildNotifications(
    base({
      activeAlerts: { data: evaluated([alert("a")]), loading: false, error: null },
      apiHealth: {
        health: healthOf([source({ id: "tmd-radar", health: "down" })]),
        apiDown: false,
        checkedAt: null,
      },
    }),
    "en",
  );
  it("นับทุกแท็บ แท็บว่างได้ 0", () => {
    expect(tabCounts(items)).toEqual({ all: 2, rain: 0, alerts: 1, storm: 0, system: 1 });
    expect(itemsForTab(items, "rain")).toEqual([]);
    expect(itemsForTab(items, "all")).toHaveLength(2);
  });
});

describe("notifications — สถานะอ่านแล้ว", () => {
  const mem = () => {
    const store = new Map<string, string>();
    return {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      store,
    };
  };

  it("parse เข้มงวด — รูปไม่ตรง v:1 คืน []", () => {
    expect(parseSeen(null)).toEqual([]);
    expect(parseSeen("{")).toEqual([]);
    expect(parseSeen(JSON.stringify({ v: 2, seen: ["a"] }))).toEqual([]);
    expect(parseSeen(JSON.stringify({ v: 1, seen: ["a", 1] }))).toEqual([]);
    expect(parseSeen(JSON.stringify({ v: 1, seen: ["a", "b"] }))).toEqual(["a", "b"]);
  });

  it("อ่าน/เขียนไป-กลับ และ storage ที่โยนไม่ทำให้พัง", () => {
    const s = mem();
    writeSeen(() => s, ["x"]);
    expect(JSON.parse(s.store.get(NOTIFICATIONS_STORAGE_KEY)!)).toEqual({ v: 1, seen: ["x"] });
    expect(readSeen(() => s)).toEqual(["x"]);
    const throwing = () => {
      throw new Error("SecurityError");
    };
    expect(readSeen(throwing)).toEqual([]);
    expect(() => writeSeen(throwing, ["x"])).not.toThrow();
    const badSet = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
    expect(() => writeSeen(() => badSet, ["x"])).not.toThrow();
  });

  it("อ่านทั้งหมด: unread = 0, จำกัดเพดาน และเก็บ id ปัจจุบันไว้เสมอ", () => {
    const items = buildNotifications(
      base({ activeAlerts: { data: evaluated([alert("a"), alert("b")]), loading: false, error: null } }),
      "en",
    );
    expect(unreadCount(items, [])).toBe(2);
    const old = Array.from({ length: SEEN_CAP + 50 }, (_, i) => `old:${i}`);
    const seen = markAllSeen(old, items);
    expect(seen).toHaveLength(SEEN_CAP);
    expect(seen.slice(-2)).toEqual(["alert:a", "alert:b"]);
    expect(unreadCount(items, seen)).toBe(0);
    // แจ้งเตือนใหม่ที่ยังไม่เคยเห็น → นับเป็นยังไม่อ่าน
    const more = buildNotifications(
      base({ activeAlerts: { data: evaluated([alert("a"), alert("c")]), loading: false, error: null } }),
      "en",
    );
    expect(unreadCount(more, seen)).toBe(1);
  });
});

describe("notifications — ไม่มีตัวเลขความน่าจะเป็นในข้อความใด", () => {
  it("ทั้งสองภาษา", () => {
    for (const lang of ["th", "en"] as const) {
      const items = buildNotifications(
        base({
          activeAlerts: { data: evaluated([alert("a", "severe")]), loading: false, error: err },
          forecast: { data: forecastData([{ validAt: "2026-09-26T00:00:00Z", rainMm: 120 }]), loading: false, error: err },
          apiHealth: {
            health: healthOf([source({ id: "tmd-nwp", health: "stale" })]),
            apiDown: true,
            checkedAt: "2026-09-25T03:05:00Z",
          },
        }),
        lang,
      );
      for (const i of items) {
        expect(`${i.title} ${i.body ?? ""} ${notificationTimeText(i.time, lang)}`).not.toMatch(PCT);
      }
    }
  });
});
