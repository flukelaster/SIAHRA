import type { SceneHandles } from "./setupScene";
import type { TerrainTileTree } from "./TerrainTiles";
import { tierFor } from "../lib/shellLayout";

export type QualityMode = "auto" | "high" | "balanced" | "low";
export type QualityLevel = "high" | "balanced" | "low";

/**
 * ชั้นของอุปกรณ์สำหรับค่าเริ่มต้นด้านการเรนเดอร์และงบหน่วยความจำ
 *
 * เป้าหมายคือ iPhone (WebKit): แท็บถูกระบบฆ่าเมื่อหน่วยความจำเกิน จึงต้องเริ่มที่
 * ค่าประหยัด ไม่ใช่เริ่ม "high" แล้วรอ 6 วินาทีของเฟรมช้ากว่าจะลดลง — ถึงตอนนั้น
 * แท็บอาจรีโหลดไปแล้ว preset เปลี่ยนแค่ "การวาด" เท่านั้น หมุด ป้าย legend การหรี่
 * ข้อมูลเก่า และบรรทัดเครดิตยังอยู่ครบทุกชั้นอุปกรณ์
 */
export type DeviceClass = "phone" | "tablet" | "desktop";

/**
 * `coarsePointer` = `(pointer: coarse)`; `shortSidePx` = ด้านสั้นของ viewport — ใช้ด้านสั้น
 * เพื่อให้ iPhone แนวนอน (กว้าง 844 px) ยังเป็น phone ไม่หลุดไปเป็น tablet ตอนหมุนจอ
 * เกณฑ์ phone คือ tier เดียวกับเปลือกหน้าจอ (`tierFor` < 768 px)
 */
export function deviceClassFor(coarsePointer: boolean, shortSidePx: number): DeviceClass {
  if (!coarsePointer) return "desktop";
  return tierFor(shortSidePx) === "phone" ? "phone" : "tablet";
}

/** อ่านชั้นของอุปกรณ์จากเบราว์เซอร์ตอนนี้ (ไม่มี window = desktop) */
export function currentDeviceClass(): DeviceClass {
  if (typeof window === "undefined") return "desktop";
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  return deviceClassFor(coarse, Math.min(window.innerWidth, window.innerHeight));
}

/** ระดับเริ่มต้นของโหมด auto */
export function initialLevelFor(cls: DeviceClass): QualityLevel {
  if (cls === "phone") return "low";
  if (cls === "tablet") return "balanced";
  return "high";
}

export interface Preset {
  pixelRatio: number;
  shadows: boolean;
  splitFactor: number;
  imageryZoomOffset: number;
}

/**
 * preset ต่ออุปกรณ์ — บนมือถือ **ทุกระดับ** ปิดเงาและ DPR ≤ 1.5 เพราะโหมด auto ขยับ
 * ขึ้นไป "high" ได้หลังเฟรมเร็วต่อเนื่อง 12 วินาที ถ้าจำกัดแค่ระดับเริ่มต้น มือถือก็จะ
 * กลับไปวาดเงา 2048² ที่ DPR 2 ในที่สุด (desktop/tablet เหมือนเดิมทุกค่า)
 */
export function presetsFor(cls: DeviceClass, devicePixelRatio: number): Record<QualityLevel, Preset> {
  const cap = cls === "phone" ? 1.5 : 2;
  const dpr = Math.min(devicePixelRatio || 1, cap);
  const shadows = cls !== "phone";
  return {
    high: { pixelRatio: dpr, shadows, splitFactor: 2.3, imageryZoomOffset: 0 },
    balanced: { pixelRatio: Math.max(1, dpr * 0.75), shadows, splitFactor: 2.0, imageryZoomOffset: 0 },
    low: { pixelRatio: 1, shadows: false, splitFactor: 1.6, imageryZoomOffset: -1 },
  };
}

const MB = 1024 * 1024;

