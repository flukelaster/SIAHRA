import * as THREE from "three";
import type { AoiManifest, FeatureTilePyramid, TerrainTilePyramid } from "@siahra/shared-types";
import type { LocalProjection } from "./localProjection";
import { createWaterMaterial } from "./waterMaterial";
import { detailTilesAllowed } from "./lod";
import { planEviction, retryDelayMs, type TileLoadState } from "./tileCache";
import type { TileLayerDebug } from "./BuildingTiles";
import type { FeatureTileJob, FeatureTileMesh } from "../workers/featureTiles.worker";

/**
 * Rivers / water bodies / major roads streamed as LOD tiles that follow the
 * terrain tile tree (same keys as BuildingTileLayer). Meshes are built in a
 * Web Worker; roads and water land in separate groups so they can be
 * toggled independently.
 */

/** เพดานจำนวนไทล์ ready (stub ไม่นับ — ดู planEviction) */
const MAX_CACHED = 160;
const MAX_LOADS = 4;

interface Tile {
  id: string;
  z: number;
  x: number;
  y: number;
  state: TileLoadState;
  roads: THREE.Mesh | null;
  water: THREE.Mesh | null;
  lastUsed: number;
  abort: AbortController | null;
  /** ระหว่าง loading: "fetch" ยกเลิกได้, "build" ส่งให้ worker แล้ว */
  phase: "fetch" | "build" | null;
  /** ไบต์ของ geometry ทั้งสองชั้น (สำหรับตัวนับดีบัก) */
  bytes: number;
  failures: number;
  retryAt: number;
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

export class FeatureTileLayer {
  readonly roadsGroup = new THREE.Group();
  readonly waterGroup = new THREE.Group();
  private readonly pyramid: FeatureTilePyramid;
  private readonly terrain: TerrainTilePyramid;
  private readonly proj: LocalProjection;
  private readonly present = new Map<number, Uint8Array>();
  private readonly tiles = new Map<string, Tile>();
  private readonly roadMaterial: THREE.MeshBasicMaterial;
  private readonly waterMaterial: THREE.MeshStandardMaterial;
  private readonly worker: Worker;
  private readonly pendingJobs = new Map<string, (mesh: FeatureTileMesh) => void>();
  private loadingCount = 0;
  private visibleSet = new Set<string>();
  private disposed = false;

