/**
 * ตรรกะล้วนของแผงเส้นทางน้ำเหนือ (E16, `NorthWaterCard`) — แยกจากคอมโพเนนต์ให้เทสได้
 * โดยไม่ต้องมี DOM
 *
 * กฎความซื่อสัตย์ของแผงนี้:
 * - ทุกตัวเลขมาจากค่าตรวจวัดของ ThaiWater (ค่าล่าสุดหรือ 48 ชม. ย้อนหลัง) — **ไม่มีเวลาที่น้ำ
 *   จะมาถึง ไม่มีค่าล่วงหน้า** "ยอดสูงสุดใน 48 ชม." คือเวลาที่เกิดไปแล้ว
 * - แนวโน้ม 3 ชม. ใช้สูตรเดียวกับ `freeboardTrendMPerH` ของ apps/api/src/exposure/compute.ts
 *   (จุดแรกกับจุดสุดท้ายในหน้าต่าง เรียงด้วย total order (เวลา, ค่า)) — เป็นอัตราที่เกิดแล้ว
 *   ไม่ใช่การต่อเส้นไปข้างหน้า
 * - ค่าย้อนหลังไม่มีระดับสถานการณ์ของ ThaiWater → สีคิดจากระยะต่ำกว่าตลิ่ง และบอกไว้
 */
import type {
  NorthReachId,
  NorthRouteHistoryPoint,
  NorthRouteStationState,
  NorthRouteTopology,
  SituationLevel,
} from "@siahra/shared-types";

export const ROUTE_WINDOW_HOURS = 48;
const HOUR_MS = 3_600_000;
/** หน้าต่างของแนวโน้ม — เท่ากับ `DEFAULT_EXPOSURE_THRESHOLDS.historyWindowH` ฝั่ง API */
export const TREND_WINDOW_HOURS = 3;
/** จุดประวัติที่ใช้แทน "ค่า ณ เวลาที่เลือก" ต้องไม่เก่ากว่าเวลานั้นเกินนี้ (RID รายชั่วโมง) */
export const POINT_TOLERANCE_MS = 3 * HOUR_MS;
/** ค่าตรวจวัดที่เก่ากว่านี้ = ค้าง (หรี่ลงพร้อมอายุ) — สองรอบรายชั่วโมง + ความหน่วงเผยแพร่ */
export const STALE_OBS_MS = 3 * HOUR_MS;

export type RouteView = { mode: "live" } | { mode: "at"; atMs: number } | { mode: "outside" };

/**
 * แผงเดินตามเวลาของ TimelineBar: สด = ค่าล่าสุด, ภายใน 48 ชม. = ค่าจากประวัติที่ถืออยู่แล้ว
 * (ไม่ยิงคำขอใหม่), เก่ากว่านั้น = บอกว่าอยู่นอกช่วงของแผงนี้ ไม่ใช่แสดงค่าปัจจุบันแทน
 */
export function routeView(atIso: string | null, nowMs: number): RouteView {
  if (atIso === null) return { mode: "live" };
  const atMs = Date.parse(atIso);
  if (!Number.isFinite(atMs)) return { mode: "live" };
  if (nowMs - atMs > ROUTE_WINDOW_HOURS * HOUR_MS) return { mode: "outside" };
  return { mode: "at", atMs };
}

/** จุดล่าสุดที่ `t ≤ atMs` และไม่เก่ากว่า `toleranceMs` — null = ไม่มีค่าที่เวลานั้น */
export function pointAt(
  history: readonly NorthRouteHistoryPoint[],
  atMs: number,
  toleranceMs = POINT_TOLERANCE_MS,
): NorthRouteHistoryPoint | null {
  let best: NorthRouteHistoryPoint | null = null;
  let bestMs = -Infinity;
  for (const p of history) {
    const ms = Date.parse(p.t);
    if (!Number.isFinite(ms) || ms > atMs || ms < atMs - toleranceMs) continue;
    if (p.value === null && p.discharge === null) continue;
    if (ms > bestMs) {
      best = p;
      bestMs = ms;
    }
  }
  return best;
}

