import * as THREE from "three";
import type { AoiManifest, SourceId, TerrainTileLevel, TerrainTilePyramid } from "@siahra/shared-types";
import type { LocalProjection } from "./localProjection";
import {
  DEFAULT_IMAGERY_PROVIDER,
  imageryUv,
  loadImagery,
  planImageryForBounds,
  type ImageryPlan,
  type ImageryProvider,
} from "./SatelliteImagery";
import { createTerrainMaterial, type TerrainSharedUniforms } from "./terrainMaterial";

/**
 * Distance-based quadtree LOD over the native-resolution terrain pyramid
 * (see TerrainTilePyramid). Each tile is its own mesh with its own satellite
 * imagery texture; hazard overlay / boundary mask / hillshade stay
 * province-wide and are sampled through the shared uniforms.
 *
 * Selection is top-down per frame (throttled): a tile is split while the
 * camera is closer than SPLIT_FACTOR × its ground size; a tile is drawn only
 * if it *and its imagery* are ready, otherwise its nearest ready ancestor
 * covers it (no holes, no flashes). Tiles are cached with LRU eviction.
 */

const SPLIT_FACTOR = 2.3;
const MAX_CACHED_TILES = 320;
/**
 * Levels below the pyramid's leaf: same 30 m heights (sliced from the leaf
 * tile already in memory) but a quarter of the footprint and one imagery
 * zoom finer per level — so zooming in keeps sharpening the photo long after
 * the DEM has run out of detail.
 */
const VIRTUAL_LEVELS = 3;
const MAX_TERRAIN_LOADS = 6;
/** Imagery px per terrain cell to aim for when choosing the tile zoom. */
const IMAGERY_PX_PER_CELL = 3;
const IMAGERY_TIMEOUT_MS = 12000;
const UPDATE_INTERVAL_MS = 120;
const NODATA_FALLBACK_Y = 0;

interface TileKey {
  z: number;
  x: number;
  y: number;
}

type TileState = "idle" | "loading" | "ready" | "empty" | "failed";

interface LevelInfo {
  z: number;
  cellSizeM: number;
  /** Cells per tile edge at this level (tileSize, halved per virtual level). */
  cells: number;
  tilesX: number;
  tilesY: number;
  /** Levels beyond the on-disk leaf reuse the leaf's heights. */
  virtualDepth: number;
}

interface Tile extends TileKey {
  id: string;
  level: LevelInfo;
  /** Bordered height samples — kept for leaf tiles so virtual children can slice them. */
  heights: Int16Array | null;
  /** Ground extent in scene metres (x/z), before vertical exaggeration. */
  box: THREE.Box3;
  sizeM: number;
  state: TileState;
  mesh: THREE.Mesh | null;
  material: ReturnType<typeof createTerrainMaterial> | null;
  imagery: THREE.Texture | null;
  lastUsed: number;
  abort: AbortController | null;
}

