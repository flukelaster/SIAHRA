import * as THREE from "three";
import type { AoiManifest, BuildingTilePyramid, TerrainTilePyramid } from "@siahra/shared-types";
import type { LocalProjection } from "./localProjection";
import { detailTilesAllowed } from "./lod";
import { planEviction, retryDelayMs, type TileLoadState } from "./tileCache";
import type { BuildingTileJob, BuildingTileMesh } from "../workers/buildingTiles.worker";

/**
 * Whole-province buildings streamed as LOD tiles that follow the terrain
 * tile tree: whatever terrain tile is drawn, the building tile with the same
 * key is drawn (coarser levels only carry large/tall buildings — see
 * BuildingTilePyramid). Extrusion runs in a Web Worker; this class only
 * uploads finished meshes.
 *
 * หน่วยความจำ (มือถือ): แคชคุมด้วย **งบไบต์** ไม่ใช่จำนวนไทล์ (ไทล์ z5 ใจกลางกรุงเทพใบเดียว
 * ~10 MB), สำเนา JS ของ attribute ถูกปล่อยทันทีหลังอัปโหลดขึ้น GPU (ไม่มีโค้ดฝั่ง main
 * thread อ่านมันอีก — การ pick ยิง ray ใส่แค่หมุด แผ่นดินไหว และกลุ่มไทล์ภูมิประเทศ ดู
 * `scene/picking.ts` + ตัวจับคลิกใน Map3DCanvas) และ mesh ใหม่ต่อเข้าฉากได้ไม่เกิน
 * MAX_NEW_ATTACH_PER_UPDATE ต่อรอบ เพื่อกระจายการอัปโหลดที่กระตุกเฟรม
 */

/** งบเริ่มต้นเมื่อผู้สร้างไม่ส่งมา (desktop) — ค่าต่ออุปกรณ์อยู่ที่ scene/quality.ts */
const DEFAULT_BUDGET_BYTES = 400 * 1024 * 1024;
const MAX_LOADS = 4;
const SINK_M = 1.5;
const WORKER_COUNT = 2;
/** mesh ที่ต่อเข้าฉาก "ครั้งแรก" (= ครั้งที่ต้องอัปโหลด GPU) ได้ต่อหนึ่ง update */
const MAX_NEW_ATTACH_PER_UPDATE = 2;

interface Tile {
  id: string;
  z: number;
  x: number;
  y: number;
  state: TileLoadState;
  mesh: THREE.Mesh | null;
  count: number;
  lastUsed: number;
  abort: AbortController | null;
  /** ระหว่าง loading: "fetch" ยกเลิกได้, "build" ส่งให้ worker แล้ว (ยกเลิกไม่ได้) */
  phase: "fetch" | "build" | null;
  /** ไบต์ของ attribute + index บน GPU — จดตอนสร้าง จึงยังรู้ค่าแม้ปล่อยสำเนา JS แล้ว */
  bytes: number;
  failures: number;
  retryAt: number;
  /** เคยต่อเข้าฉากแล้ว — ครั้งถัดไปไม่ต้องอัปโหลดใหม่ (buffer บน GPU ยังอยู่จนกว่าจะ dispose) */
  attachedOnce: boolean;
}

