import type { FloodSceneIndexEntry } from "@siahra/shared-types";

/**
 * ส่วนที่ "คิด" ของ UI เวลาของฉาก Copernicus GFM (E14.F5) — ไม่มี React ไม่มี fetch
 * จึงเทสได้ตรง ๆ ใน `environment: "node"` เหมือน `floodScenes.ts`
 *
 * สามอย่างที่อยู่ที่นี่:
 *   - `sceneAtIso`     — เวลาที่ต้องตั้ง `atIso` เพื่อให้ `pickFloodScene` เลือกฉากนั้น **พอดี**
 *   - `groupFloodEvents` — จัดฉากที่ท่วมเป็น "เหตุการณ์" ตามช่องว่างระหว่างรอบบิน
 *   - `gapParts`       — ระยะห่างจากภาพล่าสุดถึงเวลาที่เลือก สำหรับป้าย "ภาพล่าสุดก่อนเวลาที่เลือก"
 */

/** ช่วง 10 นาทีที่ TimelineBar และ `snapAtIso` (useFloodExtent) ปัด `atIso` ลง */
export const AT_ISO_SNAP_MS = 10 * 60 * 1000;

/**
 * `atIso` ที่ต้องเลือกเพื่อให้ `pickFloodScene` หยิบฉากนี้ตรง ๆ: `observedAt` ปัด
 * **ขึ้น** เป็นขอบ 10 นาทีถัดไป
 *
 * ทำไมต้องปัดขึ้น: เส้นเวลาและ `snapAtIso` ปัด atIso *ลง* เป็นช่วง 10 นาทีก่อนเลือกฉาก
 * ถ้าส่ง observedAt ตรง ๆ (เช่น 23:14:35) มันจะถูกปัดเป็น 23:10 ซึ่ง **ก่อน** เวลาบันทึกภาพ
 * → `observedAt ≤ at` ไม่จริง → ได้รอบบินก่อนหน้าแทน ปัดขึ้นเป็น 23:20 แล้ว snap ลง
 * ก็ยังเป็น 23:20 ≥ 23:14:35 จึงได้ฉากนี้ (รอบบินห่างกันเป็นชั่วโมงถึงวัน ไม่มีทางมีฉาก
 * อื่นแทรกใน 10 นาทีนั้น)
 */
export function sceneAtIso(scene: Pick<FloodSceneIndexEntry, "observedAt">): string {
  const t = Date.parse(scene.observedAt);
  return new Date(Math.ceil(t / AT_ISO_SNAP_MS) * AT_ISO_SNAP_MS).toISOString();
}

/**
 * นิยามเดียวของ "ฉากที่ท่วม" ทั้ง UI: GFM จำแนกเซลล์ว่าท่วมอย่างน้อยหนึ่งเซลล์
 *
 * ใช้ `floodedCells` ไม่ใช่ `floodedAreaKm2` เพราะพื้นที่เป็นผลคูณของจำนวนเซลล์
 * (ปัดทศนิยมได้) — ตัวเลขที่จะเป็น 0 ก็ต่อเมื่อไม่มีเซลล์ท่วมจริงคือจำนวนเซลล์
 * ขีดบนแถบเวลา แถวรอบบิน ตัวเลขของฉาก และ `groupFloodEvents` ต้องเห็นตรงกัน
 * ว่าฉากไหนท่วม ไม่งั้นขีดสีน้ำกับรายการเหตุการณ์จะไม่ตรงกัน
 */
export function isFloodedScene(scene: Pick<FloodSceneIndexEntry, "floodedCells">): boolean {
  return scene.floodedCells > 0;
}

/**
 * ช่องว่างระหว่างรอบบินที่ท่วมสองรอบ ซึ่งถือว่าเป็นคนละเหตุการณ์: 7 วัน
 *
 * Sentinel-1 บินซ้ำทุก 6–12 วัน — ฉากที่ท่วมสองฉากห่างกันไม่เกินหนึ่งรอบบินคือน้ำ
 * ก้อนเดียวกันที่ถูกเห็นสองครั้ง เกินกว่านั้นมีรอบบินที่ "แห้ง" หรือไม่มีภาพคั่นอยู่
 * และเราไม่รู้ว่าระหว่างนั้นน้ำลดหรือไม่ จึงไม่ต่อเป็นเหตุการณ์เดียว
 */
