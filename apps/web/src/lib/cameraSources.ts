/**
 * ทะเบียนแหล่งกล้องฝั่ง web (E15.3) — ตรวจ URL ของสตรีมซ้ำก่อนเปิด และบอกว่า build นี้มีสตรีม
 * ชนิดไหนได้บ้าง ทั้งหมดอ่านจาก `CAMERA_SOURCES` ของ shared-types ไม่มีโฮสต์พิมพ์ไว้ตรงนี้
 *
 * โมดูลนี้ถูกใช้ทั้งจาก entry (หมุด `scene/CctvMarkers.ts`) และจาก chunk lazy (`lib/streams.ts`,
 * `components/map/CameraBody.tsx`) จึงต้องเล็กและ **ห้าม** import `lib/cctv.ts`/`lib/streams.ts`
 * — โมดูลที่ทั้งสองฝั่งใช้ร่วมกันถูกวางใน entry ทั้งก้อน
 */
import {
  CAMERA_SOURCES,
  streamDirective,
  type Camera,
  type CameraSourceId,
  type CameraStream,
  type CameraStreamKind,
  type CspDirective,
} from "@siahra/shared-types";
import { ENABLED_CAMERA_SOURCES } from "./featureFlags";

/**
 * origin ของ API กรมทรัพยากรน้ำ — สตรีม `dwr-snapshot`/`dwr-mjpeg` ไม่มี url ในบัญชี web derive
 * เองจากค่านี้ (`lib/cctv.ts`) จึงต้องผ่านการตรวจแบบเดียวกับ url ในบัญชี: อยู่ใน
 * `CAMERA_SOURCES["dwr-cctv"].hosts` ของ directive ที่ชนิดนั้นต้องการ
 */
export const DWR_ORIGIN = "https://telemetry.dwr.go.th";
export const DWR_API = `${DWR_ORIGIN}/api`;

/**
 * url นี้เปิดได้ในฐานะสตรีมชนิด `kind` ของแหล่ง `sourceId` ไหม — hard allowlist (คนละเรื่องกับ
 * `probe.result` ซึ่งเป็นแค่ป้าย):
 *   - แหล่งต้องเปิดอยู่ใน build นี้ (`ENABLED_CAMERA_SOURCES`)
 *   - `https:` เท่านั้น ไม่มี userinfo
 *   - origin อยู่ใน `hosts[d]` ของแหล่ง **ทุก** directive `d` ที่ `streamDirective(kind)` ต้องการ
 *   - ตรง `urlPattern` ของแหล่ง (ถ้ามี) — ยึดหัว-ท้าย
 */
export function isAllowedUrl(sourceId: CameraSourceId, kind: CameraStreamKind, url: string): boolean {
  if (!ENABLED_CAMERA_SOURCES.includes(sourceId)) return false;
  const meta = CAMERA_SOURCES[sourceId];
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username !== "" || u.password !== "") return false;
  for (const d of streamDirective(kind)) {
    if (!(meta.hosts[d] ?? []).includes(u.origin)) return false;
  }
  // `urlPattern` ผูกกับกลุ่มภาพนิ่ง `jpeg` เท่านั้น — กฎเดียวกับ `writeCatalogue` ของ ETL
  if (kind === "jpeg" && meta.urlPattern && !meta.urlPattern.test(url)) return false;
  // playlist ป้าย "ระงับชั่วคราว" ของ iTIC (`tempsus`) — ETL ไม่เขียนลงบัญชีอยู่แล้ว ตรงนี้ตรวจซ้ำ
  // ให้ตัวเล่นไม่เปิดป้ายนั้นเป็นวิดีโอสด แม้บัญชีจะถูกแก้ด้วยมือ
  if (kind === "hls" && SUSPENDED_PLACEHOLDER.test(u.pathname)) return false;
  return true;
}

/** playlist ป้าย "ระงับชั่วคราว" ของ iTIC — ไม่ใช่วิดีโอสด (ดู build-itic-cctv.README.md) */
const SUSPENDED_PLACEHOLDER = /tempsus/i;

/** ชนิดที่ไม่มี url ในบัญชี — web derive จาก `Camera.id`/`stationCode` บน `DWR_API` */
const DWR_DERIVED_KINDS: ReadonlySet<CameraStreamKind> = new Set(["dwr-snapshot", "dwr-mjpeg"]);

/**
 * สตรีมนี้ของกล้องนี้เปิดได้ไหม — ชนิดที่มี url ตรวจ url นั้น; ชนิด `dwr-*` ตรวจ origin ที่ web
 * จะ derive (`DWR_ORIGIN`) กับ `hosts` ของแหล่งของกล้อง ดังนั้นสตรีม `dwr-*` บนกล้องของแหล่งอื่น
 * ถูกปฏิเสธ (แหล่งนั้นไม่มี telemetry.dwr.go.th ใน hosts)
 */
export function isAllowedStreamUrl(camera: Pick<Camera, "sourceId">, stream: CameraStream): boolean {
  if ("url" in stream) return isAllowedUrl(camera.sourceId, stream.kind, stream.url);
  if (!DWR_DERIVED_KINDS.has(stream.kind)) return false;
  return isAllowedUrl(camera.sourceId, stream.kind, `${DWR_ORIGIN}/`);
}

/**
 * build นี้มีแหล่งที่เปิดอยู่ซึ่ง **อาจ** มีสตรีมชนิดนี้ไหม — อนุมานจากทะเบียน: แหล่งที่ประกาศ
 * `hosts` ครบทุก directive ที่ชนิดนั้นต้องการ (hls = connect + media) ใช้ gate การโหลด chunk
 * ของ hls.js: ถอดทุกแหล่งที่เล่น HLS ได้ = ไม่มี `import("hls.js")` เกิดขึ้นเลย
 */
export function hasEnabledKind(kind: CameraStreamKind, enabled: readonly CameraSourceId[] = ENABLED_CAMERA_SOURCES): boolean {
  const directives: readonly CspDirective[] = streamDirective(kind);
  return enabled.some((id) => directives.every((d) => (CAMERA_SOURCES[id].hosts[d]?.length ?? 0) > 0));
}
