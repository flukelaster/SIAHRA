/**
 * นโยบายแคชของ API — ที่เดียวที่ตัดสินว่า endpoint ไหนควรถูกแคชนานแค่ไหน (E4.6)
 *
 * ก่อนหน้านี้ค่า `Cache-Control` กระจายเป็น string literal อยู่ใน routes/*.ts
 * ทำให้ไม่มีที่ไหนตอบได้ว่า "ทั้ง API แคชยังไง" นอกจากไล่ grep เอง โมดูลนี้จึงตั้งชื่อ
 * ให้แต่ละนโยบาย แล้วให้ route อ้างชื่อแทนค่า — เวลาปรับ ปรับที่นี่ที่เดียว และตารางใน
 * docs/api.md ก็เทียบกับไฟล์นี้ได้ตรง ๆ
 *
 * กติกาสองข้อที่ router บังคับให้เอง (ดู `json()` ใน router.ts):
 * - 4xx/5xx เป็น `no-store` เสมอ ไม่ว่า route จะขอนโยบายอะไรมา — คำตอบที่ผิดพลาด
 *   ไม่ควรถูก CDN เก็บไว้แจกต่อ (โดยเฉพาะ 503 ตอนต้นทางล่ม ซึ่งจะกลายเป็น
 *   "ล่มค้าง" ทั้งที่ต้นทางกลับมาแล้ว)
 * - route ที่ไม่ระบุนโยบาย ได้ `noStore` เป็นค่าตั้งต้น
 */

/** นโยบายหนึ่งอัน = ชื่อ (ไว้อ้างในเอกสาร/เทส) + ค่า `Cache-Control` ที่ส่งจริง */
export interface CachePolicy {
  readonly name: string;
  readonly value: string;
}

const policy = (name: string, value: string): CachePolicy => Object.freeze({ name, value });

/** ห้ามแคช — ใช้กับทุกคำตอบที่เป็นข้อผิดพลาด และกับข้อมูลที่ยังไม่เคยดึงสำเร็จ */
export const noStore = policy("noStore", "no-store");

/** ฟีดที่ต้องสดจริง (แผ่นดินไหวล่าสุด) — เบราว์เซอร์ 10 วิ / CDN 20 วิ */
export const realtime = policy("realtime", "public, max-age=10, s-maxage=20");

/**
 * ค่าตรวจวัดจาก ThaiWater — ต้นทางอัปเดตราว 15 นาที/ครั้ง แคชสั้น ๆ จึงไม่ทำให้ข้อมูลเก่าเกินจริง
 *
 * จงใจ **ไม่ใส่** `stale-while-revalidate` (แม้ roadmap E4.6 จะร่างไว้ว่าน่าจะใส่):
 * หน้าเว็บคำนวณ "อัปเดตเมื่อ N นาทีที่แล้ว" จาก `fetchedAt` ในตัว payload ถ้า CDN
 * แจกของค้างต่ออีกนาทีโดยที่เบราว์เซอร์เข้าใจว่าสด ตัวเลขที่ผู้ใช้เห็นกับของจริงจะเพี้ยน
 * ซึ่งขัดกับกติกาข้อแรกของโปรเจกต์ (ข้อมูลค้างต้องมองเห็นได้ ไม่ใช่ถูกกลบ)
 */
export const observations = policy("observations", "public, max-age=60, s-maxage=120");

/** ประวัติระดับน้ำย้อนหลัง — เปลี่ยนช้ากว่าค่าปัจจุบัน */
export const history = policy("history", "public, max-age=120");

/** ข้อมูลที่ขยับเป็นชั่วโมง (เขื่อน, รายวันของคลัง) */
export const slowMoving = policy("slowMoving", "public, max-age=300");

/** สรุปสถานะแหล่งข้อมูล — สั้นพอที่แถบสถานะจะไม่โชว์ของค้าง */
export const health = policy("health", "public, max-age=15");

/** เฟรมเรดาร์ล่าสุด (รายการเฟรม) */
export const radarFrames = policy("radarFrames", "public, max-age=60");

/** ภาพเรดาร์รายเฟรม — ชี้ด้วย timestamp จึงไม่มีวันเปลี่ยนเนื้อหา */
export const radarFrame = policy("radarFrame", "public, max-age=86400, immutable");

/** snapshot ย้อนหลังจากคลังถาวร — เขียนแล้วไม่แก้ */
export const archivedSnapshot = policy("archivedSnapshot", "public, max-age=3600");

/**
 * ขอบเขตน้ำท่วมจากดาวเทียม: อายุแคชขึ้นกับว่าเคยดึงสำเร็จหรือยัง
 * "ยังไม่เคยดึงสำเร็จ" อาจเป็นแค่ cold start ที่ refresh กำลังวิ่ง — ห้ามให้คำตอบนั้น
 * ค้างในแคชนานจนผู้ใช้เห็น "ต้นทางไม่ตอบสนอง" ทั้งที่ข้อมูลมาแล้ว
 */
