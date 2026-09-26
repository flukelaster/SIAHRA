import type { SourceId } from "./sources.js";

// ─────────────────────────────────────────────────────────────────────────────
// รูปเก่า (E15/E15.2) — web ยังอ่าน `dwr-cameras.json`/`itic-cameras.json` ด้วยชนิดสองชุดนี้อยู่
// ETL เขียนรูปใหม่ (`Camera`/`CameraCatalogue` ด้านล่าง) ลง `{sourceId}.json` คู่ขนานกันไปก่อน
// จนกว่า web จะย้ายตาม (PR B) แล้วชนิดเก่าจึงถูกลบ — ห้ามใช้กับไฟล์ใหม่
// ─────────────────────────────────────────────────────────────────────────────

/**
 * บัญชีกล้อง CCTV ของกรมทรัพยากรน้ำ (DWR, E15) — `apps/web/public/cctv/dwr-cameras.json`
 * สร้างโดย `npm run build:cctv:dwr -w apps/etl` (`apps/etl/src/build-dwr-cctv.ts`) จาก API
 * สาธารณะ `https://telemetry.dwr.go.th/api`
 *
 * ชนิดนี้เป็น **allowlist**: ต้นทางส่งลิงก์กล้องที่ฝังชื่อผู้ใช้/รหัสผ่านจริงมาด้วย
 * (`cctvSnapshotLink`/`cctvVideoLink`) ฟิลด์เหล่านั้นจึงไม่มีที่อยู่ในชนิดนี้โดยตั้งใจ
 * ห้ามเพิ่มฟิลด์ลิงก์ใด ๆ ของตัวกล้องเข้ามา — ภาพล่าสุดขอผ่าน API ของ DWR ด้วย `id`
 * เท่านั้น (ดู `apps/web/src/lib/cctv.ts`)
 */
export interface CctvCamera {
  /** id ของระเบียน reportCctv ที่ DWR ใช้ขอภาพล่าสุด (`public/reportCctv/snapshot/{id}`) */
  id: string;
  /** รหัสสถานีโทรมาตรของ DWR ที่กล้องติดอยู่ (เช่น "TC020106") */
  stationCode: string;
  nameTh: string | null;
  nameEn: string | null;
  /** WGS84 จาก `public/station/getByCode/{stationCode}` ของ DWR */
  lat: number;
  lon: number;
  /**
   * จังหวัดจาก point-in-polygon กับ `apps/web/public/aoi/{code}/boundary.geojson`
   * ตอน build — null = พิกัดไม่ตกในขอบเขตจังหวัดใดที่เรามี (ไม่เดาจากชื่อจังหวัดของต้นทาง)
   */
  provinceCode: string | null;
  /** ชื่ออำเภอตามที่ DWR ระบุ — null เมื่อต้นทางไม่ได้ให้ไว้ */
  amphoeTh: string | null;
}

export interface CctvCatalogue {
  /** เวลาที่สคริปต์ ETL ดึงรายการจาก DWR สำเร็จ (UTC ISO) — ใช้เป็น `fetchedAt` ของชั้น */
  builtAt: string;
  /** endpoint ที่รายการนี้มาจาก — ให้ตรวจย้อนได้ */
  sourceUrl: string;
  cameras: CctvCamera[];
}

/**
 * บัญชีกล้องถนนของมูลนิธิ iTIC (E15.2) — `apps/web/public/cctv/itic-cameras.json`
 * สร้างโดย `npm run build:cctv:itic -w apps/etl` (`apps/etl/src/build-itic-cctv.ts`) จากรายการ
 * กล้องที่ Longdo เผยแพร่ (`https://camera.longdo.com/feed/?command=json`)
 *
 * เป็น **allowlist** เช่นเดียวกับ `CctvCamera`: เก็บลิงก์ของต้นทางได้สองแบบเท่านั้น (ดู `ItiCStream`)
 * — ห้ามเพิ่มลิงก์ภาพ/MJPEG อื่นของต้นทาง (`vdourl`, `link`, `imgurl` นอกกลุ่มที่วัดแล้ว)
 */