/**
 * อัตราการเปลี่ยนของ freeboard (ม./ชม.) ในหน้าต่าง `TREND_WINDOW_HOURS` ที่จบที่ `endMs`
 * — สูตรเดียวกับ `freeboardTrend()` ใน apps/api/src/exposure/compute.ts: ค่าลบ = น้ำขึ้น
 * เข้าหาตลิ่ง; น้อยกว่าสองจุด หรือทุกจุดอยู่ที่เวลาเดียวกัน → null
 */
export function freeboardTrendMPerH(
  history: readonly NorthRouteHistoryPoint[],
  endMs: number,
  windowH = TREND_WINDOW_HOURS,
): number | null {
  const fromMs = endMs - windowH * HOUR_MS;
  const usable = history
    .map((p) => ({ ms: Date.parse(p.t), value: p.value }))
    .filter(
      (p): p is { ms: number; value: number } =>
        Number.isFinite(p.ms) && p.value !== null && Number.isFinite(p.value) && p.ms >= fromMs && p.ms <= endMs,
    )
    .sort((a, b) => a.ms - b.ms || a.value - b.value);
  if (usable.length < 2) return null;
  const first = usable[0];
  const last = usable[usable.length - 1];
  const hours = (last.ms - first.ms) / HOUR_MS;
  if (hours <= 0) return null;
  return Math.round((-(last.value - first.value) / hours) * 1000) / 1000;
}

export interface Peak {
  value: number;
  t: string;
}

/**
 * ค่าสูงสุดของระดับน้ำและอัตราการไหลใน 48 ชม. ที่จบที่ `endMs` (ค่าที่เกิดแล้ว) — เท่ากันหลายจุด
 * เลือกจุดที่ **ใหม่กว่า** (ยอดที่ยังค้างอยู่ตอนนี้อ่านง่ายกว่ายอดแรกที่แตะ)
 */
export function peaks48h(
  history: readonly NorthRouteHistoryPoint[],
  endMs: number,
): { level: Peak | null; discharge: Peak | null } {
  const fromMs = endMs - ROUTE_WINDOW_HOURS * HOUR_MS;
  let level: Peak | null = null;
  let discharge: Peak | null = null;
  for (const p of history) {
    const ms = Date.parse(p.t);
    if (!Number.isFinite(ms) || ms < fromMs || ms > endMs) continue;
    if (p.value !== null && (level === null || p.value >= level.value)) level = { value: p.value, t: p.t };
    if (p.discharge !== null && (discharge === null || p.discharge >= discharge.value)) {
      discharge = { value: p.discharge, t: p.t };
    }
  }
  return { level, discharge };
}

/** % ของความจุลำน้ำที่ต้นทางเผยแพร่ — ต้องมีทั้งสองค่าและ qmax > 0 */
export function percentOfQmax(dischargeM3s: number | null, qmaxM3s: number | null): number | null {
  if (dischargeM3s === null || qmaxM3s === null || !(qmaxM3s > 0)) return null;
  return Math.round((dischargeM3s / qmaxM3s) * 1000) / 10;
}

