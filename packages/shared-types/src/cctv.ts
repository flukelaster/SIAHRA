/**
 * บัญชีกล้อง CCTV ของกรมทรัพยากรน้ำ (DWR, E15) — `apps/web/public/cctv/dwr-cameras.json`
 * สร้างโดย `npm run build:cctv -w apps/etl` (`apps/etl/src/build-cctv.ts`) จาก API
 * สาธารณะ `https://telemetry.dwr.go.th/api`
 *
 * ชนิดนี้เป็น **allowlist**: ต้นทางส่งลิงก์กล้องที่ฝังชื่อผู้ใช้/รหัสผ่านจริงมาด้วย
 * (`cctvSnapshotLink`/`cctvVideoLink`) ฟิลด์เหล่านั้นจึงไม่มีที่อยู่ในชนิดนี้โดยตั้งใจ
 * ห้ามเพิ่มฟิลด์ลิงก์ใด ๆ ของตัวกล้องเข้ามา — ภาพล่าสุดขอผ่าน API ของ DWR ด้วย `id`
 * เท่านั้น (ดู `apps/web/src/lib/cctv.ts`)
 */
export interface CctvCamera {
  /** id ของระเบียน reportCctv ที่ DWR ใช้ขอภาพล่าสุด (`public/reportCctv/snapshot/{id}`) */
  id: string;
  /** รหัสสถานีโทรมาตรของ DWR ที่กล้องติดอยู่ (เช่น "TC020106") */
  stationCode: string;
  nameTh: string | null;
  nameEn: string | null;
  /** WGS84 จาก `public/station/getByCode/{stationCode}` ของ DWR */
  lat: number;
  lon: number;
  /**
   * จังหวัดจาก point-in-polygon กับ `apps/web/public/aoi/{code}/boundary.geojson`
   * ตอน build — null = พิกัดไม่ตกในขอบเขตจังหวัดใดที่เรามี (ไม่เดาจากชื่อจังหวัดของต้นทาง)
   */
  provinceCode: string | null;
  /** ชื่ออำเภอตามที่ DWR ระบุ — null เมื่อต้นทางไม่ได้ให้ไว้ */
  amphoeTh: string | null;
}

export interface CctvCatalogue {
  /** เวลาที่สคริปต์ ETL ดึงรายการจาก DWR สำเร็จ (UTC ISO) — ใช้เป็น `fetchedAt` ของชั้น */
  builtAt: string;
  /** endpoint ที่รายการนี้มาจาก — ให้ตรวจย้อนได้ */
  sourceUrl: string;
  cameras: CctvCamera[];
}
