import {
  BASIN_NAME_PREFIX,
  BASIN_OUTSIDE_THAILAND_KEY,
  type BasinBucket,
  type BasinDam,
  type BasinGroup,
  type BasinStation,
  type BasinsResponse,
  type DamObservation,
  type WaterLevelObservation,
} from "@siahra/shared-types";

/**
 * ตัวสร้างมุมมองตามลุ่มน้ำ (`GET /api/v1/basins`) — ฟังก์ชันล้วน ไม่มี SQL/เวลา/เครือข่าย
 * `ObservationCacheDO` ป้อนแถวจากตารางเข้ามาหนึ่งครั้งต่อรอบ refresh แล้วเก็บผลลัพธ์เป็นแถวเดียว
 *
 * กฎการจัดกลุ่ม (เจ้าของโครงการตัดสินใจแล้ว: ใช้ป้ายลุ่มน้ำของ ThaiWater ตามที่เป็น ไม่มีขอบเขตของเราเอง):
 * - คีย์ = `trim()` แล้วตัดคำนำหน้า "ลุ่มน้ำ" **หนึ่งครั้ง** (ต้นทางเขียนทั้ง "ลุ่มน้ำปิง" และ "ปิง")
 *   ชื่อที่ต่างกันไม่ถูกรวมกันไม่ว่ากรณีใด
 * - null / ว่าง / เหลือว่างหลังตัดคำนำหน้า → `unassigned` (ไม่ทิ้ง ไม่เดา)
 * - "นอกประเทศไทย" **ไม่ใช่ลุ่มน้ำ** → `outsideThailand` แยก ไม่อยู่ใน `basins[]`
 * - ลำดับแน่นอน: ลุ่มน้ำเรียงตามจำนวนสถานีมากไปน้อย เสมอกันตามรหัสอักขระของคีย์ (ไม่ใช้ `localeCompare`
 *   เพราะผลลัพธ์นี้ถูกเก็บเป็นแถว ลำดับต้องไม่ขึ้นกับ runtime) สถานีและเขื่อนเรียงตาม id
 */

/** คีย์ของกลุ่ม — null = ไม่มีป้ายลุ่มน้ำใช้ได้ (ไปที่ `unassigned`) */
export function basinKey(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (s.startsWith(BASIN_NAME_PREFIX)) s = s.slice(BASIN_NAME_PREFIX.length).trim();
  return s === "" ? null : s;
}

const byId = <T extends { id: number }>(a: T, b: T): number => a.id - b.id;
const cmpCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function toStation(w: WaterLevelObservation): BasinStation {
  return {
    id: w.station.id,
    nameTh: w.station.nameTh ?? null,
    provinceCode: w.station.provinceCode ?? null,
    lat: w.station.lat,
    lon: w.station.lon,
    waterlevelMsl: w.waterlevelMsl ?? null,
    freeboardM: w.freeboardM ?? null,
    situationLevel: w.situationLevel ?? null,
    // แถวที่เขียนก่อน E16 ไม่มีสองฟิลด์นี้ — เติมเป็น "ไม่มีข้อมูล" ไม่ปล่อย undefined หลุดไปใน JSON
    dischargeM3s: w.dischargeM3s ?? null,
    qmaxM3s: w.qmaxM3s ?? null,
    observedAt: w.observedAt ?? null,
  };
}

function toDam(d: DamObservation): BasinDam {
  return {
    id: d.id,
    nameTh: d.nameTh ?? null,
    nameEn: d.nameEn ?? null,
    kind: d.kind,
    provinceCode: d.provinceCode ?? null,
    storagePercent: d.storagePercent ?? null,
    storageMcm: d.storageMcm ?? null,
    observedAt: d.observedAt ?? null,
  };
}

interface Acc {
  stations: BasinStation[];
  dams: BasinDam[];
  /** ป้ายดิบที่ต้นทางเขียน → จำนวนที่พบ (เลือกตัวที่พบมากสุดเป็น `nameTh`) */
  labels: Map<string, number>;
}

function mostCommonLabel(labels: ReadonlyMap<string, number>, fallback: string): string {
  let best: string | null = null;
  let bestN = -1;
  for (const [label, n] of labels) {
    if (n > bestN || (n === bestN && best !== null && cmpCode(label, best) < 0)) {
      best = label;
      bestN = n;
    }
  }
  return best ?? fallback;
}