export function floodExtent(retrievedAt: string | null, historical = false): CachePolicy {
  if (!retrievedAt) return noStore;
  return historical ? floodExtentArchived : policy("floodExtent", "public, max-age=300, s-maxage=600");
}

/**
 * ฉากย้อนหลัง (`?at=` แล้วหาฉากที่ครอบเวลานั้นได้): ไบต์ของฉากที่ archive แล้วไม่มีวันเปลี่ยน
 * และ `at` ถูกปัดเป็นช่วง 10 นาทีที่ฝั่งเว็บ จึงแคชได้ยาว — แต่ไม่ `immutable` เพราะ
 * ฉากใน hot window (≤30 วัน) ยังตอบจากตาราง ซึ่ง last_seen ขยับได้จน set ของ polygon
 * ที่ "ครอบ at" เปลี่ยนตามรอบ refresh ถัดไป
 * ส่วน `retrievedAt: null` กับ `at` = ไม่มีฉากที่เก็บไว้ — ใช้ noStore เท่าเคส live
 * เพราะฉากถัดไปที่ archive อาจทำให้คำตอบเปลี่ยนภายในครึ่งชั่วโมง
 */
export const floodExtentArchived = policy("floodExtentArchived", "public, max-age=3600, s-maxage=86400");

/**
 * ไฟล์ผลลัพธ์ที่ "แช่แข็ง" แล้ว — คีย์เป็น content-addressed (มี hash อยู่ในคีย์)
 * เนื้อหาจึงเปลี่ยนไม่ได้ตามนิยาม แคชได้หนึ่งปีแบบ immutable
 *
 * ยังไม่มีใครเรียกใช้: E10.3 (ผลการคำนวณ exposure ที่เก็บลง R2 เป็นไฟล์ถาวร)
 * จะเป็นผู้ใช้รายแรก ที่เตรียมไว้ก่อนเพราะนโยบายนี้คือ "อันตรายถ้าใช้ผิดที่" —
 * ติด immutable ให้คีย์ที่เขียนทับได้ แปลว่าผู้ใช้จะค้างอยู่กับของเก่าหนึ่งปีเต็ม
 * จึงบังคับรูปคีย์ไว้ตรงนี้ และ throw ทันทีถ้าเรียกด้วยคีย์ที่ไม่ใช่ content-addressed
 * (เป็น bug ของโค้ดเรียก ไม่ใช่ input ของผู้ใช้ — router จะ log แล้วตอบ 500)
 */
export function frozenArtifact(key: string): CachePolicy {
  if (!isContentAddressed(key)) {
    throw new Error(`frozenArtifact requires a content-addressed key, got "${key}"`);
  }
  return policy("frozenArtifact", "public, max-age=31536000, immutable");
}

/**
 * คีย์ถือว่า content-addressed เมื่อ "ชื่อไฟล์" (ส่วนสุดท้าย ตัดนามสกุลออก) มี hex
 * ยาว ≥16 ตัว — ไม่ว่าจะเป็นก้อนเดียว (`9f2c1ab34de56780.json`), เป็น UUID ที่คั่นด้วย
 * ขีด (`9f2c1ab3-4de5-...`) หรือมีคำนำหน้า (`run-9f2c1ab34de56780.json`)
 *
 * 16 หลักคือเส้นแบ่งที่ตั้งใจ: วันที่ (`2026-08-19`) หรือ epoch มิลลิวินาทีสั้นกว่านั้น
 * และเป็นคีย์ที่เขียนทับได้ ซึ่งเป็นเคสที่ห้ามติด immutable เด็ดขาด
 */
export function isContentAddressed(key: string): boolean {
  const base = (key.split("/").pop() ?? "").replace(/\.[a-z0-9]+$/i, "");
  // ต้องมีตัวอักษร a-f อย่างน้อยหนึ่งตัว ไม่ใช่แค่ยาว ≥16 และเป็น [0-9a-f]:
  // ตัวเลขล้วนยาว ๆ (epoch ไมโครวินาที, timestamp ต่อท้ายด้วยตัวนับ) ผ่านเกณฑ์ hex
  // ได้ทั้งที่มันคือคีย์ที่เขียนทับได้ ซึ่งห้ามติด `immutable` เด็ดขาด — ส่วน hash
  // จริงยาว 16 หลักมีโอกาสเป็นเลขล้วนราว (10/16)^16 ≈ 0.02% จึงไม่ถูกกันโดยพลาด
  const isHex = (s: string) => s.length >= 16 && /^[0-9a-f]+$/i.test(s) && /[a-f]/i.test(s);
  return isHex(base.replace(/[._-]/g, "")) || base.split(/[._-]/).some(isHex);
}
