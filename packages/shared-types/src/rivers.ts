import type { HazardLayerDescriptor } from "./hazard-layer.js";
import type { WaterLevelObservation } from "./observations.js";

/**
 * เส้นทางน้ำเหนือ (E16) — ปิง(+วัง) และน่าน(+ยม) ไหลมาบรรจบที่นครสวรรค์ แล้วเป็น
 * เจ้าพระยาลงไปถึงกรุงเทพฯ
 *
 * สองก้อนในไฟล์นี้:
 * - `NorthRouteTopology` = ไฟล์คงที่ `apps/web/public/rivers/north-route.json` ที่
 *   `npm run build:north-route -w apps/etl` สร้าง (static-reference: ลำดับสถานีมาจาก
 *   `apps/etl/src/northRoute.source.json` พร้อมลิงก์อ้างอิง, พิกัด/รหัสสถานีจาก ThaiWater,
 *   เส้นลำน้ำจาก OpenStreetMap) — ไม่มีตัวเลขตรวจวัดใดอยู่ในไฟล์นี้
 * - `NorthRouteResponse` = `GET /api/v1/rivers/north` ค่าตรวจวัดล่าสุด + 48 ชม. ย้อนหลัง
 *   ของสถานีบนเส้นทาง (observed) — **ไม่มีเวลาที่น้ำจะมาถึง ไม่มีค่าล่วงหน้าใด ๆ**
 */

export type NorthReachId = "ping" | "wang" | "yom" | "nan" | "chao-phraya";

export interface NorthRouteReach {
  id: NorthReachId;
  nameTh: string;
  nameEn: string;
  /** ลำน้ำที่ reach นี้ไหลลงไปบรรจบ — null = ปลายทาง (เจ้าพระยา) */
  joinsReachId: NorthReachId | null;
  /** ระยะ (กม.) บน reach ปลายทางที่จุดบรรจบตกอยู่ — null เมื่อ `joinsReachId` เป็น null */
  joinsAtKm: number | null;
  /** ความยาวของเส้น (กม.) ตามเส้นที่ลดรูปแล้ว */
  lengthKm: number;
  /** [lon, lat] เรียงจากต้นน้ำไปท้ายน้ำ ลดรูปราว 200 ม. (OSM `waterway=river`) */
  polyline: [number, number][];
  /**
   * ช่วงที่ OSM ไม่มีเส้นลำน้ำชื่อนี้ต่อกัน (เช่นผ่านอ่างเก็บน้ำ) และถูกเชื่อมด้วยเส้นตรง
   * — บอกไว้ตรง ๆ ไม่ใช่ซ่อน (กม. นับจากต้นเส้น)
   */
  gaps: { fromKm: number; toKm: number }[];
  /** จังหวัดที่เส้นของ reach นี้ผ่าน (point-in-polygon กับ boundary.geojson ของแต่ละจังหวัด) */
  upstreamProvinceCodes: string[];
  /** แหล่งอ้างอิงของลำดับสถานี/การบรรจบ (จาก northRoute.source.json) */
  citations: string[];
}

export interface NorthRouteStation {
  /** รหัส RID เช่น "C.2" — กุญแจเชื่อมกับ `StationRef.ridCode` */
  ridCode: string;
  /** `station.id` ของ ThaiWater — ใช้ขอประวัติ/ค่าล่าสุด */
  thaiwaterId: number;
  reachId: NorthReachId;
  /** ระยะตามลำน้ำจากต้นเส้นของ reach (กม.) — จากการฉายพิกัดสถานีลงบนเส้น OSM */
  chainageKm: number;
  /** ระยะตั้งฉากจากเส้นลำน้ำ (กม.) ตอนฉาย — ใช้ตรวจว่าสถานีอยู่บนลำน้ำนี้จริง */
  offsetKm: number;
  lat: number;
  lon: number;
  /** จังหวัดจาก point-in-polygon — null = ไม่ตกในขอบเขตใด (ไม่เดา) */
  provinceCode: string | null;
  nameTh: string | null;
}

export interface NorthRouteDam {
  /** ชื่อตามที่ระบุใน northRoute.source.json */
  nameTh: string;
  /** id ของเขื่อนใน `/api/v1/dams` (ThaiWater analyst/dam) ที่ตรงกับชื่อนี้ ณ ตอน build */
  damIds: number[];
  reachId: NorthReachId;
  chainageKm: number;
  /** เขื่อนบนลำน้ำสาขา (เช่นแควน้อย) อยู่ห่างเส้นหลักได้ — แสดงเป็นโหนดข้างเส้น */
  offsetKm: number;
  lat: number;
  lon: number;
}

export interface NorthRouteTopology {
  /** เวลาที่สคริปต์ ETL ดึง ThaiWater สำเร็จและเขียนไฟล์ (UTC ISO) = `fetchedAt` ของชั้นนี้ */
  builtAt: string;
  /**
   * เวลาของชุดข้อมูล OSM ที่ใช้ลากเส้น (`osmosis_replication_timestamp` ในหัวไฟล์ PBF)
   * — null = ไฟล์ไม่ได้บอกไว้ (ห้ามแทนด้วย builtAt)
   */
  osmExtractAt: string | null;
  layer: HazardLayerDescriptor;
  reaches: NorthRouteReach[];
  /** เรียงตาม reach แล้วตาม chainage (ต้นน้ำ → ท้ายน้ำ) */
  stations: NorthRouteStation[];
  dams: NorthRouteDam[];
}

/** หนึ่งจุดของ 48 ชม. ย้อนหลัง — ค่าตามที่ต้นทางส่ง (ดู `datum` ของสถานี) */
export interface NorthRouteHistoryPoint {
  /** ISO-8601 UTC */
  t: string;
  value: number | null;
  /** ลบ.ม./วินาที */
  discharge: number | null;
}

export interface NorthRouteStationState {
  ridCode: string;
  thaiwaterId: number;
  reachId: NorthReachId;
  /** ค่าล่าสุดจากตาราง waterlevel — null = ThaiWater ไม่มีสถานีนี้ในฟีดที่เราเก็บไว้ */
  latest: WaterLevelObservation | null;
  /** อ้างอิงของ `history48h[].value`: ม.รทก. / ระดับอ้างอิงสถานี / ไม่ทราบ */
  datum: "msl" | "local" | "unknown";
  /** ≤ 48 ชม. ล่าสุด เรียงตามเวลา — ว่าง = ยังไม่เคยดึงประวัติของสถานีนี้ */
  history48h: NorthRouteHistoryPoint[];
  /** เวลาที่ดึงประวัติสถานีนี้สำเร็จล่าสุด — null = ยังไม่เคย (ห้ามแสดงเป็น "ตอนนี้") */
  historyFetchedAt: string | null;
}

export interface NorthRouteResponse {
  /** descriptor ของค่าตรวจวัด (observed, ThaiWater) */
  layer: HazardLayerDescriptor;
  /** เวลาที่ดึง ThaiWater (waterlevel_load) สำเร็จล่าสุด — null = ยังไม่เคย */
  fetchedAt: string | null;
  /** ความยาวหน้าต่างประวัติ (ชม.) — 48 เสมอ */
  windowHours: number;
  stations: NorthRouteStationState[];
}
