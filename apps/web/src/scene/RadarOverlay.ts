import * as THREE from "three";
import type { RadarFramesResponse } from "@siahra/shared-types";
import type { LocalProjection } from "./localProjection";
import type { TerrainSharedUniforms } from "./terrainMaterial";

const MAX_FRAMES = 8;
const FRAME_MS = 750;
const HOLD_LAST_MS = 1800;

/**
 * Drapes TMD radar composite frames over the terrain through the shared
 * terrain shader (uRadar + a raster-uv -> lon/lat -> radar-uv mapping), and
 * animates the last frames. When the timeline is scrubbed to a past time,
 * the frame nearest that time is shown instead of the loop.
 */
export class RadarOverlay {
  private textures = new Map<string, THREE.Texture>();
  private frames: { t: string; tMs: number; url: string }[] = [];
  private index = 0;
  private lastSwitch = 0;
  private atMs: number | null = null;
  private enabled = true;
  private loader = new THREE.TextureLoader();
  onFrame?: (t: string | null) => void;
  private readonly shared: TerrainSharedUniforms;

  constructor(shared: TerrainSharedUniforms, projection: LocalProjection) {
    this.shared = shared;
    // Corner lon/lat of the province raster for the shader's uv -> lon/lat map.
    const hw = projection.rasterWidthM / 2;
    const hh = projection.rasterHeightM / 2;
    // uv (0,0) = SW, (1,0) = SE, (0,1) = NW, (1,1) = NE  (v=1 is north).
    const corners = [
      projection.localToLonLat(-hw, hh),
      projection.localToLonLat(hw, hh),
      projection.localToLonLat(-hw, -hh),
      projection.localToLonLat(hw, -hh),
    ];
    for (let i = 0; i < 4; i++) shared.uRadarLL.value[i].set(corners[i][0], corners[i][1]);
  }

  setFrames(data: RadarFramesResponse | null) {
    if (!data) return;
    this.shared.uRadarBounds.value.set(data.bounds.minLon, data.bounds.minLat, data.bounds.maxLon, data.bounds.maxLat);
    const frames = data.frames.slice(-MAX_FRAMES).map((f) => ({ ...f, tMs: Date.parse(f.t) }));
    this.frames = frames;
    const keep = new Set(frames.map((f) => f.url));
    for (const [url, tex] of this.textures) {
      if (!keep.has(url)) {
        tex.dispose();
        this.textures.delete(url);
      }
    }
    for (const f of frames) {
      if (this.textures.has(f.url)) continue;
      const tex = this.loader.load(f.url);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      this.textures.set(f.url, tex);
    }
    this.index = Math.max(0, frames.length - 1);
    this.apply();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.shared.uShowRadar.value = on && this.frames.length > 0 ? 1 : 0;
    if (!on) this.onFrame?.(null);
    else this.apply();
  }

  /** null = live loop; otherwise pin to the frame nearest this time. */
  setAt(atIso: string | null) {
    this.atMs = atIso ? Date.parse(atIso) : null;
    if (this.atMs !== null && this.frames.length) {
      let best = 0;
      for (let i = 1; i < this.frames.length; i++) {
        if (Math.abs(this.frames[i].tMs - this.atMs) < Math.abs(this.frames[best].tMs - this.atMs)) best = i;
      }
      this.index = best;
      this.apply();
    }
  }

  private apply() {
    const f = this.frames[this.index];
    if (!f) {
      this.shared.uShowRadar.value = 0;
      this.onFrame?.(null);
      return;
    }
    const tex = this.textures.get(f.url) ?? null;
    this.shared.uRadar.value = tex;
    this.shared.uShowRadar.value = this.enabled && tex ? 1 : 0;
    // Past-time frames older than 40 min from the requested time are not "that time".
    if (this.atMs !== null && Math.abs(f.tMs - this.atMs) > 40 * 60 * 1000) {
      this.shared.uShowRadar.value = 0;
      this.onFrame?.(null);
      return;
    }
    this.onFrame?.(f.t);
  }

  tick(nowMs: number) {
    if (!this.enabled || this.atMs !== null || this.frames.length < 2) return;
    const last = this.index === this.frames.length - 1;
    if (nowMs - this.lastSwitch < (last ? HOLD_LAST_MS : FRAME_MS)) return;
    this.lastSwitch = nowMs;
    this.index = (this.index + 1) % this.frames.length;
    this.apply();
  }

  dispose() {
    for (const t of this.textures.values()) t.dispose();
    this.textures.clear();
    this.shared.uRadar.value = null;
    this.shared.uShowRadar.value = 0;
  }
}
