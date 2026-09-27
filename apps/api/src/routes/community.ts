import {
  COMMUNITY_MAX_BODY_BYTES,
  isProvinceCode,
  type CommunityCreateResponse,
  type CommunityRejectReason,
  type CommunitySessionResponse,
  type CommunityVoteValue,
} from "@siahra/shared-types";
import * as cachePolicy from "../cachePolicy.js";
import { json } from "../router.js";
import type { AppEnv } from "../types.js";
import { errorText, logError } from "../log.js";
import { provinceCodeAt } from "../geo/provinceRings.js";
import {
  bearerMatches,
  issueVoterToken,
  ownerTokenFor,
  verifyOwnerToken,
  verifyVoterToken,
} from "../community/tokens.js";
import {
  REPORT_ID_RE,
  declaredLengthWithin,
  imageKeyFor,
  newReportId,
  parseReportFields,
  readCappedBody,
} from "../community/validate.js";

/**
 * รายงานผลกระทบจากประชาชน — ทุกเส้นทางของ `/api/v1/community/*`
 *
 * งบต้นทุนจาก devops (ตัวย่อตรงกับ acceptance criteria):
 * - LIST-1 รหัสจังหวัดตรวจที่นี่ (ไม่รู้จัก = 404, 0 DO call), มี query = 400, แคชขอบคีย์ origin+pathname
 *   และแคช **ทุก** 200 (รวมรายการว่าง) `s-maxage=30`; ข้อผิดพลาด `no-store`
 * - REPORT-1 ลำดับ: Content-Length (413) → Turnstile siteverify **ที่ Worker** → ตรวจฟิลด์/รูป →
 *   DO จองเพดาน → `HAZARD_BUCKET.put` หลัง DO รับแล้วเท่านั้น → DO เขียนแถว; ≤ 2 DO call ต่อคำขอ
 * - VOTE-3 ลายเซ็น `X-Voter-Token` ตรวจก่อนเรียก DO; `/session` ไม่เรียก DO เลย
 * - IMAGE-1 เส้นทางรูปไม่เรียก DO: คีย์ R2 คิดจาก id ใน path, id ผิดรูป = 404 ก่อนแตะ R2
 * - LOGS-1 ไม่มี log บนเส้นทางที่สำเร็จ และไม่มี log ต่อคำขอที่ถูกปฏิเสธ — `logError` เมื่อระบบล้มเหลวเท่านั้น
 */

/** instance เดียวทั้งประเทศ */
export const COMMUNITY_INSTANCE = "primary";
export const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** body JSON เล็ก ๆ ของ session / vote / owner delete */
const SMALL_BODY_BYTES = 4096;
/** token ของ Turnstile ยาวไม่เกิน 2048 ตัวตามเอกสาร — ยาวกว่านั้นไม่ต้องถาม Cloudflare */
const TURNSTILE_TOKEN_MAX = 2048;
const SITEVERIFY_TIMEOUT_MS = 5000;

const reject = (status: number, reason: CommunityRejectReason, error: string): Response =>
  json({ error, reason }, { status });

const disabled = (): Response => reject(503, "reporting-disabled", "Community reporting is not enabled on this server");

/**
 * ถาม Turnstile ว่า token นี้ผ่านไหม — ที่ Worker เท่านั้น ไม่เคยใน DO (DO-1)
 * ส่ง IP ไปให้ Cloudflare ช่วยตัดสิน (ไม่เก็บที่ไหน); ถามไม่ได้ ≠ token ผิด จึงแยกเป็น 503
 */
async function siteverify(secret: string, token: unknown, request: Request): Promise<"ok" | "rejected" | "unreachable"> {
  if (typeof token !== "string" || token === "" || token.length > TURNSTILE_TOKEN_MAX) return "rejected";
  const form = new FormData();
  form.set("secret", secret);
  form.set("response", token);
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) form.set("remoteip", ip);
  try {
    const res = await fetch(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
    if (!res.ok) {
      logError("turnstile siteverify failed", { status: res.status });
      return "unreachable";
    }
    const body = (await res.json()) as { success?: unknown };
    return body.success === true ? "ok" : "rejected";
  } catch (err) {
    logError("turnstile siteverify failed", { error: errorText(err) });
    return "unreachable";
  }
}

function turnstileRejection(result: "rejected" | "unreachable"): Response {
  return result === "rejected"
    ? reject(403, "turnstile-failed", "Human verification failed — try again")
    : reject(503, "turnstile-unreachable", "Human verification service could not be reached");
}

/** JSON เล็ก ๆ — ต้องมี Content-Length ≤ 4 KB (อ่านซ้ำแบบจำกัดไบต์) */
async function readSmallJson(request: Request): Promise<Record<string, unknown> | Response> {
  if (!declaredLengthWithin(request, SMALL_BODY_BYTES)) return reject(413, "body-too-large", "Request body too large");
  const bytes = await readCappedBody(request, SMALL_BODY_BYTES);
  if (!bytes) return reject(413, "body-too-large", "Request body too large");
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // ตกลงไปตอบ 400 ข้างล่าง
  }
  return reject(400, "bad-request", "Body must be a JSON object");
}

