/**
 * คำขอเขียนของรายงานจากประชาชน (โหวต / ลบรายงานของฉัน) — ใช้เฉพาะจากแผงรายงาน (chunk แยก)
 *
 * ผลลัพธ์ทุกแบบถูกแยกเป็น `CommunityFailure` ที่ UI แปลเป็นข้อความตรงตัว — ปิดรับชั่วคราว (503
 * reporting-disabled) ≠ ครบเพดานโหวตของวันทั้งประเทศ (429 vote-cap) ≠ ถี่เกินไป (429 ของตัวจำกัดอัตรา) ≠
 * เครือข่ายล้มเหลว ≠ ยืนยันว่าเป็นคนไม่ผ่าน — ไม่มีกรณีไหนถูกพูดว่า "สำเร็จ" หรือกลืนเงียบ
 *
 * การโหวต: ใช้ `voterToken` ที่เก็บไว้ ถ้าไม่มี → Turnstile → `POST /community/session`; server ตอบ 401 (token
 * หมดอายุ/ไม่ถูกต้อง) → ล้าง token แล้วขอ session ใหม่ **ครั้งเดียว** แล้วลองโหวตซ้ำ
 */
import type { CommunityVoteResponse, CommunityVoteValue } from "@siahra/shared-types";

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
