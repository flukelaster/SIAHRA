/**
 * ดาวน์โหลด (พร้อม cache) ไฟล์ประชากรเชิงพื้นที่ WorldPop ที่ปรับค่าตาม UN สำหรับ
 * ประเทศไทย ปี 2020 — ใช้แพตเทิร์นเดียวกับ `fetchOsm.ts`'s `fetchThailandOsm()`
 *
 * ต้องเป็นไฟล์ `..._UNadj.tif` เท่านั้น (ไม่ใช่ `tha_ppp_2020.tif` ที่ไม่มี suffix
 * นี้ — เป็นคนละผลิตภัณฑ์ ไม่ได้ปรับค่าให้ตรงยอดรวมประชากรของ UN) — verified ด้วย
 * `curl -I` (2026-08-22): HTTP 200, Content-Length 262740152, Content-Type image/tiff
 *
 * ## ทำไมต้องมี sidecar `.meta.json`
 * ถ้าคำนวณ `fetchedAt` ตอนรัน สคริปต์ที่ใช้ไฟล์จาก cache (ดาวน์โหลดไปแล้วสัปดาห์
 * ก่อน) จะประทับเวลาว่า "ตอนนี้" ทั้งที่ fetch จริงเกิดขึ้นนานมาแล้ว — ตรงข้ามกับ
 * กฎ fetchedAt ตรงๆ (AGENTS.md) จึงบันทึกเวลาที่ fetch สำเร็จจริงไว้ข้าง ๆ ไฟล์
 * ครั้งเดียวตอนดาวน์โหลด แล้วอ่านจาก sidecar ทุกครั้งถัดไป
 *
 * โฟลเดอร์ data/raw ไม่ถูก track ใน git (.gitignore) ดังนั้น mtime ของไฟล์ที่โหลด
 * เสร็จ = เวลาที่ fetch สำเร็จจริง เชื่อถือได้ (เหตุผลเดียวกับที่ provenance.ts
 * ห้ามใช้ mtime เฉพาะไฟล์ที่ถูก track เท่านั้น —ไฟล์ track จะมี mtime เท่ากับตอน
 * git checkout ไม่ใช่ตอนสร้างจริง)
 *
 * ## ดาวน์โหลดต้อง atomic — บั๊กจริงที่เจอ (2026-08-23)
 * ดาวน์โหลด 262 MB นี้ตรง ๆ ไปที่ path ปลายทางเคยทำให้ไฟล์ที่โดนตัดกลางทาง
 * (network died mid-stream) ค้างอยู่ที่ path เดิม แล้วรันครั้งถัดไปเจอ
 * `existsSync(WORLDPOP_TIF_PATH)` เป็น true — ถือว่า cache ใช้ได้ทั้งที่ไฟล์ขาด
 * ทำให้ zonal stat ทุกตัวที่คำนวณต่อพังเงียบ ๆ จึงต้อง (1) โหลดลง `.part` ก่อน
 * แล้ว rename ทับ path จริงเมื่อสำเร็จเท่านั้น (2) ตรวจขนาดไฟล์กับ
 * `Content-Length` ของต้นทางเสมอ — ทั้งตอนดาวน์โหลดเสร็จใหม่ และตอนเจอไฟล์ที่มี
 * อยู่แล้วแต่ไม่มี sidecar (อาจเป็นไฟล์ที่โดนตัดจากรันก่อนหน้าเวอร์ชันที่ไม่ atomic)
 */
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execa } from "execa";
import { isoUtc, sha256File } from "./provenance.js";

const RAW_DIR = path.resolve(import.meta.dirname, "../data/raw");
export const WORLDPOP_URL =
  "https://data.worldpop.org/GIS/Population/Global_2000_2020/2020/THA/tha_ppp_2020_UNadj.tif";
export const WORLDPOP_TIF_PATH = path.join(RAW_DIR, "tha_ppp_2020_UNadj.tif");
const PART_PATH = `${WORLDPOP_TIF_PATH}.part`;
const META_PATH = `${WORLDPOP_TIF_PATH}.meta.json`;

export interface WorldPopFetchMeta {
  url: string;
  path: string;
  sha256: string;
  sizeBytes: number;
  /** เวลาที่การดาวน์โหลดไฟล์นี้สำเร็จจริง (mtime ของไฟล์ที่ไม่ถูก track) */
  fetchedAt: string;
  /** header `Last-Modified` ของต้นทาง — null เมื่อ probe ไม่สำเร็จ ห้ามเดา */
  publishedAt: string | null;
}

/** probe `Last-Modified`/`Content-Length` ด้วย HEAD request เบา ๆ — ไม่โหลดตัวไฟล์ */
async function probeHeaders(url: string): Promise<{ lastModified: string | null; contentLength: number | null }> {
  try {
    const { stdout } = await execa("curl", ["-sI", url]);
    const lmMatch = stdout.match(/^Last-Modified:\s*(.+)$/im);
    const clMatch = stdout.match(/^Content-Length:\s*(\d+)/im);
    const lastModifiedMs = lmMatch ? Date.parse(lmMatch[1].trim()) : NaN;
    return {
      lastModified: Number.isNaN(lastModifiedMs) ? null : isoUtc(lastModifiedMs),
      contentLength: clMatch ? Number(clMatch[1]) : null,
    };
  } catch (err) {
    console.warn(`[fetchWorldPop] probe headers ไม่ได้: ${String(err).slice(0, 160)}`);
    return { lastModified: null, contentLength: null };
  }
}

