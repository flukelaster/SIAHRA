import * as THREE from "three";
import type {
  AoiManifest,
  RainfallObservation,
  StationExposure,
  WaterLevelObservation,
} from "@siahra/shared-types";
import {
  EXPOSURE_CODE,
  EXPOSURE_HALO,
  exposureRenderClass,
} from "../lib/exposureStyle";
import { createLocalProjection } from "./localProjection";
import {
  computeOverlayField,
  LOWLAND_WINDOW_M,
  suppressLowlandChannel,
  type OverlayFieldData,
  type OverlayGrid,
} from "./overlayField";
import type { OverlayFieldJob, OverlayFieldResult } from "../workers/overlay.worker";

/**
 * Per-cell overlay data sampled by the terrain shader (see terrainMaterial):
 *
 *   R  low-lying ground   — ILLUSTRATIVE. How far a cell sits below the mean
 *                           elevation of its ~3 km neighbourhood, in units of
 *                           the local relief (standard deviation), computed
 *                           from the DEM and restricted to plains (low
 *                           neighbourhood relief). Picks out broad valley
 *                           floors and the lowest ground of a delta. Not a flood
 *                           forecast; it only says "this is the low ground
 *                           water would collect on".
 *   G  observed hazard    — OBSERVED. Halo around stations currently reporting
 *                           heavy rain or high/overflowing water. The radius
 *                           is a display convention, not a modelled extent.
 *   B  inside province    — soft boundary mask (dims neighbours).
 *   A  visibility         — 1 inside, fading to 0 away from the province so
 *                           the rectangular DEM clip dissolves into the sky.
 *
 * Every layer here is either directly observed or a plain topographic
 * derivative; the legend states which is which.
 *
 * ชั้น "ระดับการเผชิญน้ำ (ภาพประกอบ)" (E10.4) **ไม่ได้อยู่ใน RGBA ก้อนนี้** เพราะ
 * สี่แชนแนลถูกใช้ครบแล้ว จึงมี texture ของตัวเองอีกก้อน (`exposureTexture`) บนกริด
 * เดียวกัน:
 *
 *   R  ความแรงของฮาโล  — สูงสุดในบรรดาสถานีที่ครอบเซลล์นั้น
 *   G  รหัสแถบ          — ของสถานีที่ชนะใน R (shader แปลงกลับเป็นสีด้วย ramp เดียวกัน)
 *
 * ตัว shader คูณ R ด้วยแชนแนล R ข้างบน (พื้นที่ลุ่มต่ำ) จึงมีแต่ "ที่ลุ่มต่ำ" เท่านั้น
 * ที่ติดสี — และเมื่อ `terrain.bin` ไม่ผ่านการตรวจลายเซ็น แชนแนลนั้นเป็นศูนย์ ชั้นนี้
 * จึงดับตามไปเองโดยไม่ต้องมีเงื่อนไขซ้ำ
 */

/** Re-exported so callers keep one import for the overlay's tunables. */
export { LOWLAND_WINDOW_M };

/** จำนวนสถานีที่ถูกวาดลงบนภูมิประเทศจริง ๆ แยกตามสิ่งที่ผู้ใช้ต้องอ่านให้ออก */
export interface ExposurePaintResult {
  /** สถานีที่อยู่ในแถบสูงกว่าต่ำสุด และตกอยู่ในกริดของจังหวัด (จึงมีฮาโล) */
  bandedCount: number;
  /** สถานีที่ "ไม่มีปัจจัยใดวัดได้" — ไม่ระบายฮาโล แต่ต้องถูกวาดเป็นหมุดเสมอ */
  noDataCount: number;
}

