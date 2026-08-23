import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../src/types";
import alertEngineSrc from "../src/durable-objects/alert-engine.ts?raw";
import earthquakeSrc from "../src/durable-objects/earthquake-feed.ts?raw";
import floodSrc from "../src/durable-objects/flood-extent.ts?raw";
import forecastNwpSrc from "../src/durable-objects/forecast-nwp.ts?raw";
import observationSrc from "../src/durable-objects/observation-cache.ts?raw";
import radarSrc from "../src/durable-objects/radar.ts?raw";

/**
 * กันบิล Durable Objects แบบ 2026-08-18..23 (72B rows read บนสตอเรจ 64 MB) ไม่ให้
 * กลับมา: Cloudflare คิดเงิน rows read ตามแถวที่ถูก **สแกน** ไม่ใช่แถวที่ถูกคืน
 * ดังนั้นทุก SQL literal ในโค้ด DO ถูกดึงออกมาแล้วถาม SQLite ตัวจริง (ผ่าน
 * `EXPLAIN QUERY PLAN` บน schema ที่ constructor สร้าง) ว่ามันจะ `SCAN` ทั้งตาราง
 * หรือไม่ — คำสั่งที่สแกนต้องอยู่ใน allowlist ข้างล่างพร้อมเหตุผลว่าทำไมถึงรับได้
 * (วิ่งบนเส้นทาง refresh ที่นาน ๆ ครั้ง หรือตารางเล็กจนไม่มีความหมาย) ไม่ใช่ผ่าน
 * เงียบ ๆ เพราะ "มันก็ทำงานได้"
 *
 * เกณฑ์ตัดสินว่า SCAN รับได้หรือไม่ อยู่ที่ **เส้นทางที่เรียกมัน** ไม่ใช่ตัวคำสั่ง:
 * - รับได้: เรียกครั้งเดียวต่อรอบ refresh/alarm (ทุก 1–30 นาที) หรือรายชั่วโมง
 * - รับไม่ได้: เรียกต่อคำขอ HTTP (`/health`, `/observations`, …) หรือต่อรายการใน
 *   ลูป (ต่อสถานี ต่อจังหวัด) — นี่คือสองรูปแบบที่พาไปถึง 72B
 * ถ้าเพิ่มคำสั่งใหม่แล้วเทสนี้แดง: ใส่ดัชนีให้มัน หรือย้ายมันไปเส้นทาง refresh
 * แล้วค่อย allowlist พร้อมเหตุผล
 */

const appEnv = env as unknown as AppEnv;

interface DoSource {
  label: string;
  source: string;
  stub: () => { fetch?: unknown };
}

const SOURCES: DoSource[] = [
  { label: "ObservationCacheDO", source: observationSrc, stub: () => appEnv.OBSERVATION_CACHE.getByName("plan-test") },
  { label: "FloodExtentDO", source: floodSrc, stub: () => appEnv.FLOOD_EXTENT.getByName("plan-test") },
  { label: "RadarDO", source: radarSrc, stub: () => appEnv.RADAR.getByName("plan-test") },
  { label: "EarthquakeFeedDO", source: earthquakeSrc, stub: () => appEnv.EARTHQUAKE_FEED.getByName("plan-test") },
  { label: "AlertEngineDO", source: alertEngineSrc, stub: () => appEnv.ALERT_ENGINE.getByName("plan-test") },
  // E12.2 — ตารางเดียว หนึ่งแถวต่อจังหวัด อ่านด้วย PK เท่านั้น จึงไม่มีรายการใน
  // ALLOWED_SCANS เลย ถ้าวันหน้ามีคนเพิ่มคำสั่งที่สแกน เทสนี้จะแดงทันที
  { label: "ForecastNwpDO", source: forecastNwpSrc, stub: () => appEnv.FORECAST_NWP.getByName("plan-test") },
];

/**
 * คำสั่งที่สแกนทั้งตารางโดยตั้งใจ — คีย์คือ SQL ทั้งประโยค เหตุผลคือค่า
 * ทุกตัวในนี้วิ่งบนเส้นทาง refresh/alarm หรือรายชั่วโมง ไม่ใช่ต่อคำขอหรือต่อรายการ
 */
