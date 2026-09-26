import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CAMERA_SOURCE_IDS,
  CAMERA_SOURCES,
  cameraCatalogueUrl,
  cameraKey,
  SOURCES,
  streamDirective,
  type Camera,
  type CameraCatalogue,
  type CameraStream,
  type StreamProbe,
} from "@siahra/shared-types";
import {
  assembleCatalogue,
  classifyProbe,
  corsCovers,
  DWR_API,
  firstPlaylistRef,
  NOT_PROBED,
  parseBuildArgs,
  probeStreams,
  probeVantageLabel,
  serializeCatalogue,
  validateCatalogue,
  writeCatalogue,
  type CatalogueMeta,
  type ProbeEvidence,
} from "./cameraCatalogue.js";
import { fakeFetch } from "./cameraCatalogue.testUtils.js";
import { CREDENTIAL_PATTERN } from "./provincePolygons.js";

const HLS = "https://camerai1.iticfoundation.org/pass/180.180.242.207:1935/Phase8/PER_8_012.stream/playlist.m3u8";
const CHUNKLIST = "https://camerai1.iticfoundation.org/pass/180.180.242.207:1935/Phase8/PER_8_012.stream/chunklist_w1.m3u8";
const JPEG = "https://camera1.iticfoundation.org/jpeg2.php?camid=10.8.0.99:8001";
const MASTER = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=221996,CODECS=\"avc1.77.31\",RESOLUTION=1280x720\nchunklist_w1.m3u8\n";
const MEDIA = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:24\n#EXT-X-MEDIA-SEQUENCE:67\n#EXTINF:9.6,\nmedia_w1_67.ts\n";
const MEDIA_PDT = "#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXT-X-PROGRAM-DATE-TIME:2026-09-26T13:10:00.000+07:00\n#EXTINF:9.6,\nmedia_1.ts\n";
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

const camera = (over: Partial<Camera> = {}, streams: CameraStream[] = []): Camera => ({
  id: "cam-1",
  sourceId: "itic-cctv",
  nameTh: "กล้องทดสอบ",
  nameEn: null,
  lat: 13.5,
  lon: 100.5,
  coordSource: "upstream",
  provinceCode: "99",
  owner: "กรมทางหลวง",
  code: null,
  placeTh: null,
  streams,
  ...over,
});
const hls = (url = HLS, probe: StreamProbe = { ...NOT_PROBED }): CameraStream => ({ kind: "hls", url, label: null, captureTime: "none", probe });
const jpeg = (url = JPEG, probe: StreamProbe = { ...NOT_PROBED }): CameraStream => ({ kind: "jpeg", url, label: null, captureTime: "burned-in", probe });
const META: CatalogueMeta = { builtAt: "2026-09-26T00:00:00.000Z", sourceUrl: "https://camera.longdo.com/feed/?command=json", probedAt: null, probeVantage: null };
const PROBED_META: CatalogueMeta = { ...META, probedAt: "2026-09-26T00:01:00.000Z", probeVantage: "test-host (lab)" };

describe("shared-types camera registry", () => {
  it("every camera source is a browser source (the API never probes it) and its hosts are https origins", () => {
    expect(CAMERA_SOURCE_IDS).toEqual(["dwr-cctv", "itic-cctv"]);
    for (const id of CAMERA_SOURCE_IDS) {
      expect(SOURCES[id].kind).toBe("browser");
      expect(CAMERA_SOURCES[id].id).toBe(id);
      // defaultEnabled ⇒ licenceNote บอกวันที่ที่ตรวจ
      if (CAMERA_SOURCES[id].defaultEnabled) expect(CAMERA_SOURCES[id].licenceNote).toMatch(/\d{4}-\d{2}-\d{2}/);
      for (const hosts of Object.values(CAMERA_SOURCES[id].hosts)) {
        for (const h of hosts) expect(new URL(h).origin).toBe(h);
      }
    }
    expect(cameraCatalogueUrl("dwr-cctv")).toBe("/cctv/dwr-cctv.json");
    expect(cameraKey({ sourceId: "itic-cctv", id: "DOH-PER-8-012" })).toBe("itic-cctv:DOH-PER-8-012");
    expect(streamDirective("hls")).toEqual(["connect", "media"]);
    expect(streamDirective("jpeg")).toEqual(["img"]);
    expect(streamDirective("jpeg-fetch")).toEqual(["connect"]);
    expect(streamDirective("mjpeg")).toEqual(["img"]);
    expect(streamDirective("dwr-snapshot")).toEqual(["connect"]);
    expect(streamDirective("dwr-mjpeg")).toEqual(["img"]);
    expect(DWR_API).toBe("https://telemetry.dwr.go.th/api");
  });
});

