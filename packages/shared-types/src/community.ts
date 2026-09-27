import type { HazardLayerDescriptor } from "./hazard-layer.js";

// ─────────────────────────────────────────────────────────────────────────────
// รายงานผลกระทบจากประชาชน (community report pins) — สัญญาข้อมูลระหว่าง api กับ web
//
// ต่างจากทุกชั้นข้อมูลอื่นของโปรเจกต์: ข้อมูลไม่ได้มาจากเครื่องมือวัด หน่วยงาน หรือแบบจำลอง
// แต่เป็นสิ่งที่ผู้ใช้ทั่วไปพิมพ์/ถ่ายส่งมา ชั้นนี้จึงมี `EpistemicClass` ของตัวเอง
// (`"crowdsourced"`) และ `SourceDescriptor.kind` ของตัวเอง (`"community"`) — ไม่มีสถานะใน
// `/api/v1/health` เพราะไม่มีต้นทางภายนอกให้ probe; ความสดคือเวลาที่ DO อ่านรายการให้
// (`CommunityReportsResponse.fetchedAt`) และการ poll ของเว็บเอง
//
// ทุกรายงาน "ยังไม่ได้ตรวจสอบ" เสมอ — คะแนนโหวตเป็นความเห็นของผู้ใช้ ไม่ใช่การยืนยัน
// ─────────────────────────────────────────────────────────────────────────────

/** หมวดของรายงาน — เลือกได้หลายหมวด (อย่างน้อยหนึ่ง) ลำดับนี้คือลำดับที่ UI แสดง */
export const COMMUNITY_CATEGORIES = [
  "flood",
  "road-blocked",
  "power-out",
  "landslide",
  "fallen-tree",
  "building-damage",
  "other",
] as const;

export type CommunityCategory = (typeof COMMUNITY_CATEGORIES)[number];

export function isCommunityCategory(value: unknown): value is CommunityCategory {
  return typeof value === "string" && (COMMUNITY_CATEGORIES as readonly string[]).includes(value);
}

/** ความยาวสูงสุดของคำอธิบาย (หน่วย UTF-16 code unit — ตรงกับ `maxLength` ของ textarea) */
export const COMMUNITY_MAX_DESCRIPTION = 500;
/** ขนาดรูปสูงสุดหลังบีบอัดฝั่ง client (300 KiB) — server ปฏิเสธที่เกินเสมอ ไม่ย่อให้ */
export const COMMUNITY_MAX_IMAGE_BYTES = 307_200;
/** ขอบยาวสูงสุดที่ client ย่อรูปลงมา (px) — server ไม่ decode รูป จึงไม่ได้ตรวจค่านี้ */
export const COMMUNITY_MAX_IMAGE_EDGE_PX = 1280;
/** ขนาด body ของ `POST /community/reports` ทั้งก้อน (multipart) — รูป + ฟิลด์ + boundary */
export const COMMUNITY_MAX_BODY_BYTES = 409_600;
/** เก็บรายงาน (แถว + รูปใน R2) 30 วันแล้วลบ */
export const COMMUNITY_RETENTION_DAYS = 30;
/** เพดานรายงานใหม่ทั้งประเทศต่อวัน (ไม่ใช่ต่อคน) — ทำให้ R2 กรณีแย่สุดคำนวณได้ */
export const COMMUNITY_REPORT_CAP_PER_DAY = 500;
/** เพดานการโหวตที่ถูกบันทึกทั้งประเทศต่อวัน — ทำให้ DO rows written กรณีแย่สุดคำนวณได้ */
export const COMMUNITY_VOTE_CAP_PER_DAY = 20_000;

/** ซ่อนอัตโนมัติเมื่อ `down ≥ 5` … */
export const COMMUNITY_AUTO_HIDE_MIN_DOWN = 5;
/** … และ `down ≥ 2 × up` */
export const COMMUNITY_AUTO_HIDE_RATIO = 2;

