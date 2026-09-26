/// <reference lib="webworker" />
import { fillStationSheet, type SheetFill, type SheetGrid, type SheetStation } from "../lib/stationSheet";
import {
  applyObservedPrecedence,
  buildLeafSpec,
  fillLeafWindows,
  leafRequestFor,
  planLeafFetches,
  SHEET_LEAF_MAX_CONCURRENT,
  SHEET_LEAF_MAX_REQUESTS,
  stationLeafNeeds,
  type LeafPlanStatus,
  type LeafSpec,
  type LeafSpecInput,
  type SheetWindow,
} from "../lib/stationSheetLeaf";
import { decodeLandcoverTile, decodeTerrainTile } from "../lib/tileCodec";

/**
 * การเติมน้ำของแผ่นน้ำจำลองจากระดับน้ำที่สถานี (E16 B-1, `lib/stationSheet.ts` +
 * `lib/stationSheetLeaf.ts`) นอก main thread
 *
 * ต่างจาก overlay.worker.ts ที่ใช้ครั้งเดียว: ตัวนี้อยู่ตลอดอายุของชั้นในจังหวัดหนึ่ง
 * (`scene/StationSheet.ts` เป็นเจ้าของ และส่ง `abort` แล้ว terminate ตอน dispose) — ความสูง +
 * มาสก์ + สเปกไทล์ส่งมาครั้งเดียวด้วย `init` แล้วแต่ละงานส่งมาแค่รายชื่อสถานี
 *
 * ต่องาน: ขั้นที่ 1 (overview) → ส่งผล `stage: 1` ทันที → วางแผนไทล์ 30 ม. → ขอไทล์ → ขั้นที่ 2
 * (หน้าต่าง 30 ม.) → ส่งผล `stage: 2` ด้วย jobId เดิม ถ้าไทล์ที่ต้องใช้อยู่ในหน่วยความจำครบแล้ว
 * ข้ามไปขั้นที่ 2 ทันที ผลของงานที่ถูกแทนแล้วไม่ถูกคำนวณต่อ (ไทล์ที่ได้มายังเก็บไว้ใช้)
 *
 * ## การขอไทล์ (ข้อจำกัด devops C1/C4–C8 ของงาน 30 ม.)
 *
 * - `issued` นับทุกคำขอที่ **เริ่มแล้ว** ตลอดอายุของ worker (= ของจังหวัด) และไม่เกิน
 *   `SHEET_LEAF_MAX_REQUESTS` — คำขอที่ล้มเหลว/ได้ SPA shell ยังนับ และไม่ถูกขอซ้ำ
 * - `known` = คีย์ที่ขอแล้ว/กำลังขอ; คิวที่ยังไม่เริ่มถูกแทนทั้งคิวเมื่อมีงานใหม่ และถูกล้างเมื่อชั้นปิด
 *   (`enable: false`) หรือไม่มีสถานีเกินตลิ่ง (`idle`) — คำขอที่ไม่เคยเริ่มไม่นับ
 * - ทุกคำขอผ่าน AbortController ตัวเดียว ถูก abort เมื่อ `abort` (dispose / เปลี่ยนจังหวัด)
 * - พร้อมกันไม่เกิน `SHEET_LEAF_MAX_CONCURRENT`; `fetch(url, { signal })` เปล่า ๆ — URL ตรงกับ
 *   ตัววาดทุกไบต์ (`tileUrl`) ไม่มี query string / header / โหมด cache → ใช้ HTTP cache ร่วมกัน
 * - ไม่มี console.* ในเส้นทางนี้ (C8) — ข้อผิดพลาดไปอยู่ในผลที่ส่งกลับ (ตัวนับดีบัก)
 */
export type StationSheetWorkerMessage =
  | {
      type: "init";
      grid: SheetGrid;
      /** สำเนาของ heightfield — ตัวจริงยังถูกใช้โดย `sample()` บน main thread */
      heights: Float32Array;
      mask: Uint8Array | null;
      /** ส่วนของ manifest ที่ใช้ประกอบ `LeafSpec` — null = ไม่ทำขั้น 30 ม. */
      leaf: LeafSpecInput | null;
    }
  | { type: "job"; jobId: number; stations: SheetStation[] }
  /** มาสก์ "GFM สังเกตแล้ว" บนกริด overview (null = ไม่มีฉากที่แสดง) — ไม่วางแผน/ไม่ขอไทล์ */
  | { type: "observed"; mask: Uint8Array | null }
  /** ชั้นถูกปิด/เปิด — ปิด = ล้างคิวที่ยังไม่เริ่ม (C7) */
  | { type: "enable"; on: boolean }
  /** ไม่มีสถานีเกินตลิ่งแล้ว — ล้างคิว ไม่คำนวณอะไร */
  | { type: "idle" }
  /** dispose / เปลี่ยนจังหวัด — abort ทุกคำขอ (C6) */
  | { type: "abort" };

