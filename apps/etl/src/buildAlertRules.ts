/**
 * สร้าง `apps/api/src/data/alertRules.json` — ตาราง rule ของ threshold/alert
 * engine (E11.5) ที่จับคู่สถานี ThaiWater จริงเข้ากับ อปท. ที่ครอบคลุมจริง
 *
 *   npm run build:alert-rules -w apps/etl
 *
 * ## แทนที่เวอร์ชันที่ถูก revert ทั้งหมด
 * เวอร์ชันก่อนหน้าประดิษฐ์ station id (9001, 9010, 5001…) ที่ไม่ join กับสถานี
 * ThaiWater จริงตัวไหนเลย — สคริปต์นี้ดึงทะเบียนสถานีจริงจาก ThaiWater โดยตรง
 * (endpoint เดียวกับ `apps/api/src/ingestion/thaiwater.ts` — คัดลอกมาเพราะ etl
 * กับ api เป็นคนละ workspace ไม่ import ข้ามกัน เหมือนรูปแบบเดิมที่
 * `buildLocalAuthorityBoundaries.ts` คัดลอก point-in-polygon มาแทนที่จะ import)
 * แล้วทำ point-in-polygon จริงกับขอบเขต อปท. จริงของ E11.2/E11.4
 * (`apps/api/src/data/localAuthorityBoundaries.json` — 431 อปท. ใน 46 จังหวัด +
 * 50 เขตของกรุงเทพฯ) สถานีที่ไม่ตกในขอบเขตไหนเลยจะไม่มี rule — ไม่มี "สถานีใกล้
 * ที่สุด" มาเดาแทน
 *
 * ## `--merge` — ต่อยอดตารางเดิม ไม่ทิ้ง rule ของสถานีที่แค่ขาดจาก snapshot วันนี้
 * `rain_24h`/`waterlevel_load` เป็นฟีดค่าล่าสุด ไม่ใช่ทะเบียนสถานี — สถานีที่ไม่ส่งค่า
 * ในรอบที่รันสคริปต์จะหายไปจากคำตอบทั้งตัว (รันจริง 2026-09-26: 60 จาก 286 rule
 * เดิมเป็นสถานีที่ขาดจากฟีดรอบนั้น) การสร้างตารางใหม่ทั้งหมดจึงลบ rule จริงทิ้ง
 * เพราะจังหวะเวลาที่รัน ซึ่งคือ "หายไปเงียบ ๆ" แบบที่ห้าม — engine เองก็ถือว่า
 * สถานีที่ขาดจากรอบล่าสุดเป็นสถานะ "ค้าง" ไม่ใช่ "ไม่มีอยู่" `--merge` จึง:
 * rule ของสถานีที่อยู่ในฟีดรอบนี้ = คำนวณใหม่ (PIP วันนี้); rule เดิมของสถานีที่
 * **ไม่อยู่** ในฟีดรอบนี้ = เก็บไว้ตามเดิม; สถานีที่อยู่ในฟีดแต่ไม่ตกในขอบเขตใดแล้ว
 * = ตัดทิ้ง (อันนี้ตรวจได้จริง) — ดู `mergeRules`
 *
 * ## alertAtLevel เริ่มต้น
 * ทุก rule เริ่มที่ `"high"` (ระดับที่สองจากบนสุดของ `ExposureLevel`) โดยตั้งใจ —
 * `"severe"` อย่างเดียวจะพลาดการแจ้งเตือนช่วงที่ยังพอมีเวลาเตรียมการ ส่วน
 * `"elevated"`/`"low"` จะแจ้งบ่อยเกินจนกลายเป็นเสียงรบกวนที่ อปท. เพิกเฉย ไม่มี
 * เหตุผลเฉพาะสถานีใดที่จะตั้งต่างจากนี้ ณ ตอนนี้
 *
 * ## minimumDurationMinutes / cooldownMinutes
 * ระดับน้ำของ ThaiWater รายงานทุก ~10 นาที (`WaterLevelHistoryPoint` doc:
 * "10-minute cadence upstream") — 30 นาทีคือค่าที่ยืนยันด้วยการอ่านสามรอบติดกัน
 * ก่อนแจ้งเตือนจริง ไม่ใช่ค่ากระชากจากรอบเดียวที่อาจเป็น noise ของเซนเซอร์ ใช้ค่า
 * เดียวกันสมมาตรสำหรับการเคลียร์ (ต้องต่ำกว่าเกณฑ์จริงสามรอบติดกันเช่นกัน) —
 * ไม่ใช่ตัวเลขพยากรณ์ เป็นแค่นโยบาย hysteresis ของ engine เอง cooldown 60 นาที
 * กันไม่ให้สถานีที่แกว่งอยู่พอดีขอบเขตแจ้งเตือนซ้ำทุกรอบประเมิน
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { booleanPointInPolygon, point as turfPoint } from "@turf/turf";
import type {
  LocalAuthorityBoundariesArtefact,
  LocalAuthorityBoundaryGeometry,
  LocalAuthorityRef,
  ThresholdRule,
} from "@siahra/shared-types";

const LOCAL_AUTHORITY_BOUNDARIES_JSON = path.resolve(
  import.meta.dirname,
  "../../api/src/data/localAuthorityBoundaries.json",
);
const LOCAL_AUTHORITIES_JSON = path.resolve(
  import.meta.dirname,
  "../../api/src/data/localAuthorities.json",
);
const OUT_PATH = path.resolve(import.meta.dirname, "../../api/src/data/alertRules.json");

const RAIN_24H_URL = "https://api-v3.thaiwater.net/api/v1/thaiwater30/public/rain_24h";
const WATERLEVEL_URL = "https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_load";
const UA = "siahra-etl/0.0.0 (alert-rule table build)";

const RULE_TABLE_VERSION = "1";
const ALERT_AT_LEVEL = "high" as const;
const MINIMUM_DURATION_MINUTES = 30;
const COOLDOWN_MINUTES = 60;

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export interface RawStation {
  id: number;
  lat: number;
  lon: number;
}

/**
 * แยกเฉพาะ id/lat/lon จาก payload ของ ThaiWater — ไม่ทำ schema validation
 * เต็มรูปแบบเหมือน `apps/api/src/ingestion/thaiwater.ts` เพราะสคริปต์นี้เป็น
 * one-off build-time เท่านั้น ไม่ใช่เส้นทางที่รันซ้ำทุกไม่กี่นาทีบน production —
 * สถานีที่ไม่มีพิกัดหรือ id ถูกข้าม ไม่ใส่ (0,0) หลอก
 */