export interface NodeReading {
  /** ระดับน้ำ (ม.รทก. เมื่อ `levelDatum` = msl) */
  level: number | null;
  levelDatum: "msl" | "local" | "unknown";
  dischargeM3s: number | null;
  qmaxPct: number | null;
  /** ตลิ่ง − ระดับน้ำ (ม.) — เฉพาะเมื่อทั้งสองอยู่บน ม.รทก. */
  freeboardM: number | null;
  /** ระดับวิกฤต − ระดับน้ำ (ม.) — เมื่อต้นทางเผยแพร่ระดับวิกฤต */
  criticalMarginM: number | null;
  /** ระดับสถานการณ์ของ ThaiWater — มีเฉพาะค่าสด */
  situationLevel: SituationLevel | null;
  /** เวลาที่ค่านี้ถูกวัด — null = ไม่มีค่าให้แสดง */
  observedAt: string | null;
  /** แนวโน้ม freeboard 3 ชม. จบที่เวลาที่แสดง (ม./ชม., ลบ = น้ำขึ้น) */
  trendMPerH: number | null;
  /** ไม่มีค่าเลย (สถานีไม่อยู่ในฟีด หรือไม่มีจุดที่เวลานั้น) */
  missing: boolean;
  /** ค่าที่มีเก่ากว่า `STALE_OBS_MS` เมื่อเทียบกับเวลาที่แสดง */
  stale: boolean;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** ค่าของสถานีหนึ่ง ณ มุมมองที่เลือก (สด / ภายใน 48 ชม.) */
export function nodeReading(station: NorthRouteStationState, view: RouteView, nowMs: number): NodeReading {
  const latest = station.latest;
  const bank = latest?.minBankMsl ?? null;
  const critical = latest?.criticalLevelMsl ?? null;
  const qmax = latest?.qmaxM3s ?? null;
  const empty: NodeReading = {
    level: null,
    levelDatum: "unknown",
    dischargeM3s: null,
    qmaxPct: null,
    freeboardM: null,
    criticalMarginM: null,
    situationLevel: null,
    observedAt: null,
    trendMPerH: null,
    missing: true,
    stale: false,
  };
  if (view.mode === "outside") return empty;

  if (view.mode === "live") {
    if (!latest) return empty;
    const level = latest.waterlevelMsl;
    const discharge = latest.dischargeM3s ?? null;
    const obsMs = latest.observedAt ? Date.parse(latest.observedAt) : NaN;
    // แนวโน้มสดใช้ประวัติที่ถือไว้ (ต้องเป็น ม.รทก. เดียวกับค่าล่าสุด ไม่งั้นเทียบกันไม่ได้)
    const trend = station.datum === "msl" && Number.isFinite(obsMs) ? freeboardTrendMPerH(station.history48h, nowMs) : null;
    return {
      level,
      levelDatum: level !== null ? "msl" : "unknown",
      dischargeM3s: discharge,
      qmaxPct: percentOfQmax(discharge, qmax),
      freeboardM: latest.freeboardM,
      criticalMarginM: level !== null && critical !== null ? round3(critical - level) : null,
      situationLevel: latest.situationLevel,
      observedAt: latest.observedAt,
      trendMPerH: trend,
      missing: level === null && discharge === null,
      stale: !Number.isFinite(obsMs) || nowMs - obsMs > STALE_OBS_MS,
    };
  }

  const p = pointAt(station.history48h, view.atMs);
  if (!p) return empty;
  const msl = station.datum === "msl" ? p.value : null;
  return {
    level: p.value,
    levelDatum: station.datum,
    dischargeM3s: p.discharge,
    qmaxPct: percentOfQmax(p.discharge, qmax),
    freeboardM: msl !== null && bank !== null ? round3(bank - msl) : null,
    criticalMarginM: msl !== null && critical !== null ? round3(critical - msl) : null,
    situationLevel: null,
    observedAt: p.t,
    trendMPerH: station.datum === "msl" ? freeboardTrendMPerH(station.history48h, view.atMs) : null,
    missing: false,
    stale: view.atMs - Date.parse(p.t) > STALE_OBS_MS,
  };
}

/**
 * สีของโหนด — ค่าเดียวกับ `situationColor`/`freeboardColor` ของหมุดบนแผนที่
 * (scene/StationMarkers.ts) และเป็นแหล่งเดียวที่ทั้ง `nodeColor` และคำอธิบายสัญลักษณ์ใต้ผังอ่าน
 */
export const NODE_COLOR = {
  /** ThaiWater ระดับ 5 ล้นตลิ่ง / ย้อนหลัง: น้ำถึงหรือเกินตลิ่ง */
  red: "#ef4444",
  /** ThaiWater ระดับ 4 น้ำมาก / ย้อนหลัง: ต่ำกว่าตลิ่งไม่เกิน `FREEBOARD_NEAR_M` */
  orange: "#f97316",
  /** ThaiWater ระดับ 1–2 น้ำน้อยวิกฤต / น้ำน้อย */
  yellow: "#fcd34d",
  /** ThaiWater ระดับ 3 ปกติ */
  green: "#22c55e",
  /** ย้อนหลัง: ต่ำกว่าตลิ่งเกิน `FREEBOARD_NEAR_M` */
  blue: "#38bdf8",
  /** ไม่มีค่า หรือไม่มีตลิ่งให้เทียบ */
  grey: "#64748b",
} as const;

/** ระยะต่ำกว่าตลิ่ง (ม.) ที่ถือว่า "ใกล้ตลิ่ง" ในการระบายสีย้อนหลัง — เท่ากับ `freeboardColor` */
export const FREEBOARD_NEAR_M = 1;

/** สีของโหนด: ระดับสถานการณ์ (สด) หรือระยะต่ำกว่าตลิ่ง (ย้อนหลัง) — ตรงกับหมุดบนแผนที่ */
export function nodeColor(r: NodeReading): string {
  if (r.missing) return NODE_COLOR.grey;
  if (r.situationLevel !== null) {
    if (r.situationLevel === 5) return NODE_COLOR.red;
    if (r.situationLevel === 4) return NODE_COLOR.orange;
    if (r.situationLevel === 1 || r.situationLevel === 2) return NODE_COLOR.yellow;
    return NODE_COLOR.green;
  }
  if (r.freeboardM === null) return NODE_COLOR.grey;
  if (r.freeboardM <= 0) return NODE_COLOR.red;
  if (r.freeboardM <= FREEBOARD_NEAR_M) return NODE_COLOR.orange;
  return NODE_COLOR.blue;
}

// ─────────────────────────────────────────────────────────────────────────────
// ผังแบบ schematic (SVG)
// ─────────────────────────────────────────────────────────────────────────────

export interface SchematicNode {
  ridCode: string;
  reachId: NorthReachId;
  x: number;
  y: number;
}

export interface SchematicDam {
  nameTh: string;
  reachId: NorthReachId;
  x: number;
  y: number;
  /** อยู่บนลำน้ำสาขา (ห่างเส้นหลัก) — วาดข้างเส้นพร้อมเส้นประ */
  offLine: boolean;
  lineX: number;
}

export interface SchematicPath {
  reachId: NorthReachId;
  d: string;
}

/**
 * ช่วงของเส้นลำน้ำระหว่างโหนดที่ติดกัน (หรือจากหัวเส้นถึงสถานีแรก / สถานีสุดท้ายถึงปาก)
 * — `d` วาดจากต้นน้ำไปท้ายน้ำเสมอ (y เพิ่มขึ้นตลอดช่วง) ทิศของเส้นประเคลื่อนไหวจึงเป็นทิศน้ำไหล
 */
export interface SchematicSegment {
  key: string;
  reachId: NorthReachId;
  d: string;
  /** สถานีที่ปลายท้ายน้ำของช่วง — null = ช่วงนี้จบที่ปากลำน้ำ/ปลายเส้น */
  downstreamCode: string | null;
  /** สถานีที่ปลายต้นน้ำของช่วง — null = ช่วงนี้เริ่มที่หัวเส้น/จุดบรรจบ */
  upstreamCode: string | null;
}

export interface Schematic {
  width: number;
  height: number;
  confluence: { x: number; y: number };
  paths: SchematicPath[];
  segments: SchematicSegment[];
  /** สถานีท้ายสุดของลำน้ำปลายทาง (chainage มากสุด) — ปลายทางของผัง */
  terminalCode: string | null;
  nodes: SchematicNode[];
  dams: SchematicDam[];
  labels: { reachId: NorthReachId; x: number; y: number }[];
}

const COLUMN_X: Record<NorthReachId, number> = { wang: 36, ping: 96, "chao-phraya": 150, nan: 204, yom: 264 };
const PARENT_OF: Partial<Record<NorthReachId, NorthReachId>> = { wang: "ping", yom: "nan" };
/** ระยะ (px) ที่เส้นสาขาหักเข้าหาจุดบรรจบ */
const BEND = 16;

/**
 * วางโหนดตาม chainage จริง (มาตราส่วนเดียวทั้งผัง): ปิง/น่านลงมาบรรจบที่นครสวรรค์ ส่วนวัง/ยม
 * บรรจบปิง/น่านที่ `joinsAtKm` ของตัวเอง แล้วเจ้าพระยาไหลต่อลงล่าง — เส้นเริ่มที่สถานีแรกของ
 * แต่ละลำน้ำ (ต้นน้ำที่ไม่มีสถานีไม่ถูกวาดให้ยาวเปล่า ๆ)
 */
export function layoutSchematic(topology: NorthRouteTopology, height = 440, width = 300): Schematic {
  const reach = new Map(topology.reaches.map((r) => [r.id, r]));
  const firstKm = (id: NorthReachId) => {
    const ks = topology.stations.filter((s) => s.reachId === id).map((s) => s.chainageKm);
    return ks.length ? Math.min(...ks) : 0;
  };
  const kmToMouth = (id: NorthReachId, km: number) => (reach.get(id)?.lengthKm ?? km) - km;
  /** ระยะตามลำน้ำจากจุดหนึ่งบน reach ถึงจุดบรรจบนครสวรรค์ (กม.) */
  const kmToConfluence = (id: NorthReachId, km: number): number => {
    const parent = PARENT_OF[id];
    if (!parent) return kmToMouth(id, km);
    const joinKm = reach.get(id)?.joinsAtKm ?? reach.get(parent)?.lengthKm ?? 0;
    return kmToMouth(id, km) + kmToConfluence(parent, joinKm);
  };
  const upstreamIds: NorthReachId[] = ["ping", "wang", "nan", "yom"];
  const upSpan = Math.max(1, ...upstreamIds.filter((id) => reach.has(id)).map((id) => kmToConfluence(id, firstKm(id))));
  const cpStations = topology.stations.filter((s) => s.reachId === "chao-phraya");
  const downSpan = Math.max(1, ...cpStations.map((s) => s.chainageKm));
  const padTop = 22;
  const padBottom = 18;
  const scale = (height - padTop - padBottom) / (upSpan + downSpan);
  const confluence = { x: COLUMN_X["chao-phraya"], y: padTop + upSpan * scale };

  /** ตำแหน่งจุดบน reach (upstream) — y ตามระยะถึงจุดบรรจบ, x ตามคอลัมน์ หรือเส้นหักตอนใกล้ปาก */
  const pos = (id: NorthReachId, km: number): { x: number; y: number } => {
    if (id === "chao-phraya") return { x: confluence.x, y: confluence.y + km * scale };
    const y = confluence.y - kmToConfluence(id, km) * scale;
    const parent = PARENT_OF[id];
    const mouth = parent ? pos(parent, reach.get(id)?.joinsAtKm ?? 0) : confluence;
    const colX = COLUMN_X[id];
    const bendY = mouth.y - BEND;
    if (y <= bendY) return { x: colX, y };
    // ช่วงสุดท้ายก่อนบรรจบ: เส้นทแยงจาก (colX, bendY) ถึงปาก
    const f = Math.min(1, (y - bendY) / Math.max(1e-6, mouth.y - bendY));
    return { x: colX + (mouth.x - colX) * f, y };
  };

  const paths: SchematicPath[] = [];
  const segments: SchematicSegment[] = [];
  const labels: Schematic["labels"] = [];
  const pointsToD = (pts: readonly { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  /** ตัดเส้น (จุดยอดเรียง y เพิ่มขึ้น) ที่ตำแหน่งสถานีของ reach นั้น → ช่วงละคู่โหนด */
  const pushSegments = (id: NorthReachId, line: readonly { x: number; y: number }[]) => {
    const stops = topology.stations
      .filter((s) => s.reachId === id)
      .sort((a, b) => a.chainageKm - b.chainageKm)
      .map((s) => ({ code: s.ridCode as string | null, ...pos(id, s.chainageKm) }));
    const head = line[0];
    const tail = line[line.length - 1];
    const bounds = [{ code: null as string | null, ...head }, ...stops, { code: null as string | null, ...tail }];
    for (let i = 0; i + 1 < bounds.length; i++) {
      const a = bounds[i];
      const b = bounds[i + 1];
      if (b.y - a.y < 0.1) continue; // โหนดทับหัว/ท้ายเส้น — ไม่มีช่วงให้วาด
      const inner = line.filter((p) => p.y > a.y && p.y < b.y);
      segments.push({
        key: `${id}:${a.code ?? "head"}:${b.code ?? "mouth"}`,
        reachId: id,
        d: pointsToD([a, ...inner, b]),
        downstreamCode: b.code,
        upstreamCode: a.code,
      });
    }
  };
  for (const id of upstreamIds) {
    if (!reach.has(id)) continue;
    const top = pos(id, firstKm(id));
    const startY = Math.max(padTop - 8, top.y - 10);
    const parent = PARENT_OF[id];
    const mouth = parent ? pos(parent, reach.get(id)?.joinsAtKm ?? 0) : confluence;
    const bendY = Math.max(startY, mouth.y - BEND);
    paths.push({ reachId: id, d: `M${COLUMN_X[id]},${startY.toFixed(1)} L${COLUMN_X[id]},${bendY.toFixed(1)} L${mouth.x.toFixed(1)},${mouth.y.toFixed(1)}` });
    pushSegments(id, [
      { x: COLUMN_X[id], y: startY },
      { x: COLUMN_X[id], y: bendY },
      { x: mouth.x, y: mouth.y },
    ]);
    labels.push({ reachId: id, x: COLUMN_X[id], y: startY - 4 });
  }
  if (reach.has("chao-phraya")) {
    const end = confluence.y + downSpan * scale + 8;
    paths.push({ reachId: "chao-phraya", d: `M${confluence.x},${confluence.y.toFixed(1)} L${confluence.x},${end.toFixed(1)}` });
    pushSegments("chao-phraya", [confluence, { x: confluence.x, y: end }]);
  }
  const outlet = topology.reaches.find((r) => r.joinsReachId === null)?.id ?? null;
  const terminal = topology.stations
    .filter((s) => s.reachId === outlet)
    .reduce<NorthRouteTopology["stations"][number] | null>((best, s) => (best === null || s.chainageKm > best.chainageKm ? s : best), null);

  const nodes: SchematicNode[] = topology.stations.map((s) => ({ ridCode: s.ridCode, reachId: s.reachId, ...pos(s.reachId, s.chainageKm) }));
  const dams: SchematicDam[] = topology.dams.map((d) => {
    const p = pos(d.reachId, d.chainageKm);
    const offLine = d.offsetKm > 2;
    const side = d.reachId === "ping" || d.reachId === "wang" ? -1 : 1;
    return { nameTh: d.nameTh, reachId: d.reachId, x: offLine ? p.x + side * 18 : p.x, y: p.y, offLine, lineX: p.x };
  });
  return { width, height, confluence, paths, segments, terminalCode: terminal?.ridCode ?? null, nodes, dams, labels };
}

// ─────────────────────────────────────────────────────────────────────────────
// เส้นประเคลื่อนไหว = ทิศทางการไหล (ไม่ใช่ความเร็วน้ำจริง)
// ─────────────────────────────────────────────────────────────────────────────

/** ความยาวหนึ่งรอบของลายเส้นประ (px ของ viewBox) — ต้องตรงกับ `@keyframes north-flow-dash` ใน index.css */
export const FLOW_DASH_PERIOD = 10;
/** % ของความจุลำน้ำถูกหนีบไว้ในช่วงนี้ก่อนแปลงเป็นความเร็ว (เกินความจุก็ไม่เร็วขึ้นไปอีก) */
export const FLOW_PCT_MAX = 150;
/** ความเร็วเส้นประ (px/วินาที) ที่ % ต่ำสุดที่ยังมีการไหล และที่ `FLOW_PCT_MAX` */
export const FLOW_SPEED_MIN = 4;
export const FLOW_SPEED_MAX = 28;

/**
 * ระยะเวลาหนึ่งรอบของแอนิเมชัน (วินาที) จาก % ของความจุลำน้ำที่ **วัดได้** — เร็วขึ้นตาม %
 * แบบเส้นตรงในช่วง 0–`FLOW_PCT_MAX` ความเร็วนี้เป็นสัญลักษณ์ของสัดส่วนการไหลต่อความจุ ไม่ใช่
 * ความเร็วกระแสน้ำ
 *
 * null / ไม่ใช่ตัวเลข / ≤ 0 (ไม่มีค่า ไม่มีการไหล หรือไหลย้อนจากน้ำขึ้นน้ำลง) → null = ไม่เคลื่อนไหว
 * ผลปัดเป็น 2 ตำแหน่ง เพื่อให้การเรนเดอร์ซ้ำที่ค่าเดิมไม่แตะ DOM (แอนิเมชันไม่สะดุด)
 */
export function flowDurationS(qmaxPct: number | null): number | null {
  if (qmaxPct === null || !Number.isFinite(qmaxPct) || qmaxPct <= 0) return null;
  const f = Math.min(qmaxPct, FLOW_PCT_MAX) / FLOW_PCT_MAX;
  const speed = FLOW_SPEED_MIN + (FLOW_SPEED_MAX - FLOW_SPEED_MIN) * f;
  return Math.round((FLOW_DASH_PERIOD / speed) * 100) / 100;
}

export interface SegmentFlow {
  durationS: number;
  /** สถานีที่ให้ค่า */
  fromCode: string;
  /** ค่าที่ใช้ค้าง (เก่ากว่า `STALE_OBS_MS`) — ยังเคลื่อนไหว แต่หรี่ลงเหมือนโหนด */
  stale: boolean;
}

/**
 * การไหลของช่วงหนึ่ง: ใช้ % ของความจุที่ **สถานีปลายท้ายน้ำ** ของช่วง ถ้าสถานีนั้นไม่มีค่า
 * (เช่น C.12 สามเสน ที่ต้นทางไม่เผยแพร่อัตราการไหล) ใช้สถานี **ปลายต้นน้ำของช่วงเดียวกัน**
 * — ไม่ข้ามไปหาสถานีที่ไกลกว่านั้น และไม่ข้ามจุดบรรจบ ทั้งสองปลายไม่มีค่า → null (เส้นนิ่ง หรี่)
 */
export function segmentFlow(
  seg: Pick<SchematicSegment, "downstreamCode" | "upstreamCode">,
  readings: ReadonlyMap<string, NodeReading>,
): SegmentFlow | null {
  for (const code of [seg.downstreamCode, seg.upstreamCode]) {
    if (code === null) continue;
    const r = readings.get(code);
    if (!r || r.missing) continue;
    const durationS = flowDurationS(r.qmaxPct);
    if (durationS !== null) return { durationS, fromCode: code, stale: r.stale };
  }
  return null;
}
