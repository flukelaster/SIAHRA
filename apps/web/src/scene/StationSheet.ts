import * as THREE from "three";
import type { AoiManifest, WaterLevelObservation } from "@siahra/shared-types";
import { STATION_SHEET_RGB } from "../lib/floodStyle";
import { SHEET_NONE } from "../lib/stationSheet";
import {
  observedMaskFromField,
  selectSheetStations,
  sheetCellAt,
  sheetToFloodField,
  windowToFloodField,
  type SheetCells,
  type SheetInput,
} from "../lib/stationSheetField";
import type { SheetWindow } from "../lib/stationSheetLeaf";
import { unionMasks } from "../lib/gistdaDepthField";
import type {
  SheetStationResolution,
  StationSheetLeafStats,
  StationSheetWorkerMessage,
  StationSheetWorkerResult,
} from "../workers/stationSheet.worker";
import { createFloodSurface, type FloodSurface, type FloodSurfaceVariant } from "./FloodSurface";
import { buildFloodFieldTexture, summarizeFloodField, type FloodField, type FloodFieldTexture } from "./floodField";
import type { TerrainField } from "./TerrainMesh";

/**
 * แผ่นน้ำจำลองจากระดับน้ำที่สถานี (E16 B-1, ชั้น `stationSheet`, epistemic `illustrative`) —
 * แทนเสาวัดระดับน้ำของรอบแรก: ผู้ใช้อยากเห็น "ตรงนี้น้ำท่วมลึกเท่าไร" ไม่ใช่ไม้วัดระดับ
 *
 * - การเติมน้ำ (`lib/stationSheet.ts` + `lib/stationSheetLeaf.ts`) รันใน
 *   `workers/stationSheet.worker.ts` ซึ่งชั้นนี้เป็นเจ้าของตลอดอายุของจังหวัด (สร้างเมื่อมีงานแรก,
 *   `abort` + terminate ใน `dispose`) — ความสูง/มาสก์/สเปกไทล์ส่งครั้งเดียว
 * - สองขั้น: `stage 1` = กริด overview (แสดงทันที), `stage 2` = หน้าต่าง 30 ม. ต่อไทล์ของสถานีที่
 *   ได้ไทล์ครบ (งบคำขอ 48 ไทล์ต่อจังหวัด — ข้อจำกัด devops C1–C8 ของงาน 30 ม. อยู่ใน worker)
 *   หน้าต่างแทนแผ่น overview ในพื้นที่ของมันพอดี (shader ตัดแผ่น overview ด้วย texture ตารางไทล์
 *   ขอบเดียวกับ vertex ของหน้าต่าง) จึงไม่วาดซ้อน
 * - ผลถูกแปลงเป็น `FloodField` แล้ววาดด้วย **ท่อเดียวกับแผ่นความลึก GFM** (`buildFloodFieldTexture` +
 *   `createFloodSurface` variant.sheet): teal, ความจางตามระยะจากสถานี, ลายจุดตรงอาคาร/ต้นไม้
 * - ฉาก GFM ที่แสดงอยู่มาก่อน (`setObserved`): เซลล์ที่ดาวเทียมสังเกตแล้วถูกลบออกจากแผ่นใน worker
 *   (ไม่วางแผน/ไม่ขอไทล์ใหม่) และแผ่นนี้ถูกวาด **ก่อน** แผ่น GFM (`renderOrder` ต่ำกว่า)
 * - คำนวณใหม่เฉพาะเมื่อ `update()` ถูกเรียก — หน่วง `SHEET_JOB_DEBOUNCE_MS` (C7: การเลื่อนเส้นเวลา
 *   ได้งานเดียวต่อเวลาที่หยุดนิ่ง ไม่ใช่ต่อเฟรมที่ลาก) ผลของงานเก่าถูกทิ้ง
 * - worker ล้มเหลว = ไม่มีแผ่น + `error` ในตัวนับดีบัก (ไม่ log)
 */
export interface StationSheetCellPick {
  /** ความลึกจำลอง (ซม.) ที่เซลล์นี้ — null = ท่วมแต่ไม่ได้ประมาณความลึก (อาคาร/ต้นไม้) */
  depthCm: number | null;
  /** สถานีที่ให้ระดับผิวน้ำของเซลล์นี้ (max WSE) */
  obs: WaterLevelObservation;
  /** ความละเอียดที่ *สถานีนั้น* ถูกคำนวณจริง (C3) */
  resolution: SheetStationResolution;
  /** ขนาดเซลล์ของกริดที่อ่านค่านี้มา (ม.) — 30 บนหน้าต่าง, `manifest.terrain.cellSizeM` บน overview */
  cellSizeM: number;
}

