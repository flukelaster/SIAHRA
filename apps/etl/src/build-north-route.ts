/**
 * สร้าง `apps/web/public/rivers/north-route.json` (+ `apps/api/src/data/northRouteStations.json`)
 * — ผังเส้นทางน้ำเหนือ (E16): ปิง(+วัง), น่าน(+ยม) → นครสวรรค์ → เจ้าพระยา
 *
 *   npm run build:north-route -w apps/etl
 *
 * อินพุตสามอย่าง ไม่มีตัวเลขพิมพ์มือเลยสักตัว:
 *   1. `src/northRoute.source.json` (tracked) — **สตริงล้วน**: reach, ชื่อ, การบรรจบ,
 *      รหัสสถานี RID เรียงต้นน้ำ → ท้ายน้ำ, ชื่อเขื่อน, ลิงก์อ้างอิง
 *   2. ThaiWater สด — `public/waterlevel_load` (รหัส RID → station.id + พิกัด) และ
 *      `analyst/dam` (ชื่อเขื่อน → id + พิกัด)
 *   3. OSM `thailand-latest.osm.pbf` (ไฟล์เดียวกับที่ `fetchOsm.ts` ดึงไว้) —
 *      `waterway=river` ที่ `name` หรือ `name:th` ตรงกับชื่อลำน้ำ ผ่าน `osmium`
 *
 * **ปฏิเสธการเขียน** (ไม่มีไฟล์ครึ่ง ๆ กลาง ๆ) เมื่อ:
 *   - รหัส RID ไม่อยู่ในฟีดสด หรือหนึ่งรหัสชี้ได้หลายสถานี
 *   - สถานีอยู่ห่างเส้นลำน้ำของ reach เกิน `MAX_STATION_OFFSET_KM` (จับสถานีบนลำน้ำสาขา
 *     ที่ถูกใส่ผิด reach เช่น P.4A ที่อยู่บนแม่แตง)
 *   - chainage ไม่เพิ่มขึ้นตามลำดับที่เขียนไว้ใน source — ทิศของเส้นถูกตัดสินจากตำแหน่ง
 *     ของลำน้ำปลายทาง ไม่ใช่จากลำดับสถานี การตรวจนี้จึงไม่วนกลับมายืนยันตัวเอง
 *   - เส้น OSM ขาดเป็นช่วงที่ยาวเกิน `MAX_GAP_KM` หรือชิ้นที่ต่อไม่ได้ยาวเกินสัดส่วนที่รับได้
 *   - ชื่อเขื่อนไม่ตรงกับฟีดสด
 *
 * ฟังก์ชันล้วนถูก export ให้ `build-north-route.test.ts` ส่วน `main()` รันเฉพาะตอนสั่ง
 * สคริปต์นี้ตรง ๆ (ผ่าน `tsx`)
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import * as z from "zod/mini";
import { bbox as turfBbox, booleanPointInPolygon, point as turfPoint } from "@turf/turf";
import type {
  NorthReachId,
  NorthRouteDam,
  NorthRouteReach,
  NorthRouteStation,
  NorthRouteTopology,
} from "@siahra/shared-types";
import { loadProvincePolygons, type ProvincePolygon } from "./build-cctv.js";
import { fetchThailandOsm } from "./fetchOsm.js";

const THAIWATER = "https://api-v3.thaiwater.net/api/v1/thaiwater30";
export const WATERLEVEL_URL = `${THAIWATER}/public/waterlevel_load`;
export const DAM_URL = `${THAIWATER}/analyst/dam`;
const UA = "siahra-etl/0.0.0 (build-north-route)";

const SOURCE_PATH = path.resolve(import.meta.dirname, "northRoute.source.json");
const AOI_ROOT = path.resolve(import.meta.dirname, "../../web/public/aoi");
const OUT_PATH = path.resolve(import.meta.dirname, "../../web/public/rivers/north-route.json");
const API_OUT_PATH = path.resolve(import.meta.dirname, "../../api/src/data/northRouteStations.json");
const WORK_DIR = path.resolve(import.meta.dirname, "../data/work");

/** สถานีตั้งอยู่ริมตลิ่ง — เส้นกลางลำน้ำของ OSM ห่างจากหมุดไม่กี่ร้อยเมตร เกิน 2 กม. = ไม่ใช่ลำน้ำนี้ */
export const MAX_STATION_OFFSET_KM = 2;
/** เขื่อนบนลำน้ำสาขา (แควน้อย) อยู่ห่างเส้นหลักได้ แต่ถ้าไกลกว่านี้ = ใส่ reach ผิด */
export const MAX_DAM_OFFSET_KM = 40;
/** ช่วงขาดของเส้น OSM ที่ยอมเชื่อมด้วยเส้นตรง (อ่างเก็บน้ำภูมิพลยาวราว 100 กม.) */
export const MAX_GAP_KM = 120;
/** ชิ้นเส้นที่ต่อเข้าเส้นหลักไม่ได้ ทิ้งได้ไม่เกินสัดส่วนนี้ของความยาวรวม */
export const MAX_DROPPED_SHARE = 0.2;
/** ความละเอียดของการลดรูปเส้น (Douglas–Peucker) */
export const SIMPLIFY_TOLERANCE_KM = 0.2;

