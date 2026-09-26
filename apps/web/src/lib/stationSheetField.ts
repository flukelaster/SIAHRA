/**
 * ฝั่ง main thread ของแผ่นน้ำจำลองจากระดับน้ำที่สถานี (E16 B-1) — เลือกสถานี, แปลงผลการเติม
 * (`lib/stationSheet.ts` ใน worker) เป็น `FloodField` เพื่อใช้ท่อวาดเดียวกับแผ่นความลึกของ GFM
 * (`encodeFloodFieldRgba` + `createFloodSurface`) และอ่านเซลล์ใต้จุดคลิกสำหรับ popup
 *
 * ไฟล์นี้ **ห้าม import three** (เทสรันใน node) และ import จาก `lib/stationSheet.ts` ได้เฉพาะ
 * ค่าคงที่/ชนิด — ฟังก์ชันเติมน้ำต้องอยู่ในก้อน worker เท่านั้น
 */
import {
  FLOOD_FIELD_NO_DEPTH,
  FLOOD_FIELD_NO_LIKELIHOOD,
  FloodFieldClass,
  type WaterLevelObservation,
} from "@siahra/shared-types";
import type { FloodField } from "../scene/floodField";
import { SHEET_NONE, type SheetStation } from "./stationSheet";
import type { SheetWindow } from "./stationSheetLeaf";

/**
 * ค่าตรวจวัดที่เก่ากว่าเวลาอ้างอิง (เวลาที่เลือกบนเส้นเวลา หรือตอนนี้) เกินนี้ไม่สร้างแผ่น — แผ่นน้ำ
 * "ตอนนี้" จากค่าเมื่อหลายชั่วโมงก่อนคือการอ้างสิ่งที่ไม่ได้วัด (สถานีที่หยุดส่งค่ายังเป็นหมุดหรี่อยู่)
 */
export const SHEET_MAX_READING_AGE_MS = 6 * 3600_000;

export interface SheetInput {
  obs: WaterLevelObservation;
  sheet: SheetStation;
}

/**
 * สถานีที่สร้างแผ่นได้: มีระดับน้ำ + ตลิ่งต่ำสุด (ม.รทก. ทั้งคู่ — `waterlevelMsl` ไม่ใช่
 * `waterlevelLocalM` ที่อยู่บนศูนย์ของเสาวัดเอง), น้ำ **เกินตลิ่ง**, มีเวลาตรวจวัดที่ไม่เก่ากว่า
 * `SHEET_MAX_READING_AGE_MS` จากเวลาอ้างอิง และพิกัดตกในกริด — ที่เหลือไม่ผลิตอะไร
 */
export function selectSheetStations(
  waterlevel: readonly WaterLevelObservation[],
  refMs: number,
  toGrid: (lon: number, lat: number) => [col: number, row: number] | null,
): SheetInput[] {
  const out: SheetInput[] = [];
  for (const obs of waterlevel) {
    const level = obs.waterlevelMsl;
    const bank = obs.minBankMsl;
    if (level === null || bank === null || !Number.isFinite(level) || !Number.isFinite(bank)) continue;
    if (!(level > bank)) continue;
    if (!obs.observedAt) continue;
    const t = Date.parse(obs.observedAt);
    if (!Number.isFinite(t) || Math.abs(refMs - t) > SHEET_MAX_READING_AGE_MS) continue;
    const g = toGrid(obs.station.lon, obs.station.lat);
    if (!g) continue;
    out.push({ obs, sheet: { col: g[0], row: g[1], wseM: level, bankM: bank } });
  }
  return out;
}

/** ผลการเติมที่ main thread ถือไว้ (แถว 0 = เหนือ) */
export interface SheetCells {
  width: number;
  height: number;
  depthCm: Uint16Array;
  station: Uint16Array;
  /** ความจางตามระยะ 0..100 (`sheetFade`) — ไม่มี = ทึบเต็ม */
  fadePct?: Uint8Array;
  /** 1 = ท่วมแต่ไม่ได้ประมาณความลึก (อาคาร/ต้นไม้, เฉพาะหน้าต่าง 30 ม.) */
  notEst?: Uint8Array;
}

/**
 * แปลงเป็น `FloodField` (แถวล่างขึ้นบนแบบ `field.bin`) — เซลล์ที่ถูกเติม = `FLOODED` + ความลึก
 * (หรือ `FLOODED_DEPTH_NOT_ESTIMATED` ตรงอาคาร/ต้นไม้), ที่เหลือ = `NO_OBSERVATION` (ไม่ได้จำลอง
 * ไม่ใช่ "แห้ง") ไม่มีการจำแนกภาพ ช่อง likelihood จึงว่าง — **แผ่นจำลองใช้ช่องนั้นเก็บความจางตามระยะ**
 * (0..100) ให้ shader ของ `FloodSurface` (variant.sheet) คูณความทึบ; ไม่มีใครอ่านมันเป็น likelihood
 * (`floodCellAt`/popup ของ GFM ไม่เคยเห็นฟิลด์นี้)
 */