/** สรุปสำหรับ legend (C3: บอกว่าแต่ละสถานีคำนวณที่ความละเอียดเท่าไร และเพราะอะไร) */
export interface StationSheetInfo {
  /** สถานีเกินตลิ่งที่ส่งเข้างานล่าสุด */
  stations: number;
  leaf: number;
  pending: number;
  /** สถานีที่อยู่บน overview เพราะงบคำขอไทล์ของจังหวัดหมด */
  budget: number;
  /** สถานีที่อยู่บน overview เพราะขอไทล์ไม่สำเร็จ */
  failed: number;
  /** สถานีบน overview เพราะไม่มีไทล์ 30 ม. ให้ใช้ / ไม่มีแผ่น */
  overview: number;
  overviewCellSizeM: number;
  leafCellSizeM: number | null;
  /** ขนาดเซลล์ของมาสก์อาคาร/ต้นไม้ (WorldCover) — null = จังหวัดไม่มี landcover */
  maskCellSizeM: number | null;
  requests: { issued: number; max: number } | null;
  /** มีแผ่น/หน้าต่างถูกวาดอยู่จริง (ป้าย "แผ่นน้ำจำลอง" บนแผนที่แสดงเมื่อ true เท่านั้น) */
  drawn: boolean;
  /**
   * worker ล้มไปแล้วอย่างน้อยครั้งหนึ่งในจังหวัดนี้ — worker ตัวใหม่ทำเฉพาะกริดภาพรวม (ไม่ขอไทล์
   * 30 ม. อีก เพราะนับคำขอที่ตัวเก่าเริ่มไปแล้วไม่ได้ครบ งบ C1 จึงต้องไม่รีเซ็ต) — null = ไม่เคยล้ม
   */
  workerError: string | null;
}

/** ความทึบเมื่อหรี่ (ค่าตรวจวัดค้าง / กำลังดูขั้นพยากรณ์) — กฎเดียวกับหมุดสถานี */
export const STATION_SHEET_DIM_OPACITY = 0.4;
/** C7 — รอให้ค่าตรวจวัด/เวลาที่เลือกนิ่งก่อนส่งงาน (ลากเส้นเวลา = งานเดียวเมื่อปล่อย) */
export const SHEET_JOB_DEBOUNCE_MS = 250;
/** เวลาที่ให้ worker ประมวลผล `abort` ก่อน terminate (dispose) */
const WORKER_TERMINATE_GRACE_MS = 1000;
/** เซลล์ตื้นกว่านี้ไม่ถูกวาด (`FloodSurface` DEPTH_MIN_M) popup จึงไม่พูดถึงเช่นกัน */
const MIN_DRAWN_DEPTH_CM = 2;
/**
 * ลำดับการวาด: หลังภูมิประเทศ (วัสดุภูมิประเทศเป็น transparent ที่ renderOrder 0 — ต่ำกว่านี้
 * ภูมิประเทศจะทับแผ่น) และ **ก่อน** แผ่น GFM (`FLOOD_SURFACE_RENDER_ORDER`) ดาวเทียมที่เห็นจริงจึง
 * อยู่ข้างบนเสมอ; ทั้งคู่ต่ำกว่าผิวน้ำ/ถนนของ FeatureTiles (6/8)
 */
export const STATION_SHEET_RENDER_ORDER = 1;

export interface StationSheetDebug {
  /** สถานีที่เกินตลิ่งและถูกส่งเข้างานล่าสุด */
  stations: number;
  /** สถานีที่เติมได้อย่างน้อยหนึ่งเซลล์ (ขั้นที่ 1) */
  seededStations: number;
  filledCells: number;
  maxDepthCm: number | null;
  surfaceVertices: number;
  windows: number;
  windowVertices: number;
  stage: 0 | 1 | 2;
  resolution: SheetStationResolution[];
  leaf: StationSheetLeafStats | null;
  pending: boolean;
  workerAlive: boolean;
  jobs: number;
  error: string | null;
  visible: boolean;
  dimmed: boolean;
}

interface WindowView {
  w: SheetWindow;
  texture: FloodFieldTexture;
  surface: FloodSurface | null;
}

