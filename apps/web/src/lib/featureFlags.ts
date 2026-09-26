/**
 * แฟล็กตอน build — Vite แทนค่า `import.meta.env.VITE_*` เป็นค่าคงที่ตอน bundle จึงเป็น
 * ค่าคงที่ตอน bundle — ถ้าแฟล็กปิด โค้ดที่อยู่หลังแฟล็กไม่ถูกเรียกเลย
 */
import { CAMERA_SOURCE_IDS, CAMERA_SOURCES, type CameraSourceId } from "@siahra/shared-types";

/**
 * E15 — ชั้นกล้อง CCTV ทั้งชั้น (ทุกแหล่ง): **เปิดเป็นค่าเริ่มต้นในทุก build** (รวม production)
 * โดยให้เครดิตแหล่งที่มาไว้ในแผงกล้องและบรรทัดเครดิตที่ mount เสมอ — ไม่มีแหล่งใดเผยแพร่
 * เงื่อนไขการใช้หรือให้สัญญาอนุญาต จึงเก็บแฟล็กไว้เป็น kill switch: build ด้วย
 * `VITE_FEATURE_CCTV=0` ถ้าต้องถอดทั้งชั้น
 *
 * ปิด = ไม่มีสวิตช์ ไม่มีแถว legend ไม่มีหมุด ไม่ดึง `/cctv/*.json` และไม่มี request ใดไปถึง
 * ต้นทางกล้อง — ทุกจุดต้องเช็ก `ENABLED_CAMERA_SOURCES` ไม่ใช่เช็กแค่ `layers.cctv`
 * (permalink `?layers=…,cctv` ตั้งสวิตช์เป็นจริงได้แม้แฟล็กปิด)
 */
export const CCTV_ENABLED: boolean = import.meta.env.VITE_FEATURE_CCTV !== "0";

/**
 * E15.3 — ปิดรายแหล่ง: `VITE_FEATURE_CCTV_DISABLE=<id,...>` (รายชื่อ `CameraSourceId` คั่นด้วยจุลภาค)
 * `VITE_FEATURE_ITIC=0` ของ E15.2 ยังใช้ได้อีกหนึ่งรุ่นในฐานะชื่อเล่นของ `itic-cctv` ในรายการนี้
 * (ชื่อนั้นอยู่ใน docs/security.md และ `_headers` ของรุ่นก่อน) — ค่าที่ไม่ใช่ id ที่รู้จักถูกเพิกเฉย
 */
export const CAMERA_SOURCES_DISABLED: ReadonlySet<CameraSourceId> = new Set<CameraSourceId>(
  [
    ...(import.meta.env.VITE_FEATURE_CCTV_DISABLE ?? "").split(","),
    ...(import.meta.env.VITE_FEATURE_ITIC === "0" ? ["itic-cctv"] : []),
  ]
    .map((s) => s.trim())
    .filter((s): s is CameraSourceId => (CAMERA_SOURCE_IDS as readonly string[]).includes(s)),
);

/**
 * แหล่งกล้องที่ build นี้เปิดอยู่ ตามลำดับของ `CAMERA_SOURCE_IDS` (= ลำดับเครดิต/legend) —
 * ค่าคงที่ตอน build: ทั้งชั้นปิด (`CCTV_ENABLED` เท็จ) = ว่าง; ไม่งั้น = แหล่งที่ `defaultEnabled`
 * และไม่อยู่ใน `CAMERA_SOURCES_DISABLED`
 *
 * แหล่งที่ไม่อยู่ในรายการนี้ต้องไม่ถูกเอ่ยถึงที่ใดเลย: ไม่มีหมุด ไม่มีบัญชีให้ดึง ไม่มีเครดิต
 * ไม่มีชื่อใน legend และไม่มี request ไปถึงโฮสต์ของมัน
 */
export const ENABLED_CAMERA_SOURCES: readonly CameraSourceId[] = CCTV_ENABLED
  ? CAMERA_SOURCE_IDS.filter((id) => CAMERA_SOURCES[id].defaultEnabled && !CAMERA_SOURCES_DISABLED.has(id))
  : [];