export type LonLat = [number, number];

// ─────────────────────────────────────────────────────────────────────────────
// Source (strings only)
// ─────────────────────────────────────────────────────────────────────────────

const REACH_IDS = ["ping", "wang", "yom", "nan", "chao-phraya"] as const;
const reachId = z.enum(REACH_IDS);

const sourceSchema = z.object({
  reaches: z.array(
    z.object({
      id: reachId,
      nameTh: z.string(),
      nameEn: z.string(),
      osmName: z.string(),
      joinsReachId: z.nullable(reachId),
      stations: z.array(z.string()).check(z.minLength(2)),
      citations: z.array(z.string()).check(z.minLength(1)),
    }),
  ),
  dams: z.array(z.object({ nameTh: z.string(), reachId, citation: z.string() })),
});
export type RouteSource = z.infer<typeof sourceSchema>;

/** ไล่ทุกค่าในเอกสาร — เจอตัวเลขที่ไหน = ไฟล์ topology ไม่ใช่ "สตริงล้วน" อีกต่อไป */
function findNumber(value: unknown, at: string): string | null {
  if (typeof value === "number") return at;
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) {
      const hit = findNumber(v, `${at}[${i}]`);
      if (hit) return hit;
    }
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const hit = findNumber(v, `${at}.${k}`);
      if (hit) return hit;
    }
  }
  return null;
}

export function parseSource(raw: unknown): RouteSource {
  const num = findNumber(raw, "$");
  if (num) throw new Error(`northRoute.source.json must hold strings only — found a number at ${num}`);
  const r = sourceSchema.safeParse(raw);
  if (!r.success) {
    const where = r.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(root)"}:${i.code}`).join(", ");
    throw new Error(`northRoute.source.json: unexpected shape (${where})`);
  }
  const src = r.data;
  const ids = src.reaches.map((x) => x.id);
  if (new Set(ids).size !== ids.length) throw new Error("northRoute.source.json: duplicate reach id");
  for (const x of src.reaches) {
    if (x.joinsReachId !== null && !ids.includes(x.joinsReachId)) {
      throw new Error(`reach ${x.id} joins unknown reach ${x.joinsReachId}`);
    }
    if (x.joinsReachId === x.id) throw new Error(`reach ${x.id} joins itself`);
  }
  if (src.reaches.filter((x) => x.joinsReachId === null).length !== 1) {
    throw new Error("northRoute.source.json: exactly one reach must be the outlet (joinsReachId null)");
  }
  const codes = src.reaches.flatMap((x) => x.stations);
  const dup = codes.find((c, i) => codes.indexOf(c) !== i);
  if (dup) throw new Error(`northRoute.source.json: station ${dup} is listed twice`);
  for (const d of src.dams) {
    if (!ids.includes(d.reachId)) throw new Error(`dam ${d.nameTh} is on unknown reach ${d.reachId}`);
  }
  return src;
}

// ─────────────────────────────────────────────────────────────────────────────
// Live ThaiWater resolution
// ─────────────────────────────────────────────────────────────────────────────

const numeric = z.optional(z.nullable(z.union([z.number(), z.string()])));
const liveRecordSchema = z.object({
  station: z.object({
    id: numeric,
    tele_station_oldcode: z.optional(z.nullable(z.unknown())),
    tele_station_lat: numeric,
    tele_station_long: numeric,
    tele_station_name: z.optional(z.nullable(z.object({ th: z.optional(z.nullable(z.string())) }))),
  }),
  geocode: z.optional(z.nullable(z.object({ province_code: numeric }))),
});
const liveEnvelope = z.object({ waterlevel_data: z.object({ data: z.array(z.unknown()) }) });