export interface OverlayField {
  texture: THREE.DataTexture;
  data: Uint8Array;
  width: number;
  height: number;
  /** texture ของชั้น "ระดับการเผชิญน้ำ (ภาพประกอบ)" — R = ความแรง, G = รหัสแถบ */
  exposureTexture: THREE.DataTexture;
  /**
   * สัดส่วนพื้นที่ลุ่มต่ำในจังหวัด — `null` เมื่อชั้นนี้ถูกปิดเพราะ DEM ไม่ผ่าน
   * การตรวจลายเซ็น (ห้ามรายงานเป็น 0 ซึ่งอ่านว่า "ไม่มีพื้นที่ลุ่มต่ำ")
   */
  lowlandShare: number | null;
  /** Rewrites the observed-hazard channel; cheap enough to run per refresh. */
  updateObserved: (
    rainfall: RainfallObservation[],
    waterlevel: WaterLevelObservation[],
  ) => { haloCount: number };
  /**
   * เขียน texture ของชั้นการเผชิญน้ำใหม่ทั้งก้อน — `null`/อาเรย์ว่าง = ล้างเป็นศูนย์
   * (run ถูกทิ้งตอนสลับจังหวัด หรือยังไม่เคยมี run เผยแพร่)
   */
  updateExposure: (stations: readonly StationExposure[] | null) => ExposurePaintResult;
  dispose: () => void;
}

/**
 * ห่อผลลัพธ์ที่คำนวณแล้ว (จาก worker หรือจาก main thread) ให้เป็น texture +
 * ตัวอัปเดตแชนแนล G
 */
