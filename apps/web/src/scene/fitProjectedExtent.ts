/**
 * ตัวคูณระยะกล้อง (≥ 1) ที่ทำให้จุดที่ฉายลงจอทั้งหมดอยู่ในกรอบพื้นที่ว่าง — pure
 * ไม่มี three.js เพื่อให้เทสได้ตรง ๆ
 *
 * ทำไมต้องมี: `frameTerrain` (setupScene.ts) จัดกรอบด้วย "ทรงกลมล้อม" ของ bbox
 * แล้วเอียงกล้องลงมา 50° — ขอบใกล้ (ทิศใต้) ของจังหวัดที่สูงตามแกนเหนือ-ใต้จึงถูก
 * ฉายต่ำกว่าวงกลมที่ฟิตไว้ (perspective ไม่สมมาตรเมื่อเอียง) QA วัดได้ว่าเส้นขอบ
 * จังหวัดสูง ๆ ลอดใต้ dock ล่าง 13–62 px ที่ 1024–1440 (น่าน 19 px, เชียงใหม่ 38–62 px)
 *
 * วัดจาก **กึ่งกลางของกรอบ** ไม่ใช่จากช่วงกว้างของจุด: หลัง centring shift เป้าหมาย
 * ของกล้องอยู่ที่กึ่งกลางกรอบพอดี และการเพิ่มระยะกล้อง s เท่าจะย่อระยะของทุกจุด
 * จากกึ่งกลางลง ≈ 1/s — อัตราส่วน "ระยะจากกึ่งกลาง / ครึ่งกรอบ" ของจุดที่ไกลที่สุด
 * จึงเป็นตัวคูณที่พาจุดนั้นกลับเข้ากรอบพอดี (อัตราส่วนช่วงกว้าง/กรอบจะประเมินต่ำไป
 * เมื่อจุดกระจายไม่สมมาตร ซึ่งเป็นกรณีที่ต้องการแก้พอดี)
 */
export interface ProjectedPoint {
  x: number;
  y: number;
}

/** กรอบพื้นที่ว่างเป็นพิกเซล (left/top รวม, right/bottom ไม่รวม) */
export interface FreeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function fitProjectedExtent(points: readonly ProjectedPoint[], free: FreeRect): number {
  const halfW = (free.right - free.left) / 2;
  const halfH = (free.bottom - free.top) / 2;
  // กรอบเสื่อม (กว้าง/สูง ≤ 0) หรือไม่มีจุด — ไม่มีอะไรให้ฟิต อย่าคูณด้วยอนันต์
  if (!(halfW > 0) || !(halfH > 0) || points.length === 0) return 1;
  const cx = free.left + halfW;
  const cy = free.top + halfH;
  let ratio = 1;
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    ratio = Math.max(ratio, Math.abs(p.x - cx) / halfW, Math.abs(p.y - cy) / halfH);
  }
  return ratio;
}