export interface LiveStation {
  ridCode: string;
  thaiwaterId: number;
  lat: number;
  lon: number;
  nameTh: string | null;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** รหัส RID → สถานี (หลายตัว = กำกวม ผู้เรียกปฏิเสธเอง) จาก body ของ waterlevel_load */
export function parseLiveStations(body: unknown): Map<string, LiveStation[]> {
  const env = liveEnvelope.safeParse(body);
  if (!env.success) throw new Error("waterlevel_load: unexpected envelope");
  const out = new Map<string, LiveStation[]>();
  for (const raw of env.data.waterlevel_data.data) {
    const r = liveRecordSchema.safeParse(raw);
    if (!r.success) continue;
    const s = r.data.station;
    const code = typeof s.tele_station_oldcode === "string" ? s.tele_station_oldcode.trim() : "";
    const id = toNum(s.id);
    const lat = toNum(s.tele_station_lat);
    const lon = toNum(s.tele_station_long);
    if (!code || id === null || lat === null || lon === null) continue;
    const list = out.get(code) ?? [];
    if (!list.some((x) => x.thaiwaterId === id)) {
      list.push({ ridCode: code, thaiwaterId: id, lat, lon, nameTh: s.tele_station_name?.th?.trim() || null });
    }
    out.set(code, list);
  }
  return out;
}

export function resolveStation(code: string, live: Map<string, LiveStation[]>): LiveStation {
  const hits = live.get(code) ?? [];
  if (hits.length === 0) throw new Error(`station ${code} is not in the live ThaiWater waterlevel_load feed`);
  if (hits.length > 1) {
    throw new Error(`station ${code} is ambiguous in waterlevel_load (ids ${hits.map((h) => h.thaiwaterId).join(", ")})`);
  }
  return hits[0];
}

const damRecordSchema = z.object({
  dam: z.optional(
    z.nullable(
      z.object({
        id: numeric,
        dam_name: z.optional(z.nullable(z.object({ th: z.optional(z.nullable(z.string())) }))),
        dam_lat: numeric,
        dam_long: numeric,
      }),
    ),
  ),
});

export interface LiveDam {
  nameTh: string;
  ids: number[];
  lat: number;
  lon: number;
}

/**
 * ชื่อเขื่อน → id ทั้งหมดที่ใช้ชื่อนั้นใน analyst/dam (ต้นทางให้ id คนละตัวกับแถวรายวันและ
 * รายชั่วโมงของเขื่อนเดียวกัน) — ลำดับ: `dam_daily` ก่อน แล้ว `dam_hourly`
 */
export function parseLiveDams(body: unknown): Map<string, LiveDam> {
  const data = (body as { data?: Record<string, unknown> } | null)?.data ?? {};
  const out = new Map<string, LiveDam>();
  for (const group of ["dam_daily", "dam_hourly", "dam_medium"]) {
    const rows = Array.isArray(data[group]) ? (data[group] as unknown[]) : [];
    for (const raw of rows) {
      const r = damRecordSchema.safeParse(raw);
      if (!r.success || !r.data.dam) continue;
      const name = r.data.dam.dam_name?.th?.trim();
      const id = toNum(r.data.dam.id);
      const lat = toNum(r.data.dam.dam_lat);
      const lon = toNum(r.data.dam.dam_long);
      if (!name || id === null || lat === null || lon === null) continue;
      const cur = out.get(name) ?? { nameTh: name, ids: [], lat, lon };
      if (!cur.ids.includes(id)) cur.ids.push(id);
      out.set(name, cur);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry
// ─────────────────────────────────────────────────────────────────────────────

const EARTH_KM = 6371.0088;
const RAD = Math.PI / 180;

export function haversineKm(a: LonLat, b: LonLat): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(x)));
}

/** จุดบนระนาบ (กม.) รอบ `lat0` — พอสำหรับระยะไม่กี่สิบกิโลเมตรรอบจุดที่คำนวณ */
function planar(p: LonLat, lat0: number): [number, number] {
  return [p[0] * 111.32 * Math.cos(lat0 * RAD), p[1] * 110.574];
}

/** ระยะจากจุดถึงส่วนของเส้น ab (กม.) + สัดส่วนตามเส้น t ∈ [0, 1] */
function pointSegment(p: LonLat, a: LonLat, b: LonLat): { distKm: number; t: number } {
  const lat0 = (a[1] + b[1]) / 2;
  const [px, py] = planar(p, lat0);
  const [ax, ay] = planar(a, lat0);
  const [bx, by] = planar(b, lat0);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return { distKm: Math.hypot(px - qx, py - qy), t };
}

/** ระยะสะสมของแต่ละจุดยอดตามเส้น (กม.) */
export function cumulativeKm(line: readonly LonLat[]): number[] {
  const out = [0];
  for (let i = 1; i < line.length; i++) out.push(out[i - 1] + haversineKm(line[i - 1], line[i]));
  return out;
}

/** ฉายจุดลงบนเส้น: chainage (กม. จากต้นเส้น) + ระยะตั้งฉาก (กม.) */
export function projectOnLine(p: LonLat, line: readonly LonLat[], cum = cumulativeKm(line)): { chainageKm: number; offsetKm: number } {
  let best = { chainageKm: 0, offsetKm: Infinity };
  for (let i = 1; i < line.length; i++) {
    const { distKm, t } = pointSegment(p, line[i - 1], line[i]);
    if (distKm < best.offsetKm) best = { chainageKm: cum[i - 1] + t * (cum[i] - cum[i - 1]), offsetKm: distKm };
  }
  return best;
}

/** ระยะใกล้สุดจากจุดถึงเส้น (กม.) */
export function distanceToLine(p: LonLat, line: readonly LonLat[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, pointSegment(p, line[i - 1], line[i]).distKm);
  return best;
}

/**
 * Douglas–Peucker (กม.) — จุดที่ `keep[i]` เป็นจริงถูกเก็บเสมอ (ปลายทั้งสองของช่วงที่เชื่อม
 * ด้วยเส้นตรงผ่านช่องว่าง ต้องอยู่ครบ ไม่งั้นช่วงนั้นหาไม่เจอหลังลดรูป)
 */
export function simplifyLine(line: readonly LonLat[], toleranceKm: number, keep: readonly boolean[] = []): LonLat[] {
  if (line.length <= 2) return [...line];
  const marked = new Array<boolean>(line.length).fill(false);
  marked[0] = true;
  marked[line.length - 1] = true;
  for (let i = 0; i < line.length; i++) if (keep[i]) marked[i] = true;
  const stack: [number, number][] = [];
  // แบ่งเป็นช่วงระหว่างจุดที่ต้องเก็บ แล้วลดรูปแต่ละช่วง
  let prev = 0;
  for (let i = 1; i < line.length; i++) {
    if (marked[i]) {
      stack.push([prev, i]);
      prev = i;
    }
  }
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = pointSegment(line[i], line[s], line[e]).distKm;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > toleranceKm) {
      marked[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
  }
  return line.filter((_, i) => marked[i]);
}

export interface ReachLine {
  /** ต้นทาง→ปลายทางยังไม่ถูกตัดสิน (ดู `orientLine`) */
  line: LonLat[];
  /** `bridge[i]` = ส่วน i → i+1 เป็นเส้นตรงที่เราเชื่อมเองผ่านช่องว่างของ OSM */
  bridge: boolean[];
  /** ความยาวของชิ้นที่ต่อไม่ได้และถูกทิ้ง (กม.) */
  droppedKm: number;
}

/**
 * รวม way ของ OSM ที่ชื่อเดียวกันเป็นเส้นเดียว:
 *   1. กราฟจากจุดยอด (way ที่ต่อกันใช้ node เดียวกันที่ปลาย)
 *   2. เชื่อมชิ้นที่ขาดด้วยปลายที่ใกล้กันที่สุด (≤ `maxGapKm`) แบบ Kruskal
 *   3. เส้นหลัก = เส้นทางที่ยาวที่สุดระหว่างสองปลาย (กวาด Dijkstra สองรอบ) — แขนงสั้น ๆ
 *      และเกาะกลางน้ำหลุดไปเอง
 */
export function buildReachLine(ways: readonly LonLat[][], maxGapKm = MAX_GAP_KM): ReachLine {
  const keyOf = (c: LonLat) => `${c[0].toFixed(7)},${c[1].toFixed(7)}`;
  const index = new Map<string, number>();
  const coords: LonLat[] = [];
  const adj: { to: number; w: number; bridge: boolean }[][] = [];
  const nodeOf = (c: LonLat) => {
    const k = keyOf(c);
    let i = index.get(k);
    if (i === undefined) {
      i = coords.length;
      index.set(k, i);
      coords.push([c[0], c[1]]);
      adj.push([]);
    }
    return i;
  };
  const addEdge = (a: number, b: number, bridge: boolean) => {
    if (a === b) return;
    const w = haversineKm(coords[a], coords[b]);
    adj[a].push({ to: b, w, bridge });
    adj[b].push({ to: a, w, bridge });
  };
  for (const way of ways) {
    for (let i = 1; i < way.length; i++) addEdge(nodeOf(way[i - 1]), nodeOf(way[i]), false);
  }
  if (coords.length < 2) throw new Error("no river geometry");

  // ชิ้นส่วน (union-find)
  const parent = coords.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (let a = 0; a < adj.length; a++) for (const e of adj[a]) parent[find(a)] = find(e.to);

  // เชื่อมช่องว่าง: ปลายเส้น (degree 1) ต่างชิ้นกันที่ใกล้กันที่สุดก่อน
  const ends = adj.map((e, i) => (e.length === 1 ? i : -1)).filter((i) => i >= 0);
  const pairs: { a: number; b: number; d: number }[] = [];
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const a = ends[i];
      const b = ends[j];
      if (find(a) === find(b)) continue;
      const d = haversineKm(coords[a], coords[b]);
      if (d <= maxGapKm) pairs.push({ a, b, d });
    }
  }
  pairs.sort((x, y) => x.d - y.d);
  for (const { a, b } of pairs) {
    if (find(a) === find(b)) continue;
    addEdge(a, b, true);
    parent[find(a)] = find(b);
  }

  // ชิ้นที่ยาวที่สุดคือเส้นหลัก ส่วนที่เหลือถูกทิ้ง (และนับไว้)
  const lenByRoot = new Map<number, number>();
  for (let a = 0; a < adj.length; a++) {
    for (const e of adj[a]) {
      if (a < e.to) lenByRoot.set(find(a), (lenByRoot.get(find(a)) ?? 0) + e.w);
    }
  }
  let mainRoot = -1;
  let mainLen = -1;
  let totalLen = 0;
  for (const [root, len] of lenByRoot) {
    totalLen += len;
    if (len > mainLen) {
      mainLen = len;
      mainRoot = root;
    }
  }
  const droppedKm = totalLen - mainLen;

  const dijkstra = (src: number) => {
    const dist = new Float64Array(coords.length).fill(Infinity);
    const prev = new Int32Array(coords.length).fill(-1);
    dist[src] = 0;
    // heap แบบ binary อย่างง่าย: [dist, node]
    const heap: [number, number][] = [[0, src]];
    const push = (x: [number, number]) => {
      heap.push(x);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = (): [number, number] => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    while (heap.length) {
      const [d, u] = pop();
      if (d > dist[u]) continue;
      for (const e of adj[u]) {
        const nd = d + e.w;
        if (nd < dist[e.to]) {
          dist[e.to] = nd;
          prev[e.to] = u;
          push([nd, e.to]);
        }
      }
    }
    let far = src;
    for (let i = 0; i < coords.length; i++) if (Number.isFinite(dist[i]) && dist[i] > dist[far]) far = i;
    return { far, prev };
  };

  const start = coords.findIndex((_, i) => find(i) === mainRoot);
  const { far: u } = dijkstra(start);
  const { far: v, prev } = dijkstra(u);
  const path: number[] = [];
  for (let x = v; x !== -1; x = prev[x]) path.push(x);
  path.reverse();
  const line = path.map((i) => coords[i]);
  const bridge: boolean[] = [];
  for (let i = 1; i < path.length; i++) {
    const e = adj[path[i - 1]].find((x) => x.to === path[i] && x.bridge === false) ?? adj[path[i - 1]].find((x) => x.to === path[i]);
    bridge.push(e?.bridge ?? false);
  }
  return { line, bridge, droppedKm };
}

