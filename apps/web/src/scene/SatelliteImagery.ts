import * as THREE from "three";
import { SOURCES, type AoiManifest, type SourceId } from "@siahra/shared-types";
import { createLocalProjection } from "./localProjection";
import { lonLatToTile } from "./projection";

/**
 * Basemap imagery provider. XYZ tiles are fetched in the browser, stitched
 * onto one canvas in Web Mercator pixel space, and draped over the terrain
 * with a per-vertex Mercator UV set (see TerrainMesh) — so no imagery has to
 * be baked by the ETL pipeline and any XYZ source with CORS works.
 *
 * Attribution is mandatory for every provider listed here and is surfaced in
 * the map's attribution badge.
 */
export interface ImageryProvider {
  id: string;
  /** Registry entry this provider is credited as (join key into SOURCES). */
  sourceId: SourceId;
  nameTh: string;
  attribution: string;
  maxZoom: number;
  tileSize: number;
  url: (z: number, x: number, y: number) => string;
}

export const IMAGERY_PROVIDERS: Record<string, ImageryProvider> = {
  esri: {
    id: "esri",
    sourceId: "esri-world-imagery",
    nameTh: SOURCES["esri-world-imagery"].nameTh,
    attribution: SOURCES["esri-world-imagery"].attributionText,
    maxZoom: 18,
    tileSize: 256,
    url: (z, x, y) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  },
  s2cloudless: {
    id: "s2cloudless",
    sourceId: "eox-s2cloudless",
    nameTh: SOURCES["eox-s2cloudless"].nameTh,
    attribution: SOURCES["eox-s2cloudless"].attributionText,
    maxZoom: 14,
    tileSize: 256,
    url: (z, x, y) =>
      `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/${z}/${y}/${x}.jpg`,
  },
};

export const DEFAULT_IMAGERY_PROVIDER = IMAGERY_PROVIDERS.esri;

/** Hard ceilings so a large province never allocates a texture the GPU rejects. */
const MAX_TILES = 320;
const MAX_PIXELS = 20_000_000;
const MIN_ZOOM = 9;
const CONCURRENCY = 8;
const RETRIES = 2;

export interface ImageryPlan {
  provider: ImageryProvider;
  zoom: number;
  minTileX: number;
  minTileY: number;
  tilesX: number;
  tilesY: number;
  widthPx: number;
  heightPx: number;
  /** Fractional tile coordinates of the stitched canvas origin (top-left). */
  originTileX: number;
  originTileY: number;
}

/**
 * Picks the finest zoom whose tile set covering the heightfield footprint
 * still fits the texture/tile budgets, and returns the tile range.
 */
