/**
 * การตัดสินใจของ LOD ล้วน ๆ — ไม่มี three, ไม่มี DOM, ไม่มีสถานะภายนอก
 *
 * แยกออกมาเพราะสองเรื่องนี้ตัดสินใจผิดแล้วเห็นเป็นอาการเดียวกัน (ภาพกระพริบ)
 * แต่ต้นเหตุคนละอย่าง จึงต้องทดสอบแยกได้จริง ไม่ใช่เดาจากภาพ
 */

/**
 * ระยะ "แช่" (dead band) ของการยุบไทล์
 *
 * เดิมใช้เกณฑ์เดียวคือ `d < size × factor` ทั้งขาแตกและขายุบ กล้องที่ค้างอยู่
 * พอดีเส้นแบ่ง (เช่นวงโคจรรอบจังหวัด) จึงสลับ split/merge ทุกเฟรม — ไทล์ถูก
 * สร้างและทิ้งซ้ำ ๆ เห็นเป็นภาพกระพริบและงาน GPU ที่เสียเปล่า
 *
 * แก้ด้วยฮิสเทอรีซิส: แตกที่ `size × factor` แต่จะยุบก็ต่อเมื่อถอยออกไปไกลกว่า
 * `size × factor × 1.25` — ระหว่างสองค่านี้ "สถานะเดิมชนะ"
 */
export const LOD_MERGE_HYSTERESIS = 1.25;

/**
 * ควรแตกไทล์นี้เป็นสี่ลูกหรือไม่
 *
 * @param distance ระยะจากกล้องถึงกล่องของไทล์ (หน่วยเดียวกับ `size`)
 * @param size     ความกว้างของไทล์บนพื้น (เมตร)
 * @param factor   ตัวคูณระยะแตก — ผู้เรียกต้องปรับตาม preset คุณภาพและขนาด
 *                 viewport มาก่อนแล้ว ฟังก์ชันนี้ไม่รู้จักทั้งสองอย่าง
 * @param wasSplit ผลการตัดสินใจของ "เฟรมก่อน" ของไทล์ใบนี้ (ไม่ใช่ผลลัพธ์ว่า
 *                 ลูกโหลดเสร็จหรือยัง — ดูหมายเหตุใน TerrainTiles.collect)
 */
export function shouldSplit(
  distance: number,
  size: number,
  factor: number,
  wasSplit: boolean,
): boolean {
  const splitAt = size * factor;
  return wasSplit ? distance <= splitAt * LOD_MERGE_HYSTERESIS : distance < splitAt;
}

/**
 * เพดานความสูงที่หยุดสตรีมชั้นรายละเอียด (อาคาร/ถนน/แหล่งน้ำ)
 *
 * ที่ความสูงระดับนี้ไทล์รายละเอียดกินแบนด์วิดท์และ GPU โดยที่ผู้ใช้แทบไม่เห็น
 * ความต่าง — เป็นการตัดระดับรายละเอียด (LOD) ไม่ใช่การซ่อนข้อมูล: อาคารและ
 * ถนนเป็นชั้น static-reference ไม่ใช่ค่าที่ตรวจวัด จึงไม่เข้าข่ายกฎ "ข้อมูล
 * เก่าหรือแหล่งที่ตายต้องยังมองเห็น"
 */
export const DETAIL_TILE_ALTITUDE_GATE_M = 25000;

/**
 * กล้องอยู่ต่ำพอที่จะสตรีมชั้นรายละเอียดหรือยัง
 *
 * `cameraY` อยู่ในหน่วยของฉากซึ่งถูกยืดตาม vertical exaggeration ของกลุ่ม
 * `world` แล้ว จึงต้องหารกลับด้วย `worldScaleY` — ไม่อย่างนั้นที่ exaggeration
 * 3× เพดาน 25 กม. จะไปทำงานจริงที่ ~8 กม. และอาคารจะหายตั้งแต่ยังมองเห็นอยู่
 */
export function detailTilesAllowed(
  cameraY: number,
  worldScaleY: number,
  gateM: number = DETAIL_TILE_ALTITUDE_GATE_M,
): boolean {
  return cameraY / Math.max(1e-6, worldScaleY) <= gateM;
}
