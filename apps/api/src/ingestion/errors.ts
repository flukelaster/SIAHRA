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
  return err instanceof UpstreamShapeError ? err.message : String(err);
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
  const text = await res.text();
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new UpstreamShapeError(source, "<body>", `invalid JSON (${text.length} bytes): ${String(err)}`);
  }
}
