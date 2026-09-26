import { describe, expect, it } from "vitest";
import { buildCameras, LIST_URL, parseListItem, parseListPage, parseStationPoint, SOURCE_ID } from "./build-dwr-cctv.js";
import { assembleCatalogue, NOT_PROBED, serializeCatalogue } from "./cameraCatalogue.js";
import { PROVINCES } from "./cameraCatalogue.testUtils.js";
import { assignProvince, CREDENTIAL_PATTERN } from "./provincePolygons.js";

/**
 * fixture ปลอมทั้งหมด — รูปเดียวกับ payload จริงของ DWR (ตรวจ 2026-09-26) รวมถึงฟิลด์
 * ลิงก์กล้องที่ฝังชื่อผู้ใช้/รหัสผ่าน ค่าในนี้แต่งขึ้น (`user:pass@x.dyndns.info`) ไม่ใช่ของจริง
 */
const FAKE_SNAPSHOT = "http://user:pass@x.dyndns.info:8080/cgi-bin/snapshot.cgi";
const FAKE_VIDEO = "rtsp://admin:secret@cam1.dyndns.org:554/stream";

const listPage = {
  value: {
    totalCount: 3,
    results: [
      {
        entity: {
          id: "cam-a",
          stationCode: "TC000001",
          subBasinId: "sb",
          stnNameTh: " สถานีทดสอบ ก ",
          stnNameEn: "Test A",
          subDistrictId: "sd",
          cctvSnapshotLink: FAKE_SNAPSHOT,
          cctvVideoLink: FAKE_VIDEO,
          cctvOnline: true,
          teamg_group_code: "g",
          projectName: "p",
          labelEn: "l",
          label: "l",
        },
        provinceNameTh: "ทดสอบ",
        districtNameTh: "เมือง",
        subDistrictNameTh: "ตำบล",
      },
      {
        entity: {
          id: "cam-b",
          stationCode: "TC000002",
          stnNameTh: "สถานีทดสอบ ข",
          stnNameEn: null,
          cctvSnapshotLink: FAKE_SNAPSHOT,
          cctvVideoLink: FAKE_VIDEO,
        },
        districtNameTh: null,
      },
      // ผิดรูป (ไม่มี stationCode) — ต้องถูกนับว่าผิดรูป ไม่ใช่ทำให้ทั้งหน้าพัง
      { entity: { id: "cam-c", cctvSnapshotLink: FAKE_SNAPSHOT } },
    ],
  },
};

const stationPayload = (lat: number, lon: number) => ({
  value: {
    fullCon: {
      entity: {
        id: "st",
        point: { lat, lon },
        cctvSnapshotLink: FAKE_SNAPSHOT,
        cctvLatestSnapshotPath: "/TC000001/2026/9/26/7_17.jpg",
        cctvVideoLink: FAKE_VIDEO,
      },
    },
  },
});

const META = { builtAt: "2026-09-26T00:00:00.000Z", sourceUrl: LIST_URL, probedAt: null, probeVantage: null };

describe("build-dwr-cctv projection", () => {
  const page = parseListPage(listPage);
  const items = page.results.map(parseListItem);

  it("drops unknown keys (the credential links) at the schema", () => {
    expect(items[0]).not.toBeNull();
    expect(JSON.stringify(items[0])).not.toContain("dyndns");
    expect(Object.keys(items[0]!.entity).sort()).toEqual(["id", "stationCode", "stnNameEn", "stnNameTh"]);
    expect(items[2]).toBeNull();
  });

  it("projects two url-less streams per camera, starting not-probed, and never lets a credential link reach the file", () => {
    const points = new Map([
      ["TC000001", parseStationPoint(stationPayload(13.5, 100.5))],
      ["TC000002", parseStationPoint(stationPayload(15, 102))],
    ]);
    const { cameras, noCoords, noProvince } = buildCameras(items.filter((i) => i !== null), points, PROVINCES);
    expect(noCoords).toBe(0);
    expect(noProvince).toBe(1);
    expect(cameras).toEqual([
      {
        id: "cam-a",
        sourceId: SOURCE_ID,
        nameTh: "สถานีทดสอบ ก",
        nameEn: "Test A",
        lat: 13.5,
        lon: 100.5,
        coordSource: "upstream",
        provinceCode: "99",
        owner: null,
        code: "TC000001",
        placeTh: "เมือง",
        streams: [
          { kind: "dwr-snapshot", label: null, captureTime: "path", probe: NOT_PROBED },
          { kind: "dwr-mjpeg", stationCode: "TC000001", label: null, captureTime: "none", probe: NOT_PROBED },
        ],
      },
      {
        id: "cam-b",
        sourceId: SOURCE_ID,
        nameTh: "สถานีทดสอบ ข",
        nameEn: null,
        lat: 15,
        lon: 102,
        coordSource: "upstream",
        provinceCode: null,
        owner: null,
        code: "TC000002",
        placeTh: null,
        streams: [
          { kind: "dwr-snapshot", label: null, captureTime: "path", probe: NOT_PROBED },
          { kind: "dwr-mjpeg", stationCode: "TC000002", label: null, captureTime: "none", probe: NOT_PROBED },
        ],
      },
    ]);
    const { catalogue } = assembleCatalogue(SOURCE_ID, cameras, META);
    const json = serializeCatalogue(catalogue);
    for (const needle of ["user:pass", "admin:secret", "dyndns", "@", "cctvSnapshotLink", "cctvVideoLink", "snapshot.cgi", "\"url\""]) {
      expect(json).not.toContain(needle);
    }
    expect(json).toContain('"sourceId": "dwr-cctv"');
  });

  it("drops cameras whose station has no usable coordinates", () => {
    const points = new Map<string, { lat: number; lon: number } | null>([
      ["TC000001", parseStationPoint({ value: { fullCon: { entity: { point: null } } } })],
      ["TC000002", parseStationPoint(stationPayload(0, 0))],
    ]);
    const { cameras, noCoords } = buildCameras(items.filter((i) => i !== null), points, PROVINCES);
    expect(cameras).toEqual([]);
    expect(noCoords).toBe(2);
  });

  it("the shared writer refuses anything matching the credential pattern, without quoting it", () => {
    const { catalogue } = assembleCatalogue(
      SOURCE_ID,
      [
        {
          id: FAKE_SNAPSHOT,
          sourceId: SOURCE_ID,
          nameTh: null,
          nameEn: null,
          lat: 0,
          lon: 0,
          coordSource: "upstream",
          provinceCode: null,
          owner: null,
          code: "a",
          placeTh: null,
          streams: [],
        },
      ],
      META,
    );
    expect(() => serializeCatalogue(catalogue)).toThrow(/credential pattern/);
    expect(() => serializeCatalogue(catalogue)).not.toThrow(/user|dyndns/);
    expect(CREDENTIAL_PATTERN.test("http://a:b@host")).toBe(true);
    expect(CREDENTIAL_PATTERN.test(LIST_URL)).toBe(false);
  });
});

describe("assignProvince", () => {
  it("assigns by point-in-polygon, null outside every boundary", () => {
    expect(assignProvince(13.5, 100.5, PROVINCES)).toBe("99");
    expect(assignProvince(12.9, 100.5, PROVINCES)).toBeNull();
  });
});
