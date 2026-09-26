/**
 * บัญชีกล้องรูปทั่วไป (`Camera`/`CameraCatalogue` ใน `packages/shared-types/src/cctv.ts`) —
 * ส่วนที่สคริปต์ build ของทุกแหล่งใช้ร่วมกัน (`build-dwr-cctv.ts`, `build-itic-cctv.ts`, …):
 *
 *   - `probeStreams()`   — ยิงทุกสตรีม **ครั้งเดียวตอน build** จาก vantage ที่รัน แล้วบันทึกผลต่อสตรีม
 *                          (`result`, `cors`) + หลักฐาน `EXT-X-PROGRAM-DATE-TIME` ของ hls;
 *                          `probedAt`/`probeVantage` เก็บระดับ catalogue ครั้งเดียว (ลด churn ของ
 *                          JSON ที่ track ทุก rebuild)
 *   - `classifyProbe()`  — ตัดสินผลจาก status/content-type/ไบต์แรก (ล้วน มีเทสต์ตาราง)
 *   - `writeCatalogue()` — dedupe/sort, ตรวจ (https เท่านั้น, ไม่มี userinfo, origin อยู่ใน
 *                          `CAMERA_SOURCES[id].hosts` ของ directive ที่ `streamDirective` กำหนด,
 *                          `CREDENTIAL_PATTERN`) แล้วเขียน `apps/web/public/cctv/{sourceId}.json`
 *
 * ข้อตกลง (AGENTS.md):
 *   - `unreachable` = **ถามไม่ได้จากเครือข่ายที่รัน** ไม่ใช่แหล่งตาย — รายงานแยกคอลัมน์เสมอ
 *   - ไม่ได้ยิง (`--no-probe`) = `not-probed` — **ห้ามใช้ `ok` เป็นค่าตั้งต้น**
 *   - log เฉพาะจำนวน — ไม่มี url, id หรือระเบียนใดใน console/ข้อความ error (DWR มีลิงก์ที่ฝัง
 *     รหัสผ่านอยู่ใน payload ต้นทาง)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  CAMERA_SOURCES,
  streamDirective,
  type Camera,
  type CameraCatalogue,
  type CameraSourceId,
  type CameraStream,
  type CameraStreamKind,
  type ProbeResult,
} from "@siahra/shared-types";
import { CREDENTIAL_PATTERN } from "./provincePolygons.js";

/** origin ที่ใช้ตรวจ CORS — ต้นทางบางแห่งสะท้อน origin (DWR) จึงต้องส่ง `Origin` ไปด้วยทุกครั้ง */
export const SITE_ORIGIN = "https://siahra-radar.co";
/** ฐาน API ของ DWR — โฮสต์เดียวกับที่ประกาศใน `CAMERA_SOURCES["dwr-cctv"].hosts` */
export const DWR_API = `${CAMERA_SOURCES["dwr-cctv"].hosts.connect![0]}/api`;

export const OUT_DIR = path.resolve(import.meta.dirname, "../../web/public/cctv");

export const PROBE_RESULTS: readonly ProbeResult[] = [
  "ok",
  "empty",
  "not-image",
  "http-4xx",
  "http-5xx",
  "unreachable",
  "not-probed",
];
export const STREAM_KINDS: readonly CameraStreamKind[] = ["hls", "jpeg", "jpeg-fetch", "mjpeg", "dwr-snapshot", "dwr-mjpeg"];

export const NOT_PROBED = { result: "not-probed", cors: null } as const;

// ─────────────────────────────────────────────────────────────────────────────
// classify (pure)
// ─────────────────────────────────────────────────────────────────────────────

export interface ProbeEvidence {
  kind: CameraStreamKind;
  /** null = ไม่มีคำตอบ HTTP เลย (timeout/DNS/TLS) */
  status: number | null;
  contentType: string | null;
  /** จำนวนไบต์ที่ได้รับ (ชิ้นแรกพอ) */
  bytes: number;
  /** บรรทัดแรกของ body (latin1) — ใช้ดู `#EXTM3U` และ magic ของ JPEG */
  firstLine: string;
  acao: string | null;
}

