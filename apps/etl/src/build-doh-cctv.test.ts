import { describe, expect, it } from "vitest";
import type { Camera } from "@siahra/shared-types";
import {
  buildCameras,
  buildIticIndex,
  classifyStreamUrl,
  codeFromIticCamera,
  dedupeAgainstItic,
  DEDUPE_RADIUS_M,
  distanceM,
  extractField,
  HOME_URL,
  labelFor,
  normaliseCode,
  parseCameraInfo,
  parseSiteIds,
  parseSiteInfo,
  placeFromName,
  SOURCE_ID,
  streamsByOrigin,
} from "./build-doh-cctv.js";
import { assembleCatalogue, NOT_PROBED, serializeCatalogue } from "./cameraCatalogue.js";
import { PROVINCES } from "./cameraCatalogue.testUtils.js";
import { CREDENTIAL_PATTERN } from "./provincePolygons.js";

/**
 * fixture แต่งขึ้นทั้งหมด — รูปเดียวกับคำตอบจริงของ `home.aspx` PageMethods (ตรวจ 2026-09-27):
 * `GetSiteInfo` → `{d: [lat, lon, code, html-ตาราง]}`, `GetCameraInfo` → `{d: html สองแท็บ}`
 */
const S1 = "https://streaming1.highwaytraffic.go.th";
const S2 = "https://streaming2.highwaytraffic.go.th";

const siteInfoHtml = (name: string, detail: string) =>
  `<table class='igoogle igoogle-night' rules='all'><tr><td nowrap><b>ชื่อจุดติดตั้ง</b></td><td nowrap>${name}</td></tr>` +
  `<tr><td nowrap><b>รายละเอียด</b></td><td>${detail}</td></tr></table>`;

const siteInfo = (lat: string, lon: string, code: string, name: string, detail = "ทางหลวงแผ่นดินหมายเลข 1 ระหว่าง กม.92-93") => ({
  d: [lat, lon, code, siteInfoHtml(name, detail)],
});

/** แท็บหนึ่งของ `GetCameraInfo` — ตามหน้าจริง: `site_code` แล้วตามด้วยข้อความทิศทาง `ctl01_TxtDirect{In,Out}` */
const tab = (n: 1 | 2, url: string, direction: string) =>
  `<div id="tabs-${n}"><div id="ctl01_playerElement0${n}" wowza_auto_refresh="Y" site_code="${url}" site_code_text="X"></div>` +
  `<div><img src="/DOHWeb/images/uc-direction/arrow24-green-9.png" id="ctl01_ImgDirection${n === 1 ? "In" : "Out"}" />` +
  `<span id="ctl01_TxtDirect${n === 1 ? "In" : "Out"}">${direction}</span></div></div>`;

const cameraInfo = (tabs: string[]) => ({
  d:
    `<div id="tabs"><ul><li><span id="ctl01_tab1Label">ขาเข้า</span></li><li><span id="ctl01_tab2Label">ขาออก</span></li></ul>` +
    tabs.join("") +
    `</div><div id="ctl01_siteType">กล้องสำรวจปริมาณจราจรจากกรมทางหลวง</div>`,
});

/** Phase 3: ขาเข้า/ขาออก เป็นคนละ playlist (`_IN`/`_OUT`) */
const PHASE3 = cameraInfo([tab(1, `${S1}/Phase3/PER_3_003_IN.stream/playlist.m3u8`, "ทิศทางมุ่งหน้ากรุงเทพ"), tab(2, `${S1}/Phase3/PER_3_003_OUT.stream/playlist.m3u8`, "ทิศทางออกจากกรุงเทพ")]);
/** Phase 10: สองแท็บชี้ playlist เดียวกัน ไม่มี suffix — สตรีมเดียว (103/137 จุดเมื่อ 2026-09-27) */
const PHASE10 = cameraInfo([tab(1, `${S1}/Phase10/PER_10_014.stream/playlist.m3u8`, "ทิศทางมุ่งหน้าเข้า อ.ตากฟ้า"), tab(2, `${S1}/Phase10/PER_10_014.stream/playlist.m3u8`, "ทิศทางมุ่งหน้าเข้า อ.ท่าตะโก")]);
/** กลุ่ม IP ดิบ: http บน IP — ถูกปฏิเสธเป็น `raw-ip` ไม่ใช่ `http` */
const RAW_IP = cameraInfo([tab(1, "http://183.89.205.98:9980/Phase9/PER_9_001_IN.stream/playlist.m3u8", "ขาเข้า"), tab(2, `${S2}/Phase9/PER_9_001_OUT.stream/playlist.m3u8`, "ขาออก")]);