export class StationSheetLayer {
  private worker: Worker | null = null;
  private jobId = 0;
  private jobs = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastWaterlevel: readonly WaterLevelObservation[] | null | undefined = undefined;
  /** ค่าชุดที่ `run()` ใช้ล่าสุด (ส่งเข้า worker แล้ว หรือไม่มีสถานีเกินตลิ่ง) */
  private postedWaterlevel: readonly WaterLevelObservation[] | null | undefined = undefined;
  private lastArgs: { waterlevel: readonly WaterLevelObservation[] | null; refMs: number } | null = null;
  private jobInputs: { id: number; inputs: SheetInput[] } | null = null;
  private final = false;
  private stage: 0 | 1 | 2 = 0;
  private cells: SheetCells | null = null;
  private inputs: SheetInput[] = [];
  private resolution: SheetStationResolution[] = [];
  private leafStats: StationSheetLeafStats | null = null;
  private texture: FloodFieldTexture | null = null;
  private surface: FloodSurface | null = null;
  private windows = new Map<number, WindowView>();
  private clipTexture: THREE.DataTexture | null = null;
  private readonly clipUniform = { value: null as unknown as THREE.Texture };
  private readonly clipXf = { value: new THREE.Vector3() };
  private readonly opacity = { value: 1 };
  private observedField: FloodField | null = null;
  /** มาสก์ท่วมของ GISTDA (ไม่เบลอ, แถว 0 = เหนือ) — null = ไม่มีเซลล์/ชั้นปิด (E16 B-2) */
  private gistdaFlooded: Uint8Array | null = null;
  private visible = true;
  private dimmed = false;
  private disposed = false;
  private error: string | null = null;
  /** ข้อความของครั้งแรกที่ worker ล้ม — ไม่ถูกล้าง (ดู `StationSheetInfo.workerError`) */
  private workerError: string | null = null;
  private stats = { stations: 0, seededStations: 0, filledCells: 0, maxDepthCm: null as number | null };

  private readonly parent: THREE.Object3D;
  private readonly terrain: TerrainField;
  private readonly manifest: AoiManifest;
  private readonly uTime: { value: number };
  private readonly onInfo: ((info: StationSheetInfo | null) => void) | undefined;

  constructor(
    parent: THREE.Object3D,
    terrain: TerrainField,
    manifest: AoiManifest,
    uTime: { value: number },
    onInfo?: (info: StationSheetInfo | null) => void,
  ) {
    this.parent = parent;
    this.terrain = terrain;
    this.manifest = manifest;
    this.uTime = uTime;
    this.onInfo = onInfo;
  }

  /** พิกัด lon/lat → ตำแหน่งบนกริด overview (หน่วยเซลล์, แถว 0 = เหนือ) — null = นอกกริด */
  private toGrid = (lon: number, lat: number): [number, number] | null => {
    const proj = this.terrain.projection;
    const [x, z] = proj.lonLatToLocal(lon, lat);
    if (!proj.insideGrid(x, z)) return null;
    const cell = this.manifest.terrain.cellSizeM;
    return [(x + proj.gridWidthM / 2) / cell, (z + proj.gridHeightM / 2) / cell];
  };

