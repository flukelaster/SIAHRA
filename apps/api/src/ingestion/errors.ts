import type { util } from "zod/mini";

/**
 * ความผิดพลาดชนิด "ต้นทางส่งรูปร่างที่เราอ่านไม่ออก" — แยกจาก network/HTTP error
 * โดยตั้งใจ เพราะสองอย่างนี้ต้องรับมือคนละแบบ: HTTP 5xx คือ "ลองใหม่แล้วอาจได้"
 * ส่วน payload ที่ผิดรูปคือ "ลองใหม่กี่ครั้งก็ได้แบบเดิม" — ต้องหยุดเขียนทับของเดิม
 * แล้วแสดงตัวออกมาเป็น `degraded` + `lastError` แทน (AGENTS.md: แหล่งที่พังต้องมองเห็น)
 *
 * **ข้อความต้องขึ้นต้นด้วยชื่อต้นทางและ path ของ zod เสมอ** เพราะปลายทางที่เก็บมัน
 * ตัดข้อความไม่เท่ากัน (earthquake-feed ตัดที่ 120 ตัวอักษร, radar 200, flood 300)
 * ถ้าเอา path ไว้ท้ายข้อความ มันจะถูกตัดทิ้งในเส้นทางแผ่นดินไหวพอดี
 */
export class UpstreamShapeError extends Error {
  readonly source: string;
  /** path ของ zod ที่ผิด เช่น `waterlevel_data.data.12.station.tele_station_lat` */
  readonly path: string;

  constructor(source: string, path: string, detail: string) {
    super(truncate(`${source} shape: ${path || "<root>"} ${detail}`, 200));
    this.name = "UpstreamShapeError";
    this.source = source;
    this.path = path;
  }
}

/**
 * ข้อความสั้นที่สุดที่ยังบอกได้ว่าอะไรพัง — ใช้ตอนประกอบ `lastError` จากหลายฟีด
 *
 * `String(err)` บน `UpstreamShapeError` จะได้ `"UpstreamShapeError: thaiwater
 * rain_24h shape: …"` ซึ่งซ้ำซ้อนสองชั้น (ชื่อคลาส + ชื่อต้นทางที่ผู้เรียกมักใส่
 * นำหน้าอยู่แล้ว) พอเอาสองฟีดมาต่อกันแล้วตัดที่ 200 ตัวอักษร path ของฟีดหลังจะ
 * ถูกกินหายไปทั้งอัน — ซึ่งเป็นข้อมูลชิ้นเดียวที่บอกได้ว่าต้นทางเปลี่ยนรูปตรงไหน
 */
export function shortReason(err: unknown): string {
  if (err instanceof UpstreamShapeError) return err.message;
  // HTTP/เครือข่าย/ถูกพัก: ข้อความยาวได้ถึง 300 (มี snippet + header) แต่ `lastError` แบ่งงบ ≈95 ตัวอักษรต่อฟีด
  // (join แล้วตัดที่ 200) — ส่วนหัวที่ขึ้นต้นด้วย path + status จึงต้องมาก่อนเสมอและตัดจากท้าย
  if (err instanceof UpstreamHttpError || err instanceof UpstreamNetworkError || err instanceof UpstreamPausedError) {
    return truncate(err.message, SHORT_REASON_MAX);
  }
  return String(err);
}

/** งบต่อฟีดใน `lastError` (สองฟีด + "; " ต้องไม่เกิน 200) */
export const SHORT_REASON_MAX = 95;
/** เพดานข้อความเต็มที่เก็บใน `rainfallError` / `waterlevelError` / `damsError` */
export const FULL_REASON_MAX = 300;

/** ข้อความเต็มพร้อมรายละเอียดวินิจฉัย (≤ 300) — สำหรับช่องเก็บต่อฟีด ไม่ใช่ `lastError` รวม */
export function fullReason(err: unknown): string {
  return truncate(err instanceof UpstreamShapeError ? err.message : errText(err), FULL_REASON_MAX);
}