/** ความละเอียดที่แต่ละสถานีถูกคำนวณจริง (C3) */
export type SheetStationResolution =
  | "leaf"
  /** ขั้นที่ 1 ยังรอไทล์ */
  | "pending"
  /** งบคำขอไทล์ของจังหวัดหมด */
  | "overview-budget"
  /** ไทล์ที่ต้องใช้ขอไม่สำเร็จ */
  | "overview-failed"
  /** ไม่มีไทล์ 30 ม. ให้ใช้ (จังหวัดไม่มี pyramid / ไทล์ไม่มีอยู่ / ขั้นที่ 1 ไม่เติมอะไร) */
  | "overview";

export interface StationSheetLeafStats {
  issued: number;
  max: number;
  loaded: number;
  failed: number;
  inFlight: number;
  queued: number;
}

export type StationSheetWorkerResult =
  | {
      ok: true;
      jobId: number;
      stage: 1 | 2;
      depthCm: Uint16Array;
      station: Uint16Array;
      fadePct: Uint8Array;
      filledCells: number;
      cellsPerStation: number[];
      windows: SheetWindow[];
      resolution: SheetStationResolution[];
      leaf: StationSheetLeafStats;
    }
  | { ok: false; jobId: number; error: string };

let grid: SheetGrid | null = null;
let heights: Float32Array | null = null;
let mask: Uint8Array | null = null;
let spec: LeafSpec | null = null;
let observed: Uint8Array | null = null;
let enabled = true;
let aborted = false;
const controller = new AbortController();

const known = new Set<string>();
const loadedKeys = new Set<string>();
const failedKeys = new Set<string>();
const terrainTiles = new Map<number, Int16Array>();
const landcoverTiles = new Map<number, Uint8Array>();
let issued = 0;
let active = 0;
let queue: string[] = [];

interface Job {
  id: number;
  stations: SheetStation[];
  fill: SheetFill;
  needs: { terrain: number[]; keys: string[] }[];
  plan: LeafPlanStatus[];
}
let current: Job | null = null;
/** ผลล่าสุด (ยังไม่มาสก์ GFM) — ส่งซ้ำเมื่อมาสก์เปลี่ยน */
let last: { job: Job; stage: 1 | 2; windows: SheetWindow[]; resolution: SheetStationResolution[] } | null = null;

