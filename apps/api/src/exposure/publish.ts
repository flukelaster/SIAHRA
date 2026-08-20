import type { FloodExposureRun, ProvinceExposureResponse } from "@siahra/shared-types";

/**
 * การเผยแพร่ run ลง R2 + ตัวชี้ "run ล่าสุด" (E10.3) — ส่วนที่คิดได้โดยไม่ต้องมี
 * Durable Object อยู่ตรงนี้ทั้งหมด เพื่อให้เทสยิงตรงได้และให้กฎสามข้อด้านล่าง
 * อ่านออกจากที่เดียว
 *
 * 1. **คีย์เขียนครั้งเดียว** — `exposure/runs/{runId}.json.gz` ห้ามถูกเขียนทับ
 *    เพราะมันถูกเสิร์ฟด้วย `cachePolicy.frozenArtifact` (immutable หนึ่งปี)
 *    ถ้าเนื้อหาเปลี่ยนได้ ผู้ใช้จะค้างอยู่กับของเก่าโดยไม่มีทางรู้ และ run ที่
 *    ถูกอ้างอิงไปแล้วจะกลายเป็นคนละเรื่องกับตอนที่ถูกอ้าง
 * 2. **เผยแพร่เมื่อ "อะไรก็ตามที่เปิดเผย" เปลี่ยน** ไม่ใช่เฉพาะตอนระดับเปลี่ยน:
 *    artefact พก `factors.*` และ `observedAt` รายสถานีไปด้วย ถ้ารอให้ระดับเปลี่ยน
 *    ค่อยเผยแพร่ `/latest` จะเสิร์ฟค่าตรวจวัดชุดเก่าพร้อมเวลาชุดเก่า (อาจนานเป็น
 *    ชั่วโมง) โดยแสดงตัวว่าเป็นของปัจจุบัน = ข้อมูลค้างที่ถูกเรนเดอร์ว่าสด
 *    ตัวตัดสินคือ **ส่วน hash ของ `runId`** ซึ่งคิดจาก `{inputs, layer, stations}`
 *    ทั้งก้อน (ดู `computeExposure`) — เนื้อหาเท่าเดิม = ไม่เขียนอะไรเลย
 * 3. **ขอบเขตจังหวัดอยู่ในตัว run** — `scopeToProvince` ดูเฉพาะ
 *    `StationExposure.provinceCode` ที่ถูกคัดลอกไว้ตอนคำนวณ ห้ามถามตาราง
 *    สถานีที่ยังมีชีวิตอยู่ ไม่งั้น run เก่าจะถูกตัดขอบด้วยรายชื่อสถานีของวันนี้
 */

/** คำนำหน้าคีย์ของ run ทั้งหมดใน R2 (docs/ops.md อ้างค่านี้) */
export const EXPOSURE_RUN_PREFIX = "exposure/runs/";

/** ชื่ออินสแตนซ์ของ `ForecastPointerDO` ที่ถือตัวชี้ run ล่าสุด (มีตัวเดียว ทั้งประเทศ) */
export const EXPOSURE_POINTER_NAME = "flood-exposure";

/**
 * รูปของ `runId` ที่ E10.1 กำหนด: `YYYYMMDDTHHMMSSZ-<16 hex>`
 * ใช้ทั้งตรวจ input ที่เข้ามาทาง URL และกันไม่ให้ค่าที่ผู้ใช้ส่งมากลายเป็นคีย์ R2
 */
export const RUN_ID_RE = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}$/;

/**
 * ไบต์ที่เก็บจริงคือ gzip ชื่อคีย์จึงลงท้าย `.json.gz` เหมือนคลังถาวรทุกก้อนใน
 * `archive.ts` — คีย์ที่ลงท้าย `.json` แต่ข้างในเป็น gzip คือการโกหกคนที่ไล่ดู
 * bucket ด้วย `wrangler r2 object list` (run ทั้งประเทศ 1.29 MB → 103 KB)
 * `isContentAddressed` ยังผ่าน เพราะมันดูส่วนที่คั่นด้วย `-`/`.` ทีละส่วน
 */