function keyOf(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`;
}

function decodePresent(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** ปล่อยสำเนา JS ของ attribute หลัง three อัปโหลดขึ้น GPU แล้ว (bounding sphere คำนวณไว้ก่อน) */
function releaseAfterUpload(attr: THREE.BufferAttribute) {
  attr.onUpload(() => {
    (attr as unknown as { array: ArrayLike<number> | null }).array = null;
  });
}

export interface BuildingTileStats {
  visible: number;
  buildings: number;
  loading: number;
}

export interface BuildingTileLayerOptions {
  /** งบไบต์ของไทล์ที่พร้อมใช้ (ดู memoryBudgetsFor ใน scene/quality.ts) */
  budgetBytes?: number;
  /** ค่าเงาเริ่มต้น — เปลี่ยนภายหลังด้วย setShadows() */
  shadows?: boolean;
}

/** ตัวนับดีบัก (DEV) — `__siahraHandles.debug.snapshot().buildings` */
export interface TileLayerDebug {
  states: Record<TileLoadState, number>;
  /** ไบต์บน GPU ของไทล์ ready ทั้งหมด (จดตอนสร้าง ไม่ใช่อ่านจาก array ที่ปล่อยไปแล้ว) */
  residentBytes: number;
  /** null = ไม่มีงบไบต์ (คุมด้วยจำนวนไทล์) */
  budgetBytes: number | null;
  visible: number;
  attached: number;
  queuedAttach: number;
}

export class BuildingTileLayer {
  readonly group = new THREE.Group();
  private readonly pyramid: BuildingTilePyramid;
  private readonly terrain: TerrainTilePyramid;
  private readonly proj: LocalProjection;
  private readonly present = new Map<number, Uint8Array>();
  private readonly tiles = new Map<string, Tile>();
  private readonly material: THREE.MeshStandardMaterial;
  private readonly workers: Worker[] = [];
  private readonly pendingJobs = new Map<string, (mesh: BuildingTileMesh) => void>();
  private readonly budgetBytes: number;
  private shadows: boolean;
  private nextWorker = 0;
  private loadingCount = 0;
  private visibleSet = new Set<string>();
  private disposed = false;
  onStats?: (stats: BuildingTileStats) => void;

  constructor(manifest: AoiManifest, projection: LocalProjection, opts: BuildingTileLayerOptions = {}) {
    const pyramid = manifest.buildings?.tiles;
    const terrain = manifest.terrain.tiles;
    if (!pyramid || !terrain) throw new Error("manifest has no building tile pyramid");
    this.pyramid = pyramid;
    this.terrain = terrain;
    this.proj = projection;
    this.budgetBytes = opts.budgetBytes ?? DEFAULT_BUDGET_BYTES;
    this.shadows = opts.shadows ?? true;
    for (const l of pyramid.levels) this.present.set(l.z, decodePresent(l.present));
    this.group.name = "building-tiles";
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.82,
      metalness: 0.04,
      // ผนังและหลังคาหันออกนอกเสมอ (winding ถูกจัดใน lib/buildingMesh.ts + มีเทส)
      // จึงตัดหน้าหลังทิ้งได้ — ครึ่งหนึ่งของงาน fragment ของอาคาร
      side: THREE.FrontSide,
      // อาคารไม่มีพื้นล่าง: เงาวาดทั้งสองหน้าเหมือนตอนที่วัสดุเป็น DoubleSide
      shadowSide: THREE.DoubleSide,
    });
    for (let i = 0; i < WORKER_COUNT; i++) {
      const w = new Worker(new URL("../workers/buildingTiles.worker.ts", import.meta.url), {
        type: "module",
      });
      w.onmessage = (ev: MessageEvent<BuildingTileMesh>) => {
        const resolve = this.pendingJobs.get(ev.data.id);
        if (resolve) {
          this.pendingJobs.delete(ev.data.id);
          resolve(ev.data);
        }
      };
      this.workers.push(w);
    }
  }

  get count(): number {
    return this.pyramid.count;
  }

  private exists(z: number, x: number, y: number): boolean {
    const level = this.pyramid.levels.find((l) => l.z === z);
    const bits = this.present.get(z);
    if (!level || !bits || x < 0 || y < 0 || x >= level.tilesX || y >= level.tilesY) return false;
    const idx = y * level.tilesX + x;
    return (bits[idx >> 3] & (1 << (idx & 7))) !== 0;
  }

  /** เงาเปิด/ปิดตาม preset คุณภาพ — ไม่มีเงา = ไม่ต้องวาดอาคารลง shadow map เลย */
  setShadows(enabled: boolean) {
    if (this.shadows === enabled) return;
    this.shadows = enabled;
    for (const t of this.tiles.values()) {
      if (!t.mesh) continue;
      t.mesh.castShadow = enabled;
      t.mesh.receiveShadow = enabled;
    }
  }

  /**
   * Called with the terrain tree's currently drawn tile keys.
   *
   * เหนือเพดานความสูง (scene/lod.ts) ชั้นนี้ปิดทั้งชั้น: ไม่ขอไทล์ใหม่ **และ**
   * ถอด mesh ที่ต่ออยู่ออกจากฉาก การข้ามแค่การโหลดอย่างเดียวไม่ช่วยอะไร เพราะ
   * อาคารที่โหลดไว้แล้วจะยังถูกวาดต่อที่ 30 กม.
   *
   * ชั้นที่ผู้ใช้ปิดอยู่ (`group.visible === false`) ทำแบบเดียวกัน — เดิมมันยังโหลดไทล์
   * ต่อเงียบ ๆ ทั้งที่ไม่มีใครเห็น ส่วนการถอด mesh การยกเลิกไทล์ที่ยังดาวน์โหลดอยู่
   * และการไล่ออกตามงบยังทำงานทุกรอบ
   */
  update(
    visibleTerrain: { z: number; x: number; y: number }[],
    camera: THREE.Camera,
    now: number,
  ) {
    if (this.disposed) return;
    const active = this.group.visible && detailTilesAllowed(camera.position.y);
    const next = new Set<string>();
    const wanted: Tile[] = [];
    let newAttaches = 0;
    if (active) {
      for (const k of visibleTerrain) {
        if (!this.exists(k.z, k.x, k.y)) continue;
        const id = keyOf(k.z, k.x, k.y);
        let t = this.tiles.get(id);
        if (!t) {
          t = {
            id,
            ...k,
            state: "idle",
            mesh: null,
            count: 0,
            lastUsed: now,
            abort: null,
            phase: null,
            bytes: 0,
            failures: 0,
            retryAt: 0,
            attachedOnce: false,
          };
          this.tiles.set(id, t);
        }
        t.lastUsed = now;
        next.add(id);
        if (t.state === "ready" && t.mesh) {
          if (!t.mesh.parent) {
            if (t.attachedOnce) {
              this.group.add(t.mesh);
            } else if (newAttaches < MAX_NEW_ATTACH_PER_UPDATE) {
              this.group.add(t.mesh);
              t.attachedOnce = true;
              newAttaches++;
            }
          }
        } else if (t.state === "idle" || (t.state === "failed" && now >= t.retryAt)) {
          wanted.push(t);
        }
      }
    }
    for (const id of this.visibleSet) {
      if (!next.has(id)) {
        const t = this.tiles.get(id);
        if (t?.mesh?.parent) this.group.remove(t.mesh);
      }
    }
    this.visibleSet = next;

    // ไทล์ที่ยังดาวน์โหลดอยู่แต่ไม่มีใครต้องการแล้ว → ยกเลิก (กลับเป็น idle ใน load())
    // ช่วง "build" ยกเลิกไม่ได้เพราะงานอยู่ใน worker แล้ว — ปล่อยให้จบแล้วเข้าแคชตามปกติ
    for (const t of this.tiles.values()) {
      if (t.state === "loading" && t.phase === "fetch" && !next.has(t.id)) t.abort?.abort();
    }

    if (active) {
      // Finest tiles first (they are the ones the user is looking at).
      wanted.sort((a, b) => b.z - a.z);
      for (const t of wanted) {
        if (this.loadingCount >= MAX_LOADS) break;
        void this.load(t);
      }
    }
    this.evict(now);

    let buildings = 0;
    for (const id of this.visibleSet) buildings += this.tiles.get(id)?.count ?? 0;
    this.onStats?.({ visible: this.visibleSet.size, buildings, loading: this.loadingCount });
  }

  private async load(tile: Tile) {
    tile.state = "loading";
    tile.phase = "fetch";
    tile.abort = new AbortController();
    const signal = tile.abort.signal;
    this.loadingCount++;
    try {
      const url = this.pyramid.urlTemplate
        .replace("{z}", String(tile.z))
        .replace("{x}", String(tile.x))
        .replace("{y}", String(tile.y));
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`building tile ${tile.id}: HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();
      if (this.disposed) return;
      signal.throwIfAborted();
      tile.phase = "build";

      const level = this.terrain.levels[tile.z];
      const tileM = level.cellSizeM * this.terrain.tileSize;
      const centreE = this.terrain.originEasting + (tile.x + 0.5) * tileM;
      const centreN = this.terrain.originNorthing - (tile.y + 0.5) * tileM;
      const [centreX, centreZ] = this.proj.toLocal(centreE, centreN);

      const mesh = await new Promise<BuildingTileMesh>((resolve) => {
        this.pendingJobs.set(tile.id, resolve);
        const job: BuildingTileJob = {
          id: tile.id,
          buffer,
          unitM: this.pyramid.unitM,
          centreX,
          centreZ,
          sinkM: SINK_M,
        };
        const w = this.workers[this.nextWorker++ % this.workers.length];
        w.postMessage(job, [buffer]);
      });
      if (this.disposed) return;
      tile.failures = 0;
      if (mesh.count === 0 || mesh.indices.length === 0) {
        tile.state = "empty";
        return;
      }
      const geometry = new THREE.BufferGeometry();
      const position = new THREE.BufferAttribute(mesh.positions, 3);
      // สี Uint8 แบบ normalized: shader ได้ค่า 0–1 เท่าเดิม แต่กิน 3 B/vertex แทน 12
      const color = new THREE.BufferAttribute(mesh.colors, 3, true);
      const index = new THREE.BufferAttribute(mesh.indices, 1);
      geometry.setAttribute("position", position);
      geometry.setAttribute("color", color);
      geometry.setIndex(index);
      // ต้องมาก่อนปล่อยสำเนา JS — frustum culling ใช้ sphere นี้ตลอดอายุ mesh
      geometry.computeBoundingSphere();
      for (const attr of [position, color, index]) releaseAfterUpload(attr);
      tile.bytes = mesh.positions.byteLength + mesh.colors.byteLength + mesh.indices.byteLength;
      const m = new THREE.Mesh(geometry, this.material);
      m.name = `buildings:${tile.id}`;
      m.castShadow = this.shadows;
      m.receiveShadow = this.shadows;
      tile.mesh = m;
      tile.count = mesh.count;
      tile.attachedOnce = false;
      // ยังไม่ต่อเข้าฉากที่นี่ — update() รอบถัดไปต่อให้ตามโควตาการอัปโหลดต่อรอบ
      tile.state = "ready";
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        tile.state = "idle";
      } else {
        tile.state = "failed";
        tile.failures++;
        tile.retryAt = performance.now() + retryDelayMs(tile.failures);
      }
    } finally {
      tile.abort = null;
      tile.phase = null;
      this.loadingCount--;
    }
  }

  /**
   * งบไบต์: ไทล์ ready ที่ไม่ได้วาดอยู่ถูกไล่ออกแบบ LRU จนไบต์รวม ≤ งบ ส่วน stub
   * (idle/empty/failed ที่พ้นช่วงรอ) ที่ไม่ได้อยู่ในชุดที่มองเห็นถูกลบทิ้งเลย
   * (ดู planEviction ใน scene/tileCache.ts)
   */
  private evict(now: number) {
    const { evict, drop } = planEviction({
      entries: this.tiles.values(),
      keepReady: this.visibleSet,
      budgetBytes: this.budgetBytes,
      now,
    });
    for (const id of evict) {
      const t = this.tiles.get(id);
      if (t) this.disposeTile(t);
      this.tiles.delete(id);
    }
    for (const id of drop) this.tiles.delete(id);
  }

  private disposeTile(t: Tile) {
    if (t.mesh?.parent) t.mesh.parent.remove(t.mesh);
    t.mesh?.geometry.dispose();
    t.mesh = null;
    t.bytes = 0;
    t.abort?.abort();
  }

  /** ตัวนับดีบัก (DEV) — ดู TileLayerDebug */
  debugStats(): TileLayerDebug {
    const states: Record<TileLoadState, number> = { idle: 0, loading: 0, ready: 0, empty: 0, failed: 0 };
    let residentBytes = 0;
    let attached = 0;
    let queuedAttach = 0;
    for (const t of this.tiles.values()) {
      states[t.state]++;
      if (t.state === "ready") residentBytes += t.bytes;
      if (t.mesh?.parent) attached++;
      else if (t.mesh && this.visibleSet.has(t.id)) queuedAttach++;
    }
    return {
      states,
      residentBytes,
      budgetBytes: this.budgetBytes,
      visible: this.visibleSet.size,
      attached,
      queuedAttach,
    };
  }

  dispose() {
    this.disposed = true;
    for (const t of this.tiles.values()) this.disposeTile(t);
    this.tiles.clear();
    this.pendingJobs.clear();
    for (const w of this.workers) w.terminate();
    this.material.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
