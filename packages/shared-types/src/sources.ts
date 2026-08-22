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
  | "copernicus-dem"
  | "osm"
  | "worldcover"
  | "esri-world-imagery"
  | "eox-s2cloudless"
  | "dla-master"
  | "dla-gis"
  | "worldpop"
  | "dld"
  | "doae";

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
    nameTh: "รายงานแผ่นดินไหว (TMD, USGS, EMSC)",
    nameEn: "Earthquake feed (TMD, USGS, EMSC)",
    agency:
      "กองเฝ้าระวังแผ่นดินไหว กรมอุตุนิยมวิทยา (TMD), USGS Earthquake Hazards Program, EMSC",
    homepageUrl: "https://earthquake.tmd.go.th/",
    licenseName: "ข้อมูลสาธารณะเพื่อการเตือนภัย (TMD / USGS Public Domain / EMSC ODC-BY)",
    licenseUrl: "https://earthquake.usgs.gov/data/comcat/data-eventterms.php",
    attributionText:
      "ข้อมูลแผ่นดินไหวจาก กองเฝ้าระวังแผ่นดินไหว กรมอุตุนิยมวิทยา (TMD), USGS และ EMSC",
    kind: "live",
  },
  "gistda-flood": {
    id: "gistda-flood",
    nameTh: "พื้นที่น้ำท่วมจากภาพถ่ายดาวเทียม (GISTDA)",
    nameEn: "Satellite flood extent (GISTDA)",
    agency: "สำนักงานพัฒนาเทคโนโลยีอวกาศและภูมิสารสนเทศ (องค์การมหาชน) — GISTDA",
    homepageUrl: "https://flood.gistda.or.th/",
    licenseName: "เงื่อนไขการใช้ข้อมูล Open Data GISTDA",
    licenseUrl: "https://opendata.gistda.or.th/",
    attributionText:
      "พื้นที่น้ำท่วมจากดาวเทียม Sentinel-1/COSMO-SkyMed โดยสำนักงานพัฒนาเทคโนโลยีอวกาศและภูมิสารสนเทศ (GISTDA)",
    kind: "live",
  },
  "tmd-radar": {
    id: "tmd-radar",
    nameTh: "เรดาร์ฝน (กรมอุตุนิยมวิทยา)",
    nameEn: "Weather radar composite (TMD)",
    agency: "กรมอุตุนิยมวิทยา — TMD",
    homepageUrl: "https://weather.tmd.go.th/",
    licenseName: "ข้อมูลสาธารณะ กรมอุตุนิยมวิทยา",
    licenseUrl: "https://weather.tmd.go.th/",
    attributionText: "ภาพเรดาร์ตรวจอากาศคอมโพสิต กรมอุตุนิยมวิทยา (TMD)",
    kind: "live",
  },
  "exposure-illustrative": {
    id: "exposure-illustrative",
    nameTh: "การคำนวณพื้นที่เผชิญน้ำ (SIAHRA, เพื่อประกอบความเข้าใจ)",
    nameEn: "Flood exposure estimate (SIAHRA, illustrative)",
    agency: "SIAHRA (ประมวลผลจาก ThaiWater + Copernicus DEM + OSM)",
    homepageUrl: "https://github.com/flukelaster/SIAHRA",
    licenseName: "MIT (แบบจำลอง) / ดูสัญญาอนุญาตของข้อมูลตั้งต้นแต่ละแหล่ง",
    licenseUrl: "https://github.com/flukelaster/SIAHRA/blob/main/LICENSE",
    attributionText:
      "การประเมินพื้นที่เผชิญน้ำคำนวณโดย SIAHRA จากสถานี ThaiWater ร่วมกับแบบจำลองความสูง Copernicus DEM และชั้นข้อมูลสิ่งปลูกสร้าง OpenStreetMap (ไม่ใช่การพยากรณ์อุทกวิทยาทางราชการ)",
    kind: "live",
  },
  "copernicus-dem": {
    id: "copernicus-dem",
    nameTh: "แบบจำลองความสูงภูมิประเทศ (Copernicus DEM GLO-30)",
    nameEn: "Terrain elevation (Copernicus DEM GLO-30)",
    agency: "European Space Agency (ESA) / Airbus",
    homepageUrl: "https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model",
    licenseName: "Copernicus WorldDEM-30 Free Open License",
    licenseUrl: "https://spacedata.copernicus.eu/licences",
    attributionText: "แบบจำลองภูมิประเทศสามมิติสร้างจาก Copernicus DEM GLO-30 © ESA/Airbus",
    kind: "static",
  },
  osm: {
    id: "osm",
    nameTh: "อาคาร ถนน ทางน้ำ และสถานที่ (OpenStreetMap)",
    nameEn: "Buildings, roads, waterways & places (OpenStreetMap)",
    agency: "OpenStreetMap Contributors",
    homepageUrl: "https://www.openstreetmap.org/",
    licenseName: "Open Database License (ODbL) 1.0",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    attributionText: "ข้อมูลอาคาร ถนน ทางน้ำ และสถานที่ © ผู้ร่วมสร้าง OpenStreetMap (ODbL)",
    kind: "static",
  },
  worldcover: {
    id: "worldcover",
    nameTh: "ชั้นข้อมูลสิ่งปกคลุมดิน (ESA WorldCover 10m 2021)",
    nameEn: "Land cover classification (ESA WorldCover 10m 2021)",
    agency: "European Space Agency (ESA) / VITO Remote Sensing",
    homepageUrl: "https://esa-worldcover.org/",
    licenseName: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attributionText: "ชั้นพืชพรรณและสิ่งปกคลุมดินจาก ESA WorldCover 10m 2021 v200 © ESA/VITO",
    kind: "static",
  },
  "esri-world-imagery": {
    id: "esri-world-imagery",
    nameTh: "ภาพถ่ายดาวเทียมความละเอียดสูง (Esri World Imagery)",
    nameEn: "High-resolution satellite imagery (Esri World Imagery)",
    agency: "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    homepageUrl: "https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9",
    licenseName: "Esri Master License Agreement / Attribution required",
    licenseUrl: "https://www.esri.com/en-us/legal/terms/full-master-agreement",
    attributionText:
      "ภาพถ่ายดาวเทียมพื้นผิวโลกโดย Esri, Maxar, Earthstar Geographics และชุมชนผู้ใช้ GIS",
    kind: "static",
  },
  "eox-s2cloudless": {
    id: "eox-s2cloudless",
    nameTh: "ภาพถ่ายดาวเทียมไร้เมฆ (Sentinel-2 cloudless by EOX)",
    nameEn: "Cloudless satellite mosaic (Sentinel-2 cloudless by EOX)",
    agency: "EOX IT Services GmbH (contains modified Copernicus Sentinel data)",
    homepageUrl: "https://s2maps.eu/",
    licenseName: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attributionText:
      "Sentinel-2 cloudless — https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2021 & 2022)",
    kind: "static",
  },
  "dla-master": {
    id: "dla-master",
    nameTh: "บัญชีรายชื่อองค์กรปกครองส่วนท้องถิ่น (อปท.)",
    nameEn: "Local Administrative Organization Master List (DLA)",
    agency: "กรมส่งเสริมการปกครองท้องถิ่น (สถ.)",
    homepageUrl: "https://data.go.th/dataset/dla-local-admin",
    licenseName: "Open Government Data License (DGA Thailand)",
    licenseUrl: "https://data.go.th/",
    attributionText: "ข้อมูลองค์กรปกครองส่วนท้องถิ่น กรมส่งเสริมการปกครองท้องถิ่น (สถ.) ผ่าน data.go.th",
    kind: "static",
  },
  "dla-gis": {
    id: "dla-gis",
    nameTh: "ขอบเขตองค์กรปกครองส่วนท้องถิ่น (DLA / GISTDA GIS)",
    nameEn: "Local Authority Administrative Boundaries (DLA / GISTDA GIS)",
    agency: "กรมส่งเสริมการปกครองท้องถิ่น (สถ.) และ GISTDA",
    homepageUrl: "https://gis.dla.go.th/",
    licenseName: "เงื่อนไขการใช้ข้อมูลแผนที่ทางการ (DLA GIS)",
    licenseUrl: "https://gis.dla.go.th/",
    attributionText: "ขอบเขตการปกครองท้องถิ่น กรมส่งเสริมการปกครองท้องถิ่น (สถ.) และ GISTDA",
    kind: "static",
  },
  worldpop: {
    id: "worldpop",
    nameTh: "แบบจำลองความหนาแน่นประชากร (WorldPop 100m)",
    nameEn: "WorldPop Population Density (100m UN-adjusted)",
    agency: "WorldPop Research Group (University of Southampton)",
    homepageUrl: "https://www.worldpop.org/",
    licenseName: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attributionText: "WorldPop (www.worldpop.org - School of Geography and Environmental Science, University of Southampton) (2020), UN-adjusted 100m spatial disaggregation",
    kind: "static",
  },
  dld: {
    id: "dld",
    nameTh: "สถิติจำนวนสัตว์เลี้ยงและปศุสัตว์ (กรมปศุสัตว์)",
    nameEn: "Livestock & Livestock Farming Statistics (DLD)",
    agency: "กรมปศุสัตว์ กระทรวงเกษตรและสหกรณ์",
    homepageUrl: "https://ict.dld.go.th/",
    licenseName: "Open Government Data License (DGA Thailand)",
    licenseUrl: "https://data.go.th/",
    attributionText: "ข้อมูลสถิติปศุสัตว์รายตำบล/อำเภอ กรมปศุสัตว์ กระทรวงเกษตรและสหกรณ์",
    kind: "static",
  },
  doae: {
    id: "doae",
    nameTh: "สถิติพื้นที่เพาะปลูกพืชเศรษฐกิจ (กรมส่งเสริมการเกษตร)",
    nameEn: "Crop & Agricultural Land Statistics (DOAE)",
    agency: "กรมส่งเสริมการเกษตร กระทรวงเกษตรและสหกรณ์",
    homepageUrl: "http://www.doae.go.th/",
    licenseName: "Open Government Data License (DGA Thailand)",
    licenseUrl: "https://data.go.th/",
    attributionText: "ข้อมูลทะเบียนเกษตรกรและพื้นที่เพาะปลูกพืช กรมส่งเสริมการเกษตร",
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
