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

/**
 * พยากรณ์ปริมาณน้ำท่า/ระดับน้ำจากไฟล์ผลลัพธ์แบบจำลอง FEWS ของ สสน. (HII) — `GET /api/v1/rivers/forecast`
 *
 * เป็นค่า **เชิงกำหนด** ของแบบจำลองบุคคลที่สาม (`forecast`) ที่ผู้เผยแพร่ไม่ได้ระบุชื่อแบบจำลอง —
 * ไม่มีความน่าจะเป็น ไม่มีเวลาน้ำมาถึง และไม่มีตัวเลขที่เราคำนวณเอง (เกณฑ์เตือนส่งต่อตามที่เผยแพร่)
 *
 * **ข้อควรระวังสำคัญ**: `series` เริ่มก่อน `publishedAt` ราว 7 วัน (ไฟล์ต้นทางเป็นหน้าต่างเลื่อน
 * ราว now−7d ถึง now+7d) จุดก่อน `publishedAt` คือค่าที่แบบจำลองให้ไว้สำหรับชั่วโมงที่ผ่านไปแล้ว
 * **ไม่ใช่การพยากรณ์** และผู้ใช้ห้ามนำเสนอเป็นการพยากรณ์ เวลาในไฟล์ต้นทางเป็นเวลาไทย (+07:00)
 * และถูกแปลงเป็น epoch ms (UTC) แล้ว ค่าที่ไม่มีคือ null ไม่ใช่ 0 (ชุดข้อมูลไม่มีจุดค่าว่างเลย —
 * แถวที่อ่านไม่ออกถูกข้ามและบอกไว้ใน `lastError`)
 */
export type RiverForecastKind = "discharge" | "waterlevel";

/** เกณฑ์ตามที่ HII เผยแพร่ (metadata CSV) — ช่องว่าง/ไม่ใช่ตัวเลข = null ไม่ใช่ 0 */
export interface RiverForecastThresholds {
  alarm: number | null;
  warning: number | null;
  critical: number | null;
}

export interface RiverForecastStation {
  /** รหัสสถานีบนเส้นทางน้ำเหนือ (มีจุด เช่น "C.2") — สถานีระดับน้ำนนทบุรีไม่มีรหัสเส้นทาง จึงใช้รหัส HII */
  code: string;
  /** รหัสของ HII (ไม่มีจุด เช่น "C2", "CPY014") */
  hiiCode: string;
  kind: RiverForecastKind;
  /** ลบ.ม./วินาที สำหรับ discharge, เมตร สำหรับ waterlevel (เกณฑ์ใช้หน่วยเดียวกัน) */
  unit: "m3/s" | "m";
  /** ชื่อสถานีตามที่เผยแพร่ — null = ยังไม่เคยได้ metadata */
  nameTh: string | null;
  /** จังหวัดตามข้อความที่เผยแพร่ (เช่น "จ.นครสวรรค์") — null = ยังไม่เคยได้ metadata */
  province: string | null;
  /** null = ไม่มีแถวของสถานีนี้ใน metadata (ยังไม่เคยได้/ไม่พบ) */
  thresholds: RiverForecastThresholds | null;
  /** `[epoch ms UTC, ค่า]` รายชั่วโมงตามต้นทาง ไม่ลดจำนวนจุด — รวมชั่วโมงก่อน `publishedAt` (ดูด้านบน) */
  series: [number, number][];
  /** `Last-Modified` ของไฟล์สถานีนี้ — null = ต้นทางไม่ส่ง (ห้ามแทนด้วย fetchedAt) */
  publishedAt: string | null;
  /** เวลาที่เรายืนยันไฟล์นี้กับต้นทางสำเร็จล่าสุด (รวม 304) — null = ยังไม่เคย */
  fetchedAt: string | null;
  /** เหตุที่รอบล่าสุดของไฟล์นี้ไม่สมบูรณ์ — ชุดค่าเดิมยังอยู่พร้อม fetchedAt เก่าของมัน */
  lastError: string | null;
}

export interface RiverForecastResponse {
  /**
   * `forecast`, sourceIds `["hii-fews"]` — `fetchedAt` = รอบล่าสุดที่มีไฟล์สำเร็จอย่างน้อยหนึ่งไฟล์
   * (ความสดรายไฟล์อยู่ที่ `stations[].fetchedAt`), `publishedAt` = `Last-Modified` ที่เก่าที่สุดของไฟล์ที่ถืออยู่,
   * `forecast.issuedAt` เป็น null เสมอ (ต้นทางไม่บอกรอบรัน), `horizonHours` = จุดสุดท้ายลบ `publishedAt`
   */
  layer: HazardLayerDescriptor;
  stations: RiverForecastStation[];
  /** สถานะรอบดึงของต้นทางเดียวนี้ — `lastSuccessAt` null = ยังไม่เคยสำเร็จเลย */
  source: {
    id: "hii-fews";
    lastSuccessAt: string | null;
    lastAttemptAt: string | null;
    lastError: string | null;
  };
  /** metadata (เกณฑ์/ชื่อ) ดึงวันละครั้ง — ล้มเหลวไม่ทำให้รอบพยากรณ์ล้ม จึงรายงานแยกตรงนี้ */
  thresholdsFetchedAt: string | null;
  thresholdsLastError: string | null;
}
