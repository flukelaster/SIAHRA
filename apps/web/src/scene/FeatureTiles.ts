import * as THREE from "three";
import type { AoiManifest, FeatureTilePyramid, TerrainTilePyramid } from "@siahra/shared-types";
import type { LocalProjection } from "./localProjection";
import { createWaterMaterial } from "./waterMaterial";
import { detailTilesAllowed } from "./lod";
import type { FeatureTileJob, FeatureTileMesh } from "../workers/featureTiles.worker";

/**
 * Rivers / water bodies / major roads streamed as LOD tiles that follow the
 * terrain tile tree (same keys as BuildingTileLayer). Meshes are built in a
 * Web Worker; roads and water land in separate groups so they can be
 * toggled independently.
 */

const MAX_CACHED = 160;
const MAX_LOADS = 4;

type State = "idle" | "loading" | "ready" | "empty" | "failed";

interface Tile {
  id: string;
  z: number;
  x: number;
  y: number;
  state: State;
  roads: THREE.Mesh | null;
  water: THREE.Mesh | null;
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
   * ใหม่และถอด mesh ที่ต่ออยู่ออก (ดูเหตุผลใน BuildingTileLayer.update)
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
          if (t) this.detach(t);
        }
        this.visibleSet = new Set();
      }
      return;
    }
    const next = new Set<string>();
    const wanted: Tile[] = [];
    for (const k of visibleTerrain) {
      if (!this.exists(k.z, k.x, k.y)) continue;
      const id = keyOf(k.z, k.x, k.y);
      let t = this.tiles.get(id);
      if (!t) {
        t = { id, ...k, state: "idle", roads: null, water: null, lastUsed: now, abort: null };
        this.tiles.set(id, t);
      }
      t.lastUsed = now;
      next.add(id);
      if (t.state === "ready") this.attach(t);
      else if (t.state === "idle" || t.state === "failed") wanted.push(t);
    }
    for (const id of this.visibleSet) {
      if (!next.has(id)) {
        const t = this.tiles.get(id);
        if (t) this.detach(t);
      }
    }
    this.visibleSet = next;
    wanted.sort((a, b) => b.z - a.z);
    for (const t of wanted) {
      if (this.loadingCount >= MAX_LOADS) break;
      void this.load(t);
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
    tile.abort = new AbortController();
    this.loadingCount++;
    try {
      const url = this.pyramid.urlTemplate
        .replace("{z}", String(tile.z))
        .replace("{x}", String(tile.x))
        .replace("{y}", String(tile.y));
      const res = await fetch(url, { signal: tile.abort.signal });
      if (!res.ok) throw new Error(`feature tile ${tile.id}: HTTP ${res.status}`);
      const buffer = await res.arrayBuffer();
      if (this.disposed) return;
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
      if (mesh.roads.indices.length > 0) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(mesh.roads.positions, 3));
        g.setAttribute("color", new THREE.BufferAttribute(mesh.roads.colors, 3));
        g.setIndex(new THREE.BufferAttribute(mesh.roads.indices, 1));
        g.computeBoundingSphere();
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
        const m = new THREE.Mesh(g, this.waterMaterial);
        m.name = `water:${tile.id}`;
        m.renderOrder = 6;
        tile.water = m;
      }
      tile.state = tile.roads || tile.water ? "ready" : "empty";
      if (this.visibleSet.has(tile.id)) this.attach(tile);
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
    this.detach(t);
    t.roads?.geometry.dispose();
    t.water?.geometry.dispose();
    t.roads = null;
    t.water = null;
    t.abort?.abort();
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