export interface ItiCCamera {
  /** `camid` ของต้นทาง (เช่น "DOH-PER-8-012") */
  id: string;
  /** `title` ของต้นทาง (ภาษาไทย, มีทางหลวง/ทิศทาง) — null เมื่อว่าง */
  name: string | null;
  lat: number;
  lon: number;
  /** เจ้าของกล้องตามที่ต้นทางระบุ (เช่น "กรมทางหลวง") — null เมื่อว่าง; แสดงเป็นเครดิตใน popup */
  organization: string | null;
  /** สิ่งที่เบราว์เซอร์เปิดได้จากกล้องนี้ — วิดีโอสด HLS หรือภาพนิ่ง JPEG ที่ขอใหม่เป็นระยะ */
  stream: ItiCStream;
  /** จังหวัดจาก point-in-polygon ตอน build — null = ไม่ตกในขอบเขตจังหวัดใดที่เรามี */
  provinceCode: string | null;
}

/**
 * ลิงก์ของกล้อง iTIC หนึ่งตัว (ETL กรองไว้ และ web ตรวจรูปแบบซ้ำก่อนใช้):
 *
 * - `hls`  — HLS playlist บน `https://camerai1.iticfoundation.org/` ที่ไม่ใช่ `tempsus`
 *   (ป้าย "ระงับชั่วคราว") — วิดีโอสด
 * - `jpeg` — `https://camera1.iticfoundation.org/jpeg2.php?camid=10.8.0.{n}:{port}` เท่านั้น: ภาพนิ่ง
 *   หนึ่งเฟรม (เวลาถ่ายพิมพ์อยู่บนภาพ ไม่มีเป็นข้อมูล) — กลุ่มเดียวของกล้องที่ไม่มี HLS ใช้ได้ซึ่ง
 *   ตอบภาพจริงเมื่อวัด 2026-09-26 (เหตุผลและผลของกลุ่มอื่นอยู่ใน `build-itic-cctv.README.md`)
 */
export type ItiCStream = { kind: "hls"; url: string } | { kind: "jpeg"; url: string };

export interface ItiCCatalogue {
  /** เวลาที่สคริปต์ ETL ดึงรายการสำเร็จ (UTC ISO) — `fetchedAt` ของชั้น; ต้นทางไม่มีเวลาเผยแพร่ */
  builtAt: string;
  sourceUrl: string;
  cameras: ItiCCamera[];
}

// ─────────────────────────────────────────────────────────────────────────────
// รูปทั่วไป — กล้องหนึ่งชนิด, N แหล่ง (แผน 2026-09-26 ขั้นที่ 2a)
//
// แหล่งกล้องทุกแหล่งเป็น `SourceDescriptor` ชนิด `"browser"`: เบราว์เซอร์ของผู้ใช้ขอภาพ/สตรีม
// จากต้นทางเองทีละกล้องเมื่อคลิก api ไม่เคยถาม จึงไม่มีสถานะใน `/api/v1/health` และไม่มี
// ต้นทุน Cloudflare — บัญชีกล้องเป็น static asset `apps/web/public/cctv/{sourceId}.json`
// ที่ ETL เขียน (`apps/etl/src/cameraCatalogue.ts` `writeCatalogue`)
// ─────────────────────────────────────────────────────────────────────────────

/** แหล่งกล้องที่ลงทะเบียนแล้ว — ต้องเป็น `SourceId` ที่ `SOURCES[id].kind === "browser"` */
export type CameraSourceId = Extract<SourceId, "dwr-cctv" | "itic-cctv">;

/**
 * ผล probe ของสตรีมหนึ่งเส้น **ตอน build** จาก vantage เดียว (ดู `CameraCatalogue.probedAt`/
 * `probeVantage`) — ไม่ใช่สถานะปัจจุบัน ป้ายใน UI จึงพูดว่า "ไม่ตอบตอน build เมื่อ … จาก …"
 *
 * - `ok`          — ตอบ 200 และ body เป็นของที่ขอ (playlist `#EXTM3U` / ภาพ / multipart)
 * - `empty`       — ต้นทางตอบแล้วว่าไม่มีของให้: 200 แต่ 0 ไบต์ (เช่น EGAT วัด 2026-09-26, บางสถานี
 *   MJPEG ของ DWR) หรือ `dwr-snapshot` ที่ DWR ตอบ `value` ว่าง/404 (= `no-image` ของ web)
 * - `not-image`   — ตอบ 200 แต่ body ไม่ใช่ภาพ/playlist (เช่น "Camera (jpeg) not found")
 * - `http-4xx` / `http-5xx` — ต้นทางตอบด้วยสถานะผิดพลาด (hls: นับจาก chunklist ด้วย —
 *   master 200 แต่ chunklist 404 ไม่ใช่ `ok`)
 * - `unreachable` — **ถามไม่ได้จากเครือข่ายที่รัน** (timeout/DNS/TLS filter) ≠ แหล่งตาย
 *   (AGENTS.md: บอกว่า "ถามไม่ได้" ไม่ใช่ "ไม่มีอะไรใหม่") — `camera1.iticfoundation.org`
 *   และ `streaming2.highwaytraffic.go.th` ให้ผลต่างกันตาม vantage
 * - `not-probed`  — build ด้วย `--no-probe`; **ห้ามใช้ `ok` เป็นค่าตั้งต้น**
 */