function keyOf(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`;
}

function decodePresent(level: TerrainTileLevel): Uint8Array {
  const bin = atob(level.present);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface TerrainTileTreeOptions {
  manifest: AoiManifest;
  projection: LocalProjection;
  shared: TerrainSharedUniforms;
  provider?: ImageryProvider;
  /** Vertical range for culling boxes (world units before exaggeration). */
  minZ: number;
  maxZ: number;
}

export interface TerrainTileStats {
  visible: number;
  cached: number;
  loading: number;
  pending: number;
}

export class TerrainTileTree {
  readonly group = new THREE.Group();
  private readonly pyramid: TerrainTilePyramid;
  private readonly proj: LocalProjection;
  private readonly shared: TerrainSharedUniforms;
  private readonly provider: ImageryProvider;
  private readonly present: Uint8Array[];
  private readonly levels: LevelInfo[];
  private readonly leafZ: number;
  private readonly tiles = new Map<string, Tile>();
  private readonly minZ: number;
  private readonly maxZ: number;
  private readonly midLat: number;
  private visibleSet = new Set<string>();
  private wanted: { tile: Tile; priority: number }[] = [];
  private loadingCount = 0;
  private lastUpdate = 0;
  private imageryEnabled = true;
  private disposed = false;
  private splitFactor = SPLIT_FACTOR;
  private imageryZoomOffset = 0;
  private readonly frustum = new THREE.Frustum();
  private readonly projScreen = new THREE.Matrix4();
  private readonly camWorld = new THREE.Vector3();
  private readonly tmpBox = new THREE.Box3();
  private readonly tmpMat = new THREE.Matrix4();
  onStats?: (stats: TerrainTileStats) => void;

  constructor(opts: TerrainTileTreeOptions) {
    const tiles = opts.manifest.terrain.tiles;
    if (!tiles) throw new Error("manifest has no terrain tile pyramid");
    this.pyramid = tiles;
    this.proj = opts.projection;
    this.shared = opts.shared;
    this.provider = opts.provider ?? DEFAULT_IMAGERY_PROVIDER;
    this.present = tiles.levels.map(decodePresent);
    this.leafZ = tiles.levels.length - 1;
    this.levels = tiles.levels.map((l) => ({
      z: l.z,
      cellSizeM: l.cellSizeM,
      cells: tiles.tileSize,
      tilesX: l.tilesX,
      tilesY: l.tilesY,
      virtualDepth: 0,
    }));
    const leaf = tiles.levels[this.leafZ];
    for (let v = 1; v <= VIRTUAL_LEVELS; v++) {
      const cells = tiles.tileSize >> v;
      if (cells < 8) break;
      this.levels.push({
        z: this.leafZ + v,
        cellSizeM: leaf.cellSizeM,
        cells,
        tilesX: leaf.tilesX << v,
        tilesY: leaf.tilesY << v,
        virtualDepth: v,
      });
    }
    this.minZ = opts.minZ;
    this.maxZ = opts.maxZ;
    this.midLat = (opts.manifest.bbox.minLat + opts.manifest.bbox.maxLat) / 2;
    this.group.name = "terrain-tiles";
  }

  get attribution(): string {
    return this.provider.attribution;
  }

  get imagerySourceId(): SourceId {
    return this.provider.sourceId;
  }

  private exists(z: number, x: number, y: number): boolean {
    const info = this.levels[z];
    if (!info || x < 0 || y < 0 || x >= info.tilesX || y >= info.tilesY) return false;
    if (info.virtualDepth > 0) {
      // Virtual tiles exist wherever their leaf ancestor does; emptiness of the
      // sub-area is discovered when slicing (state "empty").
      return this.exists(this.leafZ, x >> info.virtualDepth, y >> info.virtualDepth);
    }
    const level = this.pyramid.levels[z];
    const idx = y * level.tilesX + x;
    return (this.present[z][idx >> 3] & (1 << (idx & 7))) !== 0;
  }

  private tile(z: number, x: number, y: number): Tile {
    const id = keyOf(z, x, y);
    let t = this.tiles.get(id);
    if (t) return t;
    const level = this.levels[z];
    const sizeM = level.cellSizeM * level.cells;
    // Tile ground footprint in scene metres (cell centres, hence the ±0.5).
    const e0 = this.pyramid.originEasting + x * sizeM;
    const n0 = this.pyramid.originNorthing - y * sizeM;
    const [x0, z0] = this.proj.toLocal(e0, n0);
    const [x1, z1] = this.proj.toLocal(e0 + sizeM, n0 - sizeM);
    const box = new THREE.Box3(
      new THREE.Vector3(Math.min(x0, x1), this.minZ, Math.min(z0, z1)),
      new THREE.Vector3(Math.max(x0, x1), this.maxZ, Math.max(z0, z1)),
    );
    t = {
      id,
      z,
      x,
      y,
      level,
      heights: null,
      box,
      sizeM,
      state: "idle",
      mesh: null,
      material: null,
      imagery: null,
      lastUsed: 0,
      abort: null,
    };
    this.tiles.set(id, t);
    return t;
  }

  /** Call every frame; work is throttled internally. */
  update(camera: THREE.PerspectiveCamera, worldScaleY: number, viewportHeightPx: number) {
    if (this.disposed) return;
    const now = performance.now();
    if (now - this.lastUpdate < UPDATE_INTERVAL_MS) return;
    this.lastUpdate = now;

    camera.updateMatrixWorld();
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreen);
    this.camWorld.setFromMatrixPosition(camera.matrixWorld);
    // Group is inside the exaggerated world: undo the y-scale for tests.
    this.tmpMat.makeScale(1, worldScaleY, 1);
    // Larger viewports can afford finer tiles at the same angular size.
    const splitFactor = this.splitFactor * Math.max(0.75, Math.min(1.5, viewportHeightPx / 900));

    this.wanted = [];
    const render: Tile[] = [];
    const root = this.levels[0];
    for (let y = 0; y < root.tilesY; y++) {
      for (let x = 0; x < root.tilesX; x++) {
        if (!this.exists(0, x, y)) continue;
        const covered = this.collect(this.tile(0, x, y), splitFactor, now);
        if (covered) render.push(...covered);
      }
    }

    // Commit visibility.
    const nextVisible = new Set<string>();
    for (const t of render) {
      nextVisible.add(t.id);
      if (t.mesh && !t.mesh.parent) this.group.add(t.mesh);
    }
    for (const id of this.visibleSet) {
      if (!nextVisible.has(id)) {
        const t = this.tiles.get(id);
        if (t?.mesh?.parent) this.group.remove(t.mesh);
      }
    }
    this.visibleSet = nextVisible;

    this.pumpLoads();
    this.evict(now);
    this.onStats?.({
      visible: this.visibleSet.size,
      cached: this.tiles.size,
      loading: this.loadingCount,
      pending: this.wanted.length,
    });
  }

  /**
   * Returns the tiles that cover this tile's footprint, or null when nothing
   * ready can cover it (caller then falls back to its own mesh).
   */
  private collect(tile: Tile, splitFactor: number, now: number): Tile[] | null {
    this.tmpBox.copy(tile.box).applyMatrix4(this.tmpMat);
    if (!this.frustum.intersectsBox(this.tmpBox)) return [];

    if (tile.state === "idle" || tile.state === "failed") {
      const d = this.tmpBox.distanceToPoint(this.camWorld);
      this.wanted.push({ tile, priority: d / tile.sizeM });
      return null;
    }
    if (tile.state === "loading") return null;
    if (tile.state === "empty") return [];

    tile.lastUsed = now;
    const distance = this.tmpBox.distanceToPoint(this.camWorld);
    const canSplit = tile.z + 1 < this.levels.length;
    if (canSplit && distance < tile.sizeM * splitFactor) {
      const parts: Tile[] = [];
      let complete = true;
      for (let j = 0; j < 2; j++) {
        for (let i = 0; i < 2; i++) {
          const cx = tile.x * 2 + i;
          const cy = tile.y * 2 + j;
          if (!this.exists(tile.z + 1, cx, cy)) continue;
          const covered = this.collect(this.tile(tile.z + 1, cx, cy), splitFactor, now);
          if (covered === null) complete = false;
          else parts.push(...covered);
        }
      }
      if (complete) return parts;
    }
    return [tile];
  }

  private pumpLoads() {
    if (this.loadingCount >= MAX_TERRAIN_LOADS) return;
    this.wanted.sort((a, b) => a.priority - b.priority);
    for (const { tile } of this.wanted) {
      if (this.loadingCount >= MAX_TERRAIN_LOADS) break;
      if (tile.state !== "idle" && tile.state !== "failed") continue;
      void this.load(tile);
    }
  }

  /** Slices a virtual tile's bordered samples out of its leaf ancestor. */
  private sliceFromLeaf(tile: Tile): { heights: Int16Array; span: number } | null {
    const v = tile.level.virtualDepth;
    const leaf = this.tiles.get(keyOf(this.leafZ, tile.x >> v, tile.y >> v));
    if (!leaf?.heights) return null;
    const B = this.pyramid.border;
    const leafSpan = this.pyramid.tileSize + 1 + 2 * B;
    const cells = tile.level.cells;
    const ox = (tile.x & ((1 << v) - 1)) * cells;
    const oy = (tile.y & ((1 << v) - 1)) * cells;
    const span = cells + 1 + 2 * B;
    const out = new Int16Array(span * span);
    for (let j = 0; j < span; j++) {
      const lj = oy + j; // leaf row index in bordered coords (border already offset)
      for (let i = 0; i < span; i++) {
        out[j * span + i] = leaf.heights[lj * leafSpan + (ox + i)];
      }
    }
    return { heights: out, span };
  }

  private async load(tile: Tile) {
    tile.state = "loading";
    tile.abort = new AbortController();
    this.loadingCount++;
    try {
      let heights: Int16Array;
      let span: number;
      if (tile.level.virtualDepth > 0) {
        const sliced = this.sliceFromLeaf(tile);
        if (!sliced) {
          tile.state = "idle"; // leaf not resident (evicted) — retry later
          return;
        }
        heights = sliced.heights;
        span = sliced.span;
      } else {
        const url = this.pyramid.urlTemplate
          .replace("{z}", String(tile.z))
          .replace("{x}", String(tile.x))
          .replace("{y}", String(tile.y));
        const res = await fetch(url, { signal: tile.abort.signal });
        if (!res.ok) throw new Error(`tile ${tile.id}: HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        span = this.pyramid.tileSize + 1 + this.pyramid.border * 2;
        if (buf.byteLength !== span * span * 2) {
          // A static host answered with something else (SPA shell) — treat as absent.
          tile.state = "empty";
          return;
        }
        heights = new Int16Array(buf);
        if (tile.z === this.leafZ) tile.heights = heights;
      }
      if (this.disposed) return;
      const built = this.buildGeometry(tile, heights, span);
      if (!built) {
        tile.state = "empty";
        return;
      }
      const { geometry, plan } = built;
      const material = createTerrainMaterial(this.shared);
      const mesh = new THREE.Mesh(geometry, material.material);
      mesh.name = `terrain-tile:${tile.id}`;
      mesh.receiveShadow = true;
      mesh.frustumCulled = true;
      tile.mesh = mesh;
      tile.material = material;

      // Imagery: wait (bounded) so the tile appears fully textured.
      try {
        const result = await Promise.race([
          loadImagery(plan, null, undefined, tile.abort.signal, 4),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), IMAGERY_TIMEOUT_MS)),
        ]);
        if (result && !this.disposed) {
          tile.imagery = result.texture;
          if (this.imageryEnabled) material.setImagery(result.texture);
        }
      } catch {
        /* imagery is optional; the elevation ramp shows instead */
      }
      if (this.disposed) {
        this.disposeTile(tile);
        return;
      }
      tile.state = "ready";
      tile.lastUsed = performance.now();
    } catch (err) {
      if ((err as Error)?.name === "AbortError") tile.state = "idle";
      else tile.state = "failed";
    } finally {
      tile.abort = null;
      this.loadingCount--;
    }
  }

  private buildGeometry(
    tile: Tile,
    heights: Int16Array,
    span: number,
  ): { geometry: THREE.BufferGeometry; plan: ImageryPlan } | null {
    const T = tile.level.cells;
    const B = this.pyramid.border;
    const nodata = this.pyramid.nodata;
    const cell = tile.level.cellSizeM;
    const n = T + 1;
    const vertexCount = n * n + 4 * n; // grid + skirt ring
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const uv1s = new Float32Array(vertexCount * 2);
    const colors = new Float32Array(vertexCount * 3);
    const valid = new Uint8Array(n * n);

    const at = (i: number, j: number) => heights[(j + B) * span + (i + B)];
    const e0 = this.pyramid.originEasting + tile.x * T * cell;
    const n0 = this.pyramid.originNorthing - tile.y * T * cell;
    const { gridWidthM, gridHeightM } = this.proj;

    // Imagery plan for this tile's lon/lat hull.
    const corners = [
      this.proj.toLocal(e0, n0),
      this.proj.toLocal(e0 + T * cell, n0),
      this.proj.toLocal(e0, n0 - T * cell),
      this.proj.toLocal(e0 + T * cell, n0 - T * cell),
    ].map(([x, z]) => this.proj.localToLonLat(x, z));
    const bounds = {
      minLon: Math.min(...corners.map((c) => c[0])),
      maxLon: Math.max(...corners.map((c) => c[0])),
      minLat: Math.min(...corners.map((c) => c[1])),
      maxLat: Math.max(...corners.map((c) => c[1])),
    };
    const mpp = cell / IMAGERY_PX_PER_CELL;
    const zoom =
      Math.round(Math.log2((156543.03392 * Math.cos((this.midLat * Math.PI) / 180)) / mpp)) + this.imageryZoomOffset;
    const plan = planImageryForBounds(bounds, zoom, this.provider);

    // Elevation ramp fallback (same as the overview).
    const lowColor = new THREE.Color(0x3f5d3a);
    const midColor = new THREE.Color(0x5c6b3a);
    const highColor = new THREE.Color(0x8a7d5e);
    const scratch = new THREE.Color();
    const zSpan = Math.max(1, this.maxZ - this.minZ);

    let anyValid = false;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const v = j * n + i;
        const h = at(i, j);
        const ok = h !== nodata;
        valid[v] = ok ? 1 : 0;
        if (ok) anyValid = true;
        const easting = e0 + (i + 0.5) * cell;
        const northing = n0 - (j + 0.5) * cell;
        const [x, z] = this.proj.toLocal(easting, northing);
        positions[v * 3] = x;
        positions[v * 3 + 1] = ok ? h : NODATA_FALLBACK_Y;
        positions[v * 3 + 2] = z;

        // Central differences over the bordered grid (falls back to self at nodata).
        const hl = at(i - 1, j);
        const hr = at(i + 1, j);
        const hu = at(i, j - 1);
        const hd = at(i, j + 1);
        const dx = ((hr === nodata ? h : hr) - (hl === nodata ? h : hl)) / (2 * cell);
        const dz = ((hd === nodata ? h : hd) - (hu === nodata ? h : hu)) / (2 * cell);
        // Surface y = f(x, z): normal ∝ (-df/dx, 1, -df/dz).
        const len = Math.hypot(dx, 1, dz);
        normals[v * 3] = -dx / len;
        normals[v * 3 + 1] = 1 / len;
        normals[v * 3 + 2] = -dz / len;

        uvs[v * 2] = (x + gridWidthM / 2) / gridWidthM;
        uvs[v * 2 + 1] = 1 - (z + gridHeightM / 2) / gridHeightM;
        const [lon, lat] = this.proj.localToLonLat(x, z);
        const [u1, v1] = imageryUv(plan, lon, lat);
        uv1s[v * 2] = u1;
        uv1s[v * 2 + 1] = v1;

        const t = THREE.MathUtils.clamp(((ok ? h : this.minZ) - this.minZ) / zSpan, 0, 1);
        if (t < 0.5) scratch.copy(lowColor).lerp(midColor, t / 0.5);
        else scratch.copy(midColor).lerp(highColor, (t - 0.5) / 0.5);
        colors[v * 3] = scratch.r;
        colors[v * 3 + 1] = scratch.g;
        colors[v * 3 + 2] = scratch.b;
      }
    }
    if (!anyValid) return null;

    // Skirt ring: copies of the edge vertices dropped straight down, so LOD
    // seams between neighbouring levels never show daylight.
    const skirtDrop = Math.max(25, cell * 3);
    const edgeIndex = (k: number) => {
      // Perimeter order: top row (j=0, i=0..T), right col (i=T, j=0..T),
      // bottom row (j=T), left col (i=0).
      if (k < n) return k; // top
      if (k < 2 * n) return (k - n) * n + T; // right
      if (k < 3 * n) return T * n + (k - 2 * n); // bottom
      return (k - 3 * n) * n; // left
    };
    for (let k = 0; k < 4 * n; k++) {
      const src = edgeIndex(k);
      const v = n * n + k;
      positions[v * 3] = positions[src * 3];
      positions[v * 3 + 1] = positions[src * 3 + 1] - skirtDrop;
      positions[v * 3 + 2] = positions[src * 3 + 2];
      normals[v * 3] = normals[src * 3];
      normals[v * 3 + 1] = normals[src * 3 + 1];
      normals[v * 3 + 2] = normals[src * 3 + 2];
      uvs[v * 2] = uvs[src * 2];
      uvs[v * 2 + 1] = uvs[src * 2 + 1];
      uv1s[v * 2] = uv1s[src * 2];
      uv1s[v * 2 + 1] = uv1s[src * 2 + 1];
      colors[v * 3] = colors[src * 3];
      colors[v * 3 + 1] = colors[src * 3 + 1];
      colors[v * 3 + 2] = colors[src * 3 + 2];
    }

    const indices: number[] = [];
    for (let j = 0; j < T; j++) {
      for (let i = 0; i < T; i++) {
        const a = j * n + i;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        if (!(valid[a] && valid[b] && valid[c] && valid[d])) continue;
        indices.push(a, c, b, b, c, d);
      }
    }
    // Skirt quads along each perimeter edge segment (both endpoints valid).
    for (let side = 0; side < 4; side++) {
      for (let k = 0; k < T; k++) {
        const k0 = side * n + k;
        const k1 = side * n + k + 1;
        const g0 = edgeIndex(k0);
        const g1 = edgeIndex(k1);
        if (!(valid[g0] && valid[g1])) continue;
        const s0 = n * n + k0;
        const s1 = n * n + k1;
        // Wind so the skirt faces outward for each side (perimeter is clockwise
        // when viewed from above for top→right→bottom→left with +z south).
        indices.push(g0, s0, g1, g1, s0, s1);
      }
    }
    if (indices.length === 0) return null;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setAttribute("uv1", new THREE.BufferAttribute(uv1s, 2));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return { geometry, plan };
  }

  private evict(now: number) {
    if (this.tiles.size <= MAX_CACHED_TILES) return;
    // Never drop a visible tile or any ancestor of one (virtual tiles slice
    // their heights from the resident leaf, and ancestors are the fallback).
    const protectedIds = new Set<string>();
    for (const id of this.visibleSet) {
      const t = this.tiles.get(id);
      if (!t) continue;
      let { z, x, y } = t;
      while (z >= 0) {
        protectedIds.add(keyOf(z, x, y));
        z--;
        x >>= 1;
        y >>= 1;
      }
    }
    const candidates = [...this.tiles.values()]
      .filter((t) => t.state === "ready" && !protectedIds.has(t.id) && t.z > 0)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    let excess = this.tiles.size - MAX_CACHED_TILES;
    for (const t of candidates) {
      if (excess <= 0) break;
      if (now - t.lastUsed < 2000) break;
      this.disposeTile(t);
      this.tiles.delete(t.id);
      excess--;
    }
  }

  private disposeTile(t: Tile) {
    if (t.mesh?.parent) t.mesh.parent.remove(t.mesh);
    t.mesh?.geometry.dispose();
    t.material?.material.dispose();
    t.imagery?.dispose();
    t.mesh = null;
    t.material = null;
    t.imagery = null;
    t.heights = null;
    t.abort?.abort();
    t.state = "idle";
  }

  /** Quality preset: LOD split distance factor and imagery zoom bias (new tiles only). */
  setQuality(splitFactor: number, imageryZoomOffset: number) {
    this.splitFactor = splitFactor;
    this.imageryZoomOffset = imageryZoomOffset;
  }

  setImageryEnabled(enabled: boolean) {
    this.imageryEnabled = enabled;
    for (const t of this.tiles.values()) {
      if (!t.material) continue;
      const desired = enabled ? t.imagery : null;
      if (t.material.material.map !== desired) t.material.setImagery(desired);
    }
  }

  /** Leaf level index of the on-disk pyramid (virtual levels sit above it). */
  get leafLevel(): number {
    return this.leafZ;
  }

  /**
   * Tiles currently drawn, as pyramid keys. Virtual (imagery-only) tiles are
   * reported as their leaf ancestor so dependants can key on real levels.
   */
  visibleTileKeys(): { z: number; x: number; y: number }[] {
    const out = new Map<string, { z: number; x: number; y: number }>();
    for (const id of this.visibleSet) {
      const t = this.tiles.get(id);
      if (!t) continue;
      const v = t.level.virtualDepth;
      const key = v > 0 ? { z: this.leafZ, x: t.x >> v, y: t.y >> v } : { z: t.z, x: t.x, y: t.y };
      out.set(keyOf(key.z, key.x, key.y), key);
    }
    return [...out.values()];
  }

  /**
   * Height at a scene point from the finest ready tile that contains it —
   * used for draping things built after tiles have streamed in.
   */
  sampleHeight(x: number, z: number): number | null {
    let best: Tile | null = null;
    for (const t of this.tiles.values()) {
      if (t.state !== "ready" || !t.mesh) continue;
      if (x < t.box.min.x || x > t.box.max.x || z < t.box.min.z || z > t.box.max.z) continue;
      if (!best || t.z > best.z) best = t;
    }
    if (!best?.mesh) return null;
    const pos = best.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const n = best.level.cells + 1;
    const cell = best.level.cellSizeM;
    const fx = (x - best.box.min.x) / cell - 0.5;
    const fz = (z - best.box.min.z) / cell - 0.5;
    const i = THREE.MathUtils.clamp(Math.round(fx), 0, n - 1);
    const j = THREE.MathUtils.clamp(Math.round(fz), 0, n - 1);
    return pos.getY(j * n + i);
  }

  dispose() {
    this.disposed = true;
    for (const t of this.tiles.values()) this.disposeTile(t);
    this.tiles.clear();
    this.visibleSet.clear();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
