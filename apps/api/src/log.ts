/**
 * บรรทัด log ที่มีรูปร่างเดียวกันทั้ง Worker (E5.3)
 *
 * เดิมทุกจุดประกอบ JSON เองด้วยมือ (`console.error(JSON.stringify({ level, message, ... }))`)
 * ผลคือรูปร่างไม่ตรงกัน: บางบรรทัดมี `level` บางบรรทัดสะกดคีย์ต่างกัน และ
 * **ไม่มีบรรทัดไหนมีเวลาเลย** — `wrangler tail` ใส่เวลาให้ตอนสตรีม แต่ log ที่
 * ถูก pipe ต่อ/เก็บลงไฟล์แล้วจะไม่มีอะไรบอกว่าเกิดเมื่อไร ทำให้ไล่เหตุการณ์
 * ข้ามต้นทางไม่ได้ ซึ่งเป็นสิ่งเดียวที่ runbook ใน docs/ops.md ต้องพึ่ง
 *
 * สัญญาของรูปร่าง — ทุกบรรทัดคือ JSON หนึ่งบรรทัดที่มีคีย์ครบสามตัวนี้เสมอ:
 *   { "level": "info"|"warn"|"error", "ts": <ISO-8601 UTC>, "message": <string>, ...fields }
 * ทำให้ `wrangler tail --format json | jq 'select(.level=="error")'` ใช้ได้จริง
 *
 * ปลายทาง: `info` → stdout, `warn`/`error` → stderr (คงพฤติกรรมเดิมของทุกจุดที่
 * ใช้ `console.error` กับ `level: "warn"` ไว้ ไม่ให้ระดับความดังของ log เปลี่ยน)
 *
 * **ไม่ใช่ที่เก็บสถานะสุขภาพ** — ข้อความที่ผู้ใช้ต้องเห็นต้องไปอยู่ที่
 * `writeMeta("lastError", ...)` ของ DO แล้วโผล่ที่ /api/v1/health เสมอ log
 * เป็นของผู้ดูแลระบบเท่านั้น การเขียน log ไม่นับว่า "แสดงความเสื่อมให้เห็นแล้ว"
 */
export type LogLevel = "info" | "warn" | "error";

export interface LogFields {
  readonly [key: string]: unknown;
}

/** ความยาวสูงสุดของข้อความ error ในหนึ่งบรรทัด — กัน stack ยาวกลบบรรทัดอื่นใน tail */
const MAX_ERROR_CHARS = 300;

/** แปลง error ที่ถูกโยนมาแบบไหนก็ได้ให้เป็นข้อความเดียวที่อ่านออก */
export function errorText(err: unknown, maxChars = MAX_ERROR_CHARS): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

export function log(level: LogLevel, message: string, fields: LogFields = {}): void {
  const line: Record<string, unknown> = { level, ts: new Date().toISOString(), message };
  for (const [key, value] of Object.entries(fields)) {
    // `undefined` หายไปเงียบ ๆ ตอน JSON.stringify อยู่แล้ว — ตัดทิ้งตรงนี้เพื่อให้
    // ชุดคีย์ของบรรทัดตรงกับที่โค้ดตั้งใจ ไม่ใช่ผลข้างเคียงของ serializer
    if (value === undefined) continue;
    if (key === "level" || key === "ts" || key === "message") continue;
    line[key] = value instanceof Error ? errorText(value) : value;
  }
  const text = JSON.stringify(line);
  if (level === "info") console.log(text);
  else console.error(text);
}

export const logInfo = (message: string, fields?: LogFields): void => log("info", message, fields);
export const logWarn = (message: string, fields?: LogFields): void => log("warn", message, fields);
export const logError = (message: string, fields?: LogFields): void => log("error", message, fields);

/**
 * สำหรับผู้เรียกที่ประกอบบรรทัดไว้ก่อนแล้ว (seam `log` ของ scheduledTick ที่เทส
 * ดักบรรทัดแทน stdout) — ดึง level/message ออกมาแล้วส่งเข้าทางเดียวกัน เพื่อให้
 * บรรทัดที่ออกจริงมีรูปร่างเดียวกับที่อื่นทั้งหมด
 */
export function logRecord(line: Record<string, unknown>): void {
  const { level, message, ...rest } = line;
  const lvl: LogLevel = level === "info" || level === "warn" || level === "error" ? level : "info";
  log(lvl, typeof message === "string" ? message : "log", rest);
}
