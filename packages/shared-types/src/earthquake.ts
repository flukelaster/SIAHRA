import type { HazardLayerDescriptor } from "./hazard-layer.js";

/**
 * จังหวัดที่อยู่ใกล้จุดศูนย์กลางแผ่นดินไหว — ระยะทางจาก "รูปหลายเหลี่ยม" ของเขต
 * จังหวัด ไม่ใช่ระยะถึงจุดศูนย์กลางเชิงเรขาคณิตของจังหวัด: จังหวัดที่ยาวเรียว
 * (ตาก แม่ฮ่องสอน ประจวบฯ) มีศูนย์กลางห่างจากขอบเขตตัวเองเป็นร้อยกิโลเมตร การจัด
 * อันดับด้วยศูนย์กลางจึงรายงานจุดที่ *อยู่ในจังหวัดแล้ว* ว่าห่างหลายสิบกิโลเมตร
 *
 * นี่คือ "ระยะทางเชิงเรขาคณิต" ล้วน ๆ ไม่ใช่แบบจำลองความสั่นสะเทือนหรือความเสียหาย
 * — ระยะใกล้ไม่ได้แปลว่าจะรู้สึกได้ และห้ามตีความเป็นการพยากรณ์ใด ๆ
 */
export interface NearestProvince {
  /** รหัสจังหวัดตาม `PROVINCE_CODES` (`./provinces.js`) */
  provinceCode: string;
  nameTh: string;
  nameEn: string;
  /** ระยะถึงขอบเขตจังหวัด (กม.) — **0 เมื่อจุดอยู่ในเขตจังหวัดนั้น** */
  distanceKm: number;
  /** จุดศูนย์กลางอยู่ในเขตจังหวัดนี้หรือไม่ */
  inside: boolean;
}

export interface EarthquakeEvent {
  id: string;
  clusterId: string;
  sources: Array<"usgs" | "emsc" | "tmd">;
  mag: number | null;
  magType: string | null;
  place: string | null;
  lat: number;
  lon: number;
  depthKm: number | null;
  time: string;
  updated: string;
  status: "automatic" | "reviewed" | "deleted";
  tsunami: boolean;
  url: string | null;
  /**
   * สามจังหวัดที่ใกล้ที่สุด เรียงตามระยะถึง *ขอบเขตจังหวัด* (0 = อยู่ในเขต)
   * คำนวณครั้งเดียวตอน ingest แล้วเก็บไว้กับระเบียน — `undefined` คือระเบียนที่
   * บันทึกไว้ก่อนฟีเจอร์นี้และยังไม่ถูก backfill ห้ามเรนเดอร์เป็น "ไม่มีจังหวัดใกล้"
   */
  nearest?: NearestProvince[];
}

/**
 * คาบ heartbeat ของสาย `/api/v1/earthquakes/live` — **ประกาศไว้ที่เดียว** ในสัญญากลาง
 * เพราะฝั่ง DO กับ watchdog ฝั่งเว็บต้องตรงกัน "โดยโครงสร้าง" ไม่ใช่ค่าคงที่สองตัว
 * ที่บังเอิญเท่ากัน (แก้ที่เซิร์ฟเวอร์อย่างเดียวแล้วเว็บปิดสายที่ยังดีอยู่)
 *
 * เซิร์ฟเวอร์ยิงทุก ≤ 30 วินาที **เมื่อมีไคลเอนต์ต่ออยู่** โดยไม่ผูกกับคาบ poll (60 วิ)
 */
export const WS_HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * ยอมให้ heartbeat หายได้กี่รอบก่อนถือว่าสายตาย — 2.5 รอบ คือหายสองรอบเต็ม ๆ
 * บวกเศษเวลาเดินของ alarm (DO alarm ไม่ได้ตรงเป๊ะระดับมิลลิวินาที)
 */
export const WS_HEARTBEAT_MISS_TOLERANCE = 2.5;

/**
 * ไม่ได้รับเฟรมใด ๆ นานเกินค่านี้ = สายตาย แม้ `readyState` จะยัง OPEN
 * (สาย WS ที่ถูก proxy ตัดกลางทางมักไม่ยิง close event เลย)
 */
export const WS_HEARTBEAT_WATCHDOG_MS = WS_HEARTBEAT_INTERVAL_MS * WS_HEARTBEAT_MISS_TOLERANCE;

