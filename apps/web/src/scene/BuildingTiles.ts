import * as THREE from "three";
import type { AoiManifest, BuildingTilePyramid, TerrainTilePyramid } from "@siahra/shared-types";
import type { LocalProjection } from "./localProjection";
import { detailTilesAllowed } from "./lod";
import type { BuildingTileJob, BuildingTileMesh } from "../workers/buildingTiles.worker";

/**
 * Whole-province buildings streamed as LOD tiles that follow the terrain
 * tile tree: whatever terrain tile is drawn, the building tile with the same
 * key is drawn (coarser levels only carry large/tall buildings — see
 * BuildingTilePyramid). Extrusion runs in a Web Worker; this class only
 * uploads finished meshes.
 */

const MAX_CACHED = 140;
const MAX_LOADS = 4;
const SINK_M = 1.5;
const WORKER_COUNT = 2;

type State = "idle" | "loading" | "ready" | "empty" | "failed";

interface Tile {
  id: string;
  z: number;
  x: number;
  y: number;
  state: State;
  mesh: THREE.Mesh | null;
  count: number;
  lastUsed: number;
  abort: AbortController | null;
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

export interface BuildingTileStats {
  visible: number;
  buildings: number;
  loading: number;
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
  private nextWorker = 0;
  private loadingCount = 0;
  private visibleSet = new Set<string>();
  private disposed = false;
  onStats?: (stats: BuildingTileStats) => void;

  constructor(manifest: AoiManifest, projection: LocalProjection) {
    const pyramid = manifest.buildings?.tiles;
    const terrain = manifest.terrain.tiles;
    if (!pyramid || !terrain) throw new Error("manifest has no building tile pyramid");
    this.pyramid = pyramid;
    this.terrain = terrain;
    this.proj = projection;
    for (const l of pyramid.levels) this.present.set(l.z, decodePresent(l.present));
    this.group.name = "building-tiles";
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.82,
      metalness: 0.04,
      side: THREE.DoubleSide,
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

  /**
   * Called with the terrain tree's currently drawn tile keys.
   *
   * เหนือเพดานความสูง (scene/lod.ts) ชั้นนี้ปิดทั้งชั้น: ไม่ขอไทล์ใหม่ **และ**
   * ถอด mesh ที่ต่ออยู่ออกจากฉาก การข้ามแค่การโหลดอย่างเดียวไม่ช่วยอะไร เพราะ
   * อาคารที่โหลดไว้แล้วจะยังถูกวาดต่อที่ 30 กม.
   */
  update(
    visibleTerrain: { z: number; x: number; y: number }[],
    camera: THREE.Camera,
    now: number,
  ) {
    if (this.disposed) return;
    if (!detailTilesAllowed(camera.position.y)) {
      if (this.visibleSet.size > 0) {
        for (const id of this.visibleSet) {
          const t = this.tiles.get(id);
          if (t?.mesh?.parent) this.group.remove(t.mesh);
        }
        this.visibleSet = new Set();
      }
      this.onStats?.({ visible: 0, buildings: 0, loading: this.loadingCount });
      return;
    }
    const next = new Set<string>();
    const wanted: Tile[] = [];
    for (const k of visibleTerrain) {
      if (!this.exists(k.z, k.x, k.y)) continue;
      const id = keyOf(k.z, k.x, k.y);
      let t = this.tiles.get(id);
      if (!t) {
        t = { id, ...k, state: "idle", mesh: null, count: 0, lastUsed: now, abort: null };
        this.tiles.set(id, t);
      }
      t.lastUsed = now;
      next.add(id);
      if (t.state === "ready" && t.mesh) {
        if (!t.mesh.parent) this.group.add(t.mesh);
      } else if (t.state === "idle" || t.state === "failed") {
        wanted.push(t);
      }
    }
    for (const id of this.visibleSet) {
      if (!next.has(id)) {
        const t = this.tiles.get(id);
        if (t?.mesh?.parent) this.group.remove(t.mesh);
      }
    }
    this.visibleSet = next;

    // Finest tiles first (they are the ones the user is looking at).
    wanted.sort((a, b) => b.z - a.z);
    for (const t of wanted) {
      if (this.loadingCount >= MAX_LOADS) break;
      void this.load(t);
    }
    this.evict(now);

    let buildings = 0;
    for (const id of this.visibleSet) buildings += this.tiles.get(id)?.count ?? 0;
    this.onStats?.({ visible: this.visibleSet.size, buildings, loading: this.loadingCount });
  }

  private async load(tile: Tile) {
    tile.state = "loading";
    tile.abort = new AbortController();
    this.loadingCount++;
    try {
      const url = this.pyramid.urlTemplate
        .replace("{z}", String(tile.z))
        .replace("{x}", String(tile.x))
        .replace("{y}", String(tile.y));
      const res = await fetch(url, { signal: tile.abort.signal });
      if (!res.ok) throw new Error(`building tile ${tile.id}: HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();
      if (this.disposed) return;

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
      if (mesh.count === 0 || mesh.indices.length === 0) {
        tile.state = "empty";
        return;
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(mesh.colors, 3));
      geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
      geometry.computeBoundingSphere();
      const m = new THREE.Mesh(geometry, this.material);
      m.name = `buildings:${tile.id}`;
      m.castShadow = true;
      m.receiveShadow = true;
      tile.mesh = m;
      tile.count = mesh.count;
      tile.state = "ready";
      if (this.visibleSet.has(tile.id)) this.group.add(m);
    } catch (err) {
      tile.state = (err as Error)?.name === "AbortError" ? "idle" : "failed";
    } finally {
      tile.abort = null;
      this.loadingCount--;
    }
  }

  private evict(now: number) {
    if (this.tiles.size <= MAX_CACHED) return;
    const candidates = [...this.tiles.values()]
      .filter((t) => !this.visibleSet.has(t.id) && t.state !== "loading")
      .sort((a, b) => a.lastUsed - b.lastUsed);
    let excess = this.tiles.size - MAX_CACHED;
    for (const t of candidates) {
      if (excess <= 0 || now - t.lastUsed < 3000) break;
      this.disposeTile(t);
      this.tiles.delete(t.id);
      excess--;
    }
  }

  private disposeTile(t: Tile) {
    if (t.mesh?.parent) t.mesh.parent.remove(t.mesh);
    t.mesh?.geometry.dispose();
    t.mesh = null;
    t.abort?.abort();
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