function errText(err: unknown): string {
  if (err instanceof UpstreamHttpError || err instanceof UpstreamNetworkError || err instanceof UpstreamPausedError) {
    return err.message;
  }
  return String(err);
}


// ---------------------------------------------------------------------------
// HTTP / เครือข่าย: แยกชนิดด้วย **ประเภทของ error** ไม่ใช่ regex บนข้อความ
// ---------------------------------------------------------------------------

/** เพดานของ Retry-After ที่ยอมเชื่อ — ต้นทางที่ขอรอเป็นวัน/ปีไม่ทำให้เราหยุดถามข้ามวัน */
export const RETRY_AFTER_MAX_MS = 60 * 60 * 1000;

/**
 * แปลงค่า header `Retry-After` เป็นมิลลิวินาที — **ที่เดียว** ที่ parse และครอบเพดาน
 * - delta-seconds (ตัวเลขล้วน): `"0"` = 0 ms (ต้นทางบอกว่าลองได้เลย ไม่ใช่ "ไม่มีค่า"); เกิน 7 หลัก = เพดานทันที
 *   (ไม่แปลงเป็น Number เพื่อกันค่าล้น)
 * - HTTP-date: ผ่าน `Date.parse` เทียบกับ `nowMs`; วันที่ในอดีต = 0 ms
 * - ว่าง / ลบ / อ่านไม่ออก = null (ไม่เดา)
 * ผลลัพธ์ถูกครอบที่ `RETRY_AFTER_MAX_MS`
 */
export function parseRetryAfter(value: string | null | undefined, nowMs: number = Date.now()): number | null {
  if (value === null || value === undefined) return null;
  const v = value.trim();
  if (v === "") return null;
  if (/^\d+$/.test(v)) return v.length > 7 ? RETRY_AFTER_MAX_MS : Math.min(RETRY_AFTER_MAX_MS, Number(v) * 1000);
  // "-5" / "12.5" / "abc" ไม่ใช่ delta-seconds และไม่ควรถูก Date.parse เดาเป็นวันที่
  if (/^[-+]?[\d.]+$/.test(v)) return null;
  const at = Date.parse(v);
  if (!Number.isFinite(at)) return null;
  return Math.min(RETRY_AFTER_MAX_MS, Math.max(0, at - nowMs));
}

export interface UpstreamHttpErrorInit {
  status: number;
  retryAfterMs: number | null;
  headers?: Record<string, string>;
}

/**
 * ต้นทางตอบ HTTP ที่ไม่ใช่ 2xx — `status` คือสิ่งเดียวที่ breaker ใช้ตัดสิน (ไม่อ่านข้อความ:
 * body ของ 403/404 ที่มีคำว่า "503" ต้องไม่นับเป็นต้นทางล่ม)
 * `message` ขึ้นต้นด้วย `ThaiWater <path> failed: <status> retry-after=<v>` เสมอ รายละเอียดวินิจฉัยอยู่ท้าย
 */
export class UpstreamHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;
  readonly headers?: Record<string, string>;

  constructor(message: string, init: UpstreamHttpErrorInit) {
    super(truncate(message, FULL_REASON_MAX));
    this.name = "UpstreamHttpError";
    this.status = init.status;
    this.retryAfterMs = init.retryAfterMs;
    this.headers = init.headers;
  }
}

/** อ่าน body ของคำตอบที่ล้มเหลวได้ไม่เกินเท่านี้ (ไบต์) — 429 ต้องไม่ดึง payload หลาย MB มาทั้งก้อน */
export const ERROR_BODY_PEEK_MAX = 2048;
/** snippet ที่ใส่ในข้อความ error (หลังตัด tag / control char / ช่องว่างซ้ำ) */
export const ERROR_SNIPPET_MAX = 200;
const HEADER_VALUE_MAX = 64;

/**
 * อ่านต้น body ไม่เกิน `capBytes` แล้ว **cancel** สตรีม — ห้ามใช้ `res.text()`/`json()` บนทางล้มเหลว
 * ใช้ BYOB reader เมื่อทำได้ (ไบต์ที่ดึงจริงไม่เกินเพดานแน่นอน); สตรีมที่ไม่ใช่ byte stream ใช้ reader ปกติ
 * ซึ่งหยุดได้แค่ระหว่าง chunk. body เป็น null / อ่านพลาด = สตริงว่าง (ห้ามโยน — นี่คือทางวินิจฉัย)
 */
