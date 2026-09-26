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

/**
 * บัญชีกล้องถนนของมูลนิธิ iTIC (E15.2) — `apps/web/public/cctv/itic-cameras.json`
 * สร้างโดย `npm run build:itic-cctv -w apps/etl` (`apps/etl/src/build-itic-cctv.ts`) จากรายการ
 * กล้องที่ Longdo เผยแพร่ (`https://camera.longdo.com/feed/?command=json`)
 *
 * เป็น **allowlist** เช่นเดียวกับ `CctvCamera`: เก็บเฉพาะ HLS playlist บน
 * `https://camerai1.iticfoundation.org/` ที่ไม่ใช่ `tempsus` (ป้าย "ระงับชั่วคราว") —
 * ห้ามเพิ่มลิงก์ภาพ/MJPEG อื่นของต้นทาง (`imgurl`, `vdourl`, `link` อยู่บน
 * `camera1.iticfoundation.org` ที่วัดแล้ว timeout ทั้งหมด)
 */
export interface ItiCCamera {
  /** `camid` ของต้นทาง (เช่น "DOH-PER-8-012") */
  id: string;
  /** `title` ของต้นทาง (ภาษาไทย, มีทางหลวง/ทิศทาง) — null เมื่อว่าง */
  name: string | null;
  lat: number;
  lon: number;
  /** เจ้าของกล้องตามที่ต้นทางระบุ (เช่น "กรมทางหลวง") — null เมื่อว่าง; แสดงเป็นเครดิตใน popup */
  organization: string | null;
  /** HLS playlist — ขึ้นต้นด้วย `https://camerai1.iticfoundation.org/` เสมอ (ETL กรองไว้) */
  hlsUrl: string;
  /** จังหวัดจาก point-in-polygon ตอน build — null = ไม่ตกในขอบเขตจังหวัดใดที่เรามี */
  provinceCode: string | null;
}

export interface ItiCCatalogue {
  /** เวลาที่สคริปต์ ETL ดึงรายการสำเร็จ (UTC ISO) — `fetchedAt` ของชั้น; ต้นทางไม่มีเวลาเผยแพร่ */
  builtAt: string;
  sourceUrl: string;
  cameras: ItiCCamera[];
}