/**
 * กติกาซ่อนอัตโนมัติ — ฟังก์ชันเดียวที่ api (ตอนบันทึกโหวต) และ web (ข้อความใน legend) ใช้ร่วมกัน
 * รายงานที่ถูกซ่อนไม่หายเงียบ: `CommunityReportsResponse.hiddenCount` บอกจำนวนเสมอ
 */
export function isAutoHidden(up: number, down: number): boolean {
  return down >= COMMUNITY_AUTO_HIDE_MIN_DOWN && down >= COMMUNITY_AUTO_HIDE_RATIO * up;
}

/** หนึ่งหมุด — ไม่มีตัวตนของผู้รายงานหรือ IP ใด ๆ อยู่ในนี้ (และไม่มีใน DO ด้วย) */
export interface CommunityReport {
  id: string;
  lat: number;
  lon: number;
  /** server คิดเองด้วย point-in-polygon บนขอบเขตจังหวัดที่ย่อแล้ว — จุดที่ชิดขอบอาจตกอีกจังหวัด */
  provinceCode: string;
  categories: CommunityCategory[];
  description: string;
  /** `/api/v1/community/image/{id}` หรือ null เมื่อไม่ได้แนบรูป */
  imageUrl: string | null;
  /** เวลาของ server ตอนรับรายงาน (ไม่ใช่เวลาที่ client อ้าง) */
  createdAt: string;
  up: number;
  down: number;
}

/** `GET /api/v1/community/{code}/reports` */
export interface CommunityReportsResponse {
  /** เวลาที่ DO อ่านรายการนี้จากฐานข้อมูลของเราเอง (ข้อมูล ณ เวลานั้น) */
  fetchedAt: string;
  /** รายงานที่ยังไม่ถูกซ่อน อายุไม่เกิน `COMMUNITY_RETENTION_DAYS` ใหม่สุดก่อน สูงสุด 500 */
  reports: CommunityReport[];
  /** จำนวนรายงานในช่วงเดียวกันที่ถูกซ่อน (โหวตลงถึงเกณฑ์ หรือผู้ดูแลซ่อน) */
  hiddenCount: number;
  /** `epistemicClass: "crowdsourced"`, `sourceIds: ["community-report"]`, `publishedAt: null` */
  layer: HazardLayerDescriptor;
}

export type CommunityVoteValue = 1 | -1 | 0;

/** `POST /api/v1/community/reports` → 201 */
export interface CommunityCreateResponse {
  report: CommunityReport;
  /** เก็บไว้ฝั่ง client เพื่อลบรายงานของตัวเอง — server ไม่เก็บค่านี้ (คำนวณซ้ำจาก HMAC) */
  ownerToken: string;
}

/** `POST /api/v1/community/session` → token นิรนามที่ server ลงนาม ใช้เป็น `X-Voter-Token` */
export interface CommunitySessionResponse {
  voterToken: string;
}

/** `POST /api/v1/community/reports/{id}/vote` */
export interface CommunityVoteResponse {
  up: number;
  down: number;
  hidden: boolean;
}

/**
 * `reason` ที่ API ส่งมากับคำตอบผิดพลาด — UI แปลเป็นข้อความได้ตรงตัว
 * (ปิดรับรายงานชั่วคราว / ครบโควตาวันนี้ / อยู่นอกประเทศ / …)
 */
export type CommunityRejectReason =
  | "reporting-disabled"
  | "body-too-large"
  | "bad-request"
  | "turnstile-failed"
  | "turnstile-unreachable"
  | "invalid-categories"
  | "description-too-long"
  | "invalid-location"
  | "outside-thailand"
  | "image-too-large"
  | "image-type"
  | "image-metadata"
  | "image-invalid"
  | "report-cap"
  | "vote-cap"
  | "storage-failed"
  | "unauthorized"
  | "admin-disabled"
  | "not-found";

export interface CommunityErrorResponse {
  error: string;
  reason: CommunityRejectReason;
}
