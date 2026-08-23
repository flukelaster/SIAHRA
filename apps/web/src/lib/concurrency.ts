/**
 * รัน `fn` บน `items` พร้อมกันได้สูงสุด `limit` งาน — ใช้แทนการยิง `Promise.all`
 * ตรง ๆ ตอนที่จำนวนรายการอาจมากถึงหลักร้อย (เช่น อปท. ในจังหวัดหนึ่งที่มีขอบเขต
 * จริง E11.2 ครบ — จังหวัดที่มากที่สุดมี ~144 รายการ) การยิงพร้อมกันหมดทุกตัวเป็น
 * การถล่ม API/Worker โดยไม่จำเป็น ทั้งที่โควตา rate-limit เดียวกันต้องแบ่งกับ
 * คำขออื่นของหน้าเดียวกันด้วย (observations, dams, ...)
 *
 * ผลลัพธ์เรียงตามลำดับ `items` เดิมเสมอ ไม่ใช่ตามลำดับที่ตอบกลับมาถึงก่อน-หลัง —
 * ผู้เรียกจึงจับคู่ `items[i]` กับ `results[i]` ได้ตรงไปตรงมา
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i], i);
    }
  };
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker());
  await Promise.all(workers);
  return results;
}
