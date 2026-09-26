import type { NorthReachId } from "@siahra/shared-types";
import raw from "./northRouteStations.json";

/**
 * สถานีบนเส้นทางน้ำเหนือ (E16) ที่ถูก bake เข้า bundle ของ Worker — สร้างใหม่ด้วย
 * `npm run build:north-route -w apps/etl` (อ่าน apps/etl/src/build-north-route.README.md)
 * ไฟล์ JSON นี้เขียนพร้อม `apps/web/public/rivers/north-route.json` ในรอบเดียวกันเสมอ
 * และเก็บแค่ id — เส้นลำน้ำไม่ถูกลากเข้า bundle
 *
 * ใช้สองที่เท่านั้น: `GET /api/v1/rivers/north` (อ่านด้วย PK ทีละสถานี) และ
 * `pullRouteHistory()` รายชั่วโมงของ ObservationCacheDO (วนเฉพาะรายการนี้)
 */
export interface NorthRouteStationRef {
  readonly ridCode: string;
  readonly thaiwaterId: number;
  readonly reachId: NorthReachId;
}

const data = raw as unknown as { builtAt: string; stations: NorthRouteStationRef[] };

export const NORTH_ROUTE_BUILT_AT: string = data.builtAt;
export const NORTH_ROUTE_STATIONS: readonly NorthRouteStationRef[] = data.stations;