/** `Access-Control-Allow-Origin` ครอบ origin ของเราไหม — null = ไม่มีคำตอบให้ดู */
export function corsCovers(acao: string | null, origin = SITE_ORIGIN): boolean | null {
  if (acao === null) return null;
  const v = acao.trim();
  return v === "*" || v === origin;
}

const JPEG_MAGIC = "\xff\xd8";

function isImageBody(contentType: string | null, firstLine: string): boolean {
  return (contentType?.toLowerCase().startsWith("image/") ?? false) || firstLine.startsWith(JPEG_MAGIC);
}

/**
 * ตัดสินผล probe จากหลักฐาน — ไม่มีคำตอบ = `unreachable` (ไม่ใช่แหล่งตาย), 4xx/5xx ตามสถานะ,
 * 200 แล้วดู body: hls ต้องขึ้นต้น `#EXTM3U`; ภาพต้อง `image/*` หรือ magic JPEG; MJPEG ต้อง
 * `multipart/x-mixed-replace` (หรือภาพ); 0 ไบต์ = `empty`; อย่างอื่น = `not-image`
 */
export function classifyProbe(e: ProbeEvidence): ProbeResult {
  if (e.status === null) return "unreachable";
  if (e.status >= 500) return "http-5xx";
  if (e.status >= 400) return "http-4xx";
  // 1xx/3xx ที่ fetch ไม่ได้ตามต่อ = ตอบมาแต่ไม่ใช่ของที่ขอ
  if (e.status < 200 || e.status >= 300) return "not-image";
  if (e.bytes === 0) return "empty";
  const ct = e.contentType?.toLowerCase() ?? null;
  switch (e.kind) {
    case "hls":
      return e.firstLine.trimStart().startsWith("#EXTM3U") ? "ok" : "not-image";
    case "jpeg":
    case "jpeg-fetch":
    case "dwr-snapshot":
      return isImageBody(ct, e.firstLine) ? "ok" : "not-image";
    case "mjpeg":
    case "dwr-mjpeg":
      return (ct?.startsWith("multipart/x-mixed-replace") ?? false) || isImageBody(ct, e.firstLine) ? "ok" : "not-image";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// probe (network)
// ─────────────────────────────────────────────────────────────────────────────

export interface ProbeOptions {
  fetch?: typeof fetch;
  /** จำนวนคำขอพร้อมกันทั้งหมด */
  concurrency?: number;
  /** เพดานต่อโฮสต์ — ค่าตั้งต้น: DWR 4 (MJPEG ใช้เวลา 4–6 วิถึงเฟรมแรก), อื่น = `concurrency` */
  hostConcurrency?: Record<string, number>;
  timeoutMs?: number;
  /** ช่วงห่างขั้นต่ำระหว่างการเริ่มคำขอสองครั้งบนโฮสต์เดียวกัน */
  perHostGapMs?: number;
  /** `--no-probe`: ไม่ยิงเลย ทุกสตรีมเป็น `not-probed` */
  skip?: boolean;
  origin?: string;
  now?: () => number;
}

export interface StreamProbeOutcome {
  result: ProbeResult;
  cors: boolean | null;
  /** hls เท่านั้น: chunklist มี `EXT-X-PROGRAM-DATE-TIME` ไหม (null = ไม่ได้ดูถึง) */
  programDateTime: boolean | null;
}

export interface ProbeStats {
  streams: number;
  byKind: Partial<Record<CameraStreamKind, Record<ProbeResult, number>>>;
  cors: { yes: number; no: number; unknown: number };
  /** hls ที่ `ok` และมี `EXT-X-PROGRAM-DATE-TIME` */
  hlsWithProgramDateTime: number;
}

const DEFAULT_HOST_CONCURRENCY: Record<string, number> = { "telemetry.dwr.go.th": 4 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FetchCtx {
  fetch: typeof fetch;
  timeoutMs: number;
  origin: string;
}

interface RawResponse {
  status: number;
  contentType: string | null;
  acao: string | null;
  bytes: number;
  firstLine: string;
  /** ข้อความเต็ม (เฉพาะเมื่อขอ `text`) */
  text: string;
}

/**
 * ยิงหนึ่งคำขอแล้วอ่านแค่ชิ้นแรกของ body (หรือทั้งหมดเมื่อ `mode = "text"`) แล้วตัดการเชื่อมต่อ —
 * MJPEG ไม่มีวันจบ, ภาพนิ่งไม่ต้องอ่านครบ; ข้อผิดพลาดทุกแบบ (timeout/DNS/TLS) → null
 */
async function request(
  ctx: FetchCtx,
  url: string,
  init: RequestInit,
  mode: "first-chunk" | "text",
): Promise<RawResponse | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ctx.timeoutMs);
  try {
    const res = await ctx.fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), Origin: ctx.origin },
      signal: controller.signal,
      redirect: "follow",
    });
    const contentType = res.headers.get("content-type");
    const acao = res.headers.get("access-control-allow-origin");
    let bytes = 0;
    let firstLine = "";
    let text = "";
    if (mode === "text") {
      text = await res.text();
      bytes = Buffer.byteLength(text);
      firstLine = text.split(/\r?\n/, 1)[0] ?? "";
    } else if (res.body) {
      const reader = res.body.getReader();
      const first = await reader.read();
      if (!first.done && first.value) {
        bytes = first.value.byteLength;
        const head = Buffer.from(first.value.subarray(0, 64)).toString("latin1");
        firstLine = head.split(/\r?\n/, 1)[0] ?? "";
      }
      // ชิ้นแรกพอแล้ว — ตัดการเชื่อมต่อ (MJPEG ไม่มีวันจบเอง)
      await reader.cancel().catch(() => undefined);
    }
    // 200 กับ content-length: 0 = ตอบมาว่างจริง แม้ body ไม่มีชิ้นให้อ่าน
    return { status: res.status, contentType, acao, bytes, firstLine, text };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

