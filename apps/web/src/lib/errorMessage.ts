/**
 * ข้อความผิดพลาดของ hooks เก็บเป็น "คีย์" ไม่ใช่ "ข้อความที่แปลแล้ว"
 *
 * ถ้า hook เรียกตัวแปลตอนที่ fetch ล้มเหลว ข้อความจะถูกตรึงเป็นภาษา ณ วินาทีนั้น
 * แล้วค้างอยู่บนหน้าจอต่อไปแม้ผู้ใช้จะกดสลับภาษา — ข้อความไทยบนหน้าอังกฤษ
 * การเลื่อนการแปลไปทำตอนเรนเดอร์ทำให้ทุกข้อความตามภาษาปัจจุบันเสมอ
 *
 * `raw` มีไว้สำหรับข้อความที่ **ไม่ใช่ของเรา** เช่น `err.message` จาก fetch หรือ
 * `HTTP 503` — แปลไม่ได้และไม่ควรแปล เพราะจะกลายเป็นการเขียนสิ่งที่ระบบไม่ได้พูด
 */
import type { MessageKey, TFunction } from "../i18n";

export type ErrorMessage = { key: MessageKey } | { raw: string };

/** `err.message` ถ้ามี (คงข้อความจริงไว้) มิฉะนั้นใช้คีย์สำรองที่ส่งมา */
export function errorMessage(err: unknown, fallbackKey: MessageKey): ErrorMessage {
  return err instanceof Error ? { raw: err.message } : { key: fallbackKey };
}

/** แปลตอนเรนเดอร์ — เรียกจากคอมโพเนนต์ที่รู้ภาษาปัจจุบันเท่านั้น */
export function resolveError(t: TFunction, e: ErrorMessage | null): string | null {
  if (!e) return null;
  return "key" in e ? t(e.key) : e.raw;
}