function extractStations(records: unknown[]): RawStation[] {
  const out: RawStation[] = [];
  for (const raw of records) {
    const r = raw as { id?: unknown; station?: { id?: unknown; tele_station_lat?: unknown; tele_station_long?: unknown } };
    const id = num(r.station?.id) ?? num(r.id);
    const lat = num(r.station?.tele_station_lat);
    const lon = num(r.station?.tele_station_long);
    if (id === null || lat === null || lon === null) continue;
    out.push({ id, lat, lon });
  }
  return out;
}

async function fetchRainfallStations(): Promise<RawStation[]> {
  const res = await fetch(RAIN_24H_URL, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`ThaiWater rain_24h failed: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { data?: unknown[] };
  return extractStations(body.data ?? []);
}

async function fetchWaterLevelStations(): Promise<RawStation[]> {
  const res = await fetch(WATERLEVEL_URL, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`ThaiWater waterlevel_load failed: ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { waterlevel_data?: { data?: unknown[] } };
  return extractStations(body.waterlevel_data?.data ?? []);
}

/** สถานีหนึ่งตกในขอบเขต อปท. ใดบ้าง — จริง ๆ ตกได้มากกว่าหนึ่งเมื่อขอบเขตซ้อนกัน
 *  (ไม่ควรเกิดกับ อปท. ระดับตำบล/เทศบาลแต่ไม่ตัดทิ้งความเป็นไปได้) */
export function stationsToLocalAuthorityIds(
  station: RawStation,
  boundaries: LocalAuthorityBoundariesArtefact["boundaries"],
): string[] {
  const pt = turfPoint([station.lon, station.lat]);
  const matched: string[] = [];
  for (const b of boundaries) {
    if (booleanPointInPolygon(pt, { type: "Feature", properties: {}, geometry: b.geometry as LocalAuthorityBoundaryGeometry })) {
      matched.push(b.id);
    }
  }
  return matched;
}

export function buildRules(
  rainfall: readonly RawStation[],
  waterlevel: readonly RawStation[],
  boundaries: LocalAuthorityBoundariesArtefact["boundaries"],
): ThresholdRule[] {
  const rules: ThresholdRule[] = [];
  for (const [stationKind, stations] of [
    ["rainfall", rainfall],
    ["waterlevel", waterlevel],
  ] as const) {
    for (const station of stations) {
      const affectedLocalAuthorityIds = stationsToLocalAuthorityIds(station, boundaries);
      if (affectedLocalAuthorityIds.length === 0) continue;
      rules.push({
        id: `alert-rule-${stationKind}-${station.id}`,
        stationId: station.id,
        stationKind,
        affectedLocalAuthorityIds,
        alertAtLevel: ALERT_AT_LEVEL,
        minimumDurationMinutes: MINIMUM_DURATION_MINUTES,
        cooldownMinutes: COOLDOWN_MINUTES,
        version: RULE_TABLE_VERSION,
      });
    }
  }
  // ลำดับที่นิ่ง (kind แล้ว stationId) เพื่อให้ diff ของไฟล์ที่ commit อ่านออกได้
  return sortRules(rules);
}

export function stationKey(kind: "rainfall" | "waterlevel", id: number): string {
  return `${kind}:${id}`;
}

export interface MergeReport {
  /** rule เดิมที่เก็บไว้เพราะสถานีไม่อยู่ในฟีดรอบนี้ */
  keptAbsent: string[];
  /** rule ใหม่ (ไม่มีในตารางเดิม) */
  added: string[];
  /** rule เดิมของสถานีที่อยู่ในฟีดแต่ไม่ตกในขอบเขตใดแล้ว */
  droppedPresent: string[];
  /** rule ที่มีทั้งสองฝั่งแต่เนื้อหาเปลี่ยน (เช่น affectedLocalAuthorityIds) */
  changed: string[];
}

function sortRules(rules: ThresholdRule[]): ThresholdRule[] {
  return rules.sort((a, b) =>
    a.stationKind === b.stationKind ? a.stationId - b.stationId : a.stationKind < b.stationKind ? -1 : 1,
  );
}

/**
 * รวมตารางเดิมกับผล PIP รอบนี้ — ฟังก์ชันล้วน ทดสอบได้ตรง ๆ
 *
 * `presentStationKeys` = `stationKey()` ของทุกสถานีที่ฟีดรอบนี้ส่งมา (ไม่ว่าจะตกใน
 * ขอบเขตหรือไม่) — ใช้แยก "ไม่อยู่ในฟีด" (เก็บ rule เดิม) ออกจาก "อยู่แต่ไม่ตกใน
 * ขอบเขตแล้ว" (ตัดทิ้ง)
 */
export function mergeRules(
  prev: readonly ThresholdRule[],
  fresh: readonly ThresholdRule[],
  presentStationKeys: ReadonlySet<string>,
): { rules: ThresholdRule[]; report: MergeReport } {
  const freshById = new Map(fresh.map((r) => [r.id, r]));
  const prevById = new Map(prev.map((r) => [r.id, r]));
  const report: MergeReport = { keptAbsent: [], added: [], droppedPresent: [], changed: [] };
  const out: ThresholdRule[] = [...fresh];
  for (const r of prev) {
    if (freshById.has(r.id)) {
      if (JSON.stringify(freshById.get(r.id)) !== JSON.stringify(r)) report.changed.push(r.id);
      continue;
    }
    if (presentStationKeys.has(stationKey(r.stationKind, r.stationId))) {
      report.droppedPresent.push(r.id);
      continue;
    }
    report.keptAbsent.push(r.id);
    out.push(r);
  }
  for (const r of fresh) if (!prevById.has(r.id)) report.added.push(r.id);
  return { rules: sortRules(out), report };
}

/** ยืนยันว่าทุก id ที่อ้างถึงมีอยู่จริงในทะเบียน E11.1 — เขียนไฟล์ที่มี id ปลอมไม่ได้ */
export function assertKnownAuthorityIds(rules: readonly ThresholdRule[], known: ReadonlySet<string>): void {
  const unknown = new Set<string>();
  for (const r of rules) for (const id of r.affectedLocalAuthorityIds) if (!known.has(id)) unknown.add(id);
  if (unknown.size > 0) {
    throw new Error(`alert rule table references unknown local-authority ids: ${[...unknown].join(", ")}`);
  }
}

export async function run(): Promise<void> {
  const boundariesArtefact = JSON.parse(
    readFileSync(LOCAL_AUTHORITY_BOUNDARIES_JSON, "utf-8"),
  ) as LocalAuthorityBoundariesArtefact;
  const registry = JSON.parse(readFileSync(LOCAL_AUTHORITIES_JSON, "utf-8")) as {
    localAuthorities: LocalAuthorityRef[];
  };
  const knownIds = new Set(registry.localAuthorities.map((a) => a.id));

  console.log("[alert-rules] fetching real ThaiWater station registries…");
  const [rainfall, waterlevel] = await Promise.all([fetchRainfallStations(), fetchWaterLevelStations()]);
  console.log(`[alert-rules] rainfall stations: ${rainfall.length}, waterlevel stations: ${waterlevel.length}`);

  const fresh = buildRules(rainfall, waterlevel, boundariesArtefact.boundaries);
  let rules = fresh;
  if (process.argv.includes("--merge")) {
    const prev = existsSync(OUT_PATH)
      ? (JSON.parse(readFileSync(OUT_PATH, "utf-8")) as { rules: ThresholdRule[] }).rules
      : [];
    const present = new Set([
      ...rainfall.map((s) => stationKey("rainfall", s.id)),
      ...waterlevel.map((s) => stationKey("waterlevel", s.id)),
    ]);
    const merged = mergeRules(prev, fresh, present);
    rules = merged.rules;
    const r = merged.report;
    console.log(
      `[alert-rules] --merge: previous ${prev.length}, kept (station absent from today's feed) ${r.keptAbsent.length}, ` +
        `added ${r.added.length}, dropped (present, no longer inside a boundary) ${r.droppedPresent.length}, changed ${r.changed.length}`,
    );
    if (r.added.length) console.log(`[alert-rules]   added: ${r.added.join(", ")}`);
    if (r.droppedPresent.length) console.log(`[alert-rules]   dropped: ${r.droppedPresent.join(", ")}`);
    if (r.changed.length) console.log(`[alert-rules]   changed: ${r.changed.join(", ")}`);
  }
  assertKnownAuthorityIds(rules, knownIds);

  const rainfallMatched = rules.filter((r) => r.stationKind === "rainfall").length;
  const waterlevelMatched = rules.filter((r) => r.stationKind === "waterlevel").length;
  console.log(
    `[alert-rules] rules written — rainfall: ${rainfallMatched}, waterlevel: ${waterlevelMatched}`,
  );

  const artefact = { generatedAt: new Date().toISOString(), recordCount: rules.length, rules };
  const json = JSON.stringify(artefact);
  writeFileSync(OUT_PATH, json);
  console.log(`[alert-rules] wrote ${OUT_PATH} — ${rules.length} rules (${(Buffer.byteLength(json) / 1024).toFixed(1)} KB)`);
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