describe("classifyProbe", () => {
  const ev = (over: Partial<ProbeEvidence>): ProbeEvidence => ({
    kind: "jpeg",
    status: 200,
    contentType: "image/jpeg",
    bytes: 100,
    firstLine: "\xff\xd8\xff",
    acao: null,
    ...over,
  });

  it.each<[string, Partial<ProbeEvidence>, string]>([
    ["no answer = unreachable, not dead", { status: null }, "unreachable"],
    ["timeout on hls", { kind: "hls", status: null, bytes: 0, firstLine: "" }, "unreachable"],
    ["404", { status: 404 }, "http-4xx"],
    ["403 with an image body is still 4xx", { status: 403 }, "http-4xx"],
    ["503", { status: 503 }, "http-5xx"],
    ["3xx that was not followed", { status: 302, bytes: 0 }, "not-image"],
    ["200 with 0 bytes (EGAT 2026-09-26)", { bytes: 0 }, "empty"],
    ["hls master #EXTM3U", { kind: "hls", contentType: "application/vnd.apple.mpegurl", firstLine: "#EXTM3U" }, "ok"],
    ["hls with an odd content-type still ok on #EXTM3U", { kind: "hls", contentType: "text/plain", firstLine: "#EXTM3U" }, "ok"],
    ["hls answering html", { kind: "hls", contentType: "text/html", firstLine: "<!DOCTYPE html>" }, "not-image"],
    ["jpeg by content-type", { contentType: "image/jpeg", firstLine: "" }, "ok"],
    ["jpeg by magic when content-type is missing", { contentType: null }, "ok"],
    ["jpeg answering text ('Camera (jpeg) not found')", { contentType: "text/html", firstLine: "Camera (jpeg) not found" }, "not-image"],
    ["jpeg-fetch image", { kind: "jpeg-fetch" }, "ok"],
    ["dwr-snapshot image", { kind: "dwr-snapshot" }, "ok"],
    ["dwr-snapshot json body", { kind: "dwr-snapshot", contentType: "application/json", firstLine: "{}" }, "not-image"],
    ["mjpeg multipart", { kind: "mjpeg", contentType: "multipart/x-mixed-replace; boundary=frame", firstLine: "--frame" }, "ok"],
    ["dwr-mjpeg multipart", { kind: "dwr-mjpeg", contentType: "multipart/x-mixed-replace; boundary=frame", firstLine: "--frame" }, "ok"],
    ["dwr-mjpeg 200 but 0 bytes = empty", { kind: "dwr-mjpeg", contentType: "multipart/x-mixed-replace", bytes: 0, firstLine: "" }, "empty"],
    ["mjpeg answering html", { kind: "mjpeg", contentType: "text/html", firstLine: "<html>" }, "not-image"],
  ])("%s", (_name, over, expected) => {
    expect(classifyProbe(ev(over))).toBe(expected);
  });

  it("never classifies anything as not-probed — that value is reserved for --no-probe", () => {
    for (const status of [null, 200, 204, 301, 404, 500]) {
      expect(classifyProbe(ev({ status, bytes: 0, firstLine: "" }))).not.toBe("not-probed");
    }
  });

  it("corsCovers accepts * or our exact origin, null when there was no answer to read", () => {
    expect(corsCovers("*")).toBe(true);
    expect(corsCovers("https://siahra-radar.co")).toBe(true);
    expect(corsCovers(" https://siahra-radar.co ")).toBe(true);
    expect(corsCovers("https://localhost:5173")).toBe(false);
    expect(corsCovers("")).toBe(false);
    expect(corsCovers(null)).toBeNull();
  });

  it("firstPlaylistRef skips tags and blank lines", () => {
    expect(firstPlaylistRef(MASTER)).toBe("chunklist_w1.m3u8");
    expect(firstPlaylistRef("#EXTM3U\n\n")).toBeNull();
  });
});