const iticCamera = (over: Partial<Camera>, url?: string): Camera => ({
  id: "DOH-X",
  sourceId: "itic-cctv",
  nameTh: "กล้อง iTIC",
  nameEn: null,
  lat: 13.5,
  lon: 100.5,
  coordSource: "upstream",
  provinceCode: "99",
  owner: "กรมทางหลวง",
  code: null,
  placeTh: null,
  streams: url ? [{ kind: "hls", url, label: null, captureTime: "none", probe: { ...NOT_PROBED } }] : [],
  ...over,
});

describe("parse: home.aspx and the two PageMethods", () => {
  it("parseSiteIds reads MoveLocation(id) in page order without repeats", () => {
    const html = `<a onclick="MoveLocation(2753);">x</a> <a onclick="MoveLocation(2767);">y</a> <a onclick="MoveLocation(2753);">dup</a> MoveLocation(abc)`;
    expect(parseSiteIds(html)).toEqual([2753, 2767]);
    expect(parseSiteIds("<html></html>")).toEqual([]);
  });

  it("parseSiteInfo takes lat/lon/code from d[] and the name/description from the html — the html itself is not retained", () => {
    const info = parseSiteInfo(siteInfo("14.3914", "100.8880", "PER-3-003", "1 - อ.หนองแค จ.สระบุรี", "ทางหลวงแผ่นดินหมายเลข 1 ระหว่าง กม.92-93  ต.ห้วยขมิ้น อ.หนองแค จ.สระบุรี "));
    expect(info).toEqual({
      lat: 14.3914,
      lon: 100.888,
      code: "PER-3-003",
      name: "1 - อ.หนองแค จ.สระบุรี",
      description: "ทางหลวงแผ่นดินหมายเลข 1 ระหว่าง กม.92-93 ต.ห้วยขมิ้น อ.หนองแค จ.สระบุรี",
    });
    expect(JSON.stringify(info)).not.toContain("<");
    // ชื่อหลายบรรทัด/entity ยังอ่านได้; ป้ายที่ไม่มี = null
    expect(extractField("<b>ชื่อจุดติดตั้ง</b></td>\n<td nowrap>ถ.กาญจนาภิเษก &amp; บางแค</td>", "ชื่อจุดติดตั้ง")).toBe("ถ.กาญจนาภิเษก & บางแค");
    expect(extractField("<b>อื่น</b><td>x</td>", "ชื่อจุดติดตั้ง")).toBeNull();
    expect(parseSiteInfo(siteInfo("14.39", "100.88", "PER-3-003", ""))?.name).toBeNull();
  });

  it("parseSiteInfo refuses a malformed answer, unusable coordinates and an empty code", () => {
    expect(parseSiteInfo(null)).toBeNull();
    expect(parseSiteInfo({ d: "not an array" })).toBeNull();
    expect(parseSiteInfo({ d: ["14.39", "100.88", "PER-3-003"] })).toBeNull();
    expect(parseSiteInfo(siteInfo("", "100.88", "PER-3-003", "x"))).toBeNull();
    expect(parseSiteInfo(siteInfo("abc", "100.88", "PER-3-003", "x"))).toBeNull();
    expect(parseSiteInfo(siteInfo("0", "0", "PER-3-003", "x"))).toBeNull();
    expect(parseSiteInfo(siteInfo("95", "100.88", "PER-3-003", "x"))).toBeNull();
    expect(parseSiteInfo(siteInfo("14.39", "100.88", "  ", "x"))).toBeNull();
  });

  it("classifyStreamUrl: only https playlists on the two registered hosts; raw IP is its own verdict, before the scheme", () => {
    expect(classifyStreamUrl(`${S1}/Phase3/PER_3_003_IN.stream/playlist.m3u8`)).toBe("ok");
    expect(classifyStreamUrl(`${S2}/Phase11/PER_11_006.stream/playlist.m3u8`)).toBe("ok");
    expect(classifyStreamUrl("http://183.89.205.98:9980/Phase9/x.stream/playlist.m3u8")).toBe("raw-ip");
    expect(classifyStreamUrl("https://183.89.205.98:9980/Phase9/x.stream/playlist.m3u8")).toBe("raw-ip");
    expect(classifyStreamUrl("http://streaming1.highwaytraffic.go.th/x/playlist.m3u8")).toBe("http");
    expect(classifyStreamUrl("https://streaming3.highwaytraffic.go.th/x/playlist.m3u8")).toBe("other-host");
    expect(classifyStreamUrl("https://streaming1.highwaytraffic.go.th.evil.test/x/playlist.m3u8")).toBe("other-host");
    expect(classifyStreamUrl("https://camerai1.iticfoundation.org/x/playlist.m3u8")).toBe("other-host");
    expect(classifyStreamUrl("https://user:pw@streaming1.highwaytraffic.go.th/x/playlist.m3u8")).toBe("credential");
    expect(classifyStreamUrl(`${S1}/Phase3/PER_3_003.stream/chunklist.ts`)).toBe("not-playlist");
    expect(classifyStreamUrl("not a url")).toBe("other-host");
  });

  it("parseCameraInfo: IN/OUT playlists become two labelled streams; the raw-IP tab is refused and counted", () => {
    expect(parseCameraInfo(PHASE3)).toEqual({
      streams: [
        { url: `${S1}/Phase3/PER_3_003_IN.stream/playlist.m3u8`, label: "ขาเข้า — ทิศทางมุ่งหน้ากรุงเทพ" },
        { url: `${S1}/Phase3/PER_3_003_OUT.stream/playlist.m3u8`, label: "ขาออก — ทิศทางออกจากกรุงเทพ" },
      ],
      refused: { "raw-ip": 0, http: 0, "other-host": 0, credential: 0, "not-playlist": 0 },
      sameUrl: 0,
    });
    expect(parseCameraInfo(RAW_IP)).toEqual({
      streams: [{ url: `${S2}/Phase9/PER_9_001_OUT.stream/playlist.m3u8`, label: "ขาออก — ขาออก" }],
      refused: { "raw-ip": 1, http: 0, "other-host": 0, credential: 0, "not-playlist": 0 },
      sameUrl: 0,
    });
    expect(parseCameraInfo({ d: 42 })).toBeNull();
    expect(parseCameraInfo({ d: "<div>no player</div>" })).toEqual({ streams: [], refused: { "raw-ip": 0, http: 0, "other-host": 0, credential: 0, "not-playlist": 0 }, sameUrl: 0 });
  });

  it("parseCameraInfo: two tabs on the same playlist collapse to one stream whose label joins both directions", () => {
    expect(parseCameraInfo(PHASE10)).toEqual({
      streams: [{ url: `${S1}/Phase10/PER_10_014.stream/playlist.m3u8`, label: "ทิศทางมุ่งหน้าเข้า อ.ตากฟ้า / ทิศทางมุ่งหน้าเข้า อ.ท่าตะโก" }],
      refused: { "raw-ip": 0, http: 0, "other-host": 0, credential: 0, "not-playlist": 0 },
      sameUrl: 1,
    });
    // ทิศทางเหมือนกันทั้งสองแท็บ → ป้ายเดียว ไม่ซ้ำ
    const same = parseCameraInfo(cameraInfo([tab(1, `${S1}/Phase10/X.stream/playlist.m3u8`, "มุ่งหน้าเหนือ"), tab(2, `${S1}/Phase10/X.stream/playlist.m3u8`, "มุ่งหน้าเหนือ")]));
    expect(same?.streams).toEqual([{ url: `${S1}/Phase10/X.stream/playlist.m3u8`, label: "มุ่งหน้าเหนือ" }]);
    expect(same?.sameUrl).toBe(1);
  });

  it("labelFor: side from the _IN/_OUT suffix, direction text from the tab, either alone when the other is missing", () => {
    expect(labelFor(`<span id="ctl01_TxtDirectIn">มุ่งหน้ากรุงเทพ</span>`, `${S1}/P/PER_3_003_IN.stream/playlist.m3u8`)).toBe("ขาเข้า — มุ่งหน้ากรุงเทพ");
    expect(labelFor(`<span id="ctl01_TxtDirectOut"></span>`, `${S1}/P/PER_3_003_OUT.stream/playlist.m3u8`)).toBe("ขาออก");
    expect(labelFor(`<span id="ctl01_TxtDirectIn">มุ่งหน้าเหนือ</span>`, `${S1}/P/PER_10_014.stream/playlist.m3u8`)).toBe("มุ่งหน้าเหนือ");
    expect(labelFor("", `${S1}/P/PER_10_014.stream/playlist.m3u8`)).toBeNull();
  });

  it("placeFromName keeps the อ./จ. part of a site name and guesses nothing otherwise", () => {
    expect(placeFromName("1 - อ.หนองแค จ.สระบุรี")).toBe("อ.หนองแค จ.สระบุรี");
    expect(placeFromName("ถ.กาญจนาภิเษก เขตบางแค")).toBe("เขตบางแค");
    expect(placeFromName("ทางหลวง 9 จ.นนทบุรี")).toBe("จ.นนทบุรี");
    expect(placeFromName("ถ.เพชรเกษม อ้อมใหญ่")).toBeNull();
    expect(placeFromName(null)).toBeNull();
  });
});

