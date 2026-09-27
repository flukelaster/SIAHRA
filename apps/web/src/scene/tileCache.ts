/**
 * การตัดสินใจเรื่องแคชไทล์ที่ใช้ร่วมกันระหว่าง BuildingTiles / FeatureTiles / TerrainTiles
 * — pure module ไม่มี three/DOM เพื่อให้เทสได้ด้วยตัวเลขล้วน
 *
 * เหตุผล (มือถือ, 2026-09): แท็บบน iPhone ถูกระบบฆ่าเพราะหน่วยความจำตอนซูมลึกในกรุงเทพ
 * แคชเดิมนับเป็น "จำนวนไทล์" ซึ่งไม่บอกอะไรเรื่องไบต์ (ไทล์อาคาร z5 ใจกลางเมืองใบเดียว
 * ~10+ MB) และนับรวมไทล์ว่าง/ล้มเหลวที่ไม่มีวันถูกไล่ออก ที่นี่จึงตัดสินด้วยงบไบต์
 * ของไทล์ที่พร้อมใช้ และลบไทล์เปล่า (stub) ที่ไม่ได้ใช้อยู่ทิ้งได้เสมอ
 */

export type TileLoadState = "idle" | "loading" | "ready" | "empty" | "failed";

/** ข้อมูลขั้นต่ำของไทล์หนึ่งใบที่การไล่ออกต้องรู้ */
export interface CacheEntryInfo {
  id: string;
  state: TileLoadState;
  /** ไบต์ที่ไทล์นี้ถือไว้ (นับเฉพาะตอน ready) */
  bytes: number;
  /** ไบต์ของ geometry (มิติที่สอง มีงบของตัวเอง — terrain ใช้) */
  geometryBytes?: number;
  lastUsed: number;
  /** ไทล์ที่ล้มเหลวลองใหม่ได้ตั้งแต่เวลานี้ (ms, เวลาเดียวกับ `now`) */
  retryAt: number;
}

export interface EvictionInput {
  entries: Iterable<CacheEntryInfo>;
  /** ไทล์ ready ที่ห้ามไล่ออก (กำลังวาด / ต้องใช้เป็นตัวสำรอง) */
  keepReady: ReadonlySet<string>;
  /** stub (idle/empty/failed) ที่ยังต้องเก็บไว้ — ไม่ส่ง = ใช้ `keepReady` */
  keepStubs?: ReadonlySet<string>;
  /** งบไบต์ของไทล์ ready ทั้งหมด */
  budgetBytes: number;
  /** งบไบต์ของ geometry ของไทล์ ready (ไม่ส่ง = ไม่จำกัด) */
  geometryBudgetBytes?: number;
  /** เพดานจำนวนไทล์ ready (ไม่ส่ง = ไม่จำกัด) */
  maxReady?: number;
  now: number;
}

export interface EvictionPlan {
  /** ไทล์ ready ที่ต้องคืนทรัพยากรแล้วลบออกจากแคช เรียงจากใช้ล่าสุดนานที่สุด */
  evict: string[];
  /** stub ที่ลบออกจาก Map ได้เลย (ไม่มีทรัพยากรให้คืน) */
  drop: string[];
}

/**
 * - ไทล์ `loading` ไม่ถูกแตะ (การยกเลิกเป็นเรื่องของผู้เรียก ไม่ใช่ของการไล่ออก)
 * - stub ที่ไม่อยู่ใน keep ถูกลบทิ้งเสมอและไม่นับเป็นไบต์ ยกเว้นไทล์ `failed` ที่ยัง
 *   ไม่ถึงเวลาลองใหม่ — ถ้าลบทิ้ง backoff ของมันจะหายไปด้วย
 * - ไทล์ ready ที่ไม่อยู่ใน keep ถูกไล่ออกแบบ LRU จนไบต์รวม ≤ งบ, ไบต์ geometry ≤ งบ
 *   geometry และจำนวน ≤ เพดาน
 *   ไทล์ใน keep นับรวมในยอดแต่ไล่ออกไม่ได้ ยอดจึงเกินงบได้ถ้าสิ่งที่วาดอยู่ใหญ่กว่างบเอง
 */
export function planEviction(input: EvictionInput): EvictionPlan {
  const keepStubs = input.keepStubs ?? input.keepReady;
  const maxReady = input.maxReady ?? Infinity;
  const geoBudget = input.geometryBudgetBytes ?? Infinity;
  const drop: string[] = [];
  const candidates: CacheEntryInfo[] = [];
  let bytes = 0;
  let geo = 0;
  let ready = 0;
  for (const e of input.entries) {
    if (e.state === "ready") {
      bytes += e.bytes;
      geo += e.geometryBytes ?? 0;
      ready++;
      if (!input.keepReady.has(e.id)) candidates.push(e);
    } else if (e.state !== "loading" && !keepStubs.has(e.id)) {
      if (e.state === "failed" && input.now < e.retryAt) continue;
      drop.push(e.id);
    }
  }
  const evict: string[] = [];
  const over = () => bytes > input.budgetBytes || geo > geoBudget || ready > maxReady;
  if (over()) {
    candidates.sort((a, b) => a.lastUsed - b.lastUsed);
    for (const e of candidates) {
      if (!over()) break;
      evict.push(e.id);
      bytes -= e.bytes;
      geo -= e.geometryBytes ?? 0;
      ready--;
    }
  }
  return { evict, drop };
}

export const RETRY_BASE_MS = 5000;
export const RETRY_MAX_MS = 5 * 60_000;

/** หน่วงก่อนลองโหลดไทล์ที่ล้มเหลวซ้ำ: 5 s, 10 s, 20 s … สูงสุด 5 นาที (`failures` ≥ 1) */
export function retryDelayMs(failures: number): number {
  const n = Math.max(1, Math.floor(failures));
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(n - 1, 16));
}

/** ไบต์ของ texture RGBA8 บน GPU พร้อม mipmap ครบชุด (+1/3) */
export function textureBytes(widthPx: number, heightPx: number, mipmaps = true): number {
  const base = widthPx * heightPx * 4;
  return mipmaps ? Math.ceil((base * 4) / 3) : base;
}