export function sheetToFloodField(cells: SheetCells): FloodField {
  const { width, height } = cells;
  const n = width * height;
  const cls = new Uint8Array(n).fill(FloodFieldClass.NO_OBSERVATION);
  const depthCm = new Uint16Array(n).fill(FLOOD_FIELD_NO_DEPTH);
  const likelihood = new Uint8Array(n).fill(FLOOD_FIELD_NO_LIKELIHOOD);
  for (let r = 0; r < height; r++) {
    const src = r * width;
    const dst = (height - 1 - r) * width;
    for (let c = 0; c < width; c++) {
      if (cells.station[src + c] === SHEET_NONE) continue;
      if (cells.notEst?.[src + c]) {
        cls[dst + c] = FloodFieldClass.FLOODED_DEPTH_NOT_ESTIMATED;
      } else {
        cls[dst + c] = FloodFieldClass.FLOODED;
        depthCm[dst + c] = cells.depthCm[src + c];
      }
      likelihood[dst + c] = cells.fadePct ? cells.fadePct[src + c] : 100;
    }
  }
  return { width, height, cls, depthCm, likelihood };
}

/** หน้าต่าง 30 ม. → `FloodField` ขนาด (T+1)² (`sheetToFloodField` ตัวเดียวกัน) */
export function windowToFloodField(w: SheetWindow): FloodField {
  return sheetToFloodField({
    width: w.size,
    height: w.size,
    depthCm: w.depthCm,
    station: w.station,
    fadePct: w.fadePct,
    notEst: w.notEst,
  });
}

/** รหัส FloodFieldClass ที่ GFM *สังเกตแล้ว* — ทั้งท่วมและแห้งคือสิ่งที่ดาวเทียมเห็นจริง */
const OBSERVED_CLASSES: ReadonlySet<number> = new Set<number>([
  FloodFieldClass.DRY,
  FloodFieldClass.FLOODED,
  FloodFieldClass.FLOODED_DEPTH_NOT_ESTIMATED,
]);

/**
 * มาสก์ "GFM สังเกตแล้ว" บนกริด overview (แถว 0 = เหนือ) จากฟิลด์ของฉาก (แถวล่างขึ้นบนแบบ
 * `field.bin`) — 1 = DRY / FLOODED / FLOODED_DEPTH_NOT_ESTIMATED; น้ำอ้างอิง (มาสก์น้ำถาวร) และ
 * EXCLUDED (SAR มองไม่เห็น) ไม่ใช่การสังเกตของฉากนี้ จึงเป็น 0 เช่นเดียวกับ NO_OBSERVATION —
 * แผ่นจำลองเติมได้เฉพาะเซลล์ที่ดาวเทียมไม่ได้บอกอะไร (การตัดสินใจของผู้ใช้ข้อ 3)
 */
export function observedMaskFromField(field: { width: number; height: number; cls: Uint8Array }): Uint8Array {
  const { width, height, cls } = field;
  const out = new Uint8Array(width * height);
  for (let r = 0; r < height; r++) {
    const src = (height - 1 - r) * width;
    const dst = r * width;
    for (let c = 0; c < width; c++) if (OBSERVED_CLASSES.has(cls[src + c])) out[dst + c] = 1;
  }
  return out;
}

export interface SheetGridGeometry {
  width: number;
  height: number;
  cellSizeM: number;
  gridWidthM: number;
  gridHeightM: number;
}

/**
 * เซลล์ใต้จุด `(localX, localZ)` ของฉาก — ใช้เซลล์ **ใกล้ที่สุด** (vertex ของแผ่นอยู่ที่
 * `x = c·cell − W/2` ตรงกับ `buildTerrainMesh`/`createFloodSurface`) `null` = นอกกริด/ไม่ถูกเติม
 */
export function sheetCellAt(
  cells: SheetCells,
  grid: SheetGridGeometry,
  localX: number,
  localZ: number,
): { depthCm: number; stationIdx: number } | null {
  if (cells.width !== grid.width || cells.height !== grid.height) return null;
  const col = Math.round((localX + grid.gridWidthM / 2) / grid.cellSizeM);
  const row = Math.round((localZ + grid.gridHeightM / 2) / grid.cellSizeM);
  if (col < 0 || col >= grid.width || row < 0 || row >= grid.height) return null;
  const i = row * grid.width + col;
  const s = cells.station[i];
  if (s === SHEET_NONE) return null;
  return { depthCm: cells.depthCm[i], stationIdx: s };
}