describe("probeStreams", () => {
  it("hls: follows the master to its chunklist, classifies from the chunklist, and records cors + PROGRAM-DATE-TIME", async () => {
    const { fetch, calls } = fakeFetch({
      [HLS]: { body: MASTER, headers: { "content-type": "application/vnd.apple.mpegurl", "access-control-allow-origin": "*" } },
      [CHUNKLIST]: { body: MEDIA_PDT, headers: { "content-type": "application/vnd.apple.mpegurl", "access-control-allow-origin": "*" } },
    });
    const { cameras, stats } = await probeStreams([camera({}, [hls()])], { fetch, perHostGapMs: 0 });
    expect(calls.map((c) => c.url)).toEqual([HLS, CHUNKLIST]);
    // probe ส่ง Origin เสมอ (DWR สะท้อน origin ใน CORS — ไม่ส่งจะไม่เห็น ACAO)
    expect(calls.every((c) => c.origin === "https://siahra-radar.co")).toBe(true);
    expect(cameras[0]!.streams[0]).toMatchObject({ kind: "hls", captureTime: "program-date-time", probe: { result: "ok", cors: true } });
    expect(stats.byKind.hls?.ok).toBe(1);
    expect(stats.hlsWithProgramDateTime).toBe(1);
  });

  it("hls: master 200 but chunklist 404 is http-4xx, never ok", async () => {
    const { fetch } = fakeFetch({
      [HLS]: { body: MASTER, headers: { "access-control-allow-origin": "*" } },
      [CHUNKLIST]: { status: 404, body: "not found" },
    });
    const { cameras } = await probeStreams([camera({}, [hls()])], { fetch, perHostGapMs: 0 });
    expect(cameras[0]!.streams[0]!.probe.result).toBe("http-4xx");
    expect(cameras[0]!.streams[0]!.captureTime).toBe("none");
  });

  it("hls: a media playlist without PROGRAM-DATE-TIME keeps captureTime none; cors false when ACAO names another origin", async () => {
    const { fetch } = fakeFetch({
      [HLS]: { body: MEDIA, headers: { "access-control-allow-origin": "https://other.example" } },
    });
    const { cameras, stats } = await probeStreams([camera({}, [hls()])], { fetch, perHostGapMs: 0 });
    expect(cameras[0]!.streams[0]).toMatchObject({ captureTime: "none", probe: { result: "ok", cors: false } });
    expect(stats.cors).toEqual({ yes: 0, no: 1, unknown: 0 });
  });

  it("network failure and timeout are unreachable with cors null — not a verdict on the source", async () => {
    const { fetch } = fakeFetch({ [JPEG]: { body: JPEG_BYTES, headers: { "content-type": "image/jpeg" }, delayMs: 5_000 } });
    const { cameras, stats } = await probeStreams(
      [camera({}, [jpeg(), jpeg("https://camera1.iticfoundation.org/jpeg2.php?camid=10.8.0.1:1")])],
      { fetch, perHostGapMs: 0, timeoutMs: 30 },
    );
    expect(cameras[0]!.streams.map((s) => s.probe)).toEqual([
      { result: "unreachable", cors: null },
      { result: "unreachable", cors: null },
    ]);
    expect(stats.byKind.jpeg?.unreachable).toBe(2);
    expect(stats.cors.unknown).toBe(2);
  });

  it("jpeg: reads only the first bytes and classifies by content-type/magic", async () => {
    const { fetch } = fakeFetch({ [JPEG]: { body: JPEG_BYTES, headers: { "content-type": "image/jpeg" } } });
    const { cameras } = await probeStreams([camera({}, [jpeg()])], { fetch, perHostGapMs: 0 });
    expect(cameras[0]!.streams[0]!.probe).toEqual({ result: "ok", cors: null });
  });

  it("dwr-snapshot: GET the path then POST for the JPEG; dwr-mjpeg: first chunk of the multipart stream", async () => {
    const acao = { "access-control-allow-origin": "https://siahra-radar.co" };
    const { fetch, calls } = fakeFetch({
      [`${DWR_API}/public/reportCctv/snapshot/cam-1`]: { body: JSON.stringify({ value: "/TC000001/2026/9/26/7_17.jpg" }), headers: { "content-type": "application/json", ...acao } },
      [`${DWR_API}/file/image/cctv`]: (init) => {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({ path: "/TC000001/2026/9/26/7_17.jpg" });
        return { body: JPEG_BYTES, headers: { "content-type": "image/jpeg", ...acao } };
      },
      [`${DWR_API}/public/cctv/mjpegStream?stnCode=TC000001&_=*`]: { body: "--frame\r\ncontent-type: image/jpeg\r\n\r\n", headers: { "content-type": "multipart/x-mixed-replace; boundary=frame", ...acao } },
      [`${DWR_API}/public/reportCctv/snapshot/cam-2`]: { body: JSON.stringify({ value: "" }), headers: { "content-type": "application/json", ...acao } },
      [`${DWR_API}/public/cctv/mjpegStream?stnCode=TC000002&_=*`]: { body: "", headers: { "content-type": "multipart/x-mixed-replace; boundary=frame", ...acao } },
      [`${DWR_API}/public/reportCctv/snapshot/cam-3`]: { status: 404, body: "", headers: acao },
      [`${DWR_API}/public/cctv/mjpegStream?stnCode=TC000003&_=*`]: { status: 500, body: "" },
    });
    const dwr = (id: string, stationCode: string): Camera =>
      camera({ id, sourceId: "dwr-cctv", owner: null, code: stationCode }, [
        { kind: "dwr-snapshot", label: null, captureTime: "path", probe: { ...NOT_PROBED } },
        { kind: "dwr-mjpeg", stationCode, label: null, captureTime: "none", probe: { ...NOT_PROBED } },
      ]);
    const { cameras, stats } = await probeStreams(
      [dwr("cam-1", "TC000001"), dwr("cam-2", "TC000002"), dwr("cam-3", "TC000003")],
      { fetch, perHostGapMs: 0 },
    );
    expect(cameras[0]!.streams.map((s) => s.probe)).toEqual([
      { result: "ok", cors: true },
      { result: "ok", cors: true },
    ]);
    // DWR ตอบแล้วว่าไม่มีภาพ (value ว่าง หรือ 404 = `no-image` ของ web) / MJPEG 200 แต่ 0 ไบต์ = empty
    // ไม่ใช่ unreachable และไม่ใช่ http-4xx; 5xx ยังเป็น http-5xx
    expect(cameras[1]!.streams.map((s) => s.probe.result)).toEqual(["empty", "empty"]);
    expect(cameras[2]!.streams.map((s) => s.probe.result)).toEqual(["empty", "http-5xx"]);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(stats.byKind["dwr-snapshot"]).toMatchObject({ ok: 1, empty: 2, "http-4xx": 0 });
    expect(stats.byKind["dwr-mjpeg"]).toMatchObject({ ok: 1, empty: 1, "http-5xx": 1 });
  });

  it("skip (--no-probe) marks every stream not-probed with cors null, and never ok", async () => {
    const { fetch, calls } = fakeFetch({ [HLS]: { body: MASTER } });
    const { cameras, stats } = await probeStreams([camera({}, [hls(), jpeg()])], { fetch, skip: true });
    expect(calls).toHaveLength(0);
    expect(cameras[0]!.streams.map((s) => s.probe)).toEqual([
      { result: "not-probed", cors: null },
      { result: "not-probed", cors: null },
    ]);
    expect(stats.byKind.hls?.["not-probed"]).toBe(1);
    expect(stats.byKind.hls?.ok).toBe(0);
  });

  it("does not mutate the input cameras", async () => {
    const input = [camera({}, [hls()])];
    const { fetch } = fakeFetch({ [HLS]: { body: MEDIA } });
    await probeStreams(input, { fetch, perHostGapMs: 0 });
    expect(input[0]!.streams[0]!.probe).toEqual(NOT_PROBED);
  });
});