export async function readBodyPrefix(res: Response, capBytes: number = ERROR_BODY_PEEK_MAX): Promise<string> {
  const body = res.body;
  if (!body) return "";
  try {
    let byob: ReadableStreamBYOBReader | null = null;
    try {
      byob = body.getReader({ mode: "byob" });
    } catch {
      byob = null;
    }
    if (byob) {
      let buffer = new ArrayBuffer(capBytes);
      let offset = 0;
      try {
        while (offset < capBytes) {
          const { done, value } = await byob.read(new Uint8Array(buffer, offset, capBytes - offset));
          if (value) buffer = value.buffer as ArrayBuffer;
          if (done || !value) break;
          offset += value.byteLength;
        }
      } finally {
        await byob.cancel().catch(() => undefined);
      }
      return new TextDecoder().decode(new Uint8Array(buffer, 0, offset));
    }
    const reader = body.getReader();
    const parts: Uint8Array[] = [];
    let total = 0;
    try {
      while (total < capBytes) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        parts.push(value);
        total += value.byteLength;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const all = new Uint8Array(total);
    let at = 0;
    for (const part of parts) {
      all.set(part, at);
      at += part.byteLength;
    }
    return new TextDecoder().decode(all.subarray(0, capBytes));
  } catch {
    return "";
  }
}

/** ตัด tag / control char / ช่องว่างซ้ำ แล้วครอบความยาว — body ของ 429 มักเป็น HTML ของ WAF */
export function sanitizeSnippet(text: string, max: number = ERROR_SNIPPET_MAX): string {
  const cleaned = text
    .replace(/<[^>]*>/g, " ")
    // tag ที่ถูกตัดกลางคันตรงเพดานไบต์
    .replace(/<[^>]*$/, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length <= max ? cleaned : cleaned.slice(0, max);
}

const HEADER_ALLOWLIST = /^(retry-after|server|via|cf-ray|content-type|x-.*rate-?limit.*)$/i;

/** header ที่ปลอดภัยพอจะใส่ในข้อความ error — allowlist เท่านั้น (ไม่มี set-cookie / authorization ฯลฯ) */
export function allowedHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    const key = name.toLowerCase();
    if (!HEADER_ALLOWLIST.test(key)) return;
    out[key] = sanitizeSnippet(value, HEADER_VALUE_MAX);
  });
  return out;
}

/**
 * สร้าง `UpstreamHttpError` จากคำตอบที่ !ok — **เรียกเฉพาะทางล้มเหลว** (ทางปกติไม่แตะ body ผ่านที่นี่)
 * ข้อความ: `<label> failed: <status> retry-after=<v>` นำหน้าเสมอ แล้วตามด้วย snippet และ header ท้ายสุด
 * (ผู้ประกอบ `lastError` ตัดจากท้าย จึงเสียแต่รายละเอียด ไม่เสีย status)
 */
export async function upstreamHttpError(label: string, res: Response): Promise<UpstreamHttpError> {
  const retryAfterRaw = res.headers.get("retry-after");
  const retryAfterMs = parseRetryAfter(retryAfterRaw);
  const snippet = sanitizeSnippet(await readBodyPrefix(res));
  const headers = allowedHeaders(res.headers);
  const shown = Object.entries(headers)
    .filter(([k]) => k !== "retry-after")
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const retryText = retryAfterRaw === null ? "none" : sanitizeSnippet(retryAfterRaw, HEADER_VALUE_MAX) || "none";
  const parts = [`${label} failed: ${res.status} retry-after=${retryText}`];
  if (snippet) parts.push(snippet);
  if (shown) parts.push(shown);
  return new UpstreamHttpError(parts.join(" | "), { status: res.status, retryAfterMs, headers });
}

