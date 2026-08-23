/**
 * The one registry of upstream data sources. Everything that names a source —
 * a `HazardLayerDescriptor.sourceIds`, a `SourceStatus.id` in /api/v1/health,
 * an attribution line in the UI — names it with a `SourceId` from here, so the
 * link between "this layer came from X" and "X is healthy/stale/down" is a
 * type error when it breaks, not a naming convention someone has to remember.
 *
 * Adding a source: add the id to `SourceId`, then `SOURCES` (tsc lists every
 * missing field), then a `SourceStatus` in /api/v1/health if `kind` is "live".
 */
export type SourceId =
  | "thaiwater"
  | "earthquakes"
  | "gistda-flood"
  | "tmd-radar"
  | "exposure-illustrative"
  | "alert-engine"
  | "copernicus-dem"
  | "osm"
  | "osm-admin"
  | "worldpop"
  | "worldcover"
  | "esri-world-imagery"
  | "eox-s2cloudless"
  | "dla";

export interface SourceDescriptor {
  id: SourceId;
  /** Short label shown next to the map (Thai). */
  nameTh: string;
  nameEn: string;
  /** The organisation that produces the data. */
  agency: string;
  /** Where a user can go to check the source themselves. */
  homepageUrl: string;
  licenseName: string;
  licenseUrl: string;
  /**
   * The credit line the source's terms require. It is an attribution, NOT a
   * claim of endorsement — these agencies supply data, they neither built nor
   * endorse this project.
   */
  attributionText: string;
  /**
   * live   = polled continuously by the API; must appear in /api/v1/health
   * static = baked into the tiles/manifest by the ETL, no freshness to report
   */
  kind: "live" | "static";
}