const unreachable = (): StreamProbeOutcome => ({ result: "unreachable", cors: null, programDateTime: null });

function outcomeFrom(kind: CameraStreamKind, r: RawResponse | null, origin: string): StreamProbeOutcome {
  if (r === null) return unreachable();
  return {
    result: classifyProbe({ kind, status: r.status, contentType: r.contentType, bytes: r.bytes, firstLine: r.firstLine, acao: r.acao }),
    cors: corsCovers(r.acao, origin),
    programDateTime: null,
  };
}

/** บรรทัด playlist ที่ไม่ใช่ tag/ว่าง — media playlist มี `#EXTINF`, master ชี้ไป chunklist */
export function firstPlaylistRef(text: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    return line;
  }
  return null;
}

export const isMediaPlaylist = (text: string): boolean => /^#EXTINF:/m.test(text);
export const hasProgramDateTime = (text: string): boolean => /^#EXT-X-PROGRAM-DATE-TIME:/m.test(text);

/**
 * hls: master → chunklist แรก แล้วตัดสินจาก chunklist — tag `PROGRAM-DATE-TIME` อยู่ที่นั่น และ
 * master 200 แต่ chunklist 404 ต้องไม่ได้ `ok`; ถ้า url เป็น media playlist อยู่แล้วก็ตัดสินตรง ๆ
 */
async function probeHls(ctx: FetchCtx, url: string): Promise<StreamProbeOutcome> {
  const master = await request(ctx, url, {}, "text");
  if (master === null) return unreachable();
  const masterOutcome = outcomeFrom("hls", master, ctx.origin);
  if (masterOutcome.result !== "ok") return masterOutcome;
  if (isMediaPlaylist(master.text)) return { ...masterOutcome, programDateTime: hasProgramDateTime(master.text) };
  const ref = firstPlaylistRef(master.text);
  if (ref === null) return { ...masterOutcome, result: "not-image" };
  let chunklistUrl: string;
  try {
    chunklistUrl = new URL(ref, url).toString();
  } catch {
    return { ...masterOutcome, result: "not-image" };
  }
  const chunklist = await request(ctx, chunklistUrl, {}, "text");
  if (chunklist === null) return { result: "unreachable", cors: masterOutcome.cors, programDateTime: null };
  const outcome = outcomeFrom("hls", chunklist, ctx.origin);
  return {
    ...outcome,
    // CORS ต้องผ่านทั้ง master และ chunklist (hls.js ขอทั้งคู่ด้วย XHR)
    cors: outcome.cors === null || masterOutcome.cors === null ? null : outcome.cors && masterOutcome.cors,
    programDateTime: outcome.result === "ok" ? hasProgramDateTime(chunklist.text) : null,
  };
}

