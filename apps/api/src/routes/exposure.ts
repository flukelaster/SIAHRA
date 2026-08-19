import { isProvinceCode, type FloodExposureRun } from "@siahra/shared-types";
import { getJsonGz } from "../archive.js";
import * as cachePolicy from "../cachePolicy.js";
import { EXPOSURE_POINTER_NAME, RUN_ID_RE, exposureRunKey, scopeToProvince } from "../exposure/publish.js";
import { json } from "../router.js";
import type { AppEnv } from "../types.js";
import { errorText, logError } from "../log.js";

/**
 * เส้นทางของ "ระดับการเผชิญน้ำ (ภาพประกอบ)" (E10.3)
 *
 * มีสองเส้นทางที่ทำหน้าที่ต่างกันคนละขั้ว และนั่นคือเหตุผลที่นโยบายแคชคนละอัน:
 * - `/provinces/{NN}/exposure/latest` — ตัวชี้ที่ขยับได้ ต้องแคชสั้น
 * - `/exposure/runs/{runId}` — artefact ที่แช่แข็งแล้ว คีย์ผูกกับเนื้อหา แคชได้ยาว
 *
 * run ถูกเก็บใน R2 เป็น gzip (คีย์ `…json.gz`) ทั้งสองเส้นทางจึงอ่านผ่าน
 * `getJsonGz` แล้วส่งออกเป็น JSON ธรรมดา — ไม่ส่งไบต์ gzip ต่อไปตรง ๆ พร้อม
 * `Content-Encoding` เพราะ client ที่ไม่ได้ขอ `Accept-Encoding: gzip` (curl เปล่า ๆ)
 * จะได้ไบนารีแทน JSON ส่วนการบีบอัดบนสายเป็นเรื่องของขอบ Cloudflare อยู่แล้ว
 *
 * ทั้งสองเส้นทางอ่านจาก run ที่เก็บไว้เท่านั้น ไม่มีจุดไหนไปถามตารางสถานีที่ยัง
 * มีชีวิตอยู่ — ขอบเขตจังหวัดมาจาก `StationExposure.provinceCode` ใน run เอง
 * (ดูเหตุผลเต็มใน `exposure/publish.ts`)
 */

/** header ที่บอกว่าคำตอบนี้มาจาก run ไหน เพื่อให้ผู้ใช้ไปเปิด run นั้นทั้งก้อนต่อได้ */
const RUN_ID_HEADER = "X-Run-Id";

/** GET /api/v1/provinces/{NN}/exposure/latest */
export async function handleProvinceExposureLatest(province: string, env: AppEnv): Promise<Response> {
  // รูปแบบถูก (สองหลัก) แต่ไม่ใช่รหัสจังหวัดจริง = ไม่มีทรัพยากรนี้ → 404
  // ตรวจกับทะเบียนรหัส 77 จังหวัด ไม่ใช่กับสถานีที่บังเอิญมีใน run
  // (จังหวัดที่ไม่มีสถานีเลยคือจังหวัดจริงที่ไม่มีอะไรจะรายงาน ไม่ใช่จังหวัดที่ไม่มีอยู่)
  if (!isProvinceCode(province)) {
    return json({ error: `Unknown province code "${province}"` }, { status: 404 });
  }
  try {
    const pointer = await env.FORECAST_POINTER.getByName(EXPOSURE_POINTER_NAME).getLatest();
    if (!pointer) {
      // ยังไม่เคยเผยแพร่ run เลย — พูดตามนั้น ไม่ใช่ตอบ run ว่างที่ดูเหมือนของจริง
      return json({ error: "No flood-exposure run has been published yet" }, { status: 503 });
    }
    const run = await getJsonGz<FloodExposureRun>(env.HAZARD_BUCKET, pointer.manifestKey);
    if (!run) {
      logError("exposure run object missing", { key: pointer.manifestKey, runId: pointer.runId });
      return json(
        { error: `Flood-exposure run ${pointer.runId} is referenced but no longer stored` },
        { status: 503 },
      );
    }
    return json(scopeToProvince(run, province), {
      cache: cachePolicy.observations,
      headers: { [RUN_ID_HEADER]: run.runId },
    });
  } catch (err) {
    logError("exposure latest failed", { province, error: errorText(err) });
    return json({ error: "Flood exposure unavailable" }, { status: 503 });
  }
}

/** GET /api/v1/exposure/runs/{runId} — run ทั้งก้อนตามที่เขียนไว้ ไม่ตัดขอบ ไม่แก้ */
export async function handleExposureRun(runId: string, env: AppEnv): Promise<Response> {
  // router จับรูป runId มาแล้ว แต่ตรวจซ้ำที่นี่เพราะบรรทัดถัดไปเอาค่านี้ไปทำคีย์ R2
  if (!RUN_ID_RE.test(runId)) return json({ error: "Bad run id" }, { status: 400 });
  const key = exposureRunKey(runId);
  const run = await getJsonGz<FloodExposureRun>(env.HAZARD_BUCKET, key);
  if (!run) return json({ error: `No such flood-exposure run: ${runId}` }, { status: 404 });
  /**
   * `frozenArtifact` จะโยนถ้าคีย์ไม่ใช่ content-addressed ซึ่งเกิดได้กรณีเดียว:
   * hash 16 หลักที่บังเอิญเป็นตัวเลขล้วน (~0.02%) run นั้นเผยแพร่ไปแล้วและอ้างอิง
   * ได้จริง จึงต้องเสิร์ฟต่อ เพียงแต่ไม่ติด `immutable` ให้ — ตอบ 500 กับ run ที่
   * มีอยู่จริงแย่กว่าการแคชสั้นลงหนึ่งคำขอ (และนโยบายเองไม่ได้ถูกผ่อนลง)
   */
  const cache = cachePolicy.isContentAddressed(key) ? cachePolicy.frozenArtifact(key) : cachePolicy.noStore;
  // ไม่มี `ETag` แล้วโดยตั้งใจ: ไบต์ที่ตอบคือ JSON ที่คลายซิปแล้ว ส่วน `httpEtag`
  // ของ R2 เป็นของไบต์ gzip การส่งต่อจะเป็น ETag ที่ไม่ตรงกับ body — และคำตอบนี้
  // ติด `immutable` หนึ่งปีอยู่แล้ว การตรวจซ้ำแบบมีเงื่อนไขจึงแทบไม่เกิด
  return json(run, { cache, headers: { [RUN_ID_HEADER]: runId } });
}