export type ProbeResult = "ok" | "empty" | "not-image" | "http-4xx" | "http-5xx" | "unreachable" | "not-probed";

export interface StreamProbe {
  result: ProbeResult;
  /**
   * `Access-Control-Allow-Origin` ของคำตอบครอบ `https://siahra-radar.co` (หรือ `*`) ไหม —
   * null = ไม่ได้ probe หรือถามไม่ได้ สำคัญกับชนิดที่ต้องอ่าน body/ header ด้วย `fetch`
   * (`hls`, `jpeg-fetch`, `dwr-snapshot`) ส่วน `<img src>` ไม่ต้องใช้ CORS
   */
  cors: boolean | null;
}

/**
 * สิ่งที่เบราว์เซอร์เปิดได้จากกล้องหนึ่งตัว — กล้องหนึ่งตัวมีได้หลายสตรีม (DWR: ภาพนิ่ง + MJPEG,
 * กรมทางหลวง: ขาเข้า/ขาออก) `captureTime` จึงอยู่บนสตรีม ไม่ใช่กล้อง และบอกว่า **เวลาถ่าย
 * มาจากไหน** — ไม่มี = `"none"` แล้ว popup พูดตรง ๆ ว่าสตรีมไม่มีเวลากำกับ (ห้ามใช้นาฬิกาผู้ใช้)
 *
 * - `hls`          — playlist HLS (`connect-src` + `media-src`); `program-date-time` เฉพาะเมื่อ
 *                    chunklist ที่ probe มี `EXT-X-PROGRAM-DATE-TIME` จริง
 * - `jpeg`         — ภาพนิ่งที่ขอใหม่เป็นระยะด้วย `<img src>` (`img-src`); `burned-in` = เวลาพิมพ์
 *                    อยู่บนภาพ ไม่มีเป็นข้อมูล
 * - `jpeg-fetch`   — ภาพนิ่งที่ต้อง `fetch()` → blob (`connect-src`, ต้อง CORS) เพื่ออ่าน
 *                    `Last-Modified` เป็นเวลาภาพ
 * - `mjpeg`        — `multipart/x-mixed-replace` แสดงด้วย `<img src>` (`img-src`)
 * - `dwr-snapshot` — ภาพล่าสุดของ DWR: ไม่มี url — derive จาก `Camera.id`
 *                    (`GET public/reportCctv/snapshot/{id}` → `POST file/image/cctv`,
 *                    `apps/web/src/lib/cctv.ts`); เวลาถ่ายอ่านจาก path ของภาพ (+07:00)
 * - `dwr-mjpeg`    — ภาพสด MJPEG ของ DWR: ไม่มี url — derive จาก `stationCode`
 *                    (`public/cctv/mjpegStream?stnCode=`), แสดงด้วย `<img src>`
 *
 * ชนิดที่มี `url` ต้องเป็น `https:` ไม่มี userinfo และ origin อยู่ใน `CAMERA_SOURCES[sourceId].hosts`
 * ของ directive ที่ `streamDirective(kind)` กำหนด — ETL ปฏิเสธทั้งไฟล์ถ้าไม่ตรง และ web ตรวจซ้ำก่อนเปิด
 */