describe("dedupe against the built iTIC catalogue", () => {
  it("normaliseCode: separators and leading zeros do not count, the direction suffix does not count", () => {
    expect(normaliseCode("PER-3-003")).toBe("PER-3-3");
    expect(normaliseCode("PER_3_003")).toBe("PER-3-3");
    expect(normaliseCode("https://camerai1.iticfoundation.org/pass/180.180.242.207:1935/Phase3/PER_3_003_IN.stream/playlist.m3u8")).toBe("PER-3-3");
    expect(normaliseCode("DOH-PER-8-012")).toBe("PER-8-12");
    expect(normaliseCode("kk08")).toBeNull();
    expect(normaliseCode(null)).toBeNull();
  });

  it("codeFromIticCamera prefers the code in the HLS url, then the id", () => {
    expect(codeFromIticCamera(iticCamera({ id: "DOH-X" }, "https://camerai1.iticfoundation.org/pass/1.2.3.4:1935/Phase8/PER_8_012_OUT.stream/playlist.m3u8"))).toBe("PER-8-12");
    expect(codeFromIticCamera(iticCamera({ id: "DOH-PER-8-013" }, "https://camerai1.iticfoundation.org/hls/kk08.m3u8"))).toBe("PER-8-13");
    expect(codeFromIticCamera(iticCamera({ id: "CAM-1" }, "https://camerai1.iticfoundation.org/hls/kk08.m3u8"))).toBeNull();
  });

  it("drops a DOH copy by code, then by ≤ 50 m from an iTIC Department of Highways camera — never a non-DOH iTIC camera", () => {
    const index = buildIticIndex({
      cameras: [
        iticCamera({ id: "DOH-A", lat: 14.3914, lon: 100.888 }, "https://camerai1.iticfoundation.org/pass/1.2.3.4:1935/Phase3/PER_3_003_IN.stream/playlist.m3u8"),
        // กรมทางหลวงใน iTIC ไม่มีรหัสในลิงก์ — จับคู่ได้ด้วยระยะทางเท่านั้น
        iticCamera({ id: "DOH-B", lat: 13.5, lon: 100.5 }, "https://camerai1.iticfoundation.org/hls/doh-b.m3u8"),
        // กล้องเทศบาล (ไม่ใช่กรมทางหลวง) ที่ตำแหน่งเดียวกัน — ไม่ใช่สำเนา
        iticCamera({ id: "M-1", lat: 13.9, lon: 100.9, owner: "iTIC Motion" }, "https://camerai1.iticfoundation.org/hls/kk08.m3u8"),
      ],
    });
    expect([...index.codes]).toEqual(["PER-3-3"]);
    expect(index.dohPoints).toEqual([
      { lat: 14.3914, lon: 100.888 },
      { lat: 13.5, lon: 100.5 },
    ]);
    const doh = (id: string, lat: number, lon: number): Camera => ({ ...iticCamera({ id, sourceId: SOURCE_ID, code: id, owner: null, lat, lon }), streams: [] });
    // ห่าง 30 m จาก DOH-B (ละติจูด 1e-4 องศา ≈ 11 m) → ตัด; 300 m → เก็บ
    const near = doh("PER-9-001", 13.5 + 0.00027, 100.5);
    const far = doh("PER-9-002", 13.5 + 0.0027, 100.5);
    expect(distanceM(near, { lat: 13.5, lon: 100.5 })).toBeLessThan(DEDUPE_RADIUS_M);
    expect(distanceM(far, { lat: 13.5, lon: 100.5 })).toBeGreaterThan(DEDUPE_RADIUS_M);
    const r = dedupeAgainstItic([doh("PER_3_003", 15, 101), near, far, doh("PER-9-003", 13.9, 100.9)], index);
    expect(r.byCode).toBe(1);
    expect(r.byDistance).toBe(1);
    expect(r.kept.map((c) => c.id)).toEqual(["PER-9-002", "PER-9-003"]);
  });
});