/**
 * ภาพล่าสุดของ DWR — ขั้นตอนเดียวกับ `apps/web/src/lib/cctv.ts` `fetchSnapshot` (อ่านอย่างเดียว):
 * GET path ของภาพ แล้ว POST ขอ JPEG; `value` ว่าง = `empty` (DWR ตอบแล้วว่าไม่มีภาพ)
 */
async function probeDwrSnapshot(ctx: FetchCtx, cameraId: string): Promise<StreamProbeOutcome> {
  const meta = await request(ctx, `${DWR_API}/public/reportCctv/snapshot/${encodeURIComponent(cameraId)}`, {}, "text");
  if (meta === null) return unreachable();
  // 404 ในขั้นใดของ DWR = "DWR ตอบแล้วว่าไม่มีภาพ" (web: `no-image`) ไม่ใช่ API พัง → `empty`
  if (meta.status === 404) return { result: "empty", cors: corsCovers(meta.acao, ctx.origin), programDateTime: null };
  if (meta.status < 200 || meta.status >= 300) {
    return outcomeFrom("dwr-snapshot", { ...meta, bytes: 0 }, ctx.origin);
  }
  let value: unknown;
  try {
    value = (JSON.parse(meta.text) as { value?: unknown } | null)?.value;
  } catch {
    return { result: "not-image", cors: corsCovers(meta.acao, ctx.origin), programDateTime: null };
  }
  if (typeof value !== "string" || value.trim() === "") {
    return { result: "empty", cors: corsCovers(meta.acao, ctx.origin), programDateTime: null };
  }
  const image = await request(
    ctx,
    `${DWR_API}/file/image/cctv`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: value }) },
    "first-chunk",
  );
  if (image?.status === 404) return { result: "empty", cors: corsCovers(image.acao, ctx.origin), programDateTime: null };
  return outcomeFrom("dwr-snapshot", image, ctx.origin);
}

/** ภาพสด MJPEG ของ DWR — url เดียวกับ `dwrLiveUrl` ของ web; ชิ้นแรกแล้วตัด */
async function probeDwrMjpeg(ctx: FetchCtx, stationCode: string): Promise<StreamProbeOutcome> {
  const url = `${DWR_API}/public/cctv/mjpegStream?stnCode=${encodeURIComponent(stationCode)}&_=${Date.now()}`;
  return outcomeFrom("dwr-mjpeg", await request(ctx, url, {}, "first-chunk"), ctx.origin);
}

/** โฮสต์ที่สตรีมนี้จะไปถาม (ใช้จัดคิวต่อโฮสต์) */
export function streamHost(s: CameraStream): string {
  if (s.kind === "dwr-snapshot" || s.kind === "dwr-mjpeg") return new URL(DWR_API).host;
  try {
    return new URL(s.url).host;
  } catch {
    return "(invalid)";
  }
}

/** ยิงสตรีมเดียว — ผู้เรียก (`probeStreams`, CLI `--url`) จัดคิวเอง */
export async function probeStream(camera: Pick<Camera, "id">, s: CameraStream, ctx: FetchCtx): Promise<StreamProbeOutcome> {
  switch (s.kind) {
    case "hls":
      return probeHls(ctx, s.url);
    case "jpeg":
    case "jpeg-fetch":
    case "mjpeg":
      return outcomeFrom(s.kind, await request(ctx, s.url, {}, "first-chunk"), ctx.origin);
    case "dwr-snapshot":
      return probeDwrSnapshot(ctx, camera.id);
    case "dwr-mjpeg":
      return probeDwrMjpeg(ctx, s.stationCode);
  }
}