/** GET /api/v1/community/{code}/reports */
export async function handleCommunityList(
  request: Request,
  env: AppEnv,
  [code]: string[],
  ctx: ExecutionContext,
): Promise<Response> {
  if (!code || !isProvinceCode(code)) return json({ error: "Unknown province" }, { status: 404 });
  const url = new URL(request.url);
  if (url.search !== "") return json({ error: "This endpoint takes no query parameters" }, { status: 400 });
  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}${url.pathname}`, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  let body;
  try {
    body = await env.COMMUNITY_REPORT.getByName(COMMUNITY_INSTANCE).list(code);
  } catch (err) {
    logError("community list failed", { error: errorText(err) });
    return json({ error: "Community reports unavailable" }, { status: 503 });
  }
  const res = json(body, { cache: cachePolicy.communityList });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

/** POST /api/v1/community/reports (multipart) → 201 {report, ownerToken} */
export async function handleCommunityCreate(request: Request, env: AppEnv): Promise<Response> {
  const turnstileSecret = env.TURNSTILE_SECRET_KEY;
  const hmacKey = env.COMMUNITY_HMAC_KEY;
  if (!turnstileSecret || !hmacKey) return disabled();
  if (!declaredLengthWithin(request, COMMUNITY_MAX_BODY_BYTES)) {
    return reject(413, "body-too-large", `Request body must declare Content-Length ≤ ${COMMUNITY_MAX_BODY_BYTES}`);
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return reject(400, "bad-request", "Body must be multipart/form-data");
  }
  const bytes = await readCappedBody(request, COMMUNITY_MAX_BODY_BYTES);
  if (!bytes) return reject(413, "body-too-large", "Request body too large");
  let form: FormData;
  try {
    form = await new Response(bytes, { headers: { "content-type": contentType } }).formData();
  } catch {
    return reject(400, "bad-request", "Malformed multipart body");
  }

  const verdict = await siteverify(turnstileSecret, form.get("turnstileToken"), request);
  if (verdict !== "ok") return turnstileRejection(verdict);

  const fields = await parseReportFields(form);
  if ("ok" in fields) return reject(fields.status, fields.reason, fields.error);
  const provinceCode = provinceCodeAt(fields.lon, fields.lat);
  if (provinceCode === null) return reject(422, "outside-thailand", "The location is outside Thailand's provinces");

  const createdMs = Date.now();
  const id = newReportId(createdMs);
  const imageKey = fields.image ? imageKeyFor(id) : null;
  const row = {
    id,
    provinceCode,
    lat: fields.lat,
    lon: fields.lon,
    categories: fields.categories,
    description: fields.description,
    imageKey,
    createdMs,
  };
  const stub = env.COMMUNITY_REPORT.getByName(COMMUNITY_INSTANCE);
  const capReached = () =>
    reject(429, "report-cap", "Today's nationwide report limit has been reached — try again tomorrow");
  let result;
  try {
    if (!fields.image || !imageKey) {
      // ไม่มีรูป: จอง + เขียนในคำขอเดียว
      result = await stub.insertReport(row, true);
    } else {
      // มีรูป: จอง (DO call 1) → put → เขียนแถว (DO call 2) — put ไม่เกิดถ้าเพดานเต็ม
      if (!(await stub.reserveUpload(createdMs))) return capReached();
      try {
        await env.HAZARD_BUCKET.put(imageKey, fields.image.bytes, {
          httpMetadata: { contentType: fields.image.contentType },
        });
      } catch (err) {
        logError("community image put failed", { error: errorText(err) });
        return reject(503, "storage-failed", "The image could not be stored — try again");
      }
      try {
        result = await stub.insertReport(row, false);
      } catch (err) {
        // แถวไม่ถูกเขียน: เก็บกวาดรูปทันที (ถ้าพลาดอีก lifecycle 30 วันของ R2 เก็บให้) — ไม่มีแถวชี้หารูปที่หาย
        await env.HAZARD_BUCKET.delete(imageKey).catch(() => {});
        throw err;
      }
    }
  } catch (err) {
    logError("community create failed", { error: errorText(err) });
    return reject(503, "storage-failed", "The report could not be stored — try again");
  }
  if (!result.ok) return capReached();
  const body: CommunityCreateResponse = { report: result.report, ownerToken: await ownerTokenFor(hmacKey, id) };
  return json(body, { status: 201 });
}

/** POST /api/v1/community/session — Turnstile → voterToken ที่ลงนามแล้ว (0 DO call, 0 DO write) */
export async function handleCommunitySession(request: Request, env: AppEnv): Promise<Response> {
  const turnstileSecret = env.TURNSTILE_SECRET_KEY;
  const hmacKey = env.COMMUNITY_HMAC_KEY;
  if (!turnstileSecret || !hmacKey) return disabled();
  const body = await readSmallJson(request);
  if (body instanceof Response) return body;
  const verdict = await siteverify(turnstileSecret, body.turnstileToken, request);
  if (verdict !== "ok") return turnstileRejection(verdict);
  const res: CommunitySessionResponse = { voterToken: await issueVoterToken(hmacKey) };
  return json(res);
}

/** POST /api/v1/community/reports/{id}/vote — `{value: 1 | -1 | 0}` + `X-Voter-Token` */
export async function handleCommunityVote(request: Request, env: AppEnv, [id]: string[]): Promise<Response> {
  const hmacKey = env.COMMUNITY_HMAC_KEY;
  if (!hmacKey) return disabled();
  const voterId = await verifyVoterToken(hmacKey, request.headers.get("X-Voter-Token"));
  if (!voterId) return reject(401, "unauthorized", "Missing or invalid voter token");
  if (!id || !REPORT_ID_RE.test(id)) return reject(404, "not-found", "Report not found");
  const body = await readSmallJson(request);
  if (body instanceof Response) return body;
  const value = body.value;
  if (value !== 1 && value !== -1 && value !== 0) return reject(400, "bad-request", "value must be 1, -1 or 0");
  let result;
  try {
    result = await env.COMMUNITY_REPORT.getByName(COMMUNITY_INSTANCE).vote(id, voterId, value as CommunityVoteValue);
  } catch (err) {
    logError("community vote failed", { error: errorText(err) });
    return json({ error: "Community reports unavailable" }, { status: 503 });
  }
  if (!result.ok) {
    return result.reason === "not-found"
      ? reject(404, "not-found", "Report not found")
      : reject(429, "vote-cap", "Today's nationwide vote limit has been reached — try again tomorrow");
  }
  return json({ up: result.up, down: result.down, hidden: result.hidden });
}

/** POST /api/v1/community/reports/{id}/delete — `{ownerToken}` ที่ได้ตอนสร้าง */
export async function handleCommunityOwnerDelete(request: Request, env: AppEnv, [id]: string[]): Promise<Response> {
  const hmacKey = env.COMMUNITY_HMAC_KEY;
  if (!hmacKey) return disabled();
  if (!id || !REPORT_ID_RE.test(id)) return reject(404, "not-found", "Report not found");
  const body = await readSmallJson(request);
  if (body instanceof Response) return body;
  if (!(await verifyOwnerToken(hmacKey, id, body.ownerToken))) {
    return reject(401, "unauthorized", "Missing or invalid owner token");
  }
  return deleteVia(env, id);
}

async function deleteVia(env: AppEnv, id: string): Promise<Response> {
  let found;
  try {
    found = await env.COMMUNITY_REPORT.getByName(COMMUNITY_INSTANCE).deleteReport(id);
  } catch (err) {
    logError("community delete failed", { error: errorText(err) });
    return json({ error: "Community reports unavailable" }, { status: 503 });
  }
  return found ? json({ deleted: true }) : reject(404, "not-found", "Report not found");
}

/** POST /api/v1/community/admin/reports/{id}/(hide|unhide|delete) — `Authorization: Bearer …` */
export async function handleCommunityAdmin(request: Request, env: AppEnv, [id, action]: string[]): Promise<Response> {
  const adminToken = env.COMMUNITY_ADMIN_TOKEN;
  if (!adminToken) return reject(503, "admin-disabled", "Community moderation is not enabled on this server");
  if (!(await bearerMatches(adminToken, request.headers.get("Authorization")))) {
    return reject(401, "unauthorized", "Missing or invalid admin token");
  }
  if (!id || !REPORT_ID_RE.test(id)) return reject(404, "not-found", "Report not found");
  if (action === "delete") return deleteVia(env, id);
  if (action !== "hide" && action !== "unhide") return reject(404, "not-found", "Unknown action");
  let state;
  try {
    state = await env.COMMUNITY_REPORT.getByName(COMMUNITY_INSTANCE).moderate(id, action);
  } catch (err) {
    logError("community moderation failed", { error: errorText(err) });
    return json({ error: "Community reports unavailable" }, { status: 503 });
  }
  return state ? json(state) : reject(404, "not-found", "Report not found");
}

/** GET /api/v1/community/image/{id} — R2 ตรง ๆ ไม่ถาม DO; แคชขอบเฉพาะ 200 หนึ่งชั่วโมง */
export async function handleCommunityImage(
  request: Request,
  env: AppEnv,
  [id]: string[],
  ctx: ExecutionContext,
): Promise<Response> {
  const key = id ? imageKeyFor(id) : null;
  if (!key) return json({ error: "Image not found" }, { status: 404 });
  const url = new URL(request.url);
  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}${url.pathname}`, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  const object = await env.HAZARD_BUCKET.get(key);
  if (!object) return json({ error: "Image not found" }, { status: 404 });
  const stored = object.httpMetadata?.contentType;
  const contentType = stored === "image/jpeg" || stored === "image/webp" ? stored : "application/octet-stream";
  const res = new Response(object.body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": cachePolicy.communityImage.value,
      ETag: object.httpEtag,
    },
  });
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
