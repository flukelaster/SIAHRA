/**
 * แฟล็กตอน build — Vite แทนค่า `import.meta.env.VITE_*` เป็นค่าคงที่ตอน bundle จึงเป็น
 * `false` ตายตัวใน build ที่ไม่ได้ตั้งค่า และโค้ดที่อยู่หลังแฟล็กไม่ถูกเรียกเลย
 */

/**
 * E15 — ภาพกล้อง CCTV ของกรมทรัพยากรน้ำ: **ปิดใน production** จนกว่า DWR จะตอบเรื่อง
 * การอนุญาตให้แสดงภาพ เปิดเฉพาะ `apps/web/.env.development` (`VITE_FEATURE_CCTV=1`)
 *
 * ปิด = ไม่มีสวิตช์ ไม่มีแถว legend ไม่มีหมุด ไม่ดึง `/cctv/dwr-cameras.json` และไม่มี
 * request ใดไปถึง telemetry.dwr.go.th — ทุกจุดต้องเช็กค่านี้ ไม่ใช่เช็กแค่ `layers.cctv`
 * (permalink `?layers=…,cctv` ตั้งสวิตช์เป็นจริงได้แม้แฟล็กปิด)
 */
export const CCTV_ENABLED: boolean = import.meta.env.VITE_FEATURE_CCTV === "1";