export interface MemoryBudgets {
  /** ไบต์ของไทล์อาคารที่พร้อมใช้ (GPU) — ดู BuildingTileLayer */
  buildingBytes: number;
  /** ไบต์ของ texture ภาพดาวเทียมบนไทล์ภูมิประเทศ (รวม mipmap) — ดู TerrainTileTree */
  terrainTextureBytes: number;
  /**
   * ไบต์ของ geometry ไทล์ภูมิประเทศ — อยู่ทั้งใน JS heap และบน GPU (ไม่ปล่อย array เพราะ
   * `sampleHeight` อ่านมัน) เพดานจำนวนไทล์อย่างเดียวปล่อยให้โตเกิน 69 MB บนมือถือ
   */
  terrainGeometryBytes: number;
}

/** งบหน่วยความจำต่ออุปกรณ์ — มือถือใช้งบแคบของ iOS WebKit */
export function memoryBudgetsFor(cls: DeviceClass): MemoryBudgets {
  if (cls === "phone") return { buildingBytes: 80 * MB, terrainTextureBytes: 96 * MB, terrainGeometryBytes: 40 * MB };
  if (cls === "tablet") return { buildingBytes: 160 * MB, terrainTextureBytes: 192 * MB, terrainGeometryBytes: 80 * MB };
  return { buildingBytes: 400 * MB, terrainTextureBytes: 512 * MB, terrainGeometryBytes: 200 * MB };
}

/**
 * Picks rendering quality from the measured frame time (auto) or a fixed
 * preset. Steps down quickly when frames get slow (>33 ms sustained) and back
 * up cautiously (<14 ms for a while), so integrated GPUs stay interactive.
 */
export class QualityManager {
  private level: QualityLevel;
  private mode: QualityMode = "auto";
  private slowSince: number | null = null;
  private fastSince: number | null = null;
  private lastChange = 0;
  onLevel?: (level: QualityLevel, mode: QualityMode) => void;
  private readonly handles: SceneHandles;
  private tree: TerrainTileTree | null;
  private readonly presets: Record<QualityLevel, Preset>;
  readonly deviceClass: DeviceClass;

  constructor(handles: SceneHandles, tree: TerrainTileTree | null, deviceClass: DeviceClass = currentDeviceClass()) {
    this.handles = handles;
    this.tree = tree;
    this.deviceClass = deviceClass;
    this.presets = presetsFor(deviceClass, window.devicePixelRatio || 1);
    this.level = initialLevelFor(deviceClass);
    this.apply(this.level);
  }

  /** ระดับ/โหมดปัจจุบัน — สำหรับตัวนับดีบัก (DEV) */
  get currentLevel(): QualityLevel {
    return this.level;
  }
  get currentMode(): QualityMode {
    return this.mode;
  }

  setTree(tree: TerrainTileTree | null) {
    this.tree = tree;
    this.apply(this.level);
  }

  setMode(mode: QualityMode) {
    this.mode = mode;
    if (mode !== "auto") this.apply(mode);
    else this.onLevel?.(this.level, this.mode);
  }

  private apply(level: QualityLevel) {
    this.level = level;
    const p = this.presets[level];
    this.handles.setPixelRatio(p.pixelRatio);
    this.handles.setShadows(p.shadows);
    this.tree?.setQuality(p.splitFactor, p.imageryZoomOffset);
    this.lastChange = performance.now();
    this.onLevel?.(level, this.mode);
  }

  /** Call every frame. */
  tick(nowMs: number) {
    if (this.mode !== "auto") return;
    if (nowMs - this.lastChange < 4000) return;
    const ft = this.handles.frameTimeMs();
    if (ft > 33) {
      this.slowSince ??= nowMs;
      this.fastSince = null;
      if (nowMs - this.slowSince > 2500) {
        this.slowSince = null;
        if (this.level === "high") this.apply("balanced");
        else if (this.level === "balanced") this.apply("low");
      }
    } else if (ft < 14) {
      this.fastSince ??= nowMs;
      this.slowSince = null;
      if (nowMs - this.fastSince > 12000) {
        this.fastSince = null;
        if (this.level === "low") this.apply("balanced");
        else if (this.level === "balanced") this.apply("high");
      }
    } else {
      this.slowSince = null;
      this.fastSince = null;
    }
  }
}
