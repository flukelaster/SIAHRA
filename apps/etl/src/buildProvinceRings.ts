/**
 * สร้าง `apps/api/src/data/provinceRings.json` — ชุดวงขอบเขต 77 จังหวัดที่ย่อแล้ว
 * สำหรับให้ `EarthquakeFeedDO` คิดระยะจากจุดศูนย์กลางแผ่นดินไหวถึงขอบเขตจังหวัด
 * (Worker อ่านไฟล์ใน apps/web/public ตอนรันไม่ได้ จึงต้อง bake เข้า bundle)
 *
 *   npm run build:province-rings -w apps/etl
 */
import { writeProvinceRings } from "./provinceBoundaries.js";

const bytes = writeProvinceRings();
const BUDGET_BYTES = 400 * 1024;
if (bytes > BUDGET_BYTES) {
  console.error(`[rings] over budget: ${(bytes / 1024).toFixed(1)} KB > 400 KB`);
  process.exit(1);
}