function wrapOverlayField(
  manifest: AoiManifest,
  raw: OverlayFieldData,
  options: OverlayFieldOptions,
): OverlayField {
  // ประตูเดียวที่ทั้งเส้นทางซิงโครนัสและเส้นทาง worker ผ่าน — การปิดชั้นลุ่มต่ำ
  // จึงเป็นไปไม่ได้ที่จะทำงานต่างกันระหว่างสองเส้นทาง
  const field = options.suppressLowland ? suppressLowlandChannel(raw) : raw;
  const { width, height, cellSizeM } = manifest.terrain;
  const n = width * height;
  const proj = createLocalProjection(manifest);
  const data = field.data;

  const makeTexture = (bytes: Uint8Array) => {
    const tex = new THREE.DataTexture(bytes, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  };

  const texture = makeTexture(data);
  // texture ของชั้นการเผชิญน้ำเริ่มต้นเป็นศูนย์ทั้งก้อน = ยังไม่มี run ให้วาด
  const exposureData = new Uint8Array(n * 4);
  const exposureTexture = makeTexture(exposureData);

  // --- G: observed hazard halos --------------------------------------------
  /**
   * `codes` (ถ้าส่งมา) เก็บ "รหัสของสถานีที่ชนะ" ที่เซลล์นั้น — ต้องเขียนพร้อมกับ
   * ค่าความแรงในเงื่อนไขเดียวกัน ไม่งั้นสีของแถบจะมาจากสถานีคนละตัวกับความแรง
   */
  const paintHalo = (
    field: Float32Array,
    lon: number,
    lat: number,
    radiusM: number,
    strength: number,
    codes?: Float32Array,
    code = 0,
  ) => {
    const [x, z] = proj.lonLatToLocal(lon, lat);
    if (!proj.insideGrid(x, z)) return false;
    const fc = (x + proj.gridWidthM / 2) / cellSizeM;
    const fr = (z + proj.gridHeightM / 2) / cellSizeM;
    const rad = radiusM / cellSizeM;
    const c0 = Math.max(0, Math.floor(fc - rad));
    const c1 = Math.min(width - 1, Math.ceil(fc + rad));
    const r0 = Math.max(0, Math.floor(fr - rad));
    const r1 = Math.min(height - 1, Math.ceil(fr + rad));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const d = Math.hypot(c - fc, r - fr) / rad;
        if (d > 1) continue;
        // Smooth bump: full at the centre, zero at the rim.
        const w = strength * (1 - d * d) * (1 - d * d);
        const i = r * width + c;
        if (w > field[i]) {
          field[i] = w;
          if (codes) codes[i] = code;
        }
      }
    }
    return true;
  };

  /** คัดลอกฟิลด์ทศนิยม (แถวเรียงจากบนลงล่าง) ลงแชนแนลหนึ่งของ texture (ล่างขึ้นบน) */
  const writeChannel = (target: Uint8Array, field: Float32Array, channel: number) => {
    for (let r = 0; r < height; r++) {
      const texRow = height - 1 - r;
      for (let c = 0; c < width; c++) {
        target[(texRow * width + c) * 4 + channel] = Math.round(
          Math.min(1, Math.max(0, field[r * width + c])) * 255,
        );
      }
    }
  };

  const updateObserved = (rainfall: RainfallObservation[], waterlevel: WaterLevelObservation[]) => {
    const field = new Float32Array(n);
    let haloCount = 0;
    for (const w of waterlevel) {
      const level = w.situationLevel ?? 0;
      if (level < 4) continue;
      const strength = level >= 5 ? 1 : 0.62;
      if (paintHalo(field, w.station.lon, w.station.lat, 4500, strength)) haloCount++;
    }
    for (const rf of rainfall) {
      const mm = rf.rain24h ?? 0;
      if (mm < 35) continue;
      const strength = mm >= 90 ? 0.9 : 0.5;
      if (paintHalo(field, rf.station.lon, rf.station.lat, 6000, strength)) haloCount++;
    }
    writeChannel(data, field, 1);
    texture.needsUpdate = true;
    return { haloCount };
  };

  /**
   * ชั้น "ระดับการเผชิญน้ำ (ภาพประกอบ)" (E10.4)
   *
   * ระบายเฉพาะสถานีที่อยู่ใน `EXPOSURE_DRAPED_LEVELS` (สูงกว่าแถบต่ำสุด) — สถานี
   * แถบต่ำสุดและสถานีที่ไม่มีปัจจัยใดวัดได้ **ไม่ถูกระบาย** แต่ก็ไม่ได้หายไป: ทั้งคู่
   * ถูกวาดเป็นหมุดคนละแบบใน `scene/ExposureMarkers.ts` และ legend เรียกชื่อทั้งสอง
   * สถานะ การเอา "ไม่มีข้อมูล" ไประบายด้วยสีของแถบต่ำสุดคือการกลบสถานะนั้นทิ้ง
   */
  const updateExposure = (stations: readonly StationExposure[] | null) => {
    const strengthField = new Float32Array(n);
    const codeField = new Float32Array(n);
    let bandedCount = 0;
    let noDataCount = 0;
    for (const s of stations ?? []) {
      const cls = exposureRenderClass(s);
      if (cls === "no-data") {
        noDataCount++;
        continue;
      }
      const halo = EXPOSURE_HALO[cls];
      if (halo.strength <= 0) continue;
      const painted = paintHalo(
        strengthField,
        s.lon,
        s.lat,
        halo.radiusM,
        halo.strength,
        codeField,
        EXPOSURE_CODE[cls],
      );
      if (painted) bandedCount++;
    }
    writeChannel(exposureData, strengthField, 0);
    writeChannel(exposureData, codeField, 1);
    exposureTexture.needsUpdate = true;
    return { bandedCount, noDataCount };
  };

  return {
    texture,
    data,
    width,
    height,
    exposureTexture,
    lowlandShare: field.lowlandShare,
    updateObserved,
    updateExposure,
    dispose: () => {
      texture.dispose();
      exposureTexture.dispose();
    },
  };
}