/**
 * ตัดสินทิศของเส้นจาก **ลำน้ำปลายทาง** ไม่ใช่จากลำดับสถานี:
 * - ลำน้ำสาขา (มี `parent`): ปลายที่ใกล้เส้นของลำน้ำปลายทางกว่า = ท้ายน้ำ
 * - ลำน้ำออก (ไม่มี parent): ปลายที่ใกล้ปลายของลำน้ำสาขากว่า = ต้นน้ำ
 * คืน true เมื่อต้องกลับทิศ
 */
export function shouldReverse(
  line: readonly LonLat[],
  ctx: { parentLine: readonly LonLat[] } | { tributaryMouths: readonly LonLat[] },
): boolean {
  const first = line[0];
  const last = line[line.length - 1];
  if ("parentLine" in ctx) {
    return distanceToLine(first, ctx.parentLine) < distanceToLine(last, ctx.parentLine);
  }
  const near = (p: LonLat) => Math.min(...ctx.tributaryMouths.map((m) => haversineKm(p, m)));
  return near(last) < near(first);
}

/** ช่วงที่เป็นเส้นตรงของเรา (กม. จากต้นเส้น) — ช่วงที่ติดกันถูกรวม */
export function gapRanges(line: readonly LonLat[], bridge: readonly boolean[]): { fromKm: number; toKm: number }[] {
  const cum = cumulativeKm(line);
  const out: { fromKm: number; toKm: number }[] = [];
  for (let i = 0; i < bridge.length; i++) {
    if (!bridge[i]) continue;
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.toKm - cum[i]) < 1e-9) prev.toKm = cum[i + 1];
    else out.push({ fromKm: cum[i], toKm: cum[i + 1] });
  }
  return out.map((g) => ({ fromKm: round(g.fromKm, 1), toKm: round(g.toKm, 1) }));
}

