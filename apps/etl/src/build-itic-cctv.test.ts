import { describe, expect, it } from "vitest";
import {
  buildCatalogue,
  classifyHlsUrl,
  classifyJpegUrl,
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
/** รูปเดียวกับกลุ่มภาพนิ่งที่ตอบภาพจริงเมื่อวัด 2026-09-26 (ค่าแต่งขึ้น) */
const BKK_JPEG = "https://camera1.iticfoundation.org/jpeg2.php?camid=10.8.0.99:8001";
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

describe("classifyJpegUrl", () => {
  it("keeps only the jpeg2.php camid 10.8.0.x:port group that returned a real frame when probed", () => {
    expect(classifyJpegUrl(BKK_JPEG)).toBe("ok");
    expect(classifyJpegUrl(` ${BKK_JPEG} `)).toBe("ok");
    expect(classifyJpegUrl(null)).toBe("empty");
    expect(classifyJpegUrl("")).toBe("empty");
    // กลุ่มที่วัดแล้วไม่ได้ภาพจากกล้อง
    expect(classifyJpegUrl("https://camera1.iticfoundation.org/jpeg2.php?camid=X.X.X.X:YYYY")).toBe("placeholder");
    expect(classifyJpegUrl("https://camera1.iticfoundation.org/jpeg2.php?camid=CAMPK0001")).toBe("other");
    expect(classifyJpegUrl("https://camera1.iticfoundation.org/jpeg2.php?camid=61.91.182.114:1111")).toBe("other");
    expect(classifyJpegUrl("https://camera1.iticfoundation.org/jpeg.cgi?camid=PER-3-008_2")).toBe("other");
    // รูปใกล้เคียงที่ต้องไม่ผ่าน
    expect(classifyJpegUrl("http://camera1.iticfoundation.org/jpeg2.php?camid=10.8.0.1:80")).toBe("other");
    expect(classifyJpegUrl("https://user:pw@camera1.iticfoundation.org/jpeg2.php?camid=10.8.0.1:80")).toBe("other");
    expect(classifyJpegUrl("https://camera1.iticfoundation.org.evil.test/jpeg2.php?camid=10.8.0.1:80")).toBe("other");
    expect(classifyJpegUrl(`${BKK_JPEG}&x=1`)).toBe("other");
    expect(classifyJpegUrl("https://camera1.iticfoundation.org/mjpeg.php?camid=10.8.0.1:80")).toBe("other");
  });

  it("does not false-positive the credential pattern on the kept image link", () => {
    expect(CREDENTIAL_PATTERN.test(BKK_JPEG)).toBe(false);
  });
});

describe("build-itic-cctv projection", () => {
  it("rejects a feed that is not an array", () => {
    expect(() => parseFeed({ cameras: [] })).toThrow(/array/);
  });

  it("drops unknown keys at the schema", () => {
    const item = parseFeedItem(entry({}));
    expect(item).not.toBeNull();
    expect(Object.keys(item!).sort()).toEqual([
      "camid",
      "hls_url",
      "imgurl",
      "latitude",
      "longitude",
      "organization",
      "title",
    ]);
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
        // ไม่มี HLS ใช้ได้ → ภาพนิ่งเฉพาะกลุ่มที่วัดแล้ว
        entry({ camid: "J", hls_url: "https://camera1.iticfoundation.org/hls/10.8.0.99_8001.m3u8", imgurl: BKK_JPEG }),
        entry({ camid: "K", hls_url: "", imgurl: "https://camera1.iticfoundation.org/jpeg2.php?camid=X.X.X.X:YYYY" }),
        entry({ camid: "L", hls_url: "", imgurl: "https://camera1.iticfoundation.org/jpeg2.php?camid=CAMPK0001" }),
        entry({ camid: "M", hls_url: "", imgurl: null }),
        { title: "malformed" },
      ],
      PROVINCES,
      "2026-09-26T00:00:00.000Z",
    );
    expect(stats).toEqual({
      total: 13,
      malformed: 1,
      hls: 2,
      jpeg: 1,
      empty: 4,
      otherHost: 2,
      suspended: 1,
      credential: 0,
      // C/D/E มี imgurl `jpeg.cgi` ของ fixture → กลุ่มอื่น
      jpegEmpty: 1,
      jpegPlaceholder: 1,
      jpegOther: 4,
      jpegCredential: 0,
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
        stream: { kind: "hls", url: "https://camerai1.iticfoundation.org/hls/kk08.m3u8" },
        provinceCode: null,
      },
      {
        id: "B",
        name: "(จ.ทดสอบ) 4 - อ.เมือง มุ่งหน้า จ.ทดสอบ",
        lat: 13.5,
        lon: 100.5,
        organization: "กรมทางหลวง",
        stream: { kind: "hls", url: DOH_HLS },
        provinceCode: "99",
      },
      {
        id: "J",
        name: "(จ.ทดสอบ) 4 - อ.เมือง มุ่งหน้า จ.ทดสอบ",
        lat: 13.5,
        lon: 100.5,
        organization: "กรมทางหลวง",
        stream: { kind: "jpeg", url: BKK_JPEG },
        provinceCode: "99",
      },
    ]);
    const json = serializeCatalogue(catalogue);
    for (const needle of ["mjpeg", "jpeg.cgi", "/hls/10.8.0", "X.X.X.X", "CAMPK", "sponsertext", "lastupdate", "banner"]) {
      expect(json).not.toContain(needle);
    }
    // ลิงก์บน camera1 ที่หลุดเข้าไฟล์ได้มีรูปเดียว — ภาพนิ่งของกลุ่มที่วัดแล้ว
    const camera1Links = json.match(/https:\/\/camera1\.[^"]*/g) ?? [];
    expect(camera1Links).toEqual([BKK_JPEG]);
  });

  it("does not false-positive on the DOH playlist path (it embeds the upstream IP:port, no userinfo)", () => {
    expect(CREDENTIAL_PATTERN.test(DOH_HLS)).toBe(false);
  });

  it("refuses to serialize anything matching the credential pattern", () => {
    const leaked = {
      builtAt: "x",
      sourceUrl: "x",
      cameras: [
        {
          id: "x",
          name: "a",
          lat: 0,
          lon: 0,
          organization: null,
          stream: { kind: "hls" as const, url: "https://user:pass@camerai1.iticfoundation.org/x.m3u8" },
          provinceCode: null,
        },
      ],
    };
    expect(() => serializeCatalogue(leaked)).toThrow(/credential pattern/);
    expect(() => serializeCatalogue(leaked)).not.toThrow(/user|pass@/);
  });
});