const post = (msg: StationSheetWorkerResult, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

function leafStats(): StationSheetLeafStats {
  return {
    issued,
    max: SHEET_LEAF_MAX_REQUESTS,
    loaded: loadedKeys.size,
    failed: failedKeys.size,
    inFlight: active,
    queued: queue.length,
  };
}

function emit(job: Job, stage: 1 | 2, windows: SheetWindow[], resolution: SheetStationResolution[]): void {
  last = { job, stage, windows, resolution };
  const m = applyObservedPrecedence(spec, observed, job.fill, windows);
  const transfer: Transferable[] = [m.overview.depthCm.buffer, m.overview.station.buffer, m.overview.fadePct.buffer];
  for (const w of m.windows) transfer.push(w.heights.buffer, w.depthCm.buffer, w.station.buffer, w.fadePct.buffer, w.notEst.buffer);
  post(
    {
      ok: true,
      jobId: job.id,
      stage,
      depthCm: m.overview.depthCm,
      station: m.overview.station,
      fadePct: m.overview.fadePct,
      filledCells: m.filledCells + m.windows.reduce((a, w) => a + w.filledCells, 0),
      cellsPerStation: job.fill.cellsPerStation,
      windows: m.windows,
      resolution,
      leaf: leafStats(),
    },
    transfer,
  );
}

const settled = (key: string) => loadedKeys.has(key) || failedKeys.has(key);

/** ขั้นที่ 2 เมื่อทุกคีย์ของสถานีที่ได้งบ settle แล้ว — ไม่งั้นรอ */
function tryFinish(job: Job): boolean {
  if (current !== job) return true;
  for (let k = 0; k < job.plan.length; k++) {
    if (job.plan[k] !== "planned") continue;
    if (!job.needs[k].keys.every(settled)) return false;
  }
  const refined = job.plan.map((p, k) => p === "planned" && job.needs[k].keys.every((key) => loadedKeys.has(key)));
  const resolution: SheetStationResolution[] = job.plan.map((p, k) =>
    refined[k] ? "leaf" : p === "planned" ? "overview-failed" : p === "budget" ? "overview-budget" : "overview",
  );
  let windows: SheetWindow[] = [];
  if (spec && refined.some(Boolean)) {
    const tiles = new Set<number>();
    job.needs.forEach((n, k) => {
      if (refined[k]) for (const t of n.terrain) tiles.add(t);
    });
    windows = fillLeafWindows({
      spec,
      tiles: { terrain: terrainTiles, landcover: landcoverTiles },
      windowTiles: [...tiles].sort((a, b) => a - b),
      stations: job.stations,
      refined,
      overview: { station: job.fill.station, fadePct: job.fill.fadePct },
      insideMask: mask,
    });
  }
  current = null;
  emit(job, 2, windows, resolution);
  return true;
}

function pump(): void {
  while (enabled && !aborted && active < SHEET_LEAF_MAX_CONCURRENT && queue.length > 0) {
    const key = queue.shift()!;
    if (known.has(key) || !spec) continue;
    if (issued >= SHEET_LEAF_MAX_REQUESTS) {
      queue = [];
      break;
    }
    const { url } = leafRequestFor(spec, key);
    known.add(key);
    issued++;
    active++;
    void load(key, url);
  }
}

async function load(key: string, url: string): Promise<void> {
  const s = spec!;
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    const [kind, , x, y] = key.split("/");
    if (kind === "t") {
      const h = decodeTerrainTile(buf, s.terrain.tileSize, s.terrain.border);
      if (!h) throw new Error("terrain tile size mismatch");
      terrainTiles.set(Number(y) * s.terrain.tilesX + Number(x), h);
    } else {
      const lc = decodeLandcoverTile(buf, s.terrain.tileSize);
      if (!lc || !s.landcover) throw new Error("landcover tile size mismatch");
      landcoverTiles.set(Number(y) * s.landcover.tilesX + Number(x), lc);
    }
    loadedKeys.add(key);
  } catch {
    // ล้มเหลว/ถูก abort/ได้ SPA shell — นับแล้ว ไม่ขอซ้ำ (สถานีนั้นอยู่บน overview + บอกเหตุ)
    failedKeys.add(key);
  } finally {
    active--;
    if (!aborted) {
      if (current) tryFinish(current);
      pump();
    }
  }
}

function runJob(jobId: number, stations: SheetStation[]): void {
  if (!grid || !heights) throw new Error("station sheet worker received a job before init");
  const fill = fillStationSheet(grid, heights, mask, stations);
  const s = spec;
  const needs = stations.map((_, k) =>
    s && fill.cellsPerStation[k] > 0 ? stationLeafNeeds(s, fill.stationCells[k]) : { terrain: [], keys: [] },
  );
  const plan = planLeafFetches(
    needs.map((n, k) => ({ keys: n.keys, priority: stations[k].wseM - stations[k].bankM })),
    known,
    issued,
  );
  const job: Job = { id: jobId, stations, fill, needs, plan: plan.status };
  current = job;
  // คิวใหม่แทนคิวเดิมทั้งคิว (C6: ขอเฉพาะไทล์ใหม่ของชุดสถานีปัจจุบัน)
  queue = enabled ? plan.fetch.slice() : [];
  if (tryFinish(job)) return;
  emit(
    job,
    1,
    [],
    plan.status.map((p) => (p === "planned" ? "pending" : p === "budget" ? "overview-budget" : "overview")),
  );
  pump();
}

self.onmessage = (ev: MessageEvent<StationSheetWorkerMessage>) => {
  const msg = ev.data;
  switch (msg.type) {
    case "init":
      grid = msg.grid;
      heights = msg.heights;
      mask = msg.mask;
      spec = msg.leaf ? buildLeafSpec(msg.leaf) : null;
      return;
    case "observed":
      observed = msg.mask;
      if (last) emit(last.job, last.stage, last.windows, last.resolution);
      return;
    case "enable":
      enabled = msg.on;
      if (!enabled) queue = [];
      return;
    case "idle":
      queue = [];
      current = null;
      last = null;
      return;
    case "abort":
      aborted = true;
      queue = [];
      current = null;
      controller.abort();
      // ไม่มีงานเหลือแล้ว — ปิดตัวเอง (main thread terminate ตามหลังเป็นตาข่ายกันพลาด)
      self.close();
      return;
    case "job":
      try {
        runJob(msg.jobId, msg.stations);
      } catch (err) {
        post({ ok: false, jobId: msg.jobId, error: String(err) });
      }
      return;
  }
};