export function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stations on reaches + checks
// ─────────────────────────────────────────────────────────────────────────────

export interface PlacedStation {
  code: string;
  chainageKm: number;
  offsetKm: number;
}

/**
 * ตรวจสองข้อที่ทำให้ปฏิเสธการเขียน: อยู่บนเส้นจริง (`MAX_STATION_OFFSET_KM`) และ chainage
 * เพิ่มขึ้นตามลำดับที่ source เขียนไว้ — คืนรายการข้อผิดพลาด (ว่าง = ผ่าน)
 */
export function checkStationOrder(reach: string, placed: readonly PlacedStation[], maxOffsetKm = MAX_STATION_OFFSET_KM): string[] {
  const errors: string[] = [];
  for (const p of placed) {
    if (p.offsetKm > maxOffsetKm) {
      errors.push(`${reach}: ${p.code} is ${p.offsetKm.toFixed(2)} km from the river line (max ${maxOffsetKm}) — not on this reach`);
    }
  }
  for (let i = 1; i < placed.length; i++) {
    if (!(placed[i].chainageKm > placed[i - 1].chainageKm)) {
      errors.push(
        `${reach}: ${placed[i].code} (km ${placed[i].chainageKm.toFixed(1)}) is not downstream of ${placed[i - 1].code} (km ${placed[i - 1].chainageKm.toFixed(1)}) — contradicts the listed order`,
      );
    }
  }
  return errors;
}