export type CameraStream = { label: string | null; probe: StreamProbe } & (
  | { kind: "hls"; url: string; captureTime: "program-date-time" | "none" }
  | { kind: "jpeg"; url: string; captureTime: "burned-in" | "none" }
  | { kind: "jpeg-fetch"; url: string; captureTime: "last-modified" | "none" }
  | { kind: "mjpeg"; url: string; captureTime: "none" }
  | { kind: "dwr-snapshot"; captureTime: "path" }
  | { kind: "dwr-mjpeg"; stationCode: string; captureTime: "none" }
);

export type CameraStreamKind = CameraStream["kind"];

/** directive ของ CSP ที่โฮสต์ของสตรีมชนิดหนึ่งต้องอยู่ (`apps/web/public/_headers`) */
export type CspDirective = "connect" | "img" | "media";

export interface Camera {
  /** id ของต้นทาง (DWR: id ระเบียน reportCctv, iTIC: `camid`) — ไม่ซ้ำภายในแหล่งเดียวกัน */
  id: string;
  sourceId: CameraSourceId;
  nameTh: string | null;
  nameEn: string | null;
  /** WGS84 */
  lat: number;
  lon: number;
  /**
   * `upstream` = พิกัดจากต้นทางโดยตรง; `hand-placed` = เราวางเอง ต้องมีที่มาต่อกล้องใน
   * `CameraSourceMeta.coordinatesDoc` — กล้องที่ไม่มีพิกัดจากที่ใดเลย **ไม่ถูก emit** (ไม่เดา)
   */
  coordSource: "upstream" | "hand-placed";
  /**
   * จังหวัดจาก point-in-polygon กับ `apps/web/public/aoi/{code}/boundary.geojson` ตอน build
   * — null = ไม่ตกในขอบเขตจังหวัดใดที่เรามี (ไม่เดาจากชื่อจังหวัดของต้นทาง)
   */
  provinceCode: string | null;
  /** เจ้าของกล้องตามที่ต้นทางระบุ (iTIC: `organization`) — null เมื่อไม่ระบุ; แสดงเป็นเครดิต */
  owner: string | null;
  /** รหัสของต้นทางที่ผู้ใช้อ้างถึงได้ (DWR: รหัสสถานีโทรมาตร, กรมทางหลวง: `PER-x-yyy`) */
  code: string | null;
  /** ที่ตั้งตามที่ต้นทางระบุ (DWR: อำเภอ) — null เมื่อไม่ระบุ */
  placeTh: string | null;
  streams: CameraStream[];
}

export interface CameraCatalogue {
  sourceId: CameraSourceId;
  /** เวลาที่ ETL ดึงรายการจากต้นทางสำเร็จ (UTC ISO) — `fetchedAt` ของชั้น; ต้นทางไม่มีเวลาเผยแพร่ */
  builtAt: string;
  /** endpoint ที่รายการนี้มาจาก — ให้ตรวจย้อนได้ */
  sourceUrl: string;
  /** เวลา probe (UTC ISO) — null = build ด้วย `--no-probe` (ทุกสตรีมเป็น `not-probed`) */
  probedAt: string | null;
  /** ป้ายเครือข่ายที่ probe (`--vantage` เท่านั้น, `"unlabelled"` ถ้าไม่ให้ — ห้ามใส่ hostname/ชื่อผู้ใช้ ไฟล์นี้สาธารณะ) — null เมื่อไม่ได้ probe */
  probeVantage: string | null;
  cameras: Camera[];
}

export interface CameraSourceMeta {
  id: CameraSourceId;
  /**
   * origin ที่สตรีมของแหล่งนี้ใช้ได้ แยกตาม directive ของ CSP — ต้องตรงกับ
   * `apps/web/public/_headers` (`docs/security.md`); ETL ปฏิเสธ url นอกรายการ, web ตรวจซ้ำ
   */
  hosts: Partial<Record<CspDirective, readonly string[]>>;
  /** รูปแบบ url เพิ่มเติมที่ต้องตรงทั้งเส้น (ยึดหัว-ท้าย) — เช่นกลุ่มภาพนิ่งเดียวของ iTIC ที่วัดแล้ว */
  urlPattern?: RegExp;
  /** เปิดในบิลด์ปกติไหม (ปิดรายแหล่งด้วย `VITE_FEATURE_CCTV_DISABLE=<id,...>` ใน PR B) */
  defaultEnabled: boolean;
  /** `renderOrder` ของหมุด — เลขมากอยู่บน */
  markerPriority: number;
  /** เอกสารที่มาของพิกัด (จำเป็นเมื่อมีกล้อง `hand-placed`) — null = ทุกกล้องเป็น `upstream` */
  coordinatesDoc: string | null;
  /** สถานะสิทธิ์ตามที่ตรวจจริง พร้อมวันที่ — ห้ามตั้งชื่อสัญญาอนุญาตขึ้นเอง */
  licenceNote: string;
  /** README ของสคริปต์ build (path จากรากโปรเจกต์) */
  readme: string;
}

