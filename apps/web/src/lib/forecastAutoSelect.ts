import type { ForecastStep } from "@siahra/shared-types";

/**
 * ขั้นที่ `ForecastStrip` ควรเลือกให้อัตโนมัติเมื่อชุดพยากรณ์ TMD มีขั้นรายชั่วโมง **ขั้นเดียว**
 * — pure module เพื่อให้เทสได้โดยไม่ต้องมี DOM (เทสฝั่ง web เป็น environment "node")
 *
 * ทำไมต้องเลือกให้: `<input type="range">` ที่ min === max ไม่ยิง onChange เลย ขั้นเดียวนั้นจึง
 * เลือกไม่ได้ทั้งที่มีข้อมูลจริง
 *
 * กติกา (devops C1, E18.4):
 *   - **ห้ามเลือกเมื่อกำลังดูค่าย้อนหลัง** (`atIso !== null`) — เลือกขั้นพยากรณ์ = ล้าง `atIso`
 *     ใน App.tsx (สองเวลาห้าม non-null พร้อมกัน) การเปิดมุมมองพยากรณ์จึงจะดีดผู้ใช้ออกจากเวลา
 *     ย้อนหลังที่เลือกไว้เอง และเปลี่ยนคำขอ observations โดยไม่มีใครกดอะไร
 *   - เลือกแล้ว = ไม่ต้องเลือกซ้ำ
 *
 * ผู้เรียก (effect ใน ForecastStrip) เรียก **เฉพาะตอน mount และเมื่อชุดขั้นเปลี่ยน** ไม่ใช่เมื่อ
 * `forecastAtIso`/`atIso` เปลี่ยน — ไม่งั้นปุ่มล้าง (X) หรือ "กลับไปปัจจุบัน" ของชิปเวลาจะถูกเลือก
 * กลับทันที และออกจากโหมดพยากรณ์ไม่ได้เลยตราบที่มุมมองพยากรณ์เปิดอยู่
 *
 * @returns `validAt` ที่ต้องส่งให้ onChange หรือ `null` = ไม่ต้องทำอะไร
 */
export function forecastAutoSelectTarget(
  steps: readonly ForecastStep[],
  forecastAtIso: string | null,
  atIso: string | null,
): string | null {
  if (steps.length !== 1) return null;
  if (atIso !== null) return null;
  const only = steps[0].validAt;
  return forecastAtIso === only ? null : only;
}

/**
 * ตัวของ effect ทั้งก้อน — เทสเรียกตัวนี้ด้วย spy แทนการ mount (ไม่มี DOM ในเทสฝั่ง web)
 *
 * `seen` = `validAt` ของชุดขั้นเดียวที่พิจารณาไปแล้ว (ref ของคอมโพเนนต์): โพลรอบใหม่ของ
 * `useProvinceForecast` สร้าง array ใหม่ทุกครั้งแม้ขั้นเดิม — ถ้าไม่จำไว้ ขั้นที่ผู้ใช้เพิ่งล้างจะถูก
 * เลือกกลับเองในรอบโพลถัดไปโดยไม่มีใครกดอะไร (C6) จึงพิจารณาขั้นเดียวแต่ละตัวครั้งเดียวต่อการ mount
 * — รวมถึงรอบที่ข้ามไปเพราะกำลังดูค่าย้อนหลัง (กลับเป็นค่าปัจจุบันทีหลังก็ไม่ถูกดีดเข้าโหมดพยากรณ์)
 */
export function runForecastAutoSelect(
  steps: readonly ForecastStep[],
  forecastAtIso: string | null,
  atIso: string | null,
  onChange: (forecastAtIso: string | null) => void,
  seen: { current: string | null } = { current: null },
): void {
  const only = steps.length === 1 ? steps[0].validAt : null;
  if (only !== null && only === seen.current) return;
  seen.current = only;
  const next = forecastAutoSelectTarget(steps, forecastAtIso, atIso);
  if (next !== null) onChange(next);
}