export function exposureRunKey(runId: string): string {
  if (!RUN_ID_RE.test(runId)) throw new Error(`invalid exposure runId: ${runId}`);
  return `${EXPOSURE_RUN_PREFIX}${runId}.json.gz`;
}

/**
 * ส่วน hash ของ `runId` — คือ "ลายนิ้วมือของเนื้อหา" ที่ใช้ตัดสินว่าต้องเผยแพร่ใหม่ไหม
 *
 * ใช้ส่วนท้าย ไม่ใช่ `runId` ทั้งก้อน เพราะส่วนหน้าคือเวลาที่คำนวณ ซึ่งขยับทุกครั้ง
 * อยู่แล้ว — เทียบทั้งก้อนจะแปลว่า "เผยแพร่ทุกครั้งเสมอ" และกฎข้อ 2 จะไร้ผล
 */
export function runContentHash(runId: string): string | null {
  const m = /-([0-9a-f]{16})$/.exec(runId);
  return m ? m[1] : null;
}

/** ตัดขอบ run ให้เหลือเฉพาะสถานีของจังหวัดหนึ่ง — ดูแค่ `provinceCode` ใน run เท่านั้น */
export function scopeToProvince(run: FloodExposureRun, provinceCode: string): ProvinceExposureResponse {
  const stations = run.stations.filter((s) => s.provinceCode === provinceCode);
  /**
   * `observedAt` ของชั้นข้อมูลถูกคิดใหม่จากสถานีที่เหลือ ไม่ใช่คัดลอกค่าทั้งประเทศ
   * มา — ไม่งั้นจังหวัดที่สถานีเงียบไปสามชั่วโมงจะแสดงเวลาตรวจวัดของอีกจังหวัด
   * หนึ่งว่าเป็นของตัวเอง (ข้อมูลค้างถูกเรนเดอร์ว่าสด อีกทางหนึ่ง) ส่วน
   * `fetchedAt` ยังเป็นของทั้ง run เพราะการดึงต้นทางเป็นครั้งเดียวทั้งประเทศจริง ๆ
   *
   * ใช้ `StationExposure.latestObservedAt` (เวลาดิบล่าสุดของสถานี) ไม่ใช่
   * `StationExposure.observedAt` — หลังรอบ 5 `observedAt` ถูกนิยามใหม่เป็น
   * "เวลาของปัจจัยที่เก่าที่สุด" (ย้อนหลังได้ถึง `inputs.historyWindowH` ชั่วโมง
   * ตาม `freeboardTrendMPerH`) เอา `max()` ทับค่าที่ถูกถอยหลังแล้วจะรายงานเวลา
   * ตรวจวัดของจังหวัดเก่ากว่าความจริงถึงขนาดหน้าต่างนั้น แม้สถานีที่สดที่สุดของ
   * จังหวัดเพิ่งรายงานมาเมื่อครู่ — endpoint นี้ (`/provinces/{NN}/exposure/latest`)
   * เป็นทางเดียวที่เว็บเรียกจริง ดังนั้นตัวเลขที่แสดงต้องถูก ไม่ใช่แค่ badge
   * ไม่กระพริบ (review round 6)
   */
  let observedAt: string | null = null;
  for (const s of stations) {
    if (s.latestObservedAt === null) continue;
    if (observedAt === null || Date.parse(s.latestObservedAt) > Date.parse(observedAt)) observedAt = s.latestObservedAt;
  }
  const { observedAt: _dropped, ...layerRest } = run.layer;
  return {
    ...run,
    layer: { ...layerRest, ...(observedAt === null ? {} : { observedAt }) },
    stations,
    scopedToProvinceCode: provinceCode,
    nationwideStationCount: run.stations.length,
  };
}