interface Task<T> {
  host: string;
  run: () => Promise<T>;
}

/** คิวจำกัดจำนวนพร้อมกันทั้งหมด + ต่อโฮสต์ + ช่วงห่างระหว่างการเริ่มบนโฮสต์เดียวกัน */
export async function runThrottled<T>(
  tasks: readonly Task<T>[],
  opts: { concurrency: number; hostConcurrency: Record<string, number>; perHostGapMs: number; now: () => number },
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  const pending = tasks.map((t, i) => ({ ...t, i }));
  const active = new Map<string, number>();
  const lastStart = new Map<string, number>();
  const limit = (host: string) => Math.min(opts.concurrency, opts.hostConcurrency[host] ?? opts.concurrency);

  async function worker(): Promise<void> {
    while (pending.length > 0) {
      const idx = pending.findIndex((t) => (active.get(t.host) ?? 0) < limit(t.host));
      if (idx === -1) {
        await sleep(25);
        continue;
      }
      const task = pending.splice(idx, 1)[0]!;
      active.set(task.host, (active.get(task.host) ?? 0) + 1);
      const wait = (lastStart.get(task.host) ?? -Infinity) + opts.perHostGapMs - opts.now();
      if (wait > 0) await sleep(wait);
      lastStart.set(task.host, opts.now());
      try {
        results[task.i] = await task.run();
      } finally {
        active.set(task.host, (active.get(task.host) ?? 1) - 1);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, () => worker()));
  return results;
}

export function emptyProbeStats(): ProbeStats {
  return { streams: 0, byKind: {}, cors: { yes: 0, no: 0, unknown: 0 }, hlsWithProgramDateTime: 0 };
}

function countOutcome(stats: ProbeStats, kind: CameraStreamKind, o: StreamProbeOutcome): void {
  stats.streams++;
  const row = (stats.byKind[kind] ??= Object.fromEntries(PROBE_RESULTS.map((r) => [r, 0])) as Record<ProbeResult, number>);
  row[o.result]++;
  if (o.cors === true) stats.cors.yes++;
  else if (o.cors === false) stats.cors.no++;
  else stats.cors.unknown++;
  if (kind === "hls" && o.result === "ok" && o.programDateTime) stats.hlsWithProgramDateTime++;
}

/** สตรีมพร้อมผล probe — hls ได้ `captureTime` จากหลักฐาน `EXT-X-PROGRAM-DATE-TIME` เท่านั้น */
export function applyOutcome(s: CameraStream, o: StreamProbeOutcome): CameraStream {
  const probe = { result: o.result, cors: o.cors };
  if (s.kind === "hls") {
    return { ...s, probe, captureTime: o.result === "ok" && o.programDateTime ? "program-date-time" : "none" };
  }
  return { ...s, probe };
}

/**
 * ยิงทุกสตรีมของทุกกล้อง (ต่อโฮสต์ไม่เกิน `hostConcurrency`, รวมไม่เกิน `concurrency` = 6,
 * timeout 15 วิ) แล้วคืนกล้องชุดใหม่พร้อม `probe` ต่อสตรีม; `skip` = ทุกสตรีม `not-probed`
 * — ผลเป็นของ vantage ที่รัน ณ เวลานั้น ไม่ใช่สถานะปัจจุบัน
 */
export async function probeStreams(
  cameras: readonly Camera[],
  opts: ProbeOptions = {},
): Promise<{ cameras: Camera[]; stats: ProbeStats }> {
  const stats = emptyProbeStats();
  if (opts.skip) {
    const out = cameras.map((c) => ({ ...c, streams: c.streams.map((s) => applyOutcome(s, { ...NOT_PROBED, programDateTime: null })) }));
    for (const c of out) for (const s of c.streams) countOutcome(stats, s.kind, { ...s.probe, programDateTime: null });
    return { cameras: out, stats };
  }
  const ctx: FetchCtx = {
    fetch: opts.fetch ?? ((...a) => fetch(...a)),
    timeoutMs: opts.timeoutMs ?? 15_000,
    origin: opts.origin ?? SITE_ORIGIN,
  };
  const tasks: Task<StreamProbeOutcome>[] = [];
  const slots: { ci: number; si: number }[] = [];
  cameras.forEach((c, ci) =>
    c.streams.forEach((s, si) => {
      slots.push({ ci, si });
      tasks.push({ host: streamHost(s), run: () => probeStream(c, s, ctx) });
    }),
  );
  const outcomes = await runThrottled(tasks, {
    concurrency: opts.concurrency ?? 6,
    hostConcurrency: opts.hostConcurrency ?? DEFAULT_HOST_CONCURRENCY,
    perHostGapMs: opts.perHostGapMs ?? 100,
    now: opts.now ?? (() => Date.now()),
  });
  const out: Camera[] = cameras.map((c) => ({ ...c, streams: [...c.streams] }));
  slots.forEach(({ ci, si }, k) => {
    const o = outcomes[k]!;
    const s = out[ci]!.streams[si]!;
    out[ci]!.streams[si] = applyOutcome(s, o);
    countOutcome(stats, s.kind, o);
  });
  return { cameras: out, stats };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI helpers
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildArgs {
  probe: boolean;
  vantage: string | null;
}

/** `--no-probe`, `--vantage <label>` — ใช้ร่วมกันทุกสคริปต์ build */
export function parseBuildArgs(argv: readonly string[]): BuildArgs {
  const out: BuildArgs = { probe: true, vantage: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-probe") out.probe = false;
    else if (a === "--vantage") out.vantage = argv[++i]?.trim() || null;
    else if (a?.startsWith("--vantage=")) out.vantage = a.slice("--vantage=".length).trim() || null;
  }
  return out;
}

/**
 * ป้ายเครือข่ายที่ probe (`--vantage`) — ป้ายใน UI พูดว่า "ไม่ตอบตอน build จาก <vantage>"; ไม่ให้ = `"unlabelled"`
 * **ห้าม** อ่าน hostname/ชื่อผู้ใช้/path ของเครื่อง — ค่านี้ลงไฟล์ที่ track และเสิร์ฟสาธารณะ
 */
export const UNLABELLED_VANTAGE = "unlabelled";
export function probeVantageLabel(label: string | null): string {
  const v = label?.trim();
  return v ? v : UNLABELLED_VANTAGE;
}

// ─────────────────────────────────────────────────────────────────────────────
// validate + write
// ─────────────────────────────────────────────────────────────────────────────

export interface CatalogueMeta {
  builtAt: string;
  sourceUrl: string;
  probedAt: string | null;
  probeVantage: string | null;
}

export interface CatalogueStats {
  cameras: number;
  /** id ซ้ำที่ถูกตัดทิ้ง (เก็บตัวแรก) */
  duplicates: number;
  provinces: number;
  streams: number;
  byKind: Partial<Record<CameraStreamKind, number>>;
  byResult: Record<ProbeResult, number>;
  cors: { yes: number; no: number; unknown: number };
}

/** dedupe (เก็บตัวแรก) + sort by id — ล้วน ให้เทสต์เรียกได้ */
export function assembleCatalogue(sourceId: CameraSourceId, cameras: readonly Camera[], meta: CatalogueMeta): { catalogue: CameraCatalogue; duplicates: number } {
  const seen = new Set<string>();
  const kept: Camera[] = [];
  let duplicates = 0;
  for (const c of cameras) {
    if (seen.has(c.id)) {
      duplicates++;
      continue;
    }
    seen.add(c.id);
    kept.push(c);
  }
  kept.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    catalogue: {
      sourceId,
      builtAt: meta.builtAt,
      sourceUrl: meta.sourceUrl,
      probedAt: meta.probedAt,
      probeVantage: meta.probeVantage,
      cameras: kept,
    },
    duplicates,
  };
}

/** ข้อความผิดพลาดบอกแค่ แหล่ง/ชนิด/เหตุผล — ไม่มี url หรือ id (อาจมีความลับของต้นทาง) */
function refuse(sourceId: string, kind: string, why: string): never {
  throw new Error(`writeCatalogue(${sourceId}): a ${kind} stream ${why} — refusing to write the catalogue`);
}

/**
 * ตรวจก่อนเขียน — ทุกข้อเป็น bug ของสคริปต์ build (มันกรองมาก่อนแล้ว) จึง **โยนทิ้งทั้งไฟล์** ไม่ใช่ตัดทิ้งแล้วนับ:
 *   - `sourceId` ของทุกกล้องตรงกับ catalogue
 *   - สตรีมที่มี url: parse ได้, `https:` เท่านั้น, ไม่มี username/password, origin อยู่ใน
 *     `CAMERA_SOURCES[id].hosts[d]` ของทุก d ใน `streamDirective(kind)`; `jpeg` ต้องตรง `urlPattern` ถ้ามี
 *   - `probe.result` เป็นค่าที่รู้จัก; `probedAt: null` ⇒ ทุกสตรีมเป็น `not-probed` (ไม่มี `ok` ที่ไม่มีที่มา)
 *   - กล้อง `hand-placed` ต้องมี `coordinatesDoc` ของแหล่ง
 */
export function validateCatalogue(cat: CameraCatalogue): void {
  const meta = CAMERA_SOURCES[cat.sourceId];
  if (!meta) throw new Error(`writeCatalogue: unknown camera source "${String(cat.sourceId)}"`);
  const ids = new Set<string>();
  for (const c of cat.cameras) {
    if (c.sourceId !== cat.sourceId) refuse(cat.sourceId, "camera", "belongs to another source");
    if (ids.has(c.id)) refuse(cat.sourceId, "camera", "has a duplicate id");
    ids.add(c.id);
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) refuse(cat.sourceId, "camera", "has no usable coordinates");
    if (c.coordSource === "hand-placed" && !meta.coordinatesDoc) refuse(cat.sourceId, "camera", "is hand-placed but the source has no coordinatesDoc");
    for (const s of c.streams) {
      if (!STREAM_KINDS.includes(s.kind)) refuse(cat.sourceId, String((s as { kind: unknown }).kind), "has an unknown kind");
      if (!PROBE_RESULTS.includes(s.probe?.result as ProbeResult)) refuse(cat.sourceId, s.kind, "has an unknown probe result");
      if (cat.probedAt === null && s.probe.result !== "not-probed") refuse(cat.sourceId, s.kind, "claims a probe result although nothing was probed");
      if (!("url" in s)) continue;
      let u: URL;
      try {
        u = new URL(s.url);
      } catch {
        refuse(cat.sourceId, s.kind, "has an unparsable url");
      }
      if (u.protocol !== "https:") refuse(cat.sourceId, s.kind, "is not https");
      if (u.username || u.password) refuse(cat.sourceId, s.kind, "carries userinfo");
      for (const d of streamDirective(s.kind)) {
        if (!(meta.hosts[d] ?? []).includes(u.origin)) refuse(cat.sourceId, s.kind, `is on an origin outside the source's ${d}-src hosts`);
      }
      if (s.kind === "jpeg" && meta.urlPattern && !meta.urlPattern.test(s.url)) refuse(cat.sourceId, s.kind, "does not match the source's urlPattern");
    }
  }
}

