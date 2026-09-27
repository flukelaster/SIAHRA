/**
 * คำขอเขียนของรายงานจากประชาชน (โหวต / ลบรายงานของฉัน / ส่งรายงานใหม่) — ใช้เฉพาะจากแผงรายงานและฟอร์ม
 * รายงาน (chunk แยกทั้งคู่)
 *
 * ผลลัพธ์ทุกแบบถูกแยกเป็น `CommunityFailure` ที่ UI แปลเป็นข้อความตรงตัว — ปิดรับชั่วคราว (503
 * reporting-disabled) ≠ ครบเพดานโหวตของวันทั้งประเทศ (429 vote-cap) ≠ ถี่เกินไป (429 ของตัวจำกัดอัตรา) ≠
 * เครือข่ายล้มเหลว ≠ ยืนยันว่าเป็นคนไม่ผ่าน — ไม่มีกรณีไหนถูกพูดว่า "สำเร็จ" หรือกลืนเงียบ
 *
 * การโหวต: ใช้ `voterToken` ที่เก็บไว้ ถ้าไม่มี → Turnstile → `POST /community/session`; server ตอบ 401 (token
 * หมดอายุ/ไม่ถูกต้อง) → ล้าง token แล้วขอ session ใหม่ **ครั้งเดียว** แล้วลองโหวตซ้ำ
 */
import type {
  CommunityCategory,
  CommunityCreateResponse,
  CommunityVoteResponse,
  CommunityVoteValue,
} from "@siahra/shared-types";

export type CommunityFailure =
  /** 503 reporting-disabled — server ยังไม่ได้เปิดระบบนี้ (ไม่มี secret) */
  | "disabled"
  /** build นี้ไม่มี `VITE_TURNSTILE_SITE_KEY` — ไม่ส่งอะไรเลย */
  | "not-configured"
  /** 429 vote-cap — ครบเพดานโหวตของวันนี้ทั้งประเทศ */
  | "vote-cap"
  /** 429 ของตัวจำกัดอัตราต่อ IP */
  | "rate-limit"
  /** 404 — รายงานถูกลบ/หมดอายุไปแล้ว */
  | "not-found"
  /** 403 turnstile-failed / Turnstile ฝั่งเบราว์เซอร์ล้ม */
  | "turnstile"
  /** 503 turnstile-unreachable — server ถาม Cloudflare ไม่ได้ */
  | "turnstile-unreachable"
  /** 401 ซ้ำหลังขอ session ใหม่แล้ว / ownerToken ไม่ถูกต้อง */
  | "unauthorized"
  /** fetch ไปไม่ถึง server */
  | "network"
  /** อย่างอื่น (5xx, คำตอบรูปร่างผิด) */
  | "server";

export type CommunityResult<T> = { ok: true; value: T } | { ok: false; failure: CommunityFailure; status: number | null };

/** สถานะ + `reason` ที่ API ส่งมา → ชนิดความล้มเหลว (pure — เทสได้) */
export function failureFor(status: number, reason: unknown): CommunityFailure {
  if (status === 503) {
    if (reason === "reporting-disabled") return "disabled";
    if (reason === "turnstile-unreachable") return "turnstile-unreachable";
    return "server";
  }
  if (status === 429) return reason === "vote-cap" ? "vote-cap" : "rate-limit";
  if (status === 404) return "not-found";
  if (status === 403) return "turnstile";
  if (status === 401) return "unauthorized";
  return "server";
}

async function postJson<T>(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<CommunityResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, failure: "network", status: null };
  }
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const reason = typeof parsed === "object" && parsed !== null ? (parsed as { reason?: unknown }).reason : undefined;
    return { ok: false, failure: failureFor(res.status, reason), status: res.status };
  }
  if (parsed === null) return { ok: false, failure: "server", status: res.status };
  return { ok: true, value: parsed as T };
}

/** ของที่การโหวตต้องใช้ — แยกออกมาให้ผู้เรียก (แผงรายงาน) ผูกกับ localStorage/Turnstile เอง */
export interface VoteDeps {
  getVoterToken: () => string | null;
  setVoterToken: (token: string | null) => void;
  /** ขอ token ของ Turnstile หนึ่งใบ — throw = ยืนยันไม่ผ่าน/โหลดไม่ได้ */
  turnstileToken: () => Promise<string>;
}