/**
 * ลำดับการประกาศ = ลำดับเครดิตในบรรทัด attribution และใน legend — เพิ่มแหล่งใหม่ต่อท้าย
 */
export const CAMERA_SOURCE_IDS = ["dwr-cctv", "itic-cctv"] as const satisfies readonly CameraSourceId[];

export const CAMERA_SOURCES: Record<CameraSourceId, CameraSourceMeta> = {
  "dwr-cctv": {
    id: "dwr-cctv",
    // connect: snapshot (GET path → POST JPEG, DWR สะท้อน origin ใน CORS); img: MJPEG `<img src>`
    hosts: { connect: ["https://telemetry.dwr.go.th"], img: ["https://telemetry.dwr.go.th"] },
    defaultEnabled: true,
    markerPriority: 30,
    coordinatesDoc: null,
    licenceNote:
      "DWR ไม่ได้เผยแพร่เงื่อนไขการใช้ API นี้ (ตรวจ 2026-09-26) — แสดงโดยให้เครดิตกรมทรัพยากรน้ำ ตามการตัดสินใจของ owner ใน docs/roadmap.md §4",
    readme: "apps/etl/src/build-dwr-cctv.README.md",
  },
  "itic-cctv": {
    id: "itic-cctv",
    // connect+media: HLS บน camerai1 (hls.js XHR + Safari native); img: ภาพนิ่ง jpeg2.php บน camera1
    hosts: {
      connect: ["https://camerai1.iticfoundation.org"],
      media: ["https://camerai1.iticfoundation.org"],
      img: ["https://camera1.iticfoundation.org"],
    },
    // กลุ่มภาพนิ่งเดียวที่ตอบภาพจริงเมื่อวัด 2026-09-26 (ดู build-itic-cctv.README.md) — ใช้กับ `jpeg` เท่านั้น
    urlPattern: /^https:\/\/camera1\.iticfoundation\.org\/jpeg2\.php\?camid=10\.8\.0\.\d+:\d+$/,
    defaultEnabled: true,
    markerPriority: 29,
    coordinatesDoc: null,
    licenceNote:
      "ไม่ได้รับสัญญาอนุญาตใดสำหรับสตรีมของ iTIC และรายการกล้องของ Longdo และเงื่อนไข API ของ Longdo จำกัดการเผยแพร่ซ้ำ (ตรวจ 2026-09-26) — owner ตัดสินใจเผยแพร่พร้อมเครดิต docs/roadmap.md §4",
    readme: "apps/etl/src/build-itic-cctv.README.md",
  },
};

/** path ของบัญชีกล้อง (static asset ของ Worker web) */
export function cameraCatalogueUrl(id: CameraSourceId): string {
  return `/cctv/${id}.json`;
}

/** กุญแจข้ามแหล่ง — `id` ซ้ำกันข้ามแหล่งได้ (รหัส `PER-x-yyy` อยู่ทั้งใน iTIC และกรมทางหลวง) */
export function cameraKey(c: Pick<Camera, "sourceId" | "id">): string {
  return `${c.sourceId}:${c.id}`;
}

/**
 * directive ของ CSP ที่ origin ของสตรีมชนิดนี้ต้องอยู่ — สตรีมที่ไม่มี url (`dwr-*`) ก็มี directive
 * เพราะ web ยัง derive url จาก `hosts` ของแหล่ง: snapshot ผ่าน `fetch` (connect), MJPEG ผ่าน
 * `<img src>` (img)
 */
export function streamDirective(kind: CameraStreamKind): readonly CspDirective[] {
  switch (kind) {
    case "hls":
      return ["connect", "media"];
    case "jpeg":
    case "mjpeg":
    case "dwr-mjpeg":
      return ["img"];
    case "jpeg-fetch":
    case "dwr-snapshot":
      return ["connect"];
  }
}