const ALLOWED_SCANS: Record<string, string> = {
  // ObservationCacheDO — รอบ refresh ทุก 5 นาที: ต้องอ่านทั้งตารางเพื่อเทียบ observedAt
  "SELECT station_id, observed_at FROM rainfall": "replaceRainfall(): once per 5-min refresh, diffs the whole feed",
  "SELECT station_id, observed_at FROM waterlevel": "replaceWaterLevel(): once per 5-min refresh, diffs the whole feed",
  "SELECT COUNT(*) AS n FROM rainfall": "recomputeStationStats(): once per refresh, result cached in meta for status()",
  "SELECT COUNT(*) AS n FROM waterlevel": "recomputeStationStats(): once per refresh, result cached in meta for status()",
  "SELECT MAX(observed_at) AS t FROM rainfall": "recomputeStationStats(): once per refresh, result cached in meta",
  "SELECT MAX(observed_at) AS t FROM waterlevel": "recomputeStationStats(): once per refresh, result cached in meta",
  "SELECT payload FROM rainfall": "nationwide getObservations()/publishExposure(): the whole table IS the answer",
  "SELECT payload FROM waterlevel": "nationwide getObservations()/publishExposure(): the whole table IS the answer",
  "SELECT station_id, province_code FROM waterlevel": "archiveDay(): once per day",
  "SELECT payload FROM dams": "dams table is ~12 rows",
  "DELETE FROM dams": "dams table is ~12 rows, rewritten every 30 min",
  "DELETE FROM archive_cache WHERE fetched_ms < ?": "archive_cache holds a handful of rows, pruned on the archive path",
  // EarthquakeFeedDO — ตาราง events ≤ 30 วัน (~200 แถว) และทุกคำสั่งวิ่งบน poll ทุกนาที
  "SELECT COUNT(*) AS n FROM events": "events is ~200 rows; status() of a 1-minute poller",
  "SELECT MAX(time_ms) AS newest, MAX(updated_ms) AS published FROM events": "events is ~200 rows",
  "SELECT MAX(time_ms) AS t FROM events": "events is ~200 rows",
  "SELECT * FROM events ORDER BY time_ms DESC LIMIT ?": "events is ~200 rows; the LIMIT keeps the answer small",
  "SELECT * FROM events ORDER BY time_ms DESC LIMIT 200": "events is ~200 rows",
  "SELECT * FROM events WHERE mag >= ? ORDER BY time_ms DESC LIMIT ?": "events is ~200 rows",
  "SELECT id, lat, lon FROM events WHERE nearest IS NULL OR json_valid(nearest) = 0 LIMIT ?": "backfill on the poll path, events is ~200 rows",
  "DELETE FROM events WHERE time_ms < ?": "once per poll, events is ~200 rows",
  // RadarDO — frames ≤ 24 h (~65 แถว)
  "SELECT MAX(ts_ms) AS t FROM frames": "frames is ~65 rows",
  "SELECT ts_ms, key FROM frames WHERE ts_ms < ?": "retention on the refresh path, frames is ~65 rows",
  "SELECT COUNT(*) AS n FROM frames WHERE ts_ms >= ?": "frames is ~65 rows",
  "SELECT ts_ms, key FROM frames WHERE ts_ms >= ? ORDER BY ts_ms ASC": "frames is ~65 rows; PK order",
  // AlertEngineDO — rule_state มี ~300 แถว อ่านบนรอบประเมิน 5 นาที
  "SELECT MAX(last_observed_at) AS v FROM rule_state": "rule_state is ~300 rows; status()",
};

/** ดึง SQL literal แบบ static ออกจากซอร์ส — INSERT ที่ประกอบ placeholder ข้ามไป (ไม่มีทางสแกน) */
function sqlLiterals(source: string): string[] {
  const out = new Set<string>();
  for (const m of source.matchAll(/"((?:SELECT|DELETE|UPDATE)\b[^"]*)"/g)) out.add(m[1]!);
  return [...out];
}

describe("ทุก SQL literal ใน Durable Objects ใช้ดัชนี หรืออยู่ใน allowlist พร้อมเหตุผล", () => {
  for (const { label, source, stub } of SOURCES) {
    it(label, async () => {
      const statements = sqlLiterals(source);
      expect(statements.length).toBeGreaterThan(0);
      const offenders: string[] = [];
      await runInDurableObject(stub() as never, (_instance, state) => {
        for (const sql of statements) {
          // bind ค่า dummy ให้ครบทุก `?` — แผนไม่ขึ้นกับค่า แต่ workerd ตรวจจำนวน
          const binds = Array.from({ length: (sql.match(/\?/g) ?? []).length }, () => 0);
          const plan = state.storage.sql
            .exec<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...binds)
            .toArray()
            .map((r) => r.detail)
            .join(" | ");
          // "SCAN <table>" โดยไม่มี "USING INDEX/COVERING INDEX" ต่อท้าย = อ่านทุกแถว
          const fullScan = /\bSCAN \w+(?! USING (?:COVERING )?INDEX)/.test(plan);
          if (fullScan && !(sql in ALLOWED_SCANS)) offenders.push(`${sql}\n    plan: ${plan}`);
        }
      });
      expect(offenders, `full-table scans not in ALLOWED_SCANS:\n  ${offenders.join("\n  ")}`).toEqual([]);
    });
  }

  it("allowlist ไม่มีรายการค้างที่โค้ดเลิกใช้แล้ว", () => {
    const all = new Set(SOURCES.flatMap((s) => sqlLiterals(s.source)));
    const orphans = Object.keys(ALLOWED_SCANS).filter((sql) => !all.has(sql));
    expect(orphans).toEqual([]);
  });
});