/**
 * ดาวน์โหลดลง `.part` ก่อนเสมอ แล้ว rename ทับ path จริงเมื่อสำเร็จเท่านั้น — ไฟล์
 * ที่ถูกตัดกลางทางจะไม่มีทางไปโผล่ที่ path ที่ `existsSync` เช็คว่า "มีแล้ว" ได้
 */
async function downloadAtomic(url: string, destPath: string): Promise<void> {
  if (existsSync(PART_PATH)) rmSync(PART_PATH); // ของค้างจากรันก่อนที่ล้มกลางทาง — ห้าม resume แบบเงียบ ๆ
  console.log(`[fetchWorldPop] downloading ${url} (~263MB, this will take a while)...`);
  await execa("curl", ["-fSL", "--create-dirs", "-o", PART_PATH, url], { stdio: "inherit" });

  // curl -f ทำให้ HTTP error ล้มดังอยู่แล้ว (execa throw) แต่ต่อให้ exit code เป็น 0
  // ก็ยังต้องตรวจขนาดไฟล์จริงกับ Content-Length ของต้นทางอีกชั้น เพื่อกัน
  // connection ที่ตายกลาง stream แบบที่ curl ไม่ได้รายงานเป็น error
  const { contentLength } = await probeHeaders(url);
  const actualSize = statSync(PART_PATH).size;
  if (contentLength !== null && actualSize !== contentLength) {
    rmSync(PART_PATH);
    throw new Error(
      `[fetchWorldPop] download truncated: got ${actualSize} bytes, expected ${contentLength} (Content-Length)`,
    );
  }
  renameSync(PART_PATH, destPath);
}

/**
 * คืน path ของไฟล์ WorldPop บนดิสก์ พร้อม provenance จริง (ดาวน์โหลดถ้ายังไม่มี
 * หรือถ้าไฟล์ที่มีอยู่ตรวจสอบขนาดแล้วไม่ตรงกับต้นทาง/sidecar)
 */
export async function fetchWorldPop(): Promise<WorldPopFetchMeta> {
  if (existsSync(WORLDPOP_TIF_PATH) && existsSync(META_PATH)) {
    const meta = JSON.parse(readFileSync(META_PATH, "utf-8")) as WorldPopFetchMeta;
    const actualSize = statSync(WORLDPOP_TIF_PATH).size;
    if (meta.sizeBytes === actualSize) {
      console.log("[fetchWorldPop] cached: tha_ppp_2020_UNadj.tif (size matches sidecar)");
      return meta;
    }
    console.warn(
      `[fetchWorldPop] cached tif size (${actualSize}) != sidecar (${meta.sizeBytes}) — treating cache as corrupt, re-downloading`,
    );
    rmSync(WORLDPOP_TIF_PATH);
    rmSync(META_PATH);
  }

  if (!existsSync(WORLDPOP_TIF_PATH)) {
    await downloadAtomic(WORLDPOP_URL, WORLDPOP_TIF_PATH);
  } else {
    // ไฟล์มีอยู่แล้วแต่ไม่มี sidecar (เช่น มาจากรันเวอร์ชันก่อนที่ยังไม่ atomic) —
    // ตรวจขนาดกับต้นทางก่อนเชื่อว่าไฟล์สมบูรณ์ ห้ามเชื่อแค่ว่าไฟล์ "มีอยู่"
    console.log("[fetchWorldPop] tif present but no sidecar meta — verifying size against upstream");
    const { contentLength } = await probeHeaders(WORLDPOP_URL);
    const actualSize = statSync(WORLDPOP_TIF_PATH).size;
    if (contentLength !== null && actualSize !== contentLength) {
      console.warn(
        `[fetchWorldPop] existing tif (${actualSize} bytes) != upstream Content-Length (${contentLength}) — re-downloading`,
      );
      rmSync(WORLDPOP_TIF_PATH);
      await downloadAtomic(WORLDPOP_URL, WORLDPOP_TIF_PATH);
    } else if (contentLength === null) {
      console.warn("[fetchWorldPop] could not probe Content-Length to verify existing tif — proceeding, unverified");
    }
  }

  const fetchedAt = isoUtc(statSync(WORLDPOP_TIF_PATH).mtimeMs);
  const { lastModified: publishedAt } = await probeHeaders(WORLDPOP_URL);
  const sha256 = sha256File(WORLDPOP_TIF_PATH);
  const sizeBytes = statSync(WORLDPOP_TIF_PATH).size;
  const meta: WorldPopFetchMeta = {
    url: WORLDPOP_URL,
    path: WORLDPOP_TIF_PATH,
    sha256,
    sizeBytes,
    fetchedAt,
    publishedAt,
  };
  writeFileSync(META_PATH, JSON.stringify(meta, null, 2));
  return meta;
}
