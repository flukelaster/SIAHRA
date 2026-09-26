/**
 * แฟล็กตอน build — Vite แทนค่า `import.meta.env.VITE_*` เป็นค่าคงที่ตอน bundle จึงเป็น
 * ค่าคงที่ตอน bundle — ถ้าแฟล็กปิด โค้ดที่อยู่หลังแฟล็กไม่ถูกเรียกเลย
 */

/**
 * E15 — ภาพกล้อง CCTV ของกรมทรัพยากรน้ำ: **เปิดเป็นค่าเริ่มต้นในทุก build** (รวม production)
 * โดยให้เครดิต DWR ไว้ในป๊อปอัปและบรรทัดเครดิตที่ mount เสมอ — DWR ไม่ได้เผยแพร่เงื่อนไข
 * การใช้ จึงเก็บแฟล็กไว้เป็น kill switch: build ด้วย `VITE_FEATURE_CCTV=0` ถ้า DWR ขอให้ถอด
 *
 * ปิด = ไม่มีสวิตช์ ไม่มีแถว legend ไม่มีหมุด ไม่ดึง `/cctv/dwr-cameras.json` และไม่มี
 * request ใดไปถึง telemetry.dwr.go.th — ทุกจุดต้องเช็กค่านี้ ไม่ใช่เช็กแค่ `layers.cctv`
 * (permalink `?layers=…,cctv` ตั้งสวิตช์เป็นจริงได้แม้แฟล็กปิด)
 */
export const CCTV_ENABLED: boolean = import.meta.env.VITE_FEATURE_CCTV !== "0";