  /**
   * คำนวณใหม่จากค่าตรวจวัดชุดนี้ ณ เวลาอ้างอิง `refMs` (เวลาที่เลือก หรือตอนนี้) — หน่วง
   * `SHEET_JOB_DEBOUNCE_MS` แล้วส่งเฉพาะชุดล่าสุด; ไม่มีสถานีเกินตลิ่ง = ล้างแผ่น + ล้างคิวไทล์ใน
   * worker (ไม่ปลุก worker ถ้ายังไม่มี) — C7: ไม่มีสถานีเกินตลิ่ง ⇒ ไม่มีคำขอไทล์
   */
  update(waterlevel: readonly WaterLevelObservation[] | null, refMs: number): void {
    if (this.disposed) return;
    // C7: เลื่อนเส้นเวลา = atIso เปลี่ยนก่อน แล้วค่าตรวจวัดของเวลานั้นตามมาทีหลัง — รอบแรก (ชุดค่าเดิม
    // กับเวลาใหม่) ไม่ใช่ข้อมูลของเวลาที่เลือก จึงไม่วางแผน/ไม่ขอไทล์; งานเดียวต่อเวลาที่หยุดนิ่ง
    // (ชุดค่าเดิม = อาร์เรย์เดิม; `setVisible(true)` ล้างตัวจำนี้ให้คำนวณใหม่ได้)
    if (waterlevel !== null && waterlevel === this.lastWaterlevel) return;
    this.lastWaterlevel = waterlevel;
    this.lastArgs = { waterlevel, refMs };
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.run(waterlevel, refMs);
    }, SHEET_JOB_DEBOUNCE_MS);
  }

  private run(waterlevel: readonly WaterLevelObservation[] | null, refMs: number): void {
    if (this.disposed || !this.visible) return;
    this.postedWaterlevel = waterlevel;
    const inputs = waterlevel ? selectSheetStations(waterlevel, refMs, this.toGrid) : [];
    const id = ++this.jobId;
    this.stats = { stations: inputs.length, seededStations: 0, filledCells: 0, maxDepthCm: null };
    if (inputs.length === 0) {
      this.jobInputs = null;
      this.post({ type: "idle" });
      this.clear();
      this.resolution = [];
      this.publish();
      return;
    }
    const worker = this.ensureWorker();
    if (!worker) {
      this.jobInputs = null;
      this.clear();
      this.publish();
      return;
    }
    this.jobInputs = { id, inputs };
    this.final = false;
    this.jobs++;
    worker.postMessage({ type: "job", jobId: id, stations: inputs.map((i) => i.sheet) } satisfies StationSheetWorkerMessage);
  }

  private post(msg: StationSheetWorkerMessage): void {
    this.worker?.postMessage(msg);
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    try {
      const worker = new Worker(new URL("../workers/stationSheet.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (ev: MessageEvent<StationSheetWorkerResult>) => this.onResult(ev.data);
      worker.onerror = (ev) => this.fail(ev.message || "station sheet worker failed");
      worker.onmessageerror = () => this.fail("station sheet worker sent an uncloneable message");
      const { width, height, cellSizeM } = this.manifest.terrain;
      // สำเนา — ตัวจริงถูกปิดทับอยู่ใน TerrainField.sample() (ห้าม detach)
      const heights = new Float32Array(this.terrain.heights);
      const init: StationSheetWorkerMessage = {
        type: "init",
        grid: { width, height, cellSizeM },
        heights,
        mask: this.terrain.insideMask,
        // devops C1: งบ 48 คำขอเป็นของจังหวัด ไม่ใช่ของ worker — คำขอที่ตัวที่ล้มไปเริ่มหลังผลล่าสุด
        // นับไม่ได้ ตัวใหม่จึงไม่ขอไทล์เลย (สถานีทั้งหมด = "overview" ซึ่งเป็นความจริง) + บอกเหตุใน legend
        leaf: this.manifest.terrain.tiles && this.workerError === null
          ? {
              overview: { width, height, cellSizeM },
              originEasting: this.manifest.originEasting,
              originNorthing: this.manifest.originNorthing,
              tiles: this.manifest.terrain.tiles,
              landcover: this.manifest.landcover,
            }
          : null,
      };
      worker.postMessage(init, [heights.buffer]);
      const observed = this.observedMask();
      if (observed) worker.postMessage({ type: "observed", mask: observed });
      this.worker = worker;
      this.error = null;
      return worker;
    } catch (err) {
      this.error = String(err);
      return null;
    }
  }

  private fail(message: string): void {
    this.error = message;
    this.workerError ??= message;
    this.worker?.terminate();
    this.worker = null;
    this.jobInputs = null;
    this.clear();
    this.resolution = [];
    this.publish();
  }

  private onResult(res: StationSheetWorkerResult): void {
    if (this.disposed) return;
    const job = this.jobInputs;
    // ผลของงานที่ถูกแทนแล้ว — ทิ้ง (งานล่าสุดกำลังมา); ผลที่ส่งซ้ำเพราะมาสก์ GFM เปลี่ยนมี jobId เดิม
    if (!job || res.jobId !== job.id) return;
    if (!res.ok) {
      this.error = res.error;
      this.jobInputs = null;
      this.clear();
      this.resolution = [];
      this.publish();
      return;
    }
    // stage 1 ที่มาช้ากว่า stage 2 ของงานเดียวกันไม่มีทางเกิด (ลำดับข้อความของ worker) แต่กันไว้
    if (this.final && res.stage === 1) return;
    if (res.stage === 2) this.final = true;
    this.error = null;
    this.clear();
    const { width, height } = this.manifest.terrain;
    const cells: SheetCells = { width, height, depthCm: res.depthCm, station: res.station, fadePct: res.fadePct };
    this.stage = res.stage;
    this.resolution = res.resolution;
    this.leafStats = res.leaf;
    this.inputs = job.inputs;
    this.cells = cells;
    this.stats = {
      stations: job.inputs.length,
      seededStations: res.cellsPerStation.filter((n) => n > 0).length,
      filledCells: res.filledCells,
      maxDepthCm: null,
    };
    this.buildWindows(res.windows);
    const field = sheetToFloodField(cells);
    const summary = summarizeFloodField(field);
    let maxDepth = summary.maxDepthCm;
    for (const v of this.windows.values()) {
      const m = summarizeFloodField(windowToFloodField(v.w)).maxDepthCm;
      if (m !== null && (maxDepth === null || m > maxDepth)) maxDepth = m;
    }
    this.stats.maxDepthCm = maxDepth;
    if (summary.floodedCells > 0) {
      const texture = buildFloodFieldTexture(field);
      const surface = createFloodSurface(this.terrain, this.manifest, field, texture.texture, this.uTime, {
        ...this.variantBase("station-sheet"),
        sheet: {
          hatchPx: this.terrain.material.uniforms.uHatchPx,
          clip: this.clipTexture ? { texture: this.clipUniform, xf: this.clipXf } : undefined,
        },
      });
      this.texture = texture;
      if (surface) this.attach(surface);
      this.surface = surface;
    }
    this.publish();
  }

  private variantBase(name: string): Omit<FloodSurfaceVariant, "sheet" | "window"> {
    return { cacheKey: "siahra-station-sheet", name, palette: STATION_SHEET_RGB, opacity: this.opacity };
  }

  private attach(surface: FloodSurface): void {
    surface.mesh.visible = this.visible;
    surface.mesh.renderOrder = STATION_SHEET_RENDER_ORDER;
    this.parent.add(surface.mesh);
  }

  /** หน้าต่าง 30 ม. ต่อไทล์ + texture ตารางไทล์ที่ใช้ตัดแผ่น overview */
  private buildWindows(windows: SheetWindow[]): void {
    const tiles = this.manifest.terrain.tiles;
    if (!tiles || windows.length === 0) return;
    const leaf = tiles.levels[tiles.levels.length - 1];
    const cell = leaf.cellSizeM;
    const T = tiles.tileSize;
    const proj = this.terrain.projection;
    // พิกัดฉากของศูนย์กลางเซลล์ leaf (0, 0) — แกน x/z ของฉากขนานกับ UTM (toLocal เป็นการเลื่อนล้วน)
    const [x00, z00] = proj.toLocal(tiles.originEasting + 0.5 * cell, tiles.originNorthing - 0.5 * cell);
    const clip = new Uint8Array(leaf.tilesX * leaf.tilesY);
    for (const w of windows) {
      clip[w.ty * leaf.tilesX + w.tx] = 255;
      const field = windowToFloodField(w);
      const texture = buildFloodFieldTexture(field);
      const surface = createFloodSurface(this.terrain, this.manifest, field, texture.texture, this.uTime, {
        ...this.variantBase(`station-sheet-30m:${w.tx}_${w.ty}`),
        sheet: { hatchPx: this.terrain.material.uniforms.uHatchPx },
        window: {
          cols: w.size,
          rows: w.size,
          x0: x00 + w.tx * T * cell,
          z0: z00 + w.ty * T * cell,
          cellSizeM: cell,
          heights: w.heights,
        },
      });
      if (surface) this.attach(surface);
      this.windows.set(w.ty * leaf.tilesX + w.tx, { w, texture, surface });
    }
    const tex = new THREE.DataTexture(clip, leaf.tilesX, leaf.tilesY, THREE.RedFormat, THREE.UnsignedByteType);
    tex.flipY = false;
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.clipTexture = tex;
    this.clipUniform.value = tex;
    this.clipXf.value.set(x00, z00, T * cell);
  }

  /** ทิ้งแผ่น + หน้าต่าง + texture ปัจจุบัน (worker ยังอยู่) — idempotent */
  private clear(): void {
    if (this.surface) {
      this.surface.mesh.parent?.remove(this.surface.mesh);
      this.surface.dispose();
      this.surface = null;
    }
    this.texture?.dispose();
    this.texture = null;
    for (const v of this.windows.values()) {
      if (v.surface) {
        v.surface.mesh.parent?.remove(v.surface.mesh);
        v.surface.dispose();
      }
      v.texture.dispose();
    }
    this.windows.clear();
    this.clipTexture?.dispose();
    this.clipTexture = null;
    this.cells = null;
    this.inputs = [];
    this.stage = 0;
  }

  private publish(): void {
    if (!this.onInfo) return;
    const tiles = this.manifest.terrain.tiles;
    const leafLevel = tiles ? tiles.levels[tiles.levels.length - 1] : null;
    const lc = this.manifest.landcover;
    const lcZ = lc && leafLevel ? (lc.levels.find((l) => l.z === leafLevel.z - 1) ?? lc.levels.find((l) => l.z === leafLevel.z)) : null;
    const count = (r: SheetStationResolution) => this.resolution.filter((x) => x === r).length;
    this.onInfo({
      stations: this.resolution.length,
      leaf: count("leaf"),
      pending: count("pending"),
      budget: count("overview-budget"),
      failed: count("overview-failed"),
      overview: count("overview"),
      overviewCellSizeM: this.manifest.terrain.cellSizeM,
      leafCellSizeM: leafLevel?.cellSizeM ?? null,
      maskCellSizeM: lcZ && tiles ? (tiles.levels[lcZ.z]?.cellSizeM ?? null) : null,
      requests: this.leafStats ? { issued: this.leafStats.issued, max: this.leafStats.max } : null,
      drawn: this.surface !== null || [...this.windows.values()].some((v) => v.surface !== null),
      workerError: this.workerError,
    });
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    if (!visible && this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // C7: ชั้นปิด = คิวไทล์ที่ยังไม่เริ่มถูกล้าง; เปิดกลับด้วยค่าชุดเดิม = แสดงผลเดิม แต่ถ้างานล่าสุด
    // ยังไม่ถึงขั้นที่ 2 (คิวถูกล้างไปตอนปิด) ต้องส่งงานใหม่ ไม่งั้นค้างอยู่ที่ overview ตลอด
    this.post({ type: "enable", on: visible });
    if (visible) {
      this.lastWaterlevel = undefined;
      const args = this.lastArgs;
      // ค่าชุดล่าสุดยังไม่เคยถูกส่ง (ตัวหน่วงถูกยกเลิกตอนปิด) หรือส่งแล้วแต่ยังไม่ถึงขั้นที่ 2
      if (args && (args.waterlevel !== this.postedWaterlevel || (this.jobInputs && !this.final))) {
        this.update(args.waterlevel, args.refMs);
      }
    }
    if (this.surface) this.surface.mesh.visible = visible;
    for (const v of this.windows.values()) if (v.surface) v.surface.mesh.visible = visible;
  }

  setDimmed(dimmed: boolean): void {
    this.dimmed = dimmed;
    this.opacity.value = dimmed ? STATION_SHEET_DIM_OPACITY : 1;
  }

  /**
   * ฉาก GFM ที่ *แสดงอยู่* (null = ไม่มีฉากในหน้าต่าง 14 วัน / ชั้น GFM ปิด) — เซลล์ที่ดาวเทียม
   * สังเกตแล้วถูกลบออกจากแผ่นใน worker แล้วส่งผลเดิมกลับมาใหม่ ไม่มีการวางแผน/ขอไทล์
   */
  setObserved(field: FloodField | null): void {
    const usable = field && field.width === this.manifest.terrain.width && field.height === this.manifest.terrain.height ? field : null;
    if (usable === this.observedField) return;
    this.observedField = usable;
    this.post({ type: "observed", mask: this.observedMask() });
  }

  /**
   * เซลล์ที่ GISTDA ระบุว่าท่วม (E16 B-2; มาสก์ไม่เบลอจาก `buildFloodMask().raw`, null = ไม่มีเซลล์ /
   * ชั้น GISTDA ปิด) — นับเป็น "ดาวเทียมสังเกตแล้ว" เช่นเดียวกับฉาก GFM: แผ่นจำลองไม่วาดทับ
   * เฉพาะ *ท่วม* — "แห้ง" ของ GISTDA เป็นข้อสมมติของ FwDET ไม่ใช่การสังเกต
   */
  setGistdaObserved(flooded: Uint8Array | null): void {
    const { width, height } = this.manifest.terrain;
    const usable = flooded && flooded.length === width * height ? flooded : null;
    if (usable === this.gistdaFlooded) return;
    this.gistdaFlooded = usable;
    this.post({ type: "observed", mask: this.observedMask() });
  }

  /** มาสก์ "สังเกตแล้ว" ที่ worker ใช้ = GFM (ท่วม/แห้ง) ∪ GISTDA (ท่วม) — null = ไม่มีทั้งคู่ */
  private observedMask(): Uint8Array | null {
    return unionMasks(this.observedField ? observedMaskFromField(this.observedField) : null, this.gistdaFlooded);
  }

  /** เซลล์ของแผ่นใต้จุด `(x, z)` ของฉาก — หน้าต่าง 30 ม. ก่อน แล้วค่อย overview; null = ไม่มีแผ่น */
  cellAt(x: number, z: number): StationSheetCellPick | null {
    if (!this.visible || !this.cells) return null;
    const tiles = this.manifest.terrain.tiles;
    if (tiles && this.windows.size > 0) {
      const leaf = tiles.levels[tiles.levels.length - 1];
      const T = tiles.tileSize;
      const [e, n] = this.terrain.projection.toUtm(x, z);
      const gc = (e - tiles.originEasting) / leaf.cellSizeM - 0.5;
      const gr = (tiles.originNorthing - n) / leaf.cellSizeM - 0.5;
      const tx = Math.floor(gc / T);
      const ty = Math.floor(gr / T);
      const view = tx >= 0 && ty >= 0 && tx < leaf.tilesX ? this.windows.get(ty * leaf.tilesX + tx) : undefined;
      if (view) {
        // พื้นที่นี้เป็นของหน้าต่าง 30 ม. (แผ่น overview ถูกตัดออก) — ตอบจากหน้าต่างเท่านั้น
        const { w } = view;
        const i = Math.round(gc - tx * T);
        const j = Math.round(gr - ty * T);
        const v = j * w.size + i;
        const k = w.station[v];
        if (!view.surface || k === undefined || k === SHEET_NONE) return null;
        const notEst = w.notEst[v] === 1;
        if (!notEst && w.depthCm[v] < MIN_DRAWN_DEPTH_CM) return null;
        const input = this.inputs[k];
        return input
          ? { depthCm: notEst ? null : w.depthCm[v], obs: input.obs, resolution: this.resolution[k] ?? "overview", cellSizeM: leaf.cellSizeM }
          : null;
      }
    }
    if (!this.surface) return null;
    const { width, height, cellSizeM } = this.manifest.terrain;
    const { gridWidthM, gridHeightM } = this.terrain.projection;
    const hit = sheetCellAt(this.cells, { width, height, cellSizeM, gridWidthM, gridHeightM }, x, z);
    if (!hit || hit.depthCm < MIN_DRAWN_DEPTH_CM) return null;
    const input = this.inputs[hit.stationIdx];
    return input
      ? { depthCm: hit.depthCm, obs: input.obs, resolution: this.resolution[hit.stationIdx] ?? "overview", cellSizeM }
      : null;
  }

  debug(): StationSheetDebug {
    let windowVertices = 0;
    for (const v of this.windows.values()) windowVertices += v.surface?.vertexCount ?? 0;
    return {
      ...this.stats,
      surfaceVertices: this.surface?.vertexCount ?? 0,
      windows: this.windows.size,
      windowVertices,
      stage: this.stage,
      resolution: this.resolution,
      leaf: this.leafStats,
      pending: this.jobInputs !== null && !this.final,
      workerAlive: this.worker !== null,
      jobs: this.jobs,
      error: this.error,
      visible: this.visible,
      dimmed: this.dimmed,
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    // C6: abort คำขอไทล์ที่ค้างอยู่ทั้งหมดผ่าน AbortController ตัวเดียวของ worker (เปลี่ยนจังหวัด /
    // ถอดชั้น) — worker ปิดตัวเองหลัง abort; terminate ตามหลังเป็นตาข่ายกันพลาด (terminate ทันทีจะตัด
    // worker ก่อนมันได้อ่านข้อความ abort)
    const worker = this.worker;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.postMessage({ type: "abort" } satisfies StationSheetWorkerMessage);
      setTimeout(() => worker.terminate(), WORKER_TERMINATE_GRACE_MS);
    }
    this.worker = null;
    this.jobInputs = null;
    this.clear();
    this.onInfo?.(null);
  }
}
