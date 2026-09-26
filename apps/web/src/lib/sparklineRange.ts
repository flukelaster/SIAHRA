/**
 * ช่วงแกน y ของ Sparkline — แยกสองอย่างที่เคยปนกัน:
 *  - `observedMin`/`observedMax` = ค่าต่ำสุด/สูงสุดที่ **วัดได้จริง** ในอนุกรม (ก่อนตัดความถี่ ก่อนขยายช่วง,
 *    ไม่รวมเส้นตลิ่ง) → เป็นตัวเลขที่ป้ายแกนพิมพ์
 *  - `scaleMin`/`scaleMax` = ช่วงที่ใช้วาดเท่านั้น: รวมเส้นตลิ่งให้อยู่ในกรอบ และขยายให้กว้างอย่างน้อย
 *    `minSpan` เพื่อไม่ให้อนุกรมที่แทบนิ่งดูเหมือนแกว่งแรง — ห้ามพิมพ์เป็นตัวเลข เพราะไม่ใช่ค่าที่วัดได้
 *    (เดิม C.2 พิมพ์ 1851 ทั้งที่ยอดที่วัดได้คือ 1,827)
 */
export interface SparklineRange {
  observedMin: number;
  observedMax: number;
  scaleMin: number;
  scaleMax: number;
}

export function sparklineRange(
  values: readonly number[],
  bank: number | null,
  discharge: boolean,
): SparklineRange {
  let observedMin = Infinity;
  let observedMax = -Infinity;
  for (const v of values) {
    if (v < observedMin) observedMin = v;
    if (v > observedMax) observedMax = v;
  }
  let scaleMin = observedMin;
  let scaleMax = observedMax;
  if (bank !== null) {
    scaleMin = Math.min(scaleMin, bank);
    scaleMax = Math.max(scaleMax, bank);
  }
  const minSpan = discharge ? Math.max(2, Math.abs(scaleMax) * 0.05) : 0.2;
  if (scaleMax - scaleMin < minSpan) {
    const mid = (scaleMax + scaleMin) / 2;
    scaleMin = mid - minSpan / 2;
    scaleMax = mid + minSpan / 2;
  }
  return { observedMin, observedMax, scaleMin, scaleMax };
}
