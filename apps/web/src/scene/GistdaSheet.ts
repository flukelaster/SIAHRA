import type * as THREE from "three";
import type { AoiManifest } from "@siahra/shared-types";
import { GISTDA_SHEET_RGB } from "../lib/floodStyle";
import {
  gfmFloodedMaskFromField,
  gistdaCellAt,
  gistdaToFloodField,
  type GistdaDepthCellPick,
  type GistdaDepthCells,
} from "../lib/gistdaDepthField";
import type { GistdaDepthWorkerMessage, GistdaDepthWorkerResult } from "../workers/gistdaDepth.worker";
import { createFloodSurface, FLOOD_SURFACE_RENDER_ORDER, type FloodSurface } from "./FloodSurface";
import { buildFloodFieldTexture, summarizeFloodField, type FloodField, type FloodFieldTexture } from "./floodField";
import type { TerrainField } from "./TerrainMesh";

/**
 * แผ่นน้ำ 3 มิติจากขอบเขตน้ำท่วม GISTDA (E16 B-2, ชั้น `gistdaDepth`)
 *
 * - **ขอบเขต = ตรวจวัดจริง** (เซลล์ H3 ที่ GISTDA แปลจากภาพดาวเทียม), **ความลึก = ภาพประกอบ**
 *   (FwDET จาก DEM, `lib/gistdaDepth.ts`) — descriptor ของชั้นเป็น `illustrative` และ legend บอกทั้งสองส่วน
 *   ผิวน้ำจึงไม่มีลายทแยง (ต่างจากแผ่นจำลองจากสถานี) และใช้สีตระกูล GISTDA (เทาฟ้า → สเลต) `GISTDA_SHEET_RGB`
 * - คำนวณใน `workers/gistdaDepth.worker.ts` ซึ่งชั้นนี้เป็นเจ้าของตลอดอายุ (สร้างเมื่อมีงานแรก,
 *   `abort` + terminate ใน `dispose`) — ความสูง/มาสก์จังหวัดส่งครั้งเดียว งานละหนึ่งมาสก์ท่วม
 * - คำนวณใหม่ **เฉพาะเมื่อมาสก์ท่วมเปลี่ยนเนื้อหา** (ข้อมูล GISTDA ใหม่ / เลื่อนเส้นเวลาไปฉากอื่น /
 *   จังหวัดเปลี่ยน = ชั้นใหม่) ไม่มีงานต่อเฟรม ไม่มี rAF ของตัวเอง
 * - วาดด้วยท่อเดียวกับแผ่นความลึก GFM (`buildFloodFieldTexture` + `createFloodSurface` variant ที่ไม่มี
 *   `sheet`) — GLSL ของ GFM ไม่เปลี่ยน; ลำดับการวาดเท่ากับ GFM (สองแผ่นไม่ซ้อนกัน: เซลล์ที่ GFM ว่าท่วม
 *   ถูกตัดออกจากแผ่นนี้ — `lib/gistdaDepthField.ts`) และสูงกว่าแผ่นจำลองจากสถานี
 * - worker ล้มเหลว = ไม่มีแผ่น + `error` ใน legend/ตัวนับดีบัก (ไม่ log)
 */
export interface GistdaSheetInfo {
  /** เซลล์ท่วม (GISTDA) บนกริด overview ที่เข้าคำนวณ — 0 = ไม่มีอะไรให้วาด */
  floodedCells: number;
  /** เซลล์ขอบน้ำที่ใช้จริง — 0 ขณะมีเซลล์ท่วม = ประมาณความลึกไม่ได้เลย */
  boundaryCells: number;
  /** เซลล์ที่ไม่ได้ประมาณความลึก (ไม่มีเซลล์ขอบให้อ้าง) */
  notEstimatedCells: number;
  /** null = ไม่มีเซลล์ใดมีค่าความลึก */
  maxDepthCm: number | null;
  /** เซลล์ที่ถูกตัดออกเพราะฉาก GFM ที่แสดงอยู่ว่าท่วมแล้ว */
  deferredToGfm: number;
  cellSizeM: number;
  pending: boolean;
  drawn: boolean;
  error: string | null;
}

