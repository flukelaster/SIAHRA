/**
 * The one registry of upstream data sources. Everything that names a source —
 * a `HazardLayerDescriptor.sourceIds`, a `SourceStatus.id` in /api/v1/health,
 * an attribution line in the UI — names it with a `SourceId` from here, so the
 * link between "this layer came from X" and "X is healthy/stale/down" is a
 * type error when it breaks, not a naming convention someone has to remember.
 *
 * Adding a source: add the id to `SourceId`, then `SOURCES` (tsc lists every
 * missing field), then a `SourceStatus` in /api/v1/health if `kind` is "live".
 * A "browser" source gets no `SourceStatus`: the API never asks it anything, and
 * neither does a "community" source: it is our own store of user submissions.
 */
export type SourceId =
  | "thaiwater"
  | "earthquakes"
  | "gistda-flood"
  | "tmd-radar"
  | "tmd-nwp"
  | "jma-typhoon"
  | "gdacs-tc"
  | "exposure-illustrative"
  | "alert-engine"
  | "copernicus-gfm"
  | "copernicus-dem"
  | "osm"
  | "osm-admin"
  | "worldpop"
  | "worldcover"
  | "esri-world-imagery"
  | "eox-s2cloudless"
  | "dla"
  | "dwr-cctv"
  | "itic-cctv"
  | "doh-cctv"
  | "bma-cctv"
  | "community-report";

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
   * A disclaimer the source publishes and asks users to carry next to its data,
   * quoted from its own terms page (the URL is in `licenseUrl`). Absent for the
   * sources that publish none — never paraphrased into a stronger claim.
   */
  disclaimerText?: string;
  /**
   * live    = polled continuously by the API; must appear in /api/v1/health
   * static  = baked into the tiles/manifest by the ETL, no freshness to report
   * browser = asked directly by the user's browser, one request per click, never
   *           by the API — so /api/v1/health has no status for it and must not
   *           claim one (the server has not probed it; "absent" is the honest
   *           state). Freshness is shown per item where it was fetched (E15:
   *           the CCTV popup's capture time and fetch time; E15.2: the live
   *           stream's own timestamp, or a plain "no timestamp")
   * community = submitted by members of the public and stored by our own API
   *           (community report pins) — there is no upstream to probe, so it is
   *           outside `LIVE_SOURCE_IDS` and /api/v1/health claims nothing for it;
   *           freshness is the list's own `fetchedAt` (when our DO read it) plus
   *           the web's poll state, and every item is unverified
   */
  kind: "live" | "static" | "browser" | "community";
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
  "tmd-nwp": {
    id: "tmd-nwp",
    nameTh: "พยากรณ์จากแบบจำลองเชิงตัวเลข (กรมอุตุนิยมวิทยา)",
    nameEn: "Numerical weather forecast (TMD NWP)",
    agency: "กรมอุตุนิยมวิทยา (TMD)",
    // เครดิตและลิงก์กลับเหมือนฟีดเรดาร์: เป็นเงื่อนไขของ data.tmd.go.th ชุดเดียวกัน
    homepageUrl: "https://data.tmd.go.th",
    // TMD ไม่ได้เผยแพร่ตัวบทสัญญาอนุญาตแยกสำหรับ NWP API — อ้างเงื่อนไขการใช้บริการ
    // ของ data.tmd.go.th ตามที่ฟีดเรดาร์อ้าง ห้ามแต่งชื่อสัญญาอนุญาตขึ้นมาเอง
    licenseName: "เงื่อนไขการใช้บริการข้อมูลของกรมอุตุนิยมวิทยา",
    licenseUrl: "https://data.tmd.go.th",
    attributionText:
      "ผลพยากรณ์จากแบบจำลองเชิงตัวเลขของกรมอุตุนิยมวิทยา (TMD) — ข้อมูลจาก data.tmd.go.th; กรมอุตุนิยมวิทยาไม่ได้รับรองหรือมีส่วนเกี่ยวข้องกับโครงการนี้",
    kind: "live",
  },
  "jma-typhoon": {
    id: "jma-typhoon",
    nameTh: "เส้นทางพายุหมุนเขตร้อน แปซิฟิกตะวันตกเฉียงเหนือและทะเลจีนใต้ (JMA)",
    nameEn: "Tropical cyclone tracks, western North Pacific and South China Sea (JMA)",
    agency: "Japan Meteorological Agency (JMA) — RSMC Tokyo – Typhoon Center",
    // ข้อมูลอ่านจาก bosai JSON (`/bosai/typhoon/data/targetTc.json` → `TC{id}/specifications.json`
    // + `forecast.json`) ซึ่งเป็นแหล่งเดียวกับแผนที่ไต้ฝุ่นของหน้าเว็บ JMA — schema ไม่มีเอกสาร
    homepageUrl: "https://www.jma.go.jp/bosai/map.html#contents=typhoon",
    // หน้า Legal Notice ของ JMA (ตรวจ 2026-09-26): เนื้อหาใช้ได้ตาม Public Data License (Version 1.0)
    // และ "The user must cite the source" ในรูป "Source: Japan Meteorological Agency website (URL)"
    licenseName: "Public Data License (Version 1.0) — ตามเงื่อนไขการใช้เว็บไซต์ JMA",
    licenseUrl: "https://www.jma.go.jp/jma/en/copyright.html",
    // บรรทัดแรกคือถ้อยคำที่ JMA บังคับ (ห้ามแก้) — ส่วนหลังคือ "ข้อความว่าได้แก้ไขเนื้อหา" ที่หน้า
    // Legal Notice กำหนดเมื่อนำไปดัดแปลง (เราวาดตำแหน่งใหม่บนแผนที่ของเราเอง) และต้องไม่ทำให้
    // เข้าใจว่ารัฐบาลญี่ปุ่นเป็นผู้จัดทำ
    attributionText:
      "Source: Japan Meteorological Agency website (https://www.jma.go.jp/) — track, positions and 70% probability circles re-plotted by SIAHRA; this edited map was not created by the Government of Japan",
    kind: "live",
  },
  "gdacs-tc": {
    id: "gdacs-tc",
    nameTh: "เส้นทางพายุหมุนเขตร้อน มหาสมุทรอินเดียเหนือ (GDACS / JTWC)",
    nameEn: "Tropical cyclone tracks, North Indian Ocean (GDACS / JTWC)",
    agency: "GDACS — European Commission Joint Research Centre (EC-JRC) และ UN-OCHA; ข้อมูลพายุจาก JTWC",
    homepageUrl: "https://www.gdacs.org/",
    // GDACS ไม่ได้เผยแพร่สัญญาอนุญาตการนำข้อมูลไปใช้ต่อ (ตรวจ 2026-09-26) มีเพียงหน้า
    // "Disclaimer and Terms of Use" — ห้ามตั้งชื่อสัญญาอนุญาตขึ้นเอง
    licenseName: "ไม่ได้เผยแพร่สัญญาอนุญาต — มีเพียง Disclaimer and Terms of Use ของ GDACS",
    licenseUrl: "https://www.gdacs.org/About/termofuse.aspx",
    attributionText: "GDACS (EC-JRC / UN-OCHA), data: JTWC",
    // ยกจากหน้า Disclaimer and Terms of Use ของ GDACS ตรงตัว (ตรวจ 2026-09-26)
    disclaimerText:
      "GDACS notifications in the case of earthquakes, tsunamis and tropical cyclones are automatic, produced by algorithms and not reviewed by human experts before being issued. They may be subject to uncertainties and errors. GDACS services are not meant to substitute nor to override any official information or alert message from local or national disaster management authorities.",
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
  "copernicus-gfm": {
    id: "copernicus-gfm",
    nameTh: "พื้นที่น้ำท่วมจากดาวเทียม Sentinel-1 (Copernicus GFM)",
    nameEn: "Satellite flood extent (Copernicus GFM, Sentinel-1)",
    agency: "European Commission — Copernicus Emergency Management Service / EODC",
    // Product User Manual ของ GFM; ข้อมูลอ่านจาก STAC ของ EODC
    // https://stac.eodc.eu/api/v1/collections/GFM (ไม่ต้อง auth; E14.F2 `apps/etl/gfm`)
    homepageUrl: "https://extwiki.eodc.eu/GFM/PUM",
    // ไม่มีชื่อสัญญาอนุญาตให้อ้าง — STAC collection ระบุ `license: "proprietary"` และ licensor
    // "JRC CEMS" (https://emergency.copernicus.eu/) ส่วน PUM ข้อ 7.1.4/7.1.7 (FAQ) ตอบเพียงว่า
    // "GFM is part of the CEMS ecosystem … the same rules apply … check the Terms and
    // Conditions sections on GloFAS/EFAS" — จึงอ้างข้อกำหนดนั้นตามที่ต้นทางชี้ ไม่ตั้งชื่อเอง
    licenseName: "ข้อกำหนดและเงื่อนไขของ Copernicus Emergency Management Service (GloFAS/EFAS Terms and Conditions ตาม PUM ข้อ 7.1.4)",
    licenseUrl: "https://global-flood.emergency.copernicus.eu/terms-and-conditions/",
    attributionText: "© European Union, Copernicus Emergency Management Service (GFM), EODC",
    // ดึงโดย job GitHub Actions (.github/workflows/gfm-ingest.yml) ทุก 6 ชม. แล้วเขียน
    // flood/gfm/health.json ลง R2 — api อ่านใบนั้นใบเดียวเพื่อรายงานใน /api/v1/health (E14.F3)
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
    nameTh: "ขอบเขต อปท. และเขตของ กทม. (OpenStreetMap)",
    nameEn: "Local-authority and Bangkok district boundaries (OpenStreetMap)",
    // แยก id จาก "osm" (อาคาร/ถนน/แหล่งน้ำ) โดยตั้งใจ — เป็นคนละชุดข้อมูล
    // (admin relation ไม่ใช่ feature ทางกายภาพ) แหล่งที่มาเดียวกันแต่ที่มาของ
    // ความน่าเชื่อถือคนละเรื่อง ให้ /api/v1/health-style tooling แยกแยะได้
    // ครอบคลุมทั้ง admin_level=7 (อปท.) และ admin_level=6 ของกรุงเทพฯ (50 เขต —
    // ไม่ใช่ อปท. ดู apps/etl/src/buildBmaDistricts.ts)
    agency: "OpenStreetMap contributors",
    homepageUrl: "https://www.openstreetmap.org/copyright",
    licenseName: "ODbL 1.0",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    attributionText:
      "ขอบเขต อปท. และเขตของ กทม. © ผู้ร่วมสร้าง OpenStreetMap (ODbL) — ผู้ร่วมสร้าง OSM ไม่ได้รับรองหรือมีส่วนเกี่ยวข้องกับโครงการนี้",
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
  "dwr-cctv": {
    id: "dwr-cctv",
    nameTh: "ภาพกล้อง CCTV สถานีโทรมาตร (กรมทรัพยากรน้ำ)",
    nameEn: "Telemetry station CCTV snapshots (Department of Water Resources)",
    agency: "กรมทรัพยากรน้ำ (Department of Water Resources — DWR)",
    homepageUrl: "https://telemetry.dwr.go.th",
    // DWR ไม่ได้เผยแพร่เงื่อนไขการใช้ข้อมูลของ API นี้ (ตรวจ 2026-09-26) — ห้ามตั้งชื่อ
    // สัญญาอนุญาตขึ้นเอง บอกตามจริงว่าไม่มี — แสดงภาพโดยให้เครดิตแหล่งที่มา (ถอดได้ด้วย
    // แฟล็ก VITE_FEATURE_CCTV=0 ถ้า DWR ขอ)
    licenseName: "ไม่ได้เผยแพร่เงื่อนไขการใช้ — แสดงโดยให้เครดิตกรมทรัพยากรน้ำ",
    licenseUrl: "https://telemetry.dwr.go.th",
    attributionText:
      "ภาพจากกล้อง CCTV สถานีโทรมาตร กรมทรัพยากรน้ำ (telemetry.dwr.go.th) — กรมทรัพยากรน้ำไม่ได้รับรองหรือมีส่วนเกี่ยวข้องกับโครงการนี้",
    // เบราว์เซอร์ของผู้ใช้ขอภาพจาก DWR ตรง ๆ ทีละคลิก api ไม่เคยถาม DWR จึงไม่มีสถานะ
    // ใน /api/v1/health (และต้องไม่มี) — บัญชีกล้องเป็นไฟล์คงที่จาก ETL
    kind: "browser",
  },
  "itic-cctv": {
    id: "itic-cctv",
    nameTh: "กล้องถนน — วิดีโอสดและภาพนิ่ง (มูลนิธิ iTIC · รายการกล้องจาก Longdo)",
    nameEn: "Road cameras — live video and still images (iTIC Foundation · camera list by Longdo)",
    agency:
      "มูลนิธิสถาบันส่งเสริมการจัดการความรู้เพื่อความปลอดภัยในการเดินทาง (iTIC Foundation) — กล้องของกรมทางหลวงและหน่วยงานพันธมิตร; รายการกล้องจาก Longdo (Metamedia Technology)",
    homepageUrl: "https://iticfoundation.org/",
    // ไม่มีเงื่อนไขการใช้ที่ให้สิทธิ์เราไว้ (ตรวจ 2026-09-26) — ห้ามตั้งชื่อสัญญาอนุญาตขึ้นเอง
    // แสดงโดยให้เครดิต และถอดได้ด้วยแฟล็ก VITE_FEATURE_ITIC=0 ถ้าเจ้าของขอ
    licenseName: "ไม่ได้รับสัญญาอนุญาตใด — แสดงโดยให้เครดิต iTIC เจ้าของกล้อง และ Longdo",
    licenseUrl: "https://iticfoundation.org/",
    attributionText:
      "วิดีโอสดและภาพนิ่งจากกล้องที่เผยแพร่ผ่านมูลนิธิสถาบันส่งเสริมการจัดการความรู้เพื่อความปลอดภัยในการเดินทาง (iTIC) — เจ้าของกล้องคือกรมทางหลวงและหน่วยงานพันธมิตรตามที่ระบุในแต่ละกล้อง; รายการกล้องจาก Longdo (camera.longdo.com) — ไม่มีหน่วยงานใดรับรองหรือมีส่วนเกี่ยวข้องกับโครงการนี้",
    // เบราว์เซอร์เล่นสตรีม/ขอภาพนิ่งจาก iTIC ตรง ๆ ทีละกล้องเมื่อผู้ใช้คลิก api ไม่เคยถาม iTIC
    // จึงไม่มีสถานะใน /api/v1/health (และต้องไม่มี) — บัญชีกล้องเป็นไฟล์คงที่จาก ETL
    kind: "browser",
  },
  "doh-cctv": {
    id: "doh-cctv",
    nameTh: "กรมทางหลวง — กล้องทางหลวง",
    nameEn: "Department of Highways — highway cameras",
    agency: "กรมทางหลวง (Department of Highways — DOH)",
    homepageUrl: "https://www.highwaytraffic.go.th/DOHWeb/home.aspx",
    // หน้ากล้องของกรมทางหลวงไม่ได้เผยแพร่เงื่อนไขการใช้ใด (ตรวจ 2026-09-26) — ห้ามตั้งชื่อสัญญา
    // อนุญาตขึ้นเอง บอกตามจริงว่าไม่มี — แสดงโดยให้เครดิต และถอดได้ด้วย
    // VITE_FEATURE_CCTV_DISABLE=doh-cctv ถ้ากรมทางหลวงขอ (docs/roadmap.md §4)
    licenseName: "ไม่ได้เผยแพร่เงื่อนไขการใช้ (ตรวจ 2026-09-26) — แสดงโดยให้เครดิตกรมทางหลวง",
    licenseUrl: "https://www.highwaytraffic.go.th/DOHWeb/home.aspx",
    attributionText:
      "วิดีโอสดจากกล้องทางหลวงของกรมทางหลวง (highwaytraffic.go.th) — กรมทางหลวงไม่ได้รับรองหรือมีส่วนเกี่ยวข้องกับโครงการนี้",
    // เบราว์เซอร์เล่น HLS จาก streaming{1,2}.highwaytraffic.go.th ตรง ๆ ทีละกล้องเมื่อผู้ใช้คลิก
    // api ไม่เคยถาม จึงไม่มีสถานะใน /api/v1/health (และต้องไม่มี) — บัญชีกล้องเป็นไฟล์คงที่จาก ETL
    kind: "browser",
  },
  "bma-cctv": {
    id: "bma-cctv",
    // ชื่อบอกเฉพาะที่ข้อมูลยืนยันได้: กทม. + กล้องจราจร (คอลัมน์ project ของชุดข้อมูลเป็นโครงการกล้อง
    // "เพื่อการบริหารจัดการจราจร") + ตำแหน่งเท่านั้น — ไม่เอ่ยชื่อสำนักการจราจรและขนส่ง เพราะการระบุว่า
    // เป็นกล้องของ สจส. เป็นการอนุมาน (ดู apps/etl/src/build-bma-cctv.README.md)
    nameTh: "กรุงเทพมหานคร — ตำแหน่งกล้องจราจร (ชุดข้อมูลเปิด)",
    nameEn: "Bangkok Metropolitan Administration — traffic camera locations (open data)",
    agency: "กรุงเทพมหานคร (Bangkok Metropolitan Administration — BMA); ชุดข้อมูลเผยแพร่โดยกองยุทธศาสตร์ดิจิทัล",
    homepageUrl: "https://data.bangkok.go.th/dataset/bma-cctv",
    // ชุดข้อมูลระบุ "License not specified" ตรง ๆ (ตรวจ 2026-09-27) — ห้ามตั้งชื่อสัญญาอนุญาตขึ้นเอง
    // แสดงโดยให้เครดิต และถอดได้ด้วย VITE_FEATURE_CCTV_DISABLE=bma-cctv ถ้า กทม. ขอ (docs/roadmap.md §4)
    licenseName: "not specified on data.bangkok.go.th (checked 2026-09-27) — shown with attribution",
    licenseUrl: "https://data.bangkok.go.th/dataset/bma-cctv",
    attributionText:
      "ตำแหน่งกล้อง CCTV จากชุดข้อมูลเปิดของกรุงเทพมหานคร (data.bangkok.go.th) — SIAHRA ไม่ได้แสดงภาพจากกล้องเหล่านี้; กรุงเทพมหานครไม่ได้รับรองหรือมีส่วนเกี่ยวข้องกับโครงการนี้",
    // SIAHRA ไม่ขออะไรจาก กทม. เลยตอนใช้งาน: ตำแหน่งเป็นไฟล์คงที่จาก ETL และลิงก์ BMA Traffic
    // ผู้ใช้เปิดเองในแท็บใหม่ — api ไม่เคยถาม จึงไม่มีสถานะใน /api/v1/health (และต้องไม่มี)
    kind: "browser",
  },
  "community-report": {
    id: "community-report",
    nameTh: "รายงานผลกระทบจากประชาชน (ยังไม่ได้ตรวจสอบ)",
    nameEn: "Community impact reports (unverified)",
    // ไม่ใช่หน่วยงาน: ผู้ใช้ทั่วไปส่งผ่านแอปนี้ SIAHRA แค่เก็บและแสดง ไม่ได้ตรวจสอบเนื้อหา
    agency: "ผู้ใช้ SIAHRA ทั่วไป — รวบรวมและแสดงโดย SIAHRA ไม่มีหน่วยงานใดตรวจสอบ",
    homepageUrl: "https://siahra-radar.co/",
    // ผู้ส่งไม่ได้ให้สัญญาอนุญาตใด ๆ กับเนื้อหาของตน — บอกตามจริง ไม่ตั้งชื่อสัญญาอนุญาตขึ้นเอง
    licenseName: "เนื้อหาของผู้ใช้ เผยแพร่สาธารณะ 30 วันแล้วลบ — ไม่มีสัญญาอนุญาตให้นำไปใช้ต่อ",
    licenseUrl: "https://siahra-radar.co/",
    attributionText:
      "รายงานผลกระทบที่ผู้ใช้ทั่วไปส่งผ่าน SIAHRA — ยังไม่ได้ตรวจสอบ ไม่ใช่ข้อมูลจากหน่วยงานหรือเครื่องมือวัด และคะแนนโหวตเป็นความเห็นของผู้ใช้ ไม่ใช่การยืนยัน",
    // เก็บใน CommunityReportDO ของ api เอง ไม่มีต้นทางภายนอกให้ probe → ไม่อยู่ใน LIVE_SOURCE_IDS
    // และ /api/v1/health ไม่เรียก DO นี้เลย (devops HEALTH-1)
    kind: "community",
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