export interface LonLatBounds {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

/** Tile range covering `bounds` at a fixed zoom (used per terrain tile). */
export function planImageryForBounds(
  bounds: LonLatBounds,
  zoom: number,
  provider: ImageryProvider = DEFAULT_IMAGERY_PROVIDER,
): ImageryPlan {
  const z = Math.max(1, Math.min(provider.maxZoom, zoom));
  const [x0, y0] = lonLatToTile(bounds.minLon, bounds.maxLat, z);
  const [x1, y1] = lonLatToTile(bounds.maxLon, bounds.minLat, z);
  const minTileX = Math.floor(x0);
  const minTileY = Math.floor(y0);
  const tilesX = Math.floor(x1) - minTileX + 1;
  const tilesY = Math.floor(y1) - minTileY + 1;
  return {
    provider,
    zoom: z,
    minTileX,
    minTileY,
    tilesX,
    tilesY,
    widthPx: tilesX * provider.tileSize,
    heightPx: tilesY * provider.tileSize,
    originTileX: minTileX,
    originTileY: minTileY,
  };
}

/** Lon/lat hull of the (UTM-aligned, so slightly rotated) heightfield footprint. */
export function manifestLonLatBounds(manifest: AoiManifest): LonLatBounds {
  const proj = createLocalProjection(manifest);
  const hw = proj.rasterWidthM / 2;
  const hh = proj.rasterHeightM / 2;
  const corners = [
    proj.localToLonLat(-hw, -hh),
    proj.localToLonLat(hw, -hh),
    proj.localToLonLat(-hw, hh),
    proj.localToLonLat(hw, hh),
  ];
  return {
    minLon: Math.min(...corners.map((c) => c[0])),
    maxLon: Math.max(...corners.map((c) => c[0])),
    minLat: Math.min(...corners.map((c) => c[1])),
    maxLat: Math.max(...corners.map((c) => c[1])),
  };
}

export function planImagery(
  manifest: AoiManifest,
  maxTextureSize: number,
  provider: ImageryProvider = DEFAULT_IMAGERY_PROVIDER,
): ImageryPlan {
  const bounds = manifestLonLatBounds(manifest);
  const dimCap = Math.min(maxTextureSize, 8192);
  let best: ImageryPlan | null = null;
  for (let zoom = MIN_ZOOM; zoom <= provider.maxZoom; zoom++) {
    const plan = planImageryForBounds(bounds, zoom, provider);
    const { widthPx, heightPx, tilesX, tilesY } = plan;
    const fits =
      widthPx <= dimCap &&
      heightPx <= dimCap &&
      widthPx * heightPx <= MAX_PIXELS &&
      tilesX * tilesY <= MAX_TILES;
    if (fits) best = plan;
    else if (best) break;
    else if (zoom === MIN_ZOOM) best = plan; // never leave a province with no imagery
  }
  return best!;
}

/** Lon/lat -> UV into the stitched canvas (v = 1 at the top row, matching flipY). */
export function imageryUv(plan: ImageryPlan, lon: number, lat: number): [number, number] {
  const [tx, ty] = lonLatToTile(lon, lat, plan.zoom);
  const u = ((tx - plan.originTileX) * plan.provider.tileSize) / plan.widthPx;
  const v = 1 - ((ty - plan.originTileY) * plan.provider.tileSize) / plan.heightPx;
  return [u, v];
}

export interface ImageryResult {
  texture: THREE.CanvasTexture;
  loadedTiles: number;
  totalTiles: number;
}

/** Stitched canvases are large; keep only the last couple of provinces. */
const canvasCache = new Map<string, HTMLCanvasElement>();
const CACHE_LIMIT = 2;

function loadTile(url: string, signal?: AbortSignal): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    const done = (ok: boolean) => {
      img.onload = null;
      img.onerror = null;
      resolve(ok ? img : null);
    };
    img.onload = () => done(true);
    img.onerror = () => done(false);
    signal?.addEventListener("abort", () => done(false), { once: true });
    img.src = url;
  });
}

/**
 * Fetches every tile of the plan and paints it into one canvas texture.
 * Missing tiles are left dark rather than failing the whole layer.
 */
export async function loadImagery(
  plan: ImageryPlan,
  cacheKey: string | null,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
  concurrency = CONCURRENCY,
): Promise<ImageryResult> {
  const total = plan.tilesX * plan.tilesY;
  const { provider } = plan;

  let canvas = cacheKey ? canvasCache.get(cacheKey) : undefined;
  let loaded = total;
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = plan.widthPx;
    canvas.height = plan.heightPx;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#0b1526";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const jobs: { x: number; y: number }[] = [];
    for (let ty = 0; ty < plan.tilesY; ty++)
      for (let tx = 0; tx < plan.tilesX; tx++) jobs.push({ x: tx, y: ty });

    loaded = 0;
    let done = 0;
    let next = 0;
    const worker = async () => {
      while (next < jobs.length) {
        if (signal?.aborted) return;
        const job = jobs[next++];
        const url = provider.url(plan.zoom, plan.minTileX + job.x, plan.minTileY + job.y);
        let img: HTMLImageElement | null = null;
        for (let attempt = 0; attempt <= RETRIES && !img; attempt++) {
          if (signal?.aborted) return;
          if (attempt > 0) await new Promise((r) => setTimeout(r, 300 * attempt));
          img = await loadTile(url, signal);
        }
        if (!img) console.warn(`[imagery] tile failed after ${RETRIES + 1} attempts: ${url}`);
        if (img) {
          ctx.drawImage(img, job.x * provider.tileSize, job.y * provider.tileSize);
          loaded++;
        }
        done++;
        onProgress?.(done, total);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
    if (signal?.aborted) throw new DOMException("imagery load aborted", "AbortError");

    if (loaded > 0 && cacheKey) {
      canvasCache.set(cacheKey, canvas);
      if (canvasCache.size > CACHE_LIMIT) {
        const oldest = canvasCache.keys().next().value;
        if (oldest !== undefined) canvasCache.delete(oldest);
      }
    }
  } else {
    onProgress?.(total, total);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.channel = 1;
  texture.needsUpdate = true;
  return { texture, loadedTiles: loaded, totalTiles: total };
}