/** ตรวจ + serialise — เจอ `CREDENTIAL_PATTERN` ในผลลัพธ์เมื่อไหร่ โยนทิ้งทั้งไฟล์ (ข้อความไม่อ้างค่าที่เจอ) */
export function serializeCatalogue(cat: CameraCatalogue): string {
  validateCatalogue(cat);
  const json = `${JSON.stringify(cat, null, 2)}\n`;
  if (CREDENTIAL_PATTERN.test(json)) {
    throw new Error(`writeCatalogue(${cat.sourceId}): output matches the credential pattern — refusing to write it`);
  }
  return json;
}

export function catalogueStats(cat: CameraCatalogue, duplicates: number): CatalogueStats {
  const stats: CatalogueStats = {
    cameras: cat.cameras.length,
    duplicates,
    provinces: new Set(cat.cameras.map((c) => c.provinceCode).filter((p) => p !== null)).size,
    streams: 0,
    byKind: {},
    byResult: Object.fromEntries(PROBE_RESULTS.map((r) => [r, 0])) as Record<ProbeResult, number>,
    cors: { yes: 0, no: 0, unknown: 0 },
  };
  for (const c of cat.cameras) {
    for (const s of c.streams) {
      stats.streams++;
      stats.byKind[s.kind] = (stats.byKind[s.kind] ?? 0) + 1;
      stats.byResult[s.probe.result]++;
      if (s.probe.cors === true) stats.cors.yes++;
      else if (s.probe.cors === false) stats.cors.no++;
      else stats.cors.unknown++;
    }
  }
  return stats;
}

