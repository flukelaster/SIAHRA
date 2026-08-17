import * as THREE from "three";
import type { AoiManifest, LandcoverTilePyramid, TerrainTilePyramid } from "@siahra/shared-types";
import type { LocalProjection } from "./localProjection";
import type { TerrainTileTree } from "./TerrainTiles";

/**
 * Trees from ESA WorldCover "tree cover" cells, drawn as instanced crossed
 * billboards only on nearby leaf tiles. Purely cosmetic (class 10 = trees),
 * density-thinned so a forested 3.8 km tile costs a few thousand instances.
 */
const NEAR_M = 9000;
const MAX_TREES_PER_TILE = 6000;
const TREE_CLASS = 10;
const MANGROVE_CLASS = 95;
const MAX_CACHED = 60;

interface Tile {
  id: string;
  z: number;
  x: number;
  y: number;
  state: "idle" | "loading" | "ready" | "empty" | "failed";
  mesh: THREE.InstancedMesh | null;
  lastUsed: number;
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

/** Procedural tree sprite: dark trunk, layered canopy, transparent edges. */
function treeTexture(): THREE.CanvasTexture {
  const w = 128;
  const h = 192;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#4a3521";
  ctx.fillRect(w / 2 - 5, h * 0.55, 10, h * 0.45);
  const blobs = [
    [0.5, 0.42, 0.34],
    [0.35, 0.5, 0.26],
    [0.65, 0.5, 0.26],
    [0.5, 0.26, 0.24],
    [0.4, 0.34, 0.2],
    [0.62, 0.34, 0.2],
  ];
  for (const [bx, by, br] of blobs) {
    const g = ctx.createRadialGradient(bx * w - 6, by * h - 8, 2, bx * w, by * h, br * w);
    g.addColorStop(0, "#6f9a3c");
    g.addColorStop(0.7, "#3f6d2a");
    g.addColorStop(1, "#2c4f1f");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(bx * w, by * h, br * w, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function crossedQuads(): THREE.BufferGeometry {
  // Two vertical quads crossed at 90°, 1 unit tall, 0.7 wide, origin at the base.
  const hw = 0.35;
  const pos = new Float32Array([
    -hw, 0, 0, hw, 0, 0, hw, 1, 0, -hw, 1, 0,
    0, 0, -hw, 0, 0, hw, 0, 1, hw, 0, 1, -hw,
  ]);
  const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1]);
  const idx = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class VegetationTiles {
  readonly group = new THREE.Group();
  private readonly pyramid: LandcoverTilePyramid;
  private readonly terrain: TerrainTilePyramid;
  private readonly proj: LocalProjection;
  private readonly tree: TerrainTileTree;
  private readonly present = new Map<number, Uint8Array>();
  private readonly tiles = new Map<string, Tile>();
  private readonly geometry = crossedQuads();
  private readonly material: THREE.MeshStandardMaterial;
  private readonly leafZ: number;
  private loading = 0;
  private visible = new Set<string>();
  private disposed = false;
  private enabled = true;

  constructor(manifest: AoiManifest, projection: LocalProjection, tree: TerrainTileTree) {
    const pyramid = manifest.landcover;
    const terrain = manifest.terrain.tiles;
    if (!pyramid || !terrain) throw new Error("no landcover pyramid");
    this.pyramid = pyramid;
    this.terrain = terrain;
    this.proj = projection;
    this.tree = tree;
    this.leafZ = terrain.levels.length - 1;
    for (const l of pyramid.levels) this.present.set(l.z, decodePresent(l.present));
    this.group.name = "vegetation";
    this.material = new THREE.MeshStandardMaterial({
      map: treeTexture(),
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.95,
      metalness: 0,
    });
  }

  private exists(z: number, x: number, y: number): boolean {
    const level = this.pyramid.levels.find((l) => l.z === z);
    const bits = this.present.get(z);
    if (!level || !bits || x < 0 || y < 0 || x >= level.tilesX || y >= level.tilesY) return false;
    const idx = y * level.tilesX + x;
    return (bits[idx >> 3] & (1 << (idx & 7))) !== 0;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.group.visible = on;
  }

  update(visibleTerrain: { z: number; x: number; y: number }[], camera: THREE.Camera, now: number) {
    if (this.disposed || !this.enabled) return;
    const next = new Set<string>();
    const camPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    for (const k of visibleTerrain) {
      if (k.z !== this.leafZ || !this.exists(k.z, k.x, k.y)) continue;
      const level = this.terrain.levels[k.z];
      const tileM = level.cellSizeM * this.terrain.tileSize;
      const [cx, cz] = this.proj.toLocal(
        this.terrain.originEasting + (k.x + 0.5) * tileM,
        this.terrain.originNorthing - (k.y + 0.5) * tileM,
      );
      const d = Math.hypot(camPos.x - cx, camPos.z - cz);
      if (d > NEAR_M) continue;
      const id = keyOf(k.z, k.x, k.y);
      let t = this.tiles.get(id);
      if (!t) {
        t = { id, ...k, state: "idle", mesh: null, lastUsed: now };
        this.tiles.set(id, t);
      }
      t.lastUsed = now;
      next.add(id);
      if (t.state === "ready" && t.mesh && !t.mesh.parent) this.group.add(t.mesh);
      if (t.state === "idle" && this.loading < 2) void this.load(t);
    }
    for (const id of this.visible) {
      if (!next.has(id)) {
        const t = this.tiles.get(id);
        if (t?.mesh?.parent) this.group.remove(t.mesh);
      }
    }
    this.visible = next;
    if (this.tiles.size > MAX_CACHED) {
      const old = [...this.tiles.values()].filter((t) => !next.has(t.id) && t.state !== "loading").sort((a, b) => a.lastUsed - b.lastUsed);
      for (const t of old.slice(0, this.tiles.size - MAX_CACHED)) {
        t.mesh?.dispose(); // geometry/material are shared; only the instance buffers go
        this.tiles.delete(t.id);
      }
    }
  }

  private async load(t: Tile) {
    t.state = "loading";
    this.loading++;
    try {
      const url = this.pyramid.urlTemplate.replace("{z}", String(t.z)).replace("{x}", String(t.x)).replace("{y}", String(t.y));
      const res = await fetch(url);
      if (!res.ok) throw new Error(`landcover ${t.id}: ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (this.disposed) return;
      const T = this.terrain.tileSize;
      if (buf.length !== T * T) {
        t.state = "empty";
        return;
      }
      const level = this.terrain.levels[t.z];
      const cell = level.cellSizeM;
      const e0 = this.terrain.originEasting + t.x * T * cell;
      const n0 = this.terrain.originNorthing - t.y * T * cell;
      // Deterministic pseudo-random per tile so trees don't jump between loads.
      let seed = (t.x * 73856093) ^ (t.y * 19349663) ^ 0x9e3779b9;
      const rand = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      const candidates: number[] = [];
      for (let i = 0; i < T * T; i++) {
        const v = buf[i];
        if (v === TREE_CLASS || v === MANGROVE_CLASS) candidates.push(i);
      }
      if (candidates.length === 0) {
        t.state = "empty";
        return;
      }
      // Thin dense forest: keep at most MAX_TREES_PER_TILE, sampled uniformly.
      const keep = Math.min(MAX_TREES_PER_TILE, candidates.length);
      const step = candidates.length / keep;
      const mesh = new THREE.InstancedMesh(this.geometry, this.material, keep);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      const p = new THREE.Vector3();
      const color = new THREE.Color();
      for (let k = 0; k < keep; k++) {
        const i = candidates[Math.floor(k * step)];
        const c = i % T;
        const r = Math.floor(i / T);
        const e = e0 + (c + 0.15 + rand() * 0.7) * cell;
        const n = n0 - (r + 0.15 + rand() * 0.7) * cell;
        const [x, z] = this.proj.toLocal(e, n);
        const y = this.tree.sampleHeight(x, z) ?? 0;
        const h = 8 + rand() * 7;
        p.set(x, y - 0.5, z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
        s.set(h, h, h);
        m.compose(p, q, s);
        mesh.setMatrixAt(k, m);
        color.setHSL(0.27 + rand() * 0.06, 0.45 + rand() * 0.2, 0.32 + rand() * 0.14);
        mesh.setColorAt(k, color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.frustumCulled = true;
      mesh.name = `trees:${t.id}`;
      t.mesh = mesh;
      t.state = "ready";
      if (this.visible.has(t.id)) this.group.add(mesh);
    } catch {
      t.state = "failed";
    } finally {
      this.loading--;
    }
  }

  dispose() {
    this.disposed = true;
    for (const t of this.tiles.values()) {
      t.mesh?.parent?.remove(t.mesh);
      t.mesh?.dispose();
    }
    this.tiles.clear();
    this.geometry.dispose();
    this.material.map?.dispose();
    this.material.dispose();
    this.group.parent?.remove(this.group);
  }
}