  constructor(
    manifest: AoiManifest,
    projection: LocalProjection,
    uTime: { value: number },
    overlay: { value: THREE.Texture | null },
  ) {
    const pyramid = manifest.features;
    const terrain = manifest.terrain.tiles;
    if (!pyramid || !terrain) throw new Error("manifest has no feature tile pyramid");
    this.pyramid = pyramid;
    this.terrain = terrain;
    this.proj = projection;
    for (const l of pyramid.levels) this.present.set(l.z, decodePresent(l.present));
    this.roadsGroup.name = "feature-roads";
    this.waterGroup.name = "feature-water";
    this.roadMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.waterMaterial = createWaterMaterial(uTime);
    // Both follow the province mask like the terrain: dimmed outside the
    // province and dissolving with the DEM edge fade.
    const gridW = projection.gridWidthM;
    const gridH = projection.gridHeightM;
    for (const mat of [this.roadMaterial, this.waterMaterial]) {
      const prev = mat.onBeforeCompile;
      mat.onBeforeCompile = (shader, renderer) => {
        prev?.(shader, renderer);
        shader.uniforms.uMaskOverlay = overlay;
        shader.uniforms.uGridSize = { value: new THREE.Vector2(gridW, gridH) };
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec2 vMaskUv;\nuniform vec2 uGridSize;")
          .replace(
            "#include <worldpos_vertex>",
            "#include <worldpos_vertex>\n  { vec4 wp = modelMatrix * vec4(transformed, 1.0); vMaskUv = vec2((wp.x + uGridSize.x * 0.5) / uGridSize.x, 1.0 - (wp.z + uGridSize.y * 0.5) / uGridSize.y); }",
          );
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nvarying vec2 vMaskUv;\nuniform sampler2D uMaskOverlay;")
          .replace(
            "#include <color_fragment>",
            "#include <color_fragment>\n  { vec4 mo = texture2D(uMaskOverlay, vMaskUv); diffuseColor.rgb *= mix(0.55, 1.0, mo.b); diffuseColor.a *= mo.a; }",
          );
      };
      mat.customProgramCacheKey = () => `${mat.type}-siahra-masked`;
    }
    this.worker = new Worker(new URL("../workers/featureTiles.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (ev: MessageEvent<FeatureTileMesh>) => {
      const resolve = this.pendingJobs.get(ev.data.id);
      if (resolve) {
        this.pendingJobs.delete(ev.data.id);
        resolve(ev.data);
      }
    };
  }

  private exists(z: number, x: number, y: number): boolean {
    const level = this.pyramid.levels.find((l) => l.z === z);
    const bits = this.present.get(z);
    if (!level || !bits || x < 0 || y < 0 || x >= level.tilesX || y >= level.tilesY) return false;
    const idx = y * level.tilesX + x;
    return (bits[idx >> 3] & (1 << (idx & 7))) !== 0;
  }

  /**
   * เหนือเพดานความสูง (scene/lod.ts) ถนนและแหล่งน้ำปิดทั้งชั้น — ทั้งหยุดขอไทล์
   * ใหม่และถอด mesh ที่ต่ออยู่ออก (ดูเหตุผลใน BuildingTileLayer.update) เมื่อผู้ใช้ปิด
   * ทั้งถนนและแหล่งน้ำ ก็ไม่ขอไทล์ใหม่เช่นกัน (ไทล์หนึ่งใบมีทั้งสองชั้น จึงโหลดต่อถ้า
   * ยังเปิดอยู่ชั้นใดชั้นหนึ่ง) ส่วนการยกเลิกไทล์ที่ค้างและการไล่ออกทำทุกรอบ
   */
  update(
    visibleTerrain: { z: number; x: number; y: number }[],
    camera: THREE.Camera,
    now: number,
  ) {
    if (this.disposed) return;
    const active =
      (this.roadsGroup.visible || this.waterGroup.visible) && detailTilesAllowed(camera.position.y);
    const next = new Set<string>();
    const wanted: Tile[] = [];
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
            roads: null,
            water: null,
            lastUsed: now,
            abort: null,
            phase: null,
            bytes: 0,
            failures: 0,
            retryAt: 0,
          };
          this.tiles.set(id, t);
        }
        t.lastUsed = now;
        next.add(id);
        if (t.state === "ready") this.attach(t);
        else if (t.state === "idle" || (t.state === "failed" && now >= t.retryAt)) wanted.push(t);
      }
    }
    for (const id of this.visibleSet) {
      if (!next.has(id)) {
        const t = this.tiles.get(id);
        if (t) this.detach(t);
      }
    }
    this.visibleSet = next;
    // ไทล์ที่ยังดาวน์โหลดอยู่แต่หลุดจากชุดที่มองเห็นแล้ว → ยกเลิก (กลับเป็น idle)
    for (const t of this.tiles.values()) {
      if (t.state === "loading" && t.phase === "fetch" && !next.has(t.id)) t.abort?.abort();
    }
    if (active) {
      wanted.sort((a, b) => b.z - a.z);
      for (const t of wanted) {
        if (this.loadingCount >= MAX_LOADS) break;
        void this.load(t);
      }
    }
    this.evict(now);
  }

  private attach(t: Tile) {
    if (t.roads && !t.roads.parent) this.roadsGroup.add(t.roads);
    if (t.water && !t.water.parent) this.waterGroup.add(t.water);
  }
  private detach(t: Tile) {
    if (t.roads?.parent) this.roadsGroup.remove(t.roads);
    if (t.water?.parent) this.waterGroup.remove(t.water);
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
      if (!res.ok) throw new Error(`feature tile ${tile.id}: HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();
      if (this.disposed) return;
      signal.throwIfAborted();
      tile.phase = "build";
      const level = this.terrain.levels[tile.z];
      const tileM = level.cellSizeM * this.terrain.tileSize;
      const centreE = this.terrain.originEasting + (tile.x + 0.5) * tileM;
      const centreN = this.terrain.originNorthing - (tile.y + 0.5) * tileM;
      const [centreX, centreZ] = this.proj.toLocal(centreE, centreN);
      const leafZ = this.terrain.levels.length - 1;
      const widthScale = [1, 2, 3.5, 6, 9][Math.min(4, leafZ - tile.z)] ?? 9;

      const mesh = await new Promise<FeatureTileMesh>((resolve) => {
        this.pendingJobs.set(tile.id, resolve);
        const job: FeatureTileJob = { id: tile.id, buffer, centreX, centreZ, widthScale };
        this.worker.postMessage(job, [buffer]);
      });
      if (this.disposed) return;
      tile.failures = 0;
      tile.bytes = 0;
      if (mesh.roads.indices.length > 0) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(mesh.roads.positions, 3));
        g.setAttribute("color", new THREE.BufferAttribute(mesh.roads.colors, 3));
        g.setIndex(new THREE.BufferAttribute(mesh.roads.indices, 1));
        g.computeBoundingSphere();
        tile.bytes += mesh.roads.positions.byteLength + mesh.roads.colors.byteLength + mesh.roads.indices.byteLength;
        const m = new THREE.Mesh(g, this.roadMaterial);
        m.name = `roads:${tile.id}`;
        m.renderOrder = 8;
        tile.roads = m;
      }
      if (mesh.water.indices.length > 0) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(mesh.water.positions, 3));
        g.setIndex(new THREE.BufferAttribute(mesh.water.indices, 1));
        g.computeVertexNormals();
        g.computeBoundingSphere();
        // + normal ที่ computeVertexNormals สร้าง (Float32 ×3 เท่ากับ position)
        tile.bytes += 2 * mesh.water.positions.byteLength + mesh.water.indices.byteLength;
        const m = new THREE.Mesh(g, this.waterMaterial);
        m.name = `water:${tile.id}`;
        m.renderOrder = 6;
        tile.water = m;
      }
      tile.state = tile.roads || tile.water ? "ready" : "empty";
      if (this.visibleSet.has(tile.id)) this.attach(tile);
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
   * เพดาน MAX_CACHED นับเฉพาะไทล์ ready (เดิมนับ stub ว่าง/ล้มเหลวที่ไม่มีวันถูกไล่ออก
   * รวมไปด้วย แคชจึงโตได้ไม่จำกัด) — stub นอกชุดที่มองเห็นถูกลบทิ้งทุกรอบ
   */
  private evict(now: number) {
    const { evict, drop } = planEviction({
      entries: this.tiles.values(),
      keepReady: this.visibleSet,
      budgetBytes: Infinity,
      maxReady: MAX_CACHED,
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
    this.detach(t);
    t.roads?.geometry.dispose();
    t.water?.geometry.dispose();
    t.roads = null;
    t.water = null;
    t.bytes = 0;
    t.abort?.abort();
  }

  /** ตัวนับดีบัก (DEV) — `__siahraHandles.debug.snapshot().features` */
  debugStats(): TileLayerDebug {
    const states: Record<TileLoadState, number> = { idle: 0, loading: 0, ready: 0, empty: 0, failed: 0 };
    let residentBytes = 0;
    let attached = 0;
    for (const t of this.tiles.values()) {
      states[t.state]++;
      if (t.state === "ready") residentBytes += t.bytes;
      if (t.roads?.parent || t.water?.parent) attached++;
    }
    return {
      states,
      residentBytes,
      budgetBytes: null,
      visible: this.visibleSet.size,
      attached,
      queuedAttach: 0,
    };
  }

  dispose() {
    this.disposed = true;
    for (const t of this.tiles.values()) this.disposeTile(t);
    this.tiles.clear();
    this.pendingJobs.clear();
    this.worker.terminate();
    this.roadMaterial.dispose();
    this.waterMaterial.dispose();
    this.roadsGroup.parent?.remove(this.roadsGroup);
    this.waterGroup.parent?.remove(this.waterGroup);
  }
}
