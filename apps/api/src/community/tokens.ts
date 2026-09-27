/**
 * ตัวตนแบบนิรนามของรายงานจากประชาชน — HMAC-SHA256 ของ Web Crypto ล้วน ไม่มีตาราง session
 *
 * - **voterToken** = `${voterId}.${HMAC(key, "voter:" + voterId)}` โดย `voterId` สุ่ม 128 บิต (base64url)
 *   ออกให้หลังผ่าน Turnstile ครั้งเดียว — Worker ตรวจลายเซ็นก่อนเรียก DO ทุกครั้ง (devops VOTE-3) และ DO
 *   เก็บแค่ `voterId` ในตาราง votes ไม่มี IP ไม่มีอะไรที่ย้อนไปหาตัวคนได้
 * - **ownerToken** = `HMAC(key, "owner:" + id)` — server ไม่เก็บค่านี้เลย คำนวณซ้ำตอนตรวจ
 *
 * การเทียบใช้ `crypto.subtle.verify` (เวลาคงที่ตามสเปก Web Crypto) และ `timingSafeEqual` ของ workerd
 * สำหรับ bearer ของผู้ดูแล — ไม่เคยเทียบสตริงลับด้วย `===`
 *
 * เปลี่ยน `COMMUNITY_HMAC_KEY` = token เดิมทุกใบใช้ไม่ได้ทันที (โหวต/ลบรายงานของตัวเองไม่ได้จนขอใหม่)
 */

const enc = new TextEncoder();

/** base64url ของ `voterId` 16 ไบต์ = 22 ตัว, ลายเซ็น SHA-256 32 ไบต์ = 43 ตัว */
const VOTER_TOKEN_RE = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;
const SIG_RE = /^[A-Za-z0-9_-]{43}$/;

let cached: { secret: string; key: Promise<CryptoKey> } | null = null;

function hmacKey(secret: string): Promise<CryptoKey> {
  if (cached?.secret !== secret) {
    cached = {
      secret,
      key: crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
        "sign",
        "verify",
      ]),
    };
  }
  return cached.key;
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** base64url ของไบต์สุ่ม — 16 ไบต์ = 128 บิต (≥ 96 บิตตาม devops IMAGE-1) */
export function randomToken(bytes = 16): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sign(secret: string, message: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(message));
  return toBase64Url(new Uint8Array(sig));
}

async function verify(secret: string, message: string, sigB64: string): Promise<boolean> {
  if (!SIG_RE.test(sigB64)) return false;
  return crypto.subtle.verify("HMAC", await hmacKey(secret), fromBase64Url(sigB64), enc.encode(message));
}

export async function issueVoterToken(secret: string): Promise<string> {
  const voterId = randomToken(16);
  return `${voterId}.${await sign(secret, `voter:${voterId}`)}`;
}

/** `voterId` เมื่อลายเซ็นถูก, `null` เมื่อไม่มี/รูปผิด/ปลอม */
export async function verifyVoterToken(secret: string, token: string | null): Promise<string | null> {
  const m = token ? VOTER_TOKEN_RE.exec(token) : null;
  if (!m) return null;
  return (await verify(secret, `voter:${m[1]}`, m[2]!)) ? m[1]! : null;
}

export function ownerTokenFor(secret: string, reportId: string): Promise<string> {
  return sign(secret, `owner:${reportId}`);
}

export function verifyOwnerToken(secret: string, reportId: string, token: unknown): Promise<boolean> {
  if (typeof token !== "string") return Promise.resolve(false);
  return verify(secret, `owner:${reportId}`, token);
}

/**
 * `Authorization: Bearer <COMMUNITY_ADMIN_TOKEN>` — hash ทั้งสองข้างก่อน แล้วเทียบด้วย `timingSafeEqual`
 * (ความยาวเท่ากันเสมอหลัง hash จึงไม่รั่วความยาวของกุญแจ)
 */
export async function bearerMatches(expected: string, header: string | null): Promise<boolean> {
  const m = header ? /^Bearer (.+)$/.exec(header) : null;
  if (!m) return false;
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
    crypto.subtle.digest("SHA-256", enc.encode(m[1]!)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}