/**
 * เขียน `apps/web/public/cctv/{sourceId}.json` — dedupe/sort → ตรวจ → serialise → เขียน; คืนสถิติ
 * (จำนวนเท่านั้น) ให้สคริปต์ log; `outDir` มีไว้ให้เทสต์เขียนลงที่อื่น
 */
export function writeCatalogue(
  sourceId: CameraSourceId,
  cameras: readonly Camera[],
  meta: CatalogueMeta,
  opts: { outDir?: string } = {},
): { path: string; stats: CatalogueStats } {
  const { catalogue, duplicates } = assembleCatalogue(sourceId, cameras, meta);
  const json = serializeCatalogue(catalogue);
  const outDir = opts.outDir ?? OUT_DIR;
  const file = path.join(outDir, `${sourceId}.json`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(file, json);
  return { path: file, stats: catalogueStats(catalogue, duplicates) };
}

/** ตาราง markdown ของผล probe — คอลัมน์ `unreachable` อ่านว่า "ถามไม่ได้จาก vantage นี้" ไม่ใช่ตาย */
export function formatProbeTable(stats: ProbeStats, cameras: readonly Camera[]): string {
  const httpsByKind = new Map<CameraStreamKind, { https: number; total: number }>();
  for (const c of cameras) {
    for (const s of c.streams) {
      const row = httpsByKind.get(s.kind) ?? { https: 0, total: 0 };
      row.total++;
      if (!("url" in s) || s.url.startsWith("https://")) row.https++;
      httpsByKind.set(s.kind, row);
    }
  }
  const lines = [
    "| kind | streams | https | cors yes/no/unknown | ok | empty | not-image | http-4xx | http-5xx | unreachable (could not be reached from this vantage) | not-probed | timestamp evidence |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const kind of STREAM_KINDS) {
    const row = stats.byKind[kind];
    if (!row) continue;
    const https = httpsByKind.get(kind) ?? { https: 0, total: 0 };
    const cors = { yes: 0, no: 0, unknown: 0 };
    for (const c of cameras) {
      for (const s of c.streams) {
        if (s.kind !== kind) continue;
        if (s.probe.cors === true) cors.yes++;
        else if (s.probe.cors === false) cors.no++;
        else cors.unknown++;
      }
    }
    const evidence =
      kind === "hls"
        ? `EXT-X-PROGRAM-DATE-TIME on ${stats.hlsWithProgramDateTime}/${row.ok} ok`
        : kind === "dwr-snapshot"
          ? "capture time from the snapshot path (+07:00)"
          : kind === "jpeg"
            ? "burned into the image, not data"
            : kind === "jpeg-fetch"
              ? "Last-Modified header (needs CORS)"
              : "none";
    lines.push(
      `| ${kind} | ${https.total} | ${https.https}/${https.total} | ${cors.yes}/${cors.no}/${cors.unknown} | ${row.ok} | ${row.empty} | ${row["not-image"]} | ${row["http-4xx"]} | ${row["http-5xx"]} | ${row.unreachable} | ${row["not-probed"]} | ${evidence} |`,
    );
  }
  return lines.join("\n");
}