export interface GistdaSheetDebug extends GistdaSheetInfo {
  /** เซลล์ที่มีค่าความลึก แยกช่วง (ซม.): < 2 · 2–50 · 50–100 · 100–200 · ≥ 200 (ทุกช่วงถูกวาด) */
  depthHistogramCm: [number, number, number, number, number];
  /** ตำแหน่งฉาก (x, z) ของเซลล์ที่ลึกที่สุด — ให้ QA พากล้องไปดูไล่เฉดได้ตรงจุด; null = ไม่มี */
  deepestAt: [number, number] | null;
  jobs: number;
  computeMs: number | null;
  surfaceVertices: number;
  workerAlive: boolean;
  visible: boolean;
  dimmed: boolean;
}

/** ความทึบเมื่อหรี่ (แหล่ง GISTDA ค้าง/ติดต่อไม่ได้) — ค่าเดียวกับชั้นอื่นที่หรี่ */
export const GISTDA_SHEET_DIM_OPACITY = 0.4;
/**
 * ความทึบของเซลล์ที่ตื้นที่สุด — ขอบเขตเป็นของที่ดาวเทียมเห็นจริง ต้องเห็นชัดแม้ FwDET ให้ความลึก ~0
 * (หย่อมเซลล์ H3 เล็ก ๆ แทบทั้งหย่อมเป็นขอบน้ำ); GFM เริ่มที่ 0.35 และทิ้งเซลล์ที่ตื้นกว่า 2 ซม.
 */
export const GISTDA_SHEET_MIN_ALPHA = 0.55;
/** ความลึก < 2 ซม. (ช่องแรกของฮิสโทแกรมดีบัก) — ยังถูกวาด (ขอบเขตตรวจวัดจริง) แต่อ่านว่า "~0 ม." */
const SHALLOW_CM = 2;
const WORKER_TERMINATE_GRACE_MS = 1000;