describe("build-doh-cctv projection", () => {
  it("projects sites into cameras, starts every stream not-probed, counts every drop reason, and keeps no html", () => {
    const { cameras, stats } = buildCameras(
      [
        { siteId: 1, info: siteInfo("13.5", "100.5", "PER-3-003", "1 - อ.หนองแค จ.สระบุรี"), cameras: PHASE3 },
        { siteId: 2, info: siteInfo("13.6", "100.6", "PER-10-014", "11 - อ.ท่าตะโก จ.นครสวรรค์"), cameras: PHASE10 },
        { siteId: 3, info: siteInfo("13.7", "100.7", "PER-9-001", "x"), cameras: RAW_IP },
        // ทั้งสองแท็บเป็น IP ดิบ → ไม่เหลือสตรีม ไม่ emit
        { siteId: 4, info: siteInfo("13.8", "100.8", "PER-9-002", "x"), cameras: cameraInfo([tab(1, "http://183.89.205.98:9980/a/playlist.m3u8", "a"), tab(2, "http://183.89.205.98:9980/b/playlist.m3u8", "b")]) },
        // รหัสซ้ำกับจุด 1 → เก็บตัวแรก
        { siteId: 5, info: siteInfo("13.9", "100.9", "PER-3-003", "dup"), cameras: PHASE3 },
        // นอกทุกจังหวัดที่มี
        { siteId: 6, info: siteInfo("18.5", "99.0", "PER-1-001", "north"), cameras: PHASE3 },
        { siteId: 7, info: null, cameras: null },
        { siteId: 8, info: { d: ["x"] }, cameras: PHASE3 },
        { siteId: 9, info: siteInfo("13.5", "100.5", "PER-2-002", "x"), cameras: { d: 1 } },
      ],
      PROVINCES,
    );
    expect(stats).toEqual({
      sites: 9,
      fetchFailed: 1,
      malformed: 1,
      malformedCameras: 1,
      // 3+4: PHASE3 ×3 (2+2+2), PHASE10 (2), RAW_IP (2), site 4 (2) = 12
      streamsSeen: 12,
      refused: { "raw-ip": 3, http: 0, "other-host": 0, credential: 0, "not-playlist": 0 },
      sameUrl: 1,
      noStream: 1,
      duplicateCode: 1,
      noProvince: 1,
      cameras: 4,
    });
    expect(cameras.map((c) => [c.id, c.provinceCode, c.streams.length])).toEqual([
      ["PER-3-003", "99", 2],
      ["PER-10-014", "99", 1],
      ["PER-9-001", "99", 1],
      ["PER-1-001", null, 2],
    ]);
    expect(cameras[0]).toEqual({
      id: "PER-3-003",
      sourceId: SOURCE_ID,
      nameTh: "1 - อ.หนองแค จ.สระบุรี",
      nameEn: null,
      lat: 13.5,
      lon: 100.5,
      coordSource: "upstream",
      provinceCode: "99",
      owner: null,
      code: "PER-3-003",
      placeTh: "อ.หนองแค จ.สระบุรี",
      streams: [
        { kind: "hls", url: `${S1}/Phase3/PER_3_003_IN.stream/playlist.m3u8`, label: "ขาเข้า — ทิศทางมุ่งหน้ากรุงเทพ", captureTime: "none", probe: NOT_PROBED },
        { kind: "hls", url: `${S1}/Phase3/PER_3_003_OUT.stream/playlist.m3u8`, label: "ขาออก — ทิศทางออกจากกรุงเทพ", captureTime: "none", probe: NOT_PROBED },
      ],
    });
    expect(streamsByOrigin(cameras)).toEqual({ [S1]: 5, [S2]: 1 });

    const { catalogue } = assembleCatalogue(SOURCE_ID, cameras, { builtAt: "2026-09-27T00:00:00.000Z", sourceUrl: HOME_URL, probedAt: null, probeVantage: null });
    const json = serializeCatalogue(catalogue);
    for (const needle of ["<", "183.89.205.98", "igoogle", "ctl01", "site_code", "ASP.NET"]) expect(json).not.toContain(needle);
    expect(CREDENTIAL_PATTERN.test(json)).toBe(false);
    // ลิงก์ที่หลุดเข้าไฟล์ได้อยู่บนสองโฮสต์ของกรมเท่านั้น
    const hosts = new Set((json.match(/https?:\/\/[^/"]+/g) ?? []).filter((h) => !h.includes("highwaytraffic.go.th/DOHWeb")));
    expect([...hosts].every((h) => h === S1 || h === S2 || h === "https://www.highwaytraffic.go.th")).toBe(true);
  });
});