async function newSession(deps: VoteDeps): Promise<CommunityResult<string>> {
  let turnstileToken: string;
  try {
    turnstileToken = await deps.turnstileToken();
  } catch {
    return { ok: false, failure: "turnstile", status: null };
  }
  const res = await postJson<{ voterToken?: unknown }>("/api/v1/community/session", { turnstileToken });
  if (!res.ok) return res;
  const token = res.value.voterToken;
  if (typeof token !== "string" || token === "") return { ok: false, failure: "server", status: null };
  deps.setVoterToken(token);
  return { ok: true, value: token };
}

function isVoteResponse(v: unknown): v is CommunityVoteResponse {
  const o = v as Partial<CommunityVoteResponse> | null;
  return typeof o?.up === "number" && typeof o.down === "number" && typeof o.hidden === "boolean";
}

/** โหวตหนึ่งครั้ง (`0` = ถอน) — คืนตัวนับของ server (ไม่ใช่ตัวนับที่เดาเอง) */
export async function castVote(
  id: string,
  value: CommunityVoteValue,
  deps: VoteDeps,
): Promise<CommunityResult<CommunityVoteResponse>> {
  const url = `/api/v1/community/reports/${encodeURIComponent(id)}/vote`;
  let token = deps.getVoterToken();
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!token) {
      const session = await newSession(deps);
      if (!session.ok) return session;
      token = session.value;
    }
    const res = await postJson<unknown>(url, { value }, { "X-Voter-Token": token });
    if (res.ok) {
      return isVoteResponse(res.value) ? { ok: true, value: res.value } : { ok: false, failure: "server", status: null };
    }
    if (res.failure !== "unauthorized" || attempt > 0) return res;
    // token หมดอายุ/ถูกหมุนกุญแจ — ล้างแล้วขอ session ใหม่ครั้งเดียว
    deps.setVoterToken(null);
    token = null;
  }
  return { ok: false, failure: "unauthorized", status: 401 };
}

/** ลบรายงานของฉันด้วย ownerToken ที่ได้ตอนส่ง */
export async function deleteOwnReport(id: string, ownerToken: string): Promise<CommunityResult<true>> {
  const res = await postJson<unknown>(`/api/v1/community/reports/${encodeURIComponent(id)}/delete`, { ownerToken });
  return res.ok ? { ok: true, value: true } : res;
}

/* ------------------------------------------------------------------ */
/* ส่งรายงานใหม่ (PR C — ฟอร์ม `ReportCompose`)                            */
/* ------------------------------------------------------------------ */

/**
 * ผลของ `POST /api/v1/community/reports` ที่ไม่สำเร็จ — แยกทุกแบบที่ API ตอบ (`routes/community.ts` +
 * `community/validate.ts` + 429/403 ของ router) ให้ UI บอกได้ตรงตัวว่า "ไม่ได้ส่ง เพราะอะไร"
 */
export type ReportFailure =
  /** 503 reporting-disabled */
  | "disabled"
  /** 503 turnstile-unreachable — server ถาม Cloudflare ไม่ได้ */
  | "turnstile-unreachable"
  /** 503 storage-failed — DO/R2 เก็บไม่ได้ */
  | "storage"
  /** 403 turnstile-failed — ยืนยันว่าเป็นคนไม่ผ่าน (token ใช้ครั้งเดียว: กดส่งใหม่ = widget ใหม่) */
  | "turnstile"
  /** Turnstile ฝั่งเบราว์เซอร์: โหลดสคริปต์ไม่ได้ (ไม่มีคำขอไป API) */
  | "turnstile-load"
  /** 429 report-cap — ครบเพดานรายงานของวันนี้ทั้งประเทศ */
  | "report-cap"
  /** 429 ของตัวจำกัดอัตราต่อ IP (ไม่มี reason) */
  | "rate-limit"
  /** 422 outside-thailand */
  | "outside-thailand"
  /** 422 image-metadata — รูปพก Exif/XMP */
  | "image-metadata"
  /** 422 image-invalid */
  | "image-invalid"
  /** 415 image-type */
  | "image-type"
  /** 413 body-too-large / image-too-large */
  | "too-large"
  /** 400 / 422 อื่น (หมวด ข้อความยาวเกิน พิกัด) */
  | "invalid"
  | "network"
  | "server";

export type ReportResult =
  | { ok: true; value: CommunityCreateResponse }
  | { ok: false; failure: ReportFailure; status: number | null };

