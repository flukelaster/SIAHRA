import { describe, expect, it } from "vitest";
import {
  assignProvince,
  buildCatalogue,
  CREDENTIAL_PATTERN,
  parseListItem,
  parseListPage,
  parseStationPoint,
  serializeCatalogue,
  type ProvincePolygon,
} from "./build-cctv.js";

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

/** จังหวัดสี่เหลี่ยมสมมุติ 99 ครอบ lon 100..101, lat 13..14 */
const PROVINCES: ProvincePolygon[] = [
  {
    code: "99",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [100, 13],
          [101, 13],
          [101, 14],
          [100, 14],
          [100, 13],
        ],
      ],
    },
  },
];

describe("build-cctv projection", () => {
  const page = parseListPage(listPage);
  const items = page.results.map(parseListItem);

  it("drops unknown keys (the credential links) at the schema", () => {
    expect(items[0]).not.toBeNull();
    expect(JSON.stringify(items[0])).not.toContain("dyndns");
    expect(Object.keys(items[0]!.entity).sort()).toEqual(["id", "stationCode", "stnNameEn", "stnNameTh"]);
    expect(items[2]).toBeNull();
  });

  it("never lets a credential link reach the serialized catalogue", () => {
    const points = new Map([
      ["TC000001", parseStationPoint(stationPayload(13.5, 100.5))],
      ["TC000002", parseStationPoint(stationPayload(15, 102))],
    ]);
    const { catalogue, noCoords, noProvince } = buildCatalogue(
      items.filter((i) => i !== null),
      points,
      PROVINCES,
      "2026-09-26T00:00:00.000Z",
    );
    const json = serializeCatalogue(catalogue);
    for (const needle of ["user:pass", "admin:secret", "dyndns", "@", "cctvSnapshotLink", "cctvVideoLink", "snapshot.cgi"]) {
      expect(json).not.toContain(needle);
    }
    expect(noCoords).toBe(0);
    expect(noProvince).toBe(1);
    expect(catalogue.cameras).toEqual([
      {
        id: "cam-a",
        stationCode: "TC000001",
        nameTh: "สถานีทดสอบ ก",
        nameEn: "Test A",
        lat: 13.5,
        lon: 100.5,
        provinceCode: "99",
        amphoeTh: "เมือง",
      },
      {
        id: "cam-b",
        stationCode: "TC000002",
        nameTh: "สถานีทดสอบ ข",
        nameEn: null,
        lat: 15,
        lon: 102,
        provinceCode: null,
        amphoeTh: null,
      },
    ]);
  });

  it("drops cameras whose station has no usable coordinates", () => {
    const points = new Map<string, { lat: number; lon: number } | null>([
      ["TC000001", parseStationPoint({ value: { fullCon: { entity: { point: null } } } })],
      ["TC000002", parseStationPoint(stationPayload(0, 0))],
    ]);
    const { catalogue, noCoords } = buildCatalogue(items.filter((i) => i !== null), points, PROVINCES, "x");
    expect(catalogue.cameras).toEqual([]);
    expect(noCoords).toBe(2);
  });

  it("refuses to serialize anything matching the credential pattern", () => {
    const leaked = {
      builtAt: "x",
      sourceUrl: "x",
      cameras: [
        { id: FAKE_SNAPSHOT, stationCode: "a", nameTh: null, nameEn: null, lat: 0, lon: 0, provinceCode: null, amphoeTh: null },
      ],
    };
    expect(() => serializeCatalogue(leaked)).toThrow(/credential pattern/);
    // ข้อความผิดพลาดต้องไม่อ้างค่าที่เจอ
    expect(() => serializeCatalogue(leaked)).not.toThrow(/user|dyndns/);
    expect(CREDENTIAL_PATTERN.test("http://a:b@host")).toBe(true);
    expect(CREDENTIAL_PATTERN.test("https://telemetry.dwr.go.th/api/public/reportCctv/listPaginate")).toBe(false);
  });
});

describe("assignProvince", () => {
  it("assigns by point-in-polygon, null outside every boundary", () => {
    expect(assignProvince(13.5, 100.5, PROVINCES)).toBe("99");
    expect(assignProvince(12.9, 100.5, PROVINCES)).toBeNull();
  });
});