/** จังหวัดที่เส้นผ่าน เรียงตามลำดับที่พบจากต้นน้ำ */
export function provincesAlong(line: readonly LonLat[], provinces: readonly ProvincePolygon[]): string[] {
  const boxes = provinces.map((p) => ({ p, b: turfBbox(p.geometry) }));
  const out: string[] = [];
  for (const c of line) {
    const pt = turfPoint(c);
    for (const { p, b } of boxes) {
      if (c[0] < b[0] || c[0] > b[2] || c[1] < b[1] || c[1] > b[3]) continue;
      if (booleanPointInPolygon(pt, p.geometry)) {
        if (!out.includes(p.code)) out.push(p.code);
        break;
      }
    }
  }
  return out;
}

export function provinceOf(c: LonLat, provinces: readonly ProvincePolygon[]): string | null {
  const pt = turfPoint(c);
  for (const p of provinces) if (booleanPointInPolygon(pt, p.geometry)) return p.code;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Assembly
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildInputs {
  source: RouteSource;
  /** ต่อ reach: way ของ OSM ที่ชื่อตรง (ยังไม่รวม) */
  waysByReach: ReadonlyMap<NorthReachId, LonLat[][]>;
  live: Map<string, LiveStation[]>;
  dams: Map<string, LiveDam>;
  provinces: readonly ProvincePolygon[];
  builtAt: string;
  osmExtractAt: string | null;
}

export function buildTopology(input: BuildInputs): NorthRouteTopology {
  const { source, provinces } = input;
  const errors: string[] = [];

  // 1) เส้นดิบของแต่ละ reach
  const raw = new Map<NorthReachId, ReachLine>();
  for (const r of source.reaches) {
    const ways = input.waysByReach.get(r.id) ?? [];
    if (ways.length === 0) throw new Error(`reach ${r.id}: no OSM waterway=river named "${r.osmName}"`);
    const built = buildReachLine(ways);
    const total = built.droppedKm + cumulativeKm(built.line).at(-1)!;
    if (built.droppedKm > MAX_DROPPED_SHARE * total) {
      throw new Error(
        `reach ${r.id}: ${built.droppedKm.toFixed(0)} km of OSM line could not be joined within ${MAX_GAP_KM} km — refusing to guess`,
      );
    }
    raw.set(r.id, built);
  }

  // 2) ทิศ: ลำน้ำสาขาก่อน (อิงเส้นของปลายทาง ซึ่งทิศไม่มีผลต่อระยะถึงเส้น)
  const oriented = new Map<NorthReachId, { line: LonLat[]; bridge: boolean[] }>();
  const flip = (x: ReachLine) => ({ line: [...x.line].reverse(), bridge: [...x.bridge].reverse() });
  for (const r of source.reaches) {
    const x = raw.get(r.id)!;
    if (r.joinsReachId === null) continue;
    const parent = raw.get(r.joinsReachId)!;
    oriented.set(r.id, shouldReverse(x.line, { parentLine: parent.line }) ? flip(x) : { line: x.line, bridge: x.bridge });
  }
  for (const r of source.reaches) {
    if (r.joinsReachId !== null) continue;
    const x = raw.get(r.id)!;
    const mouths = source.reaches
      .filter((t) => t.joinsReachId === r.id)
      .map((t) => oriented.get(t.id)!.line.at(-1)!);
    oriented.set(r.id, shouldReverse(x.line, { tributaryMouths: mouths }) ? flip(x) : { line: x.line, bridge: x.bridge });
  }

  // 3) ลดรูป (เก็บปลายของช่วงที่เชื่อมเอง)
  const lines = new Map<NorthReachId, { line: LonLat[]; gaps: { fromKm: number; toKm: number }[] }>();
  for (const r of source.reaches) {
    const { line, bridge } = oriented.get(r.id)!;
    const keep = line.map((_, i) => (i > 0 && bridge[i - 1]) || (i < bridge.length && bridge[i]));
    const simple = simplifyLine(line, SIMPLIFY_TOLERANCE_KM, keep);
    // ส่วนไหนของเส้นที่ลดรูปแล้วเป็นเส้นตรงของเรา: ปลายทั้งสองเป็นจุดที่ถูก keep ติดกัน
    const bridgeKeys = new Set<string>();
    for (let i = 0; i < bridge.length; i++) if (bridge[i]) bridgeKeys.add(`${line[i].join()}|${line[i + 1].join()}`);
    const simpleBridge = simple.slice(1).map((p, i) => bridgeKeys.has(`${simple[i].join()}|${p.join()}`));
    lines.set(r.id, {
      line: simple.map((c) => [round(c[0], 5), round(c[1], 5)] as LonLat),
      gaps: gapRanges(simple, simpleBridge),
    });
  }

  // 4) สถานี
  const stations: NorthRouteStation[] = [];
  for (const r of source.reaches) {
    const { line } = lines.get(r.id)!;
    const cum = cumulativeKm(line);
    const placed: (PlacedStation & { live: LiveStation })[] = [];
    for (const code of r.stations) {
      let live: LiveStation;
      try {
        live = resolveStation(code, input.live);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
        continue;
      }
      const { chainageKm, offsetKm } = projectOnLine([live.lon, live.lat], line, cum);
      placed.push({ code, chainageKm, offsetKm, live });
    }
    errors.push(...checkStationOrder(r.id, placed));
    for (const p of placed) {
      stations.push({
        ridCode: p.code,
        thaiwaterId: p.live.thaiwaterId,
        reachId: r.id,
        chainageKm: round(p.chainageKm, 1),
        offsetKm: round(p.offsetKm, 2),
        lat: p.live.lat,
        lon: p.live.lon,
        provinceCode: provinceOf([p.live.lon, p.live.lat], provinces),
        nameTh: p.live.nameTh,
      });
    }
  }

  // 5) เขื่อน
  const dams: NorthRouteDam[] = [];
  for (const d of source.dams) {
    const live = input.dams.get(d.nameTh);
    if (!live) {
      errors.push(`dam "${d.nameTh}" is not in the live ThaiWater analyst/dam feed`);
      continue;
    }
    const { line } = lines.get(d.reachId)!;
    const { chainageKm, offsetKm } = projectOnLine([live.lon, live.lat], line);
    if (offsetKm > MAX_DAM_OFFSET_KM) {
      errors.push(`dam "${d.nameTh}" is ${offsetKm.toFixed(1)} km from the ${d.reachId} line (max ${MAX_DAM_OFFSET_KM})`);
      continue;
    }
    dams.push({
      nameTh: d.nameTh,
      damIds: live.ids,
      reachId: d.reachId,
      chainageKm: round(chainageKm, 1),
      offsetKm: round(offsetKm, 1),
      lat: live.lat,
      lon: live.lon,
    });
  }

  if (errors.length) throw new Error(`build-north-route refused to write:\n  - ${errors.join("\n  - ")}`);

  // 6) reach + จุดบรรจบ
  const reaches: NorthRouteReach[] = source.reaches.map((r) => {
    const { line, gaps } = lines.get(r.id)!;
    const joinsAtKm =
      r.joinsReachId === null ? null : round(projectOnLine(line.at(-1)!, lines.get(r.joinsReachId)!.line).chainageKm, 1);
    return {
      id: r.id,
      nameTh: r.nameTh,
      nameEn: r.nameEn,
      joinsReachId: r.joinsReachId,
      joinsAtKm,
      lengthKm: round(cumulativeKm(line).at(-1)!, 1),
      polyline: line,
      gaps,
      upstreamProvinceCodes: provincesAlong(line, provinces),
      citations: r.citations,
    };
  });

  return {
    builtAt: input.builtAt,
    osmExtractAt: input.osmExtractAt,
    layer: {
      id: "north-route-topology",
      epistemicClass: "static-reference",
      liveOrStatic: "static",
      // ไฟล์นี้คือผังที่เราประกอบเอง ต้นทางไม่มีเวลาเผยแพร่ของชุดนี้ให้อ้าง → null ตามจริง
      publishedAt: null,
      fetchedAt: input.builtAt,
      sourceIds: ["osm", "thaiwater"],
    },
    reaches,
    stations,
    dams,
  };
}

/** ไฟล์เล็กที่ Worker ของ API import (id ของสถานีเท่านั้น ไม่พาเส้นลำน้ำเข้า bundle) */
export function apiStationList(topology: NorthRouteTopology): {
  builtAt: string;
  stations: { ridCode: string; thaiwaterId: number; reachId: NorthReachId }[];
} {
  return {
    builtAt: topology.builtAt,
    stations: topology.stations.map((s) => ({ ridCode: s.ridCode, thaiwaterId: s.thaiwaterId, reachId: s.reachId })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// I/O (main only)
// ─────────────────────────────────────────────────────────────────────────────

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

/** way ของ OSM ต่อชื่อ — ผ่าน `osmium tags-filter` แล้ว `osmium export` เป็น GeoJSON Sequence */
async function extractRiverWays(pbf: string, names: readonly string[]): Promise<Map<string, LonLat[][]>> {
  mkdirSync(WORK_DIR, { recursive: true });
  const filtered = path.join(WORK_DIR, "north-route-rivers.osm.pbf");
  const seq = path.join(WORK_DIR, "north-route-rivers.geojsonseq");
  await execa("osmium", ["tags-filter", "-o", filtered, "--overwrite", pbf, "w/waterway=river"], { stdio: "inherit" });
  if (existsSync(seq)) rmSync(seq);
  await execa("osmium", ["export", "-f", "geojsonseq", "--geometry-types=linestring", "-o", seq, filtered], { stdio: "inherit" });
  const out = new Map<string, LonLat[][]>(names.map((n) => [n, []]));
  for (const lineText of readFileSync(seq, "utf-8").split("\n")) {
    const trimmed = lineText.replace(/^\x1e/, "").trim();
    if (!trimmed) continue;
    const f = JSON.parse(trimmed) as { geometry?: { type: string; coordinates: LonLat[] }; properties?: Record<string, string> };
    if (f.geometry?.type !== "LineString") continue;
    const name = f.properties?.name;
    const nameTh = f.properties?.["name:th"];
    for (const n of names) if (name === n || nameTh === n) out.get(n)!.push(f.geometry.coordinates);
  }
  return out;
}

async function osmTimestamp(pbf: string): Promise<string | null> {
  try {
    const { stdout } = await execa("osmium", ["fileinfo", "-g", "header.option.osmosis_replication_timestamp", pbf]);
    const ms = Date.parse(stdout.trim());
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  } catch {
    return null;
  }
}

async function main() {
  const source = parseSource(JSON.parse(readFileSync(SOURCE_PATH, "utf-8")));
  const provinces = loadProvincePolygons(AOI_ROOT);
  console.log(`boundaries: ${new Set(provinces.map((p) => p.code)).size} provinces`);

  const pbf = await fetchThailandOsm();
  const osmExtractAt = await osmTimestamp(pbf);
  const byName = await extractRiverWays(pbf, source.reaches.map((r) => r.osmName));
  const waysByReach = new Map<NorthReachId, LonLat[][]>(source.reaches.map((r) => [r.id, byName.get(r.osmName) ?? []]));
  for (const r of source.reaches) console.log(`osm ${r.id}: ${waysByReach.get(r.id)!.length} ways named "${r.osmName}"`);

  const [waterBody, damBody] = await Promise.all([getJson(WATERLEVEL_URL), getJson(DAM_URL)]);
  // เวลาที่ได้ข้อมูลสดจาก ThaiWater ครบทั้งสองปลายทาง = fetchedAt ของผังนี้
  const builtAt = new Date().toISOString();
  const live = parseLiveStations(waterBody);
  const dams = parseLiveDams(damBody);
  console.log(`thaiwater: ${live.size} RID codes, ${dams.size} dam names`);

  const topology = buildTopology({ source, waysByReach, live, dams, provinces, builtAt, osmExtractAt });
  for (const r of topology.reaches) {
    const st = topology.stations.filter((s) => s.reachId === r.id);
    console.log(
      `${r.id}: ${r.lengthKm} km, ${r.polyline.length} pts, gaps ${JSON.stringify(r.gaps)}, joins ${r.joinsReachId ?? "-"} @ ${r.joinsAtKm ?? "-"} km, ` +
        st.map((s) => `${s.ridCode}@${s.chainageKm}(±${s.offsetKm})`).join(" "),
    );
  }
  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(topology)}\n`);
  writeFileSync(API_OUT_PATH, `${JSON.stringify(apiStationList(topology), null, 2)}\n`);
  console.log(`wrote ${path.relative(process.cwd(), OUT_PATH)} and ${path.relative(process.cwd(), API_OUT_PATH)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : "build-north-route failed");
    process.exit(1);
  });
}