/** สถานะ + `reason` → ชนิดความล้มเหลวของการส่งรายงาน (pure — เทสได้) */
export function reportFailureFor(status: number, reason: unknown): ReportFailure {
  switch (status) {
    case 503:
      if (reason === "reporting-disabled") return "disabled";
      if (reason === "turnstile-unreachable") return "turnstile-unreachable";
      if (reason === "storage-failed") return "storage";
      return "server";
    case 429:
      return reason === "report-cap" ? "report-cap" : "rate-limit";
    case 403:
      // 403 ที่ไม่มี reason คือด่าน same-origin ของ router — ไม่ใช่ความผิดของผู้ใช้
      return reason === "turnstile-failed" ? "turnstile" : "server";
    case 413:
      return "too-large";
    case 415:
      return "image-type";
    case 422:
      if (reason === "outside-thailand") return "outside-thailand";
      if (reason === "image-metadata") return "image-metadata";
      if (reason === "image-invalid") return "image-invalid";
      return "invalid";
    case 400:
      return "invalid";
    default:
      return "server";
  }
}

export interface ReportDraft {
  lat: number;
  lon: number;
  categories: readonly CommunityCategory[];
  description: string;
  /** รูปที่บีบอัดแล้ว (`lib/compressImage.ts`) — JPEG/WebP ไม่มี metadata; null = ไม่แนบ */
  image: Blob | null;
}

/** ทศนิยม 6 ตำแหน่ง ≈ 0.1 ม. — ละเอียดกว่าที่ปลายนิ้วเลือกได้อยู่แล้ว */
const COORD_DIGITS = 6;

/**
 * multipart ตามที่ `parseReportFields` อ่าน: `lat`/`lon` ข้อความทศนิยม, `categories` ฟิลด์ซ้ำหนึ่งตัวต่อหมวด,
 * `description`, `image` (ไฟล์ — ไม่มีเมื่อไม่แนบ), `turnstileToken`
 */
export function buildReportForm(draft: ReportDraft, turnstileToken: string): FormData {
  const form = new FormData();
  form.set("lat", draft.lat.toFixed(COORD_DIGITS));
  form.set("lon", draft.lon.toFixed(COORD_DIGITS));
  for (const c of draft.categories) form.append("categories", c);
  form.set("description", draft.description);
  if (draft.image) form.set("image", draft.image, draft.image.type === "image/webp" ? "photo.webp" : "photo.jpg");
  form.set("turnstileToken", turnstileToken);
  return form;
}

const REPORT_ID = /^[0-9]{8}-[A-Za-z0-9_-]{22}$/;

function isCreateResponse(v: unknown): v is CommunityCreateResponse {
  const o = v as Partial<CommunityCreateResponse> | null;
  const r = o?.report;
  return (
    typeof o?.ownerToken === "string" &&
    o.ownerToken !== "" &&
    typeof r === "object" &&
    r !== null &&
    typeof r.id === "string" &&
    REPORT_ID.test(r.id) &&
    typeof r.lat === "number" &&
    typeof r.lon === "number" &&
    typeof r.provinceCode === "string" &&
    Array.isArray(r.categories) &&
    typeof r.description === "string" &&
    typeof r.createdAt === "string" &&
    typeof r.up === "number" &&
    typeof r.down === "number"
  );
}

/**
 * ส่งรายงานหนึ่งครั้ง — **POST เดียวต่อการกดส่งหนึ่งครั้ง ไม่ลองซ้ำเองเด็ดขาด** (งบของ devops PR A: ผู้ใช้กดส่ง
 * ใหม่เองเท่านั้น) `Content-Length` มาจากเบราว์เซอร์ (FormData มีความยาวแน่นอน) ซึ่ง API บังคับให้มี
 */
export async function submitReport(draft: ReportDraft, turnstileToken: string): Promise<ReportResult> {
  let res: Response;
  try {
    res = await fetch("/api/v1/community/reports", { method: "POST", body: buildReportForm(draft, turnstileToken) });
  } catch {
    return { ok: false, failure: "network", status: null };
  }
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const reason = typeof parsed === "object" && parsed !== null ? (parsed as { reason?: unknown }).reason : undefined;
    return { ok: false, failure: reportFailureFor(res.status, reason), status: res.status };
  }
  if (res.status !== 201 || !isCreateResponse(parsed)) return { ok: false, failure: "server", status: res.status };
  return { ok: true, value: parsed };
}
