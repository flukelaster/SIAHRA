import * as THREE from "three";
import type { RadarFramesResponse, RadarGeoreference } from "@siahra/shared-types";
import { radarDecodeSize, selectRadarFrames, type SelectedRadarFrame } from "../lib/radarProjection";
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
 *
 * Each frame names its projection (`web-mercator` 1800×2644 or legacy
 * `equirectangular` 1173×1668), so bounds and the shader's Mercator flag are
 * set per frame in `apply()`. Frames are decoded through `createImageBitmap`
 * resized to at most the legacy pixel count (`radarDecodeSize`): 8 frames at
 * 1154×1695 RGBA ≈ 63 MB instead of ≈ 152 MB at full size. Both the bitmap path
 * and the `TextureLoader` fallback upload with `flipY = false`, so v = 0 is the
 * image's top row on either path (the shader counts rows from the top).
 */
export class RadarOverlay {
  private textures = new Map<string, THREE.Texture>();
  private frames: SelectedRadarFrame[] = [];
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
    // georeference ต่อเฟรม (ทนต่อ payload ของ API รุ่นก่อน — ดู selectRadarFrames)
    const frames = selectRadarFrames(data, MAX_FRAMES);
    this.frames = frames;
    const keep = new Set(frames.map((f) => f.url));
    for (const [url, tex] of this.textures) {
      if (!keep.has(url)) {
        disposeFrameTexture(tex);
        this.textures.delete(url);
      }
    }
    for (const f of frames) {
      if (this.textures.has(f.url)) continue;
      const tex = new THREE.Texture();
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.flipY = false;
      this.textures.set(f.url, tex);
      void this.loadInto(tex, f.url, f.geo);
    }
    this.index = Math.max(0, frames.length - 1);
    this.apply();
  }

  /** ภาพที่ decode เสร็จหลัง URL ถูกทิ้งไปแล้ว ต้องไม่ถูกใส่ลงเทกซ์เจอร์ที่ dispose แล้ว */
  private isCurrent(url: string, tex: THREE.Texture): boolean {
    return this.textures.get(url) === tex;
  }

  private async loadInto(tex: THREE.Texture, url: string, geo: RadarGeoreference): Promise<void> {
    try {
      if (typeof createImageBitmap !== "function") throw new Error("createImageBitmap unavailable");
      const res = await fetch(url);
      if (!res.ok) throw new Error(`radar frame ${res.status}`);
      const blob = await res.blob();
      const size = radarDecodeSize(geo.widthPx, geo.heightPx);
      const bitmap = await createImageBitmap(blob, {
        resizeWidth: size.width,
        resizeHeight: size.height,
        resizeQuality: "medium",
        premultiplyAlpha: "none",
        colorSpaceConversion: "none",
      });
      if (!this.isCurrent(url, tex)) {
        bitmap.close();
        return;
      }
      tex.image = bitmap;
      tex.needsUpdate = true;
    } catch {
      // เบราว์เซอร์ที่ไม่รองรับการย่อใน createImageBitmap (หรือ decode ไม่ผ่าน) —
      // กลับไปเส้นทางเดิม: ภาพเต็มขนาดผ่าน TextureLoader
      if (!this.isCurrent(url, tex)) return;
      this.loader.load(url, (img) => {
        if (!this.isCurrent(url, tex)) return;
        tex.image = img;
        tex.needsUpdate = true;
      });
    }
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
    const geo = f.geo;
    this.shared.uRadarBounds.value.set(geo.bounds.minLon, geo.bounds.minLat, geo.bounds.maxLon, geo.bounds.maxLat);
    this.shared.uRadarMercator.value = geo.projection === "web-mercator" ? 1 : 0;
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
    for (const t of this.textures.values()) disposeFrameTexture(t);
    this.textures.clear();
    this.shared.uRadar.value = null;
    this.shared.uShowRadar.value = 0;
  }
}

/** dispose เทกซ์เจอร์ และปิด ImageBitmap ที่ถืออยู่ (dispose ของ three ไม่ปิดให้) */
function disposeFrameTexture(tex: THREE.Texture): void {
  const image: unknown = tex.image;
  tex.dispose();
  if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) image.close();
}