/** เวลาตรวจวัดใหม่สุดของสถานี — เทียบเป็นเวลา ไม่ใช่สตริง; ค่าที่อ่านไม่ออกไม่ถูกนับ */
function newestObservedAt(stations: readonly BasinStation[]): string | undefined {
  let best: string | undefined;
  let bestMs = -Infinity;
  for (const s of stations) {
    if (s.observedAt === null) continue;
    const ms = Date.parse(s.observedAt);
    if (Number.isFinite(ms) && ms > bestMs) {
      best = s.observedAt;
      bestMs = ms;
    }
  }
  return best;
}

/** เท่ากับ `STALE_AFTER_MS` ของฟีดระดับน้ำใน `ObservationCacheDO` (15 นาที — เทสยืนยันว่าเท่ากัน) */
export const BASINS_STALE_AFTER_SECONDS = 15 * 60;

export interface BuildBasinsInput {
  waterlevel: readonly WaterLevelObservation[];
  dams: readonly DamObservation[];
  /** `waterlevelFetchedAt` ณ ตอนสร้าง — ห้ามเป็นนาฬิกาปัจจุบัน */
  fetchedAt: string | null;
  /** `damsFetchedAt` — null = ไม่เคยดึงเขื่อน */
  damsFetchedAt: string | null;
  staleAfterSeconds: number;
}

export function buildBasins(input: BuildBasinsInput): BasinsResponse {
  const groups = new Map<string, Acc>();
  const outside: BasinBucket = { stations: [], dams: [] };
  const unassigned: BasinBucket = { stations: [], dams: [] };

  const place = <T>(raw: string | null, item: T, kind: "stations" | "dams"): void => {
    const key = basinKey(raw);
    if (key === null) {
      (unassigned[kind] as T[]).push(item);
      return;
    }
    if (key === BASIN_OUTSIDE_THAILAND_KEY) {
      (outside[kind] as T[]).push(item);
      return;
    }
    let g = groups.get(key);
    if (!g) {
      g = { stations: [], dams: [], labels: new Map() };
      groups.set(key, g);
    }
    (g[kind] as T[]).push(item);
    const label = (raw as string).trim();
    g.labels.set(label, (g.labels.get(label) ?? 0) + 1);
  };

  const stations: BasinStation[] = [];
  for (const w of input.waterlevel) {
    const s = toStation(w);
    stations.push(s);
    place(w.station.basinNameTh ?? null, s, "stations");
  }
  for (const d of input.dams) place(d.basinNameTh ?? null, toDam(d), "dams");

  const basins: BasinGroup[] = [...groups.entries()].map(([key, g]) => ({
    key,
    nameTh: mostCommonLabel(g.labels, key),
    stations: g.stations.sort(byId),
    dams: g.dams.sort(byId),
  }));
  basins.sort((a, b) => b.stations.length - a.stations.length || cmpCode(a.key, b.key));
  for (const bucket of [outside, unassigned]) {
    bucket.stations.sort(byId);
    bucket.dams.sort(byId);
  }

  return {
    layer: {
      id: "thaiwater-basins",
      epistemicClass: "observed",
      liveOrStatic: "live",
      observedAt: newestObservedAt(stations),
      // ThaiWater ส่งมาแต่เวลาที่ตรวจวัด ไม่มีเวลาเผยแพร่ของชุดข้อมูล → null ตามจริง
      publishedAt: null,
      fetchedAt: input.fetchedAt,
      staleAfterSeconds: input.staleAfterSeconds,
      sourceIds: ["thaiwater"],
    },
    fetchedAt: input.fetchedAt,
    damsFetchedAt: input.damsFetchedAt,
    basins,
    outsideThailand: outside,
    unassigned,
  };
}

/**
 * คำตอบของ "ยังไม่มีแถว" (ยังไม่มีรอบ refresh ที่ดึงระดับน้ำสำเร็จหลัง deploy) — `fetchedAt` เป็น null
 * ทุกที่ ไม่ใช่ "ไม่มีลุ่มน้ำ": กลุ่มว่างที่มาพร้อม `fetchedAt: null` อ่านว่า "ยังไม่เคยได้ข้อมูล"
 */
export function coldBasinsResponse(staleAfterSeconds: number, buildError: string | null): BasinsResponse {
  return {
    layer: {
      id: "thaiwater-basins",
      epistemicClass: "observed",
      liveOrStatic: "live",
      publishedAt: null,
      fetchedAt: null,
      staleAfterSeconds,
      sourceIds: ["thaiwater"],
    },
    fetchedAt: null,
    damsFetchedAt: null,
    basins: [],
    outsideThailand: { stations: [], dams: [] },
    unassigned: { stations: [], dams: [] },
    buildError,
  };
}