export interface OverlayFieldOptions {
  /**
   * `true` เมื่อ `terrain.bin` ไม่ผ่านการตรวจ sha256 (E9.1) — แชนแนล R
   * (พื้นที่ลุ่มต่ำ) จะถูกล้างเป็นศูนย์ เพราะมันเป็นอนุพันธ์ของ DEM ก้อนที่
   * เชื่อไม่ได้แล้ว ส่วน G (ฮาโลจากค่าตรวจวัดจริง) และ B (มาสก์จังหวัด) ไม่ได้
   * มาจาก DEM จึงเรนเดอร์ต่อ และภาพน้ำท่วมจาก GISTDA เป็น texture คนละก้อน
   * (`scene/floodMask.ts` → `uFloodMask`) จึงไม่ถูกแตะเลย
   */
  suppressLowland?: boolean;
}

/** กริดของ overlay ที่มาจาก manifest — ใช้ร่วมกันทั้งสองเส้นทาง */
function gridOf(manifest: AoiManifest): OverlayGrid {
  const { width, height, cellSizeM } = manifest.terrain;
  return { width, height, cellSizeM };
}

/**
 * เส้นทางแบบซิงโครนัส — ใช้ในเทสต์และเป็น fallback เมื่อ worker ใช้ไม่ได้
 * (เช่น เบราว์เซอร์บล็อก module worker)
 */
export function buildOverlayField(
  manifest: AoiManifest,
  heights: Float32Array,
  insideMask: Uint8Array | null,
  options: OverlayFieldOptions = {},
): OverlayField {
  return wrapOverlayField(
    manifest,
    computeOverlayField(gridOf(manifest), heights, insideMask),
    options,
  );
}

/**
 * เส้นทางปกติ — คำนวณใน Web Worker แล้วค่อยอัปโหลดเป็น texture บน main thread
 *
 * worker เป็นแบบ "ใช้ครั้งเดียว": สร้างตอนเริ่มงาน และ terminate ใน finally
 * เสมอ ไม่ว่าจะสำเร็จ ล้มเหลว หรือถูกยกเลิก — สลับจังหวัดสิบครั้งจึงไม่ทิ้ง
 * worker ค้างไว้แม้แต่ตัวเดียว
 *
 * `heights` ถูกส่งเป็น **สำเนา**: ตัวจริงถูกปิดทับอยู่ใน `TerrainField.sample()`
 * ถ้าโอนบัฟเฟอร์ไป main thread จะเหลืออาร์เรย์ที่ถูก detach และการหาความสูง
 * ทุกจุดจะพัง
 */
export async function buildOverlayFieldAsync(
  manifest: AoiManifest,
  heights: Float32Array,
  insideMask: Uint8Array | null,
  options: OverlayFieldOptions = {},
): Promise<OverlayField> {
  const grid = gridOf(manifest);
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL("../workers/overlay.worker.ts", import.meta.url), {
      type: "module",
    });
    const w = worker;
    const field = await new Promise<OverlayFieldData>((resolve, reject) => {
      w.onmessage = (ev: MessageEvent<OverlayFieldResult>) => {
        if (ev.data.ok) resolve({ data: ev.data.data, lowlandShare: ev.data.lowlandShare });
        else reject(new Error(ev.data.error));
      };
      w.onerror = (ev) => reject(new Error(ev.message || "overlay worker failed"));
      w.onmessageerror = () => reject(new Error("overlay worker sent an uncloneable message"));
      const copy = new Float32Array(heights);
      const job: OverlayFieldJob = { grid, heights: copy, insideMask };
      w.postMessage(job, [copy.buffer]);
    });
    return wrapOverlayField(manifest, field, options);
  } catch (err) {
    // ไม่กลืนความล้มเหลว: บอกให้เห็นว่าตกไปใช้เส้นทางซิงโครนัส แล้วคำนวณต่อ —
    // ชั้นภาพประกอบนี้ต้องมีเสมอ ไม่ใช่หายไปเงียบ ๆ เพราะ worker สร้างไม่ได้
    console.warn("[siahra] overlay worker unavailable, computing on the main thread", err);
    return buildOverlayField(manifest, heights, insideMask, options);
  } finally {
    worker?.terminate();
  }
}