/** `fetch()` โยนเอง (ต่อไม่ติด / หลุดกลางทาง / body อ่านไม่จบ) — ต่างจาก HTTP ที่ต้นทางตอบมาแล้ว */
export class UpstreamNetworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(truncate(message, FULL_REASON_MAX), options);
    this.name = "UpstreamNetworkError";
  }
}

/** คิวต้นทางปฏิเสธงานเพราะ breaker พักอยู่ (หรือมี probe ค้างอยู่) — ไม่ได้ยิงต้นทางเลย */
export class UpstreamPausedError extends Error {
  readonly key: string;
  /** ms epoch ที่การพักสิ้นสุด — 0 = ไม่ได้พักเป็นเวลา แต่มี probe ของ half-open ค้างอยู่ */
  readonly until: number;
  constructor(key: string, until: number) {
    super(
      until > 0
        ? `upstream ${key} paused until ${new Date(until).toISOString()} (circuit breaker)`
        : `upstream ${key} probe in flight (circuit breaker half-open)`,
    );
    this.name = "UpstreamPausedError";
    this.key = key;
    this.until = until;
  }
}

/** ต้นทางแออัด/ล่ม: 429, 502, 503, 504 หรือเครือข่ายล้ม — ตัดสินจากชนิด error เท่านั้น */
export function isUpstreamOverload(err: unknown): boolean {
  if (err instanceof UpstreamNetworkError) return true;
  return err instanceof UpstreamHttpError && (err.status === 429 || err.status === 502 || err.status === 503 || err.status === 504);
}

/** เพดานความยาวข้อความตาม AC: ≤200 ตัวอักษร รวมส่วนที่บอก path แล้ว */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function formatPath(path: readonly PropertyKey[]): string {
  return path.map((p) => String(p)).join(".");
}

/**
 * ตรวจ payload หนึ่งก้อนด้วย schema แล้ว **โยนทิ้งผลลัพธ์** — คืนค่าเดิมที่รับเข้ามา
 *
 * จงใจไม่คืน output ของ zod เพราะ object schema ของ zod ตัดคีย์ที่ไม่ได้ประกาศทิ้ง
 * ตัว mapper ของแต่ละ adapter อ่านฟิลด์จาก payload ดิบอยู่แล้ว การสลับไปใช้ค่าที่
 * ผ่าน zod จะเปลี่ยนพฤติกรรมเงียบ ๆ ตรงฟิลด์ที่ schema ยังไม่รู้จัก — งานนี้ต้องการ
 * "ประตูตรวจ" ไม่ใช่ "ตัวแปลง"
 */
export function assertShape<T>(
  source: string,
  schema: { safeParse: (data: unknown) => util.SafeParseResult<unknown> },
  data: T,
  pathPrefix = "",
): T {
  const result = schema.safeParse(data);
  if (result.success) return data;
  const issue = result.error.issues[0];
  const path = [pathPrefix, formatPath(issue.path ?? [])].filter(Boolean).join(".");
  throw new UpstreamShapeError(source, path, `${issue.code}: ${issue.message}`);
}

/**
 * อ่าน body เป็น JSON โดยแปลง "JSON ที่พังกลางคัน" ให้เป็น `UpstreamShapeError`
 * เหมือนกับ payload ที่รูปร่างผิด — ทั้งสองกรณีคือ "สิ่งที่ต้นทางส่งมาใช้ไม่ได้"
 * และต้องเดินเส้นทางเดียวกัน (คงข้อมูลเดิม + degraded) ถ้าปล่อยเป็น SyntaxError
 * ดิบ ๆ ข้อความที่ไปโผล่ที่ /health จะไม่บอกด้วยซ้ำว่าต้นทางไหนเป็นคนส่งมา
 */
export async function readUpstreamJson(source: string, res: Response): Promise<unknown> {
  // body ที่หลุดกลางทางคือความล้มเหลวของเครือข่าย ไม่ใช่ "รูปร่างผิด" — แยกชนิดให้ breaker เห็น
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    throw new UpstreamNetworkError(`${source} body read failed: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new UpstreamShapeError(source, "<body>", `invalid JSON (${text.length} bytes): ${String(err)}`);
  }
}