export const FLOOD_EVENT_GAP_MS = 7 * 24 * 60 * 60 * 1000;

/** เหตุการณ์น้ำท่วม "ที่ดาวเทียมเห็น" — กลุ่มของรอบบินที่ท่วมติด ๆ กัน ไม่ใช่การนิยามอุทกภัยของหน่วยงานใด */
export interface FloodEvent {
  /** observedAt ของฉากแรก/ฉากสุดท้ายในกลุ่ม — ช่วงที่ *เห็น* น้ำ ไม่ใช่ช่วงที่น้ำท่วมจริง */
  startAt: string;
  endAt: string;
  /** ฉากที่พื้นที่ท่วมมากที่สุดในกลุ่ม */
  peak: FloodSceneIndexEntry;
  sceneCount: number;
  /** เรียงตามเวลา (เก่า → ใหม่) */
  sceneIds: string[];
}

/**
 * จัดฉากที่ท่วม (`isFloodedScene`) เป็นเหตุการณ์: เรียงตามเวลา แล้วตัดกลุ่มทุกครั้งที่
 * ห่างจากฉากท่วมก่อนหน้าเกิน `FLOOD_EVENT_GAP_MS` ผลลัพธ์เรียงตามพื้นที่สูงสุดของกลุ่ม
 * (มาก → น้อย) ให้เหตุการณ์ใหญ่สุดอยู่บนสุดของรายการ
 */
export function groupFloodEvents(scenes: readonly FloodSceneIndexEntry[]): FloodEvent[] {
  const flooded = scenes
    .filter((s) => isFloodedScene(s) && Number.isFinite(Date.parse(s.observedAt)))
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const events: FloodEvent[] = [];
  let group: FloodSceneIndexEntry[] = [];
  const flush = () => {
    if (group.length === 0) return;
    let peak = group[0];
    for (const s of group) if (s.floodedAreaKm2 > peak.floodedAreaKm2) peak = s;
    events.push({
      startAt: group[0].observedAt,
      endAt: group[group.length - 1].observedAt,
      peak,
      sceneCount: group.length,
      sceneIds: group.map((s) => s.sceneId),
    });
    group = [];
  };
  for (const s of flooded) {
    const prev = group[group.length - 1];
    if (prev && Date.parse(s.observedAt) - Date.parse(prev.observedAt) > FLOOD_EVENT_GAP_MS) flush();
    group.push(s);
  }
  flush();
  return events.sort((a, b) => b.peak.floodedAreaKm2 - a.peak.floodedAreaKm2);
}

/** ส่วนประกอบของระยะห่างสำหรับป้าย "ภาพล่าสุดก่อนเวลาที่เลือก: 3 วัน 4 ชม." */
export interface GapParts {
  days: number;
  hours: number;
  minutes: number;
}

/**
 * ระยะจากเวลาบันทึกภาพถึงเวลาที่เลือก — **ไม่ใช่** อายุของภาพเทียบกับตอนนี้
 *
 * `null` เมื่อดูสด (`atIso === null` — ป้ายนี้มีความหมายเฉพาะตอนเลือกเวลาเอง) หรือ
 * เมื่อห่างกันไม่ถึงหนึ่งช่วง 10 นาที (คือฉากที่ถูกเลือกผ่าน `sceneAtIso` พอดี ไม่มี
 * ช่องว่างให้พูดถึง) — ค่านี้บอกแค่ว่าภาพเก่ากว่าเวลาที่เลือกเท่าไร ไม่ได้บอกอะไร
 * เกี่ยวกับสภาพ ณ เวลาที่เลือก
 */
export function gapParts(atIso: string | null, observedAt: string): GapParts | null {
  if (atIso === null) return null;
  const at = Date.parse(atIso);
  const obs = Date.parse(observedAt);
  if (!Number.isFinite(at) || !Number.isFinite(obs)) return null;
  const ms = at - obs;
  if (ms < AT_ISO_SNAP_MS) return null;
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes - days * 1440) / 60);
  const minutes = totalMinutes - days * 1440 - hours * 60;
  return { days, hours, minutes };
}
