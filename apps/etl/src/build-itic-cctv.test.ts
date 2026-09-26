import { describe, expect, it } from "vitest";
import {
  buildCatalogue,
  classifyHlsUrl,
  FEED_URL,
  parseFeed,
  parseFeedItem,
  serializeCatalogue,
} from "./build-itic-cctv.js";
import { CREDENTIAL_PATTERN, type ProvincePolygon } from "./provincePolygons.js";

/**
 * fixture แต่งขึ้นทั้งหมด — รูปเดียวกับ feed จริงของ Longdo (ตรวจ 2026-09-26) รวมฟิลด์ที่
 * ห้ามหลุดเข้าไปในผลลัพธ์ (`link`, `vdourl`, `imgurl`, `imgurl_specific`, `sponsertext`)
 */
const DOH_HLS = "https://camerai1.iticfoundation.org/pass/180.180.242.207:1935/Phase8/PER_8_012.stream/playlist.m3u8";
const entry = (over: Record<string, unknown>) => ({
  title: "(จ.ทดสอบ) 4 - อ.เมือง มุ่งหน้า จ.ทดสอบ",
  link: "https://camera1.iticfoundation.org/mjpeg.php?camid=X",
  camid: "DOH-X",
  lastupdate: "2030-04-17 00:00:00",
  latitude: "13.5",
  longitude: "100.5",
  incity: "N",
  organization: "กรมทางหลวง",
  sponsertext: "สำนักอำนวยความปลอดภัย กรมทางหลวง",
  motion: "Y",
  vdourl: "https://camera1.iticfoundation.org/mjpeg.php?camid=X",
  imgurl: "https://camera1.iticfoundation.org/jpeg.cgi?camid=X",
  imgurl_specific: "https://camera1.iticfoundation.org/mjpeg.cgi?camid=X",
  geocode: "100101",
  overlay_file: "banner.jpg",
  hls_url: DOH_HLS,
  ...over,
});

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

describe("classifyHlsUrl", () => {
  it("keeps only camerai1 playlists that are not the suspended placeholder", () => {
    expect(classifyHlsUrl(DOH_HLS)).toBe("ok");
    expect(classifyHlsUrl("https://camerai1.iticfoundation.org/hls/kk08.m3u8")).toBe("ok");
    expect(classifyHlsUrl(null)).toBe("empty");
    expect(classifyHlsUrl("  ")).toBe("empty");
    expect(classifyHlsUrl("https://camera1.iticfoundation.org/hls/kk08.m3u8")).toBe("other-host");
    expect(classifyHlsUrl("http://180.180.242.207:1935/Phase8/x.stream/playlist.m3u8")).toBe("other-host");
    expect(classifyHlsUrl("https://camerai1.iticfoundation.org/hls/tempsus.m3u8")).toBe("suspended");
    // userinfo ก่อนโฮสต์ทำให้ prefix ไม่ตรงอยู่แล้ว
    expect(classifyHlsUrl("https://user:pw@camerai1.iticfoundation.org/x.m3u8")).toBe("other-host");
    expect(classifyHlsUrl("https://camerai1.iticfoundation.org.evil.test/x.m3u8")).toBe("other-host");
  });
});

describe("build-itic-cctv projection", () => {
  it("rejects a feed that is not an array", () => {
    expect(() => parseFeed({ cameras: [] })).toThrow(/array/);
  });

  it("drops unknown keys at the schema", () => {
    const item = parseFeedItem(entry({}));
    expect(item).not.toBeNull();
    expect(Object.keys(item!).sort()).toEqual(["camid", "hls_url", "latitude", "longitude", "organization", "title"]);
    expect(parseFeedItem({ title: "no camid" })).toBeNull();
  });

  it("projects the allowlist only and counts every drop reason", () => {
    const { catalogue, stats } = buildCatalogue(
      [
        entry({ camid: "B", latitude: "13.5", longitude: "100.5" }),
        entry({ camid: "A", latitude: 15, longitude: 102, organization: "iTIC Motion", hls_url: "https://camerai1.iticfoundation.org/hls/kk08.m3u8" }),
        entry({ camid: "C", hls_url: "" }),
        entry({ camid: "D", hls_url: "https://camera1.iticfoundation.org/hls/x.m3u8" }),
        entry({ camid: "E", hls_url: "https://camerai1.iticfoundation.org/hls/tempsus.m3u8" }),
        entry({ camid: "F", latitude: "", longitude: "" }),
        entry({ camid: "G", latitude: "0", longitude: "0" }),
        entry({ camid: "B" }),
        { title: "malformed" },
      ],
      PROVINCES,
      "2026-09-26T00:00:00.000Z",
    );
    expect(stats).toEqual({
      total: 9,
      malformed: 1,
      empty: 1,
      otherHost: 1,
      suspended: 1,
      credential: 0,
      duplicate: 1,
      noCoords: 2,
      noProvince: 1,
    });
    expect(catalogue.sourceUrl).toBe(FEED_URL);
    expect(catalogue.cameras).toEqual([
      {
        id: "A",
        name: "(จ.ทดสอบ) 4 - อ.เมือง มุ่งหน้า จ.ทดสอบ",
        lat: 15,
        lon: 102,
        organization: "iTIC Motion",
        hlsUrl: "https://camerai1.iticfoundation.org/hls/kk08.m3u8",
        provinceCode: null,
      },
      {
        id: "B",
        name: "(จ.ทดสอบ) 4 - อ.เมือง มุ่งหน้า จ.ทดสอบ",
        lat: 13.5,
        lon: 100.5,
        organization: "กรมทางหลวง",
        hlsUrl: DOH_HLS,
        provinceCode: "99",
      },
    ]);
    const json = serializeCatalogue(catalogue);
    for (const needle of ["camera1.", "mjpeg", "jpeg.cgi", "sponsertext", "lastupdate", "banner"]) {
      expect(json).not.toContain(needle);
    }
  });

  it("does not false-positive on the DOH playlist path (it embeds the upstream IP:port, no userinfo)", () => {
    expect(CREDENTIAL_PATTERN.test(DOH_HLS)).toBe(false);
  });

  it("refuses to serialize anything matching the credential pattern", () => {
    const leaked = {
      builtAt: "x",
      sourceUrl: "x",
      cameras: [
        { id: "x", name: "a", lat: 0, lon: 0, organization: null, hlsUrl: "https://user:pass@camerai1.iticfoundation.org/x.m3u8", provinceCode: null },
      ],
    };
    expect(() => serializeCatalogue(leaked)).toThrow(/credential pattern/);
    expect(() => serializeCatalogue(leaked)).not.toThrow(/user|pass@/);
  });
});
