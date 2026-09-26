/**
 * สำรวจแหล่งกล้อง (อ่านอย่างเดียว ใช้ซ้ำทุกแหล่ง) — ยิงทุกสตรีมของบัญชีที่ build แล้ว หรือ url เดียว
 * จากเครือข่ายที่รัน แล้วพิมพ์ตาราง markdown (จำนวน, kind, https, CORS, การแจกแจงผล, หลักฐานเวลา)
 * ไว้แปะใน README ของแหล่งนั้น — **ไม่เขียนไฟล์ใด**
 *
 *   npx -y tsx@4 src/probe-cameras.ts <sourceId> [--vantage <label>]
 *   npx -y tsx@4 src/probe-cameras.ts --url <https://…/playlist.m3u8 | …jpg> [--vantage <label>]
 *
 * `unreachable` = **ถามไม่ได้จาก vantage นี้** (เครือข่ายนี้มี TLS filter; camera1.iticfoundation.org
 * และ streaming2.highwaytraffic.go.th ตอบต่างกันตามเครือข่าย) — ไม่ใช่แหล่งตาย ให้ owner เปิดจาก
 * มือถือเครือข่ายไทยยืนยัน; log เฉพาะจำนวน ไม่มีระเบียนดิบ
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CAMERA_SOURCE_IDS, type Camera, type CameraCatalogue, type CameraSourceId, type CameraStream } from "@siahra/shared-types";
import { formatProbeTable, NOT_PROBED, OUT_DIR, parseBuildArgs, probeStreams, probeVantageLabel } from "./cameraCatalogue.js";

/** เดาชนิดจากนามสกุล — `--url` ใช้กับการสำรวจแหล่งใหม่ที่ยังไม่มี build script */
export function streamForUrl(url: string): CameraStream {
  const p = new URL(url).pathname.toLowerCase();
  if (p.endsWith(".m3u8")) return { kind: "hls", url, label: null, captureTime: "none", probe: { ...NOT_PROBED } };
  return { kind: "jpeg", url, label: null, captureTime: "none", probe: { ...NOT_PROBED } };
}

function usage(): never {
  console.error(`usage: probe-cameras.ts <${CAMERA_SOURCE_IDS.join("|")}> | --url <m3u8|jpg> [--vantage <label>]`);
  process.exit(2);
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseBuildArgs(argv);
  const urlIdx = argv.indexOf("--url");
  let cameras: Camera[];
  let title: string;
  if (urlIdx !== -1) {
    const url = argv[urlIdx + 1];
    if (!url) usage();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      usage();
    }
    // ระเบียนชั่วคราวเพื่อ probe เท่านั้น — ไม่ถูกเขียนที่ไหน
    cameras = [
      {
        id: "url",
        sourceId: CAMERA_SOURCE_IDS[0],
        nameTh: null,
        nameEn: null,
        lat: 0,
        lon: 0,
        coordSource: "upstream",
        provinceCode: null,
        owner: null,
        code: null,
        placeTh: null,
        streams: [streamForUrl(url)],
      },
    ];
    title = `one url on ${parsed.host}`;
  } else {
    const sourceId = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--vantage");
    if (!sourceId || !(CAMERA_SOURCE_IDS as readonly string[]).includes(sourceId)) usage();
    const file = path.join(OUT_DIR, `${sourceId as CameraSourceId}.json`);
    let cat: CameraCatalogue;
    try {
      cat = JSON.parse(readFileSync(file, "utf-8")) as CameraCatalogue;
    } catch {
      console.error(`cannot read ${path.relative(process.cwd(), file)} — build it first (npm run build:cctv:* -w apps/etl)`);
      process.exit(1);
    }
    cameras = cat.cameras;
    title = `${sourceId}: ${cameras.length} cameras (catalogue built ${cat.builtAt})`;
  }
  const vantage = probeVantageLabel(args.vantage);
  const startedAt = new Date().toISOString();
  const { cameras: probed, stats } = await probeStreams(cameras);
  console.log(`## probe — ${title}`);
  console.log(`vantage: ${vantage} · probed at ${startedAt} · ${stats.streams} streams`);
  console.log("");
  console.log(formatProbeTable(stats, probed));
  console.log("");
  console.log("`unreachable` = could not be reached from this vantage (a network verdict, not a verdict on the source).");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : "probe-cameras failed");
    process.exit(1);
  });
}
