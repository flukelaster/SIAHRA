/**
 * จำนวนชั้นที่เปิดอยู่ — ตัวเลขบนปุ่ม "ชั้นข้อมูล" ของแผนที่ (pure)
 *
 * นับเฉพาะชั้นที่ผู้ใช้เห็นเป็นแถวใน legend จริง: `hidden` คือคีย์ที่ build นี้ไม่มีแถวให้
 * (เช่น `cctv` เมื่อ `ENABLED_CAMERA_SOURCES` ว่าง — permalink `?layers=…,cctv` ตั้งสวิตช์
 * เป็นจริงได้แม้แฟล็กปิด) ตัวเลขจึงตรงกับจำนวนสวิตช์ที่เปิดอยู่เมื่อผู้ใช้กดเข้าไปดู
 */
export function countLayersOn<T extends object>(layers: T, hidden: readonly (keyof T & string)[] = []): number {
  let n = 0;
  for (const [key, on] of Object.entries(layers)) {
    if (on === true && !(hidden as readonly string[]).includes(key)) n += 1;
  }
  return n;
}