export const SOURCES: Record<SourceId, SourceDescriptor> = {
  thaiwater: {
    id: "thaiwater",
    nameTh: "สถานีตรวจวัดน้ำ/ฝน (ThaiWater สสน.)",
    nameEn: "Water & rainfall stations (ThaiWater, HII)",
    agency: "สถาบันสารสนเทศทรัพยากรน้ำ (องค์การมหาชน) — HII",
    homepageUrl: "https://www.thaiwater.net/",
    licenseName: "เงื่อนไขการใช้ข้อมูลของคลังข้อมูลน้ำแห่งชาติ (ต้องอ้างอิงแหล่งที่มา)",
    licenseUrl: "https://www.thaiwater.net/",
    attributionText:
      "ข้อมูลตรวจวัดจากคลังข้อมูลน้ำแห่งชาติ (ThaiWater) สถาบันสารสนเทศทรัพยากรน้ำ (สสน.)",
    kind: "live",
  },
  earthquakes: {
    id: "earthquakes",
    nameTh: "แผ่นดินไหว (USGS / EMSC / TMD)",
    nameEn: "Earthquakes (USGS / EMSC / TMD)",
    agency: "USGS, EMSC (seismicportal.eu) และกรมอุตุนิยมวิทยา (TMD)",
    homepageUrl: "https://earthquake.usgs.gov/",
    licenseName: "USGS: สาธารณสมบัติ · EMSC: CC BY 4.0 · TMD: ตามเงื่อนไข data.tmd.go.th",
    licenseUrl: "https://www.usgs.gov/information-policies-and-instructions/crediting-usgs",
    attributionText:
      "ข้อมูลแผ่นดินไหวจาก USGS, EMSC (seismicportal.eu) และกรมอุตุนิยมวิทยา (TMD) — หน่วยงานเหล่านี้เป็นผู้เผยแพร่ข้อมูล ไม่ได้รับรองหรือมีส่วนร่วมกับโครงการนี้",
    kind: "live",
  },
  "gistda-flood": {
    id: "gistda-flood",
    nameTh: "น้ำท่วมจากภาพดาวเทียม (GISTDA)",
    nameEn: "Satellite flood extent (GISTDA)",
    agency: "สำนักงานพัฒนาเทคโนโลยีอวกาศและภูมิสารสนเทศ (องค์การมหาชน) — GISTDA",
    homepageUrl: "https://flood-innotech.gistda.or.th/",
    licenseName: "GISTDA Open Data",
    licenseUrl: "https://opendata.gistda.or.th/dataset/floodcheck",
    attributionText:
      "พื้นที่น้ำท่วมจากภาพดาวเทียม โดยสำนักงานพัฒนาเทคโนโลยีอวกาศและภูมิสารสนเทศ (GISTDA)",
    kind: "live",
  },
  "tmd-radar": {
    id: "tmd-radar",
    nameTh: "เรดาร์ฝน (กรมอุตุนิยมวิทยา)",
    nameEn: "Weather radar composite (TMD)",
    agency: "กรมอุตุนิยมวิทยา (TMD)",
    // เงื่อนไขการใช้ข้อมูลของ TMD กำหนดให้แสดงเครดิตพร้อมลิงก์กลับไปที่ data.tmd.go.th
    homepageUrl: "https://data.tmd.go.th",
    licenseName: "เงื่อนไขการใช้บริการข้อมูลของกรมอุตุนิยมวิทยา",
    licenseUrl: "https://data.tmd.go.th",
    attributionText:
      "เรดาร์ตรวจอากาศ กรมอุตุนิยมวิทยา (TMD) — ข้อมูลจาก data.tmd.go.th; กรมอุตุนิยมวิทยาไม่ได้รับรองหรือมีส่วนเกี่ยวข้องกับโครงการนี้",
    kind: "live",
  },
  "exposure-illustrative": {
    id: "exposure-illustrative",
    nameTh: "ระดับการเผชิญน้ำ (ภาพประกอบ) — คำนวณเอง",
    nameEn: "Flood exposure (illustrative) — computed here",
    // ไม่ใช่ฟีดของหน่วยงานใด: เป็นผลลัพธ์ที่โปรเจกต์นี้คำนวณเองจากค่าตรวจวัดของ
    // ThaiWater ตามตารางเกณฑ์ที่ประกาศไว้ จึงต้องระบุผู้คำนวณเป็นตัวเอง
    // ห้ามยกเครดิต/ความรับผิดให้ สสน. ในสิ่งที่ สสน. ไม่ได้เผยแพร่
    agency: "SIAHRA (โครงการนี้) — คำนวณจากค่าตรวจวัดของ ThaiWater (สสน.)",
    homepageUrl: "https://siahra-radar.co/methodology/flood-exposure",
    licenseName: "MIT (โค้ดและผลลัพธ์ของโครงการ) — ข้อมูลตั้งต้นเป็นของ ThaiWater",
    licenseUrl: "https://github.com/flukelaster/SIAHRA/blob/main/LICENSE",
    attributionText:
      "ระดับการเผชิญน้ำ (ภาพประกอบ) คำนวณโดย SIAHRA จากค่าตรวจวัดของคลังข้อมูลน้ำแห่งชาติ (ThaiWater) ตามวิธีใน docs/methodology/flood-exposure.md — เป็นการจัดอันดับค่าที่วัดได้แล้ว ไม่ใช่การพยากรณ์",
    kind: "live",
  },
  "alert-engine": {
    id: "alert-engine",
    nameTh: "การประเมินแจ้งเตือนระดับท้องถิ่น (คำนวณเอง)",
    nameEn: "Local-authority alert evaluation (computed here)",
    // ไม่ใช่ฟีดของหน่วยงานใด: ตัวเลขที่ประกอบเป็นการแจ้งเตือนมาจาก ThaiWater
    // ผ่านตารางเกณฑ์ของ exposure-illustrative อยู่แล้ว ชั้นนี้คือกฎเงื่อนไข
    // (station → อปท. + tier + hysteresis) ที่โปรเจกต์นี้ประกาศเองและรันเอง
    agency: "SIAHRA (โครงการนี้) — ประเมินจาก ThaiWater (สสน.) ผ่านตารางเกณฑ์ flood-exposure",
    homepageUrl: "https://siahra-radar.co/methodology/flood-exposure",
    licenseName: "MIT (โค้ดและผลลัพธ์ของโครงการ) — ข้อมูลตั้งต้นเป็นของ ThaiWater",
    licenseUrl: "https://github.com/flukelaster/SIAHRA/blob/main/LICENSE",
    attributionText:
      "การแจ้งเตือนระดับท้องถิ่นประเมินโดย SIAHRA จากค่าตรวจวัดของคลังข้อมูลน้ำแห่งชาติ (ThaiWater) ตามกฎเงื่อนไขที่ผูกกับสถานีจริง — ไม่ใช่การพยากรณ์",
    kind: "live",
  },
  "copernicus-dem": {
    id: "copernicus-dem",
    nameTh: "แบบจำลองความสูงภูมิประเทศ Copernicus GLO-30",
    nameEn: "Copernicus DEM GLO-30",
    agency: "European Space Agency / Copernicus Programme",
    homepageUrl: "https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model",
    licenseName: "Copernicus DEM open licence",
    licenseUrl: "https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model",
    attributionText: "ภูมิประเทศจาก Copernicus DEM GLO-30 © ESA / Copernicus Programme",
    kind: "static",
  },
  osm: {
    id: "osm",
    nameTh: "อาคาร ถนน และแหล่งน้ำ (OpenStreetMap)",
    nameEn: "Buildings, roads and water (OpenStreetMap)",
    agency: "OpenStreetMap contributors",
    homepageUrl: "https://www.openstreetmap.org/copyright",
    licenseName: "ODbL 1.0",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    attributionText: "ข้อมูลอาคาร ถนน และแหล่งน้ำ © ผู้ร่วมสร้าง OpenStreetMap (ODbL)",
    kind: "static",
  },
  "osm-admin": {
    id: "osm-admin",
    nameTh: "ขอบเขตองค์กรปกครองส่วนท้องถิ่น (OpenStreetMap)",
    nameEn: "Local-authority administrative boundaries (OpenStreetMap)",
    // แยก id จาก "osm" (อาคาร/ถนน/แหล่งน้ำ) โดยตั้งใจ — เป็นคนละชุดข้อมูล
    // (admin relation ไม่ใช่ feature ทางกายภาพ) แหล่งที่มาเดียวกันแต่ที่มาของ
    // ความน่าเชื่อถือคนละเรื่อง ให้ /api/v1/health-style tooling แยกแยะได้
    agency: "OpenStreetMap contributors",
    homepageUrl: "https://www.openstreetmap.org/copyright",
    licenseName: "ODbL 1.0",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    attributionText:
      "ขอบเขตองค์กรปกครองส่วนท้องถิ่น © ผู้ร่วมสร้าง OpenStreetMap (ODbL) — ผู้ร่วมสร้าง OSM ไม่ได้รับรองหรือมีส่วนเกี่ยวข้องกับโครงการนี้",
    kind: "static",
  },
  worldpop: {
    id: "worldpop",
    nameTh: "ประชากรเชิงพื้นที่ WorldPop 100 ม. ปรับค่าตาม UN (2020)",
    nameEn: "WorldPop 100 m gridded population, UN-adjusted (2020)",
    agency: "WorldPop, University of Southampton (ทุนสนับสนุนโดย Bill & Melinda Gates Foundation)",
    homepageUrl: "https://hub.worldpop.org/geodata/summary?id=6439",
    licenseName: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attributionText:
      "ประชากรเชิงพื้นที่ WorldPop 2020 (UN-adjusted, 100 ม.) โดย WorldPop, University of Southampton — DOI 10.5258/SOTON/WP00645 (CC BY 4.0)",
    kind: "static",
  },
  worldcover: {
    id: "worldcover",
    nameTh: "สิ่งปกคลุมดิน ESA WorldCover 10 ม. (2021)",
    nameEn: "ESA WorldCover 10 m land cover (2021)",
    agency: "ESA WorldCover consortium",
    homepageUrl: "https://esa-worldcover.org/",
    licenseName: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attributionText:
      "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium (CC BY 4.0)",
    kind: "static",
  },
  "esri-world-imagery": {
    id: "esri-world-imagery",
    nameTh: "ภาพดาวเทียม Esri World Imagery",
    nameEn: "Esri World Imagery",
    agency: "Esri และผู้ให้ข้อมูลภาพ",
    homepageUrl: "https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9",
    licenseName: "Esri Terms of Use",
    licenseUrl: "https://www.esri.com/en-us/legal/terms/full-master-agreement",
    attributionText: "Esri, Maxar, Earthstar Geographics, GIS User Community",
    kind: "static",
  },
  "eox-s2cloudless": {
    id: "eox-s2cloudless",
    nameTh: "ภาพดาวเทียม Sentinel-2 cloudless (EOX)",
    nameEn: "Sentinel-2 cloudless (EOX)",
    agency: "EOX IT Services GmbH",
    homepageUrl: "https://s2maps.eu/",
    licenseName: "CC BY-NC-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    attributionText: "Sentinel-2 cloudless by EOX IT Services (CC BY-NC-SA 4.0), Copernicus",
    kind: "static",
  },
  dla: {
    id: "dla",
    nameTh: "ทะเบียนองค์กรปกครองส่วนท้องถิ่น (กรมส่งเสริมการปกครองท้องถิ่น)",
    nameEn: "Local Administrative Organization registry (DLA)",
    agency: "กรมส่งเสริมการปกครองท้องถิ่น (DLA)",
    homepageUrl: "https://opendata.dla.go.th/en/dataset/dlads_05_01",
    // เว็บ dataset ของ DLA ระบุชื่อสัญญาอนุญาตไว้ตรง ๆ ว่า "Open Data Common" —
    // เป็นชื่อที่ไม่ปกติ (ไม่ใช่ Open Data Commons ที่รู้จักกันทั่วไป) แต่คงไว้ตามที่
    // ต้นทางเขียนจริง ไม่ตั้งชื่อใหม่ให้เอง
    licenseName: "Open Data Common",
    // ไม่มีหน้าสัญญาอนุญาตแยกต่างหาก — ลิงก์ไปหน้า dataset เอง
    licenseUrl: "https://opendata.dla.go.th/en/dataset/dlads_05_01",
    attributionText:
      "ทะเบียนองค์กรปกครองส่วนท้องถิ่นจากชุดข้อมูลเปิดของกรมส่งเสริมการปกครองท้องถิ่น (DLA)",
    // baked เข้า bundle ตอน build (ETL) ไม่ได้ poll สด จึงไม่มีสถานะให้รายงานใน /api/v1/health
    kind: "static",
  },
};

/** Every registered id, in declaration order. */
export const SOURCE_IDS = Object.keys(SOURCES) as readonly SourceId[];

/** Ids the API is expected to report a freshness status for in /api/v1/health. */
export const LIVE_SOURCE_IDS: readonly SourceId[] = SOURCE_IDS.filter(
  (id) => SOURCES[id].kind === "live",
);

/** One-line credit for a set of sources, e.g. the footer of an exported image. */
export function attributionLine(ids: readonly SourceId[]): string {
  return ids.map((id) => SOURCES[id].attributionText).join(" · ");
}