describe("writeCatalogue / validateCatalogue", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "siahra-cctv-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("dedupes by id (first wins), sorts by id, writes {sourceId}.json and returns counts only", () => {
    const { path: file, stats } = writeCatalogue(
      "itic-cctv",
      [
        camera({ id: "B", provinceCode: null }, [hls()]),
        camera({ id: "A" }, [jpeg()]),
        camera({ id: "B", nameTh: "ซ้ำ" }, [hls()]),
      ],
      META,
      { outDir: dir },
    );
    expect(path.basename(file)).toBe("itic-cctv.json");
    const written = JSON.parse(readFileSync(file, "utf-8")) as CameraCatalogue;
    expect(written.sourceId).toBe("itic-cctv");
    expect(written.probedAt).toBeNull();
    expect(written.probeVantage).toBeNull();
    expect(written.cameras.map((c) => c.id)).toEqual(["A", "B"]);
    expect(written.cameras[1]!.nameTh).toBe("กล้องทดสอบ");
    expect(stats).toEqual({
      cameras: 2,
      duplicates: 1,
      provinces: 1,
      streams: 2,
      byKind: { hls: 1, jpeg: 1 },
      byResult: { ok: 0, empty: 0, "not-image": 0, "http-4xx": 0, "http-5xx": 0, unreachable: 0, "not-probed": 2 },
      cors: { yes: 0, no: 0, unknown: 2 },
    });
  });

  const refusal = (cams: Camera[], meta = META, sourceId: "itic-cctv" | "dwr-cctv" = "itic-cctv") => {
    const { catalogue } = assembleCatalogue(sourceId, cams, meta);
    return () => serializeCatalogue(catalogue);
  };

  it("refuses the credential pattern without echoing the value", () => {
    const run = refusal([camera({ nameTh: "user:pass@x.dyndns.info" }, [hls()])]);
    expect(run).toThrow(/credential pattern/);
    expect(run).not.toThrow(/dyndns|user:pass/);
  });

  it("refuses http:, userinfo, a foreign origin, a jpeg outside the urlPattern, and an hls on the img-only host", () => {
    expect(refusal([camera({}, [hls("http://camerai1.iticfoundation.org/x.m3u8")])])).toThrow(/not https/);
    // userinfo: URL parser เห็นก่อน CREDENTIAL_PATTERN — ข้อความไม่อ้าง url
    const userinfo = refusal([camera({}, [hls("https://user:pw@camerai1.iticfoundation.org/x.m3u8")])]);
    expect(userinfo).toThrow(/userinfo/);
    expect(userinfo).not.toThrow(/user:pw/);
    expect(refusal([camera({}, [hls("https://camerai1.iticfoundation.org.evil.test/x.m3u8")])])).toThrow(/outside the source's connect-src hosts/);
    expect(refusal([camera({}, [hls("https://camera1.iticfoundation.org/x.m3u8")])])).toThrow(/outside the source's connect-src hosts/);
    expect(refusal([camera({}, [jpeg("https://camera1.iticfoundation.org/jpeg2.php?camid=CAMPK0001")])])).toThrow(/urlPattern/);
    expect(refusal([camera({}, [jpeg("https://camerai1.iticfoundation.org/jpeg2.php?camid=10.8.0.1:80")])])).toThrow(/outside the source's img-src hosts/);
    expect(refusal([camera({}, [{ kind: "mjpeg", url: "https://telemetry.dwr.go.th/x", label: null, captureTime: "none", probe: { ...NOT_PROBED } }])])).toThrow(
      /outside the source's img-src hosts/,
    );
    expect(refusal([camera({}, [hls("not a url")])])).toThrow(/unparsable/);
  });

  it("refuses a camera of another source, hand-placed coordinates without a coordinatesDoc, and a probe claim without a probe", () => {
    expect(refusal([camera({ sourceId: "dwr-cctv" }, [])])).toThrow(/another source/);
    expect(refusal([camera({ coordSource: "hand-placed" }, [])])).toThrow(/coordinatesDoc/);
    expect(refusal([camera({}, [hls(HLS, { result: "ok", cors: true })])], META)).toThrow(/nothing was probed/);
    // probedAt ตั้งแล้ว → ok ผ่านได้
    expect(refusal([camera({}, [hls(HLS, { result: "ok", cors: true })])], PROBED_META)).not.toThrow();
    expect(refusal([camera({}, [hls(HLS, { result: "great" as never, cors: true })])], PROBED_META)).toThrow(/unknown probe result/);
  });

  it("accepts DWR streams without a url and keeps unreachable streams (dimmed later, never dropped)", () => {
    const cams = [
      camera({ id: "d1", sourceId: "dwr-cctv", owner: null, code: "TC000001" }, [
        { kind: "dwr-snapshot", label: null, captureTime: "path", probe: { result: "ok", cors: true } },
        { kind: "dwr-mjpeg", stationCode: "TC000001", label: null, captureTime: "none", probe: { result: "unreachable", cors: null } },
      ]),
    ];
    const { catalogue } = assembleCatalogue("dwr-cctv", cams, PROBED_META);
    expect(() => validateCatalogue(catalogue)).not.toThrow();
    const json = serializeCatalogue(catalogue);
    expect(json).toContain('"unreachable"');
    expect(CREDENTIAL_PATTERN.test(json)).toBe(false);
  });
});

describe("CLI helpers", () => {
  it("parseBuildArgs: --no-probe and --vantage in both spellings", () => {
    expect(parseBuildArgs([])).toEqual({ probe: true, vantage: null });
    expect(parseBuildArgs(["--no-probe"])).toEqual({ probe: false, vantage: null });
    expect(parseBuildArgs(["--vantage", "home-lan"])).toEqual({ probe: true, vantage: "home-lan" });
    expect(parseBuildArgs(["--vantage=office", "--no-probe"])).toEqual({ probe: false, vantage: "office" });
    expect(parseBuildArgs(["--vantage", ""])).toEqual({ probe: true, vantage: null });
  });

  it("probeVantageLabel is the label only — never the machine's hostname, even when one is around", () => {
    expect(probeVantageLabel("fortinet-lan")).toBe("fortinet-lan");
    expect(probeVantageLabel(null)).toBe("unlabelled");
    expect(probeVantageLabel("  ")).toBe("unlabelled");
    // ค่านี้ลงไฟล์สาธารณะ: hostname ของเครื่อง build ต้องไม่หลุดเข้ามาไม่ว่าสภาพแวดล้อมเป็นอย่างไร
    const host = os.hostname();
    for (const v of [probeVantageLabel("lab"), probeVantageLabel(null)]) {
      // ไม่มี suffix ของชื่อเครื่อง (mDNS/LAN) และไม่มี hostname ของเครื่องที่รันเทสต์
      expect(v).not.toMatch(/\.(local|lan|home)\b/);
      if (host) expect(v).not.toContain(host);
    }
  });
});
