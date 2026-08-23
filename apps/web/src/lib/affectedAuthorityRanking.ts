/**
 * การจัดอันดับ อปท. ที่ได้รับผลกระทบในจังหวัดหนึ่ง — โมดูลบริสุทธิ์ที่
 * `hooks/useAffectedAuthorities.ts` ใช้ เพื่อให้เทสได้โดยไม่ต้องยุ่งกับ fetch/timer
 *
 * กติกาความซื่อสัตย์ต่อข้อมูลข้อเดียวที่ไฟล์นี้บังคับ: **ห้ามเอา `floodedFraction:
 * null` (GISTDA ยังไม่เคยดึงสำเร็จ) มาเรียงปนกับ `0` (ดึงสำเร็จแล้วแต่ไม่ท่วมเลย)**
 * — สอง อปท. นี้ต้องอยู่คนละกลุ่มบนหน้าจอเสมอ ไม่ใช่แค่คนละแถวเฉย ๆ
 */
import type { LocalAuthorityImpact, LocalAuthorityType } from "@siahra/shared-types";

/** อปท. หนึ่งรายการที่มีขอบเขตจริง (E11.2) ในจังหวัดที่กำลังดู — ก่อนจัดอันดับ */
export interface AffectedAuthorityCandidate {
  id: string;
  nameTh: string;
  type: LocalAuthorityType;
  /**
   * ผลจาก `GET /:id/impact` — `null` เมื่อคำขอของ อปท. รายนี้เอง**ล้มเหลว**
   * (เครือข่ายขาด/5xx) ต่างจาก `impact.floodedFraction === null` ที่แปลว่าคำขอ
   * สำเร็จแต่ GISTDA เองยังไม่เคยดึงฉากใดสำเร็จเลย — สองเรื่องนี้คนละสาเหตุ แต่ผล
   * บนหน้าจอเหมือนกัน (ไม่มีตัวเลขให้จัดอันดับ) จึงรวมเป็นบักเก็ตเดียวกันได้อย่าง
   * ปลอดภัยผ่าน `unavailable`
   */
  impact: LocalAuthorityImpact | null;
  /** true = คำขอ `/impact` ของ อปท. รายนี้เองล้มเหลว (ต่างจาก 404 ซึ่งไม่ควรอยู่ใน
   *  รายการนี้ตั้งแต่แรก เพราะ candidate มาจากขอบเขต E11.2 จริงที่มีอยู่แล้ว) */
  unavailable: boolean;
}

export type AffectedAuthorityBucket = "measured" | "never-fetched" | "unavailable";

export interface RankedAffectedAuthority extends AffectedAuthorityCandidate {
  bucket: AffectedAuthorityBucket;
}

function facilitiesCount(impact: LocalAuthorityImpact): number {
  const f = impact.facilitiesExposed;
  return f.hospitals.length + f.schools.length + f.fireStations.length;
}

function bucketOf(c: AffectedAuthorityCandidate): AffectedAuthorityBucket {
  if (c.unavailable || !c.impact) return "unavailable";
  if (c.impact.floodedFraction === null) return "never-fetched";
  return "measured";
}

const BUCKET_ORDER: Record<AffectedAuthorityBucket, number> = {
  measured: 0,
  "never-fetched": 1,
  unavailable: 2,
};

/**
 * เรียง: `measured` (มีตัวเลขจริง) ก่อนเสมอ → เรียงตาม `floodedFraction` มากไปน้อย
 * → เสมอกันเรียงตามจำนวนสถานที่สำคัญที่ถูกน้ำท่วม (`facilitiesExposed`) มากไปน้อย
 * จากนั้น `never-fetched` (GISTDA ไม่เคยดึงสำเร็จ) แล้วค่อย `unavailable`
 * (คำขอของรายนี้เองล้มเหลว) — ทั้งสองกลุ่มหลังเรียงตามชื่อไทยเพื่อให้ผลลัพธ์
 * นิ่ง (deterministic) ไม่ใช่ตามลำดับที่คำขอ async กลับมาถึงก่อน-หลัง
 */
export function rankAffectedAuthorities(
  candidates: readonly AffectedAuthorityCandidate[],
): RankedAffectedAuthority[] {
  return candidates
    .map((c) => ({ ...c, bucket: bucketOf(c) }))
    .sort((a, b) => {
      const order = BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket];
      if (order !== 0) return order;
      if (a.bucket === "measured") {
        // bucket === "measured" รับประกันว่า impact และ floodedFraction ไม่เป็น null
        const fa = a.impact as LocalAuthorityImpact;
        const fb = b.impact as LocalAuthorityImpact;
        const fractionDelta = (fb.floodedFraction as number) - (fa.floodedFraction as number);
        if (fractionDelta !== 0) return fractionDelta;
        const facilityDelta = facilitiesCount(fb) - facilitiesCount(fa);
        if (facilityDelta !== 0) return facilityDelta;
      }
      return a.nameTh.localeCompare(b.nameTh, "th");
    });
}