/**
 * คาบเดิมก่อน E6.1 (heartbeat เกาะไปกับรอบ poll 60 วิ) — **ยังต้องมี** เพราะสอง
 * Worker ขึ้นแยกกัน: เว็บรุ่นใหม่ที่ไปเจอ api รุ่นเก่าจะได้ heartbeat แค่นาทีละครั้ง
 * ถ้าใช้ watchdog 75 วิ ตั้งแต่แรก มันจะปิดสายที่ยัง **ดีอยู่** แล้ววนสร้างสาย
 * ใหม่ชนเพดาน rate limit ของ `/api/v1/earthquakes/live` (10 ครั้ง/5 นาที)
 *
 * ไคลเอนต์จึงเริ่มที่ค่าหลวมนี้ แล้วรัดลงเมื่อเห็น heartbeat ที่มี `serverTime`
 * (ฟิลด์นั้นคือ "ลายเซ็น" ว่าฝั่งเซิร์ฟเวอร์เป็นรุ่น E6.1 แล้ว)
 * ลบทั้งคู่ได้หนึ่งรีลีสหลัง E6.1 ขึ้น production ครบทั้งสอง Worker
 */
export const WS_HEARTBEAT_LEGACY_INTERVAL_MS = 60_000;
export const WS_HEARTBEAT_LEGACY_WATCHDOG_MS =
  WS_HEARTBEAT_LEGACY_INTERVAL_MS * WS_HEARTBEAT_MISS_TOLERANCE;

export type EqWsMessage =
  // `layer` is emitted by the server today but stays OPTIONAL for one release
  // so a client shipped before E3.1 keeps parsing snapshots.
  /**
   * `asOf` = เวลาที่ poll สำเร็จล่าสุด ความหมายเดียวกับ `heartbeat.asOf` เป๊ะ ๆ —
   * ห้ามเป็นเวลาที่ประกอบ response เพราะสองเฟรมนี้วิ่งบน socket เดียวกัน ถ้าคนละ
   * ความหมายเวลาบนการ์ดจะกระโดดถอยหลังตอน heartbeat แรกมาถึง
   *
   * `null` = DO ยังไม่เคย poll สำเร็จเลย (เย็นอยู่) ห้ามเรนเดอร์เป็นเวลา
   */
  | { type: "snapshot"; asOf: string | null; events: EarthquakeEvent[]; layer?: HazardLayerDescriptor }
  | { type: "event.created"; event: EarthquakeEvent }
  | { type: "event.updated"; event: EarthquakeEvent }
  | { type: "event.deleted"; id: string }
  | {
      type: "heartbeat";
      /**
       * @deprecated เท่ากับ `serverTime` เสมอ เก็บไว้อีกหนึ่งรีลีสเพื่อให้เว็บที่
       * deploy ไปก่อน E6.1 ยังอ่านได้ (สอง Worker ขึ้นแยกกัน) — อย่าใช้เป็น "เวลาของข้อมูล"
       */
      ts: string;
      /**
       * นาฬิกาของเซิร์ฟเวอร์ตอนยิงเฟรมนี้ — ใช้พิสูจน์ว่าสายยังมีชีวิต **เท่านั้น**
       * ห้ามเอาไปแสดงเป็นอายุข้อมูล (heartbeat เต้นต่อไปแม้ poll จะล้มทุกครั้ง)
       *
       * OPTIONAL หนึ่งรีลีสด้วยเหตุผลเดียวกับ `layer`: เว็บรุ่นใหม่อาจเจอ api รุ่นเก่า
       */
      serverTime?: string;
      /**
       * เวลาที่ poll รอบล่าสุด "จบ" — คืออายุจริงของชุดข้อมูลที่ heartbeat นี้ยืนยัน
       * `null` = ยังไม่เคย poll เลย (ห้ามเรนเดอร์เป็นเวลาใด ๆ) และเมื่อฟิลด์นี้หายไป
       * (api รุ่นเก่า) ฝั่งเว็บต้องคง `asOf` เดิมไว้ ไม่ใช่ถอยไปใช้ `serverTime`
       */
      asOf?: string | null;
    };

/** Envelope of GET /api/v1/earthquakes/recent. */
export interface EarthquakeRecentResponse {
  /**
   * เวลาของรอบ poll ล่าสุดที่สำเร็จ — ความหมายเดียวกับ `asOf` ของ WS snapshot/heartbeat
   * `null` = DO ยังไม่เคย poll สำเร็จเลย ห้ามเรนเดอร์เป็นเวลาใด ๆ และห้ามแทนด้วยเวลาที่
   * ประกอบ response นี้ (ไม่งั้นเหตุการณ์เดิมที่ต้นทางเงียบมาหลายชั่วโมงจะดูเหมือน
   * เพิ่งอัปเดตทุกครั้งที่ REST fallback poll)
   */
  asOf: string | null;
  layer: HazardLayerDescriptor;
  events: EarthquakeEvent[];
}