function sameMask(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export class GistdaSheetLayer {
  private worker: Worker | null = null;
  private jobId = 0;
  private jobs = 0;
  /** `update()` ถูกเรียกแล้วอย่างน้อยครั้งหนึ่ง */
  private updated = false;
  private pendingJob: number | null = null;
  /** สำเนามาสก์ท่วมของงานล่าสุด (ตัวเปรียบเทียบ "ข้อมูลเปลี่ยนไหม") */
  private flooded: Uint8Array | null = null;
  private cells: GistdaDepthCells | null = null;
  private stats = { floodedCells: 0, boundaryCells: 0, maxDepthCm: null as number | null, computeMs: null as number | null };
  private gfmMask: Uint8Array | null = null;
  private gfmField: FloodField | null = null;
  private texture: FloodFieldTexture | null = null;
  private surface: FloodSurface | null = null;
  private field: { notEstimatedCells: number; deferredToGfm: number } = { notEstimatedCells: 0, deferredToGfm: 0 };
  private readonly opacity = { value: 1 };
  private visible = true;
  private dimmed = false;
  private disposed = false;
  private error: string | null = null;

  private readonly parent: THREE.Object3D;
  private readonly terrain: TerrainField;
  private readonly manifest: AoiManifest;
  private readonly uTime: { value: number };
  private readonly onInfo: ((info: GistdaSheetInfo | null) => void) | undefined;

  constructor(
    parent: THREE.Object3D,
    terrain: TerrainField,
    manifest: AoiManifest,
    uTime: { value: number },
    onInfo?: (info: GistdaSheetInfo | null) => void,
  ) {
    this.parent = parent;
    this.terrain = terrain;
    this.manifest = manifest;
    this.uTime = uTime;
    this.onInfo = onInfo;
  }

  /**
   * มาสก์ท่วมชุดใหม่ (ไม่เบลอ, แถว 0 = เหนือ; null = ไม่มีเซลล์ GISTDA) — เนื้อหาเดิม = ไม่ทำอะไร
   * ไม่มีเซลล์ท่วม = ล้างแผ่นโดยไม่ปลุก worker
   */
  update(flooded: Uint8Array | null): void {
    if (this.disposed) return;
    const { width, height } = this.manifest.terrain;
    const usable = flooded && flooded.length === width * height && flooded.some((v) => v !== 0) ? flooded : null;
    // ครั้งแรกต้องผ่านเสมอ: `flooded` เริ่มที่ null — มาสก์ว่างครั้งแรก (มีเซลล์ GISTDA แต่ไม่ตกกึ่งกลาง
    // เซลล์ใดของกริด) ต้อง publish ให้ legend บอกเหตุ ไม่ใช่เงียบ
    if (
      this.updated &&
      sameMask(usable, this.flooded) &&
      (this.cells !== null || this.pendingJob !== null || usable === null)
    ) {
      return;
    }
    this.updated = true;
    this.flooded = usable ? usable.slice() : null;
    if (!usable) {
      this.pendingJob = null;
      this.cells = null;
      this.stats = { floodedCells: 0, boundaryCells: 0, maxDepthCm: null, computeMs: null };
      this.clear();
      this.publish();
      return;
    }
    const worker = this.ensureWorker();
    if (!worker) {
      this.clear();
      this.publish();
      return;
    }
    const id = ++this.jobId;
    this.pendingJob = id;
    this.jobs++;
    const copy = usable.slice();
    worker.postMessage({ type: "job", jobId: id, flooded: copy } satisfies GistdaDepthWorkerMessage, [copy.buffer]);
    this.publish();
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    try {
      const worker = new Worker(new URL("../workers/gistdaDepth.worker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (ev: MessageEvent<GistdaDepthWorkerResult>) => this.onResult(ev.data);
      worker.onerror = (ev) => this.fail(ev.message || "gistda depth worker failed");
      worker.onmessageerror = () => this.fail("gistda depth worker sent an uncloneable message");
      const { width, height } = this.manifest.terrain;
      // สำเนา — ตัวจริงถูกปิดทับอยู่ใน TerrainField.sample() (ห้าม detach)
      const heights = new Float32Array(this.terrain.heights);
      const inside = this.terrain.insideMask ? this.terrain.insideMask.slice() : null;
      const transfer: Transferable[] = [heights.buffer];
      if (inside) transfer.push(inside.buffer);
      worker.postMessage(
        { type: "init", grid: { width, height }, heights, inside } satisfies GistdaDepthWorkerMessage,
        transfer,
      );
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
    this.worker?.terminate();
    this.worker = null;
    this.pendingJob = null;
    this.cells = null;
    // งานถัดไปที่มีเนื้อหาเดียวกันต้องลองใหม่ได้ (ไม่งั้น `update` เห็นว่าเหมือนเดิมแล้วเงียบ)
    this.flooded = null;
    this.clear();
    this.publish();
  }

  private onResult(res: GistdaDepthWorkerResult): void {
    if (this.disposed || res.jobId !== this.pendingJob) return;
    this.pendingJob = null;
    if (!res.ok) {
      this.error = res.error;
      this.cells = null;
      this.clear();
      this.publish();
      return;
    }
    this.error = null;
    const { width, height } = this.manifest.terrain;
    this.cells = { width, height, cls: res.cls, depthCm: res.depthCm };
    this.stats = {
      floodedCells: res.floodedCells,
      boundaryCells: res.boundaryCells,
      maxDepthCm: res.maxDepthCm,
      computeMs: res.ms,
    };
    this.rebuild();
  }

  /** texture + แผ่นจากผลล่าสุดกับมาสก์ GFM ปัจจุบัน — ไม่ปลุก worker */
  private rebuild(): void {
    this.clear();
    const cells = this.cells;
    if (!cells) {
      this.publish();
      return;
    }
    const field = gistdaToFloodField(cells, this.gfmMask);
    const summary = summarizeFloodField(field);
    let deferredToGfm = 0;
    if (this.gfmMask) {
      for (let i = 0; i < cells.cls.length; i++) if (cells.cls[i] !== 0 && this.gfmMask[i]) deferredToGfm++;
    }
    this.field = { notEstimatedCells: summary.floodedCells - summary.depthEstimatedCells, deferredToGfm };
    if (summary.depthEstimatedCells > 0) {
      const texture = buildFloodFieldTexture(field);
      const surface = createFloodSurface(this.terrain, this.manifest, field, texture.texture, this.uTime, {
        cacheKey: "siahra-gistda-sheet",
        name: "gistda-sheet",
        palette: GISTDA_SHEET_RGB,
        opacity: this.opacity,
        // ขอบเขตตรวจวัดจริง: ทุกเซลล์ท่วมที่มีค่าความลึกถูกวาด แม้ FwDET ให้ ~0 ม. (ขอบของหย่อมเล็ก ๆ)
        observedExtent: { minAlpha: GISTDA_SHEET_MIN_ALPHA },
      });
      this.texture = texture;
      if (surface) {
        surface.mesh.visible = this.visible;
        // เท่ากับ GFM (เซลล์ไม่ซ้อนกัน) และสูงกว่าแผ่นจำลองจากสถานี (`STATION_SHEET_RENDER_ORDER` = 1)
        surface.mesh.renderOrder = FLOOD_SURFACE_RENDER_ORDER;
        this.parent.add(surface.mesh);
      }
      this.surface = surface;
    }
    this.publish();
  }

  /** ทิ้งแผ่น + texture ปัจจุบัน (worker ยังอยู่) — idempotent */
  private clear(): void {
    if (this.surface) {
      this.surface.mesh.parent?.remove(this.surface.mesh);
      this.surface.dispose();
      this.surface = null;
    }
    this.texture?.dispose();
    this.texture = null;
    this.field = { notEstimatedCells: 0, deferredToGfm: 0 };
  }

  private info(): GistdaSheetInfo {
    return {
      floodedCells: this.stats.floodedCells,
      boundaryCells: this.stats.boundaryCells,
      notEstimatedCells: this.field.notEstimatedCells,
      maxDepthCm: this.stats.maxDepthCm,
      deferredToGfm: this.field.deferredToGfm,
      cellSizeM: this.manifest.terrain.cellSizeM,
      pending: this.pendingJob !== null,
      drawn: this.surface !== null,
      error: this.error,
    };
  }

  private publish(): void {
    this.onInfo?.(this.info());
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (this.surface) this.surface.mesh.visible = visible;
  }

  setDimmed(dimmed: boolean): void {
    this.dimmed = dimmed;
    this.opacity.value = dimmed ? GISTDA_SHEET_DIM_OPACITY : 1;
  }

  /**
   * ฉาก GFM ที่ *แสดงอยู่* (null = ไม่มีฉาก/ชั้น GFM ปิด) — GFM มาก่อน: เซลล์ที่ GFM ว่าท่วมถูกตัดออกจาก
   * แผ่นนี้ สร้าง texture/แผ่นใหม่จากผลเดิม ไม่ปลุก worker
   */
  setGfmField(field: FloodField | null): void {
    const { width, height } = this.manifest.terrain;
    const usable = field && field.width === width && field.height === height ? field : null;
    if (usable === this.gfmField) return;
    this.gfmField = usable;
    this.gfmMask = usable ? gfmFloodedMaskFromField(usable) : null;
    if (this.cells) this.rebuild();
  }

  /** เซลล์ของแผ่นใต้จุด `(x, z)` ของฉาก — null = ชั้นซ่อน/ไม่มีแผ่นตรงนี้/GFM มาก่อน */
  cellAt(x: number, z: number): GistdaDepthCellPick | null {
    if (!this.visible || !this.cells || !this.surface) return null;
    const { width, height, cellSizeM } = this.manifest.terrain;
    const { gridWidthM, gridHeightM } = this.terrain.projection;
    return gistdaCellAt(
      this.cells,
      { width, height, cellSizeM, gridWidthM, gridHeightM },
      this.gfmMask,
      x,
      z,
      0,
    );
  }

  debug(): GistdaSheetDebug {
    const hist: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    const cells = this.cells;
    let deepest = -1;
    if (cells) {
      for (let i = 0; i < cells.cls.length; i++) {
        if (cells.cls[i] !== 1) continue;
        const d = cells.depthCm[i]!;
        if (deepest < 0 || d > cells.depthCm[deepest]!) deepest = i;
        hist[d < SHALLOW_CM ? 0 : d < 50 ? 1 : d < 100 ? 2 : d < 200 ? 3 : 4]++;
      }
    }
    return {
      ...this.info(),
      depthHistogramCm: hist,
      deepestAt:
        cells && deepest >= 0
          ? [
              (deepest % cells.width) * this.manifest.terrain.cellSizeM - this.terrain.projection.gridWidthM / 2,
              Math.floor(deepest / cells.width) * this.manifest.terrain.cellSizeM - this.terrain.projection.gridHeightM / 2,
            ]
          : null,
      jobs: this.jobs,
      computeMs: this.stats.computeMs,
      surfaceVertices: this.surface?.vertexCount ?? 0,
      workerAlive: this.worker !== null,
      visible: this.visible,
      dimmed: this.dimmed,
    };
  }

  dispose(): void {
    this.disposed = true;
    const worker = this.worker;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.postMessage({ type: "abort" } satisfies GistdaDepthWorkerMessage);
      // worker ปิดตัวเองหลัง abort; terminate ตามหลังเป็นตาข่ายกันพลาด
      setTimeout(() => worker.terminate(), WORKER_TERMINATE_GRACE_MS);
    }
    this.worker = null;
    this.pendingJob = null;
    this.cells = null;
    this.clear();
    this.onInfo?.(null);
  }
}
