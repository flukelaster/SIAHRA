/**
 * สร้าง `apps/api/src/data/localAuthorityExposure.json` — ความเสี่ยงพื้นฐาน
 * (ประชากร, อาคาร, ถนน, สิ่งอำนวยความสะดวก) ของ อปท. แต่ละแห่ง (E11.3)
 *
 *   npm run build:local-authority-exposure -w apps/etl
 *
 * ## ทำไมได้แค่ 431 จาก 7,849 อปท.
 * คำนวณ zonal statistics ได้เฉพาะ อปท. ที่มีขอบเขตจริงจาก E11.2
 * (`apps/web/public/aoi/{code}/local-authorities.geojson`) เท่านั้น — ที่เหลือไม่มี
 * รูปหลายเหลี่ยมให้คำนวณ การประดิษฐ์รูปขึ้นมาเอง (บัฟเฟอร์รอบจุด, ยืมรูปตำบล) คือ
 * การกุข้อมูลแบบเดียวกับที่ epic นี้มีไว้กำจัด อ่านหัวไฟล์ของ
 * `buildLocalAuthorityBoundaries.ts` ก่อนถ้ายังไม่เข้าใจเหตุผล
 *
 * ## แหล่งข้อมูลจริงที่ใช้
 * - ประชากร: WorldPop 2020 UN-adjusted 100 ม. (`fetchWorldPop.ts`) — zonal sum
 *   ด้วย gdalwarp -cutline (ตัดตามรูปจริงของ อปท.) แล้ว gdal_translate -of AAIGrid
 *   อ่านค่าพิกเซลรวมด้วย `sumAaiGridPopulation` (GDAL CLI ล้วน ไม่มี python/rasterio)
 * - อาคาร/ถนน/สิ่งอำนวยความสะดวก: OSM extract ประเทศไทยที่ cache ไว้แล้ว
 *   (`fetchThailandOsm`) — สกัดรายจังหวัด (ไม่ใช่รายอปท.) ด้วย bbox ที่เป็น union
 *   ของรูป อปท. ทุกรูปในจังหวัดนั้น แล้วทำ point-in-polygon / clip ต่อ อปท. ในหน่วยความจำ
 *   ประหยัดกว่าสกัดทีละ อปท. ทั้ง ๆ ที่ 431 รูปกระจายอยู่แค่ 46 จังหวัด
 *
 * ## ความสมบูรณ์ของ OSM ไม่เท่ากันทุกที่
 * `buildingsPerThousandPop` ไม่ใช่ความเชื่อมั่น (confidence score) แค่อัตราส่วนดิบ
 * ที่ผู้ใช้เอาไปเทียบเองได้ว่าพื้นที่ไหนแมปอาคารไว้ครบกว่าที่อื่น — ค่าต่ำผิดปกติ
 * มักแปลว่า OSM ยังแมปอาคารไม่ครบ ไม่ใช่พื้นที่ไม่มีอาคารจริง ดู COVERAGE.md
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import type {
  HazardLayerDescriptor,
  LocalAuthorityBaselineExposure,
  LocalAuthorityExposureArtefact,
  LocalAuthorityFacility,
} from "@siahra/shared-types";
import { fetchThailandOsm } from "./fetchOsm.js";
import { fetchWorldPop } from "./fetchWorldPop.js";
import { parseOtherTags } from "./buildProvinceBuildings.js";
import { isoUtc, readOsmPublishedAt } from "./provenance.js";
import {
  buildingsPerThousandPop,
  dedupeFacilityNodes,
  geometryBbox,
  geometryToFlatRings,
  groupRoadLengthByClass,
  lineLengthKm,
  pointInRings,
  polygonVertexCentroid,
  sumAaiGridPopulation,
  type CandidateFacility,
  type GeoJsonGeometry,
} from "./localAuthorityExposureHelpers.js";

const AOI_DIR = path.resolve(import.meta.dirname, "../../web/public/aoi");
const WORK_DIR = path.resolve(import.meta.dirname, "../data/work/exposure");
const OUT_PATH = path.resolve(import.meta.dirname, "../../api/src/data/localAuthorityExposure.json");
export const COVERAGE_DIR = path.resolve(import.meta.dirname, "../data/sources/worldpop");

/** เผื่อขอบรูป อปท. ที่ติดขอบ bbox จังหวัดพอดี — ไม่กระทบผลลัพธ์ (ยังทำ
 *  point-in-polygon/clip ต่อรูปจริงอยู่ดี) แค่กันโดนตัดขาดตอน osmium extract */
const PROVINCE_PAD_DEG = 0.01;

interface RawFeatureCollection {
  type: "FeatureCollection";
  features: { type: "Feature"; properties: Record<string, unknown>; geometry: GeoJsonGeometry }[];
}

interface AuthorityFeature {
  id: string;
  nameTh: string;
  geometry: GeoJsonGeometry;
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
}

function readGeoJson(file: string): RawFeatureCollection {
  return JSON.parse(readFileSync(file, "utf-8")) as RawFeatureCollection;
}

function osmIdOf(props: Record<string, unknown>): string {
  const raw = props.osm_way_id ?? props.osm_id ?? props.osm_relation_id ?? "unknown";
  return String(raw);
}

function facilityNameOf(props: Record<string, unknown>, otherTags: Record<string, string>): string | null {
  return otherTags["name:th"] ?? (typeof props.name === "string" ? props.name : null) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ขั้นแตะดิสก์: gdalinfo ของ WorldPop raster
// ─────────────────────────────────────────────────────────────────────────────

interface WorldPopRasterInfo {
  pixelSizeDeg: number;
  nodataValue: number | null;
}

async function readWorldPopRasterInfo(tifPath: string): Promise<WorldPopRasterInfo> {
  const { stdout } = await execa("gdalinfo", ["-json", tifPath]);
  const info = JSON.parse(stdout) as {
    geoTransform?: number[];
    bands?: { noDataValue?: number }[];
  };
  const pixelSizeDeg = info.geoTransform ? Math.abs(info.geoTransform[1]) : 0.0008333333333333;
  const nodataValue = info.bands?.[0]?.noDataValue ?? null;
  return { pixelSizeDeg, nodataValue };
}

// ─────────────────────────────────────────────────────────────────────────────
// ขั้นแตะดิสก์: OSM extract รายจังหวัด (cache ใน WORK_DIR)
// ─────────────────────────────────────────────────────────────────────────────

interface ProvinceOsmData {
  buildingCentroids: [number, number][];
  facilityCandidates: Record<"hospitals" | "schools" | "fireStations", CandidateFacility[]>;
  roadLines: { highwayClass: string; coords: [number, number][] }[];
}

async function extractProvinceOsm(
  provinceCode: string,
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  pbfPath: string,
): Promise<ProvinceOsmData> {
  mkdirSync(WORK_DIR, { recursive: true });
  const extractPbf = path.join(WORK_DIR, `p${provinceCode}-extract.osm.pbf`);
  const filteredPbf = path.join(WORK_DIR, `p${provinceCode}-filtered.osm.pbf`);
  const polysJson = path.join(WORK_DIR, `p${provinceCode}-polys.geojson`);
  const linesJson = path.join(WORK_DIR, `p${provinceCode}-lines.geojson`);
  const pointsJson = path.join(WORK_DIR, `p${provinceCode}-points.geojson`);

  const bboxArg = `${bbox.minLon - PROVINCE_PAD_DEG},${bbox.minLat - PROVINCE_PAD_DEG},${bbox.maxLon + PROVINCE_PAD_DEG},${bbox.maxLat + PROVINCE_PAD_DEG}`;

  if (!existsSync(extractPbf)) {
    await execa("osmium", ["extract", "-b", bboxArg, "-o", extractPbf, "--overwrite", pbfPath], {
      stdio: "ignore",
    });
  }
  if (!existsSync(filteredPbf)) {
    // fire station = amenity=fire_station, NOT emergency=fire_station — verified
    // against the real extract before trusting it (`osmium tags-filter
    // thailand-latest.osm.pbf "emergency=fire_station"` -> 0 nodes/ways
    // nationally; `"amenity=fire_station"` -> 894 nodes + 137 ways). Using the
    // wrong tag would have silently reported "no fire stations anywhere" as if
    // it were a real absence instead of a tagging bug — see COVERAGE.md.
    await execa(
      "osmium",
      [
        "tags-filter",
        extractPbf,
        "w/building",
        "n/building",
        "w/highway",
        "nwr/amenity=hospital,school,fire_station",
        "-o",
        filteredPbf,
        "--overwrite",
      ],
      { stdio: "ignore" },
    );
  }
  if (!existsSync(polysJson)) {
    await execa("ogr2ogr", ["-f", "GeoJSON", polysJson, filteredPbf, "multipolygons"], { stdio: "ignore" });
  }
  if (!existsSync(linesJson)) {
    await execa("ogr2ogr", ["-f", "GeoJSON", linesJson, filteredPbf, "lines"], { stdio: "ignore" });
  }
  if (!existsSync(pointsJson)) {
    await execa("ogr2ogr", ["-f", "GeoJSON", pointsJson, filteredPbf, "points"], { stdio: "ignore" });
  }

  const polys = readGeoJson(polysJson);
  const lines = readGeoJson(linesJson);
  const points = readGeoJson(pointsJson);

  const buildingCentroids: [number, number][] = [];
  const facilityPolygonGeoms: Record<"hospitals" | "schools" | "fireStations", GeoJsonGeometry[]> = {
    hospitals: [],
    schools: [],
    fireStations: [],
  };
  const facilityPolygonPoints: Record<"hospitals" | "schools" | "fireStations", CandidateFacility[]> = {
    hospitals: [],
    schools: [],
    fireStations: [],
  };

  for (const f of polys.features) {
    const props = f.properties;
    const other = parseOtherTags(typeof props.other_tags === "string" ? props.other_tags : undefined);
    const amenity = (props.amenity as string | undefined) ?? other.amenity;

    if (props.building) {
      const c = polygonVertexCentroid(f.geometry);
      if (c) buildingCentroids.push(c);
    }

    const kind = amenity === "hospital" ? "hospitals" : amenity === "school" ? "schools" : amenity === "fire_station" ? "fireStations" : null;
    if (kind) {
      const c = polygonVertexCentroid(f.geometry);
      if (c) {
        facilityPolygonGeoms[kind].push(f.geometry);
        facilityPolygonPoints[kind].push({
          osmId: `way/${osmIdOf(props)}`,
          nameTh: facilityNameOf(props, other),
          lon: c[0],
          lat: c[1],
        });
      }
    }
  }

  const facilityNodesRaw: Record<"hospitals" | "schools" | "fireStations", CandidateFacility[]> = {
    hospitals: [],
    schools: [],
    fireStations: [],
  };
  for (const f of points.features) {
    if (f.geometry.type !== "Point") continue;
    const props = f.properties;
    const other = parseOtherTags(typeof props.other_tags === "string" ? props.other_tags : undefined);
    const amenity = (props.amenity as string | undefined) ?? other.amenity;
    const kind = amenity === "hospital" ? "hospitals" : amenity === "school" ? "schools" : amenity === "fire_station" ? "fireStations" : null;
    if (!kind) continue;
    const [lon, lat] = f.geometry.coordinates as unknown as [number, number];
    facilityNodesRaw[kind].push({
      osmId: `node/${osmIdOf(props)}`,
      nameTh: facilityNameOf(props, other),
      lon,
      lat,
    });
  }

  const facilityCandidates: ProvinceOsmData["facilityCandidates"] = {
    hospitals: [
      ...facilityPolygonPoints.hospitals,
      ...dedupeFacilityNodes(facilityNodesRaw.hospitals, facilityPolygonGeoms.hospitals),
    ],
    schools: [
      ...facilityPolygonPoints.schools,
      ...dedupeFacilityNodes(facilityNodesRaw.schools, facilityPolygonGeoms.schools),
    ],
    fireStations: [
      ...facilityPolygonPoints.fireStations,
      ...dedupeFacilityNodes(facilityNodesRaw.fireStations, facilityPolygonGeoms.fireStations),
    ],
  };

  const roadLines: ProvinceOsmData["roadLines"] = [];
  for (const f of lines.features) {
    const highwayClass = (f.properties.highway as string | undefined) ?? null;
    if (!highwayClass) continue;
    const geom = f.geometry;
    const parts: [number, number][][] =
      geom.type === "LineString"
        ? [(geom.coordinates as unknown as [number, number][])]
        : geom.type === "MultiLineString"
          ? (geom.coordinates as unknown as [number, number][][])
          : [];
    for (const coords of parts) {
      if (coords.length >= 2) roadLines.push({ highwayClass, coords });
    }
  }

  return { buildingCentroids, facilityCandidates, roadLines };
}

// ─────────────────────────────────────────────────────────────────────────────
// per-authority: population zonal sum ผ่าน gdalwarp -cutline + gdal_translate
// ─────────────────────────────────────────────────────────────────────────────

interface PopulationResult {
  estimate: number | null;
  reason: string | null;
}

async function zonalPopulationSum(
  worldpopTif: string,
  laoGeojsonPath: string,
  authorityId: string,
  rasterInfo: WorldPopRasterInfo,
  scratchPrefix: string,
): Promise<PopulationResult> {
  const clippedTif = `${scratchPrefix}-pop.tif`;
  const clippedAsc = `${scratchPrefix}-pop.asc`;
  try {
    await execa(
      "gdalwarp",
      [
        "-cutline",
        laoGeojsonPath,
        "-cwhere",
        `id='${authorityId}'`,
        "-crop_to_cutline",
        "-tr",
        String(rasterInfo.pixelSizeDeg),
        String(rasterInfo.pixelSizeDeg),
        "-tap",
        "-r",
        "near",
        "-dstnodata",
        "-9999",
        "-of",
        "GTiff",
        "-overwrite",
        worldpopTif,
        clippedTif,
      ],
      { stdio: "ignore" },
    );
    await execa("gdal_translate", ["-of", "AAIGrid", clippedTif, clippedAsc], { stdio: "ignore" });
    const text = readFileSync(clippedAsc, "utf-8");
    const result = sumAaiGridPopulation(text);
    if (result.validPixelCount === 0) {
      return { estimate: null, reason: "no valid (non-nodata, non-negative) pixels in crop" };
    }
    return { estimate: result.sum, reason: null };
  } catch (err) {
    return { estimate: null, reason: `gdalwarp/gdal_translate failed: ${String(err).slice(0, 200)}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// per-authority: ความยาวถนน — clip เส้นทางจริงด้วย ogr2ogr -clipsrc
// ─────────────────────────────────────────────────────────────────────────────

async function clippedRoadLengthByClass(
  candidateLines: readonly { highwayClass: string; coords: [number, number][] }[],
  authorityBbox: { minLon: number; minLat: number; maxLon: number; maxLat: number },
  laoGeojsonPath: string,
  authorityId: string,
  scratchPrefix: string,
): Promise<Record<string, number>> {
  const pad = 0.002;
  const relevant = candidateLines.filter((l) =>
    l.coords.some(
      ([lon, lat]) =>
        lon >= authorityBbox.minLon - pad &&
        lon <= authorityBbox.maxLon + pad &&
        lat >= authorityBbox.minLat - pad &&
        lat <= authorityBbox.maxLat + pad,
    ),
  );
  if (relevant.length === 0) return {};

  const subsetPath = `${scratchPrefix}-roads-subset.geojson`;
  const clippedPath = `${scratchPrefix}-roads-clipped.geojson`;
  writeFileSync(
    subsetPath,
    JSON.stringify({
      type: "FeatureCollection",
      features: relevant.map((l) => ({
        type: "Feature",
        properties: { highway: l.highwayClass },
        geometry: { type: "LineString", coordinates: l.coords },
      })),
    }),
  );

  try {
    await execa(
      "ogr2ogr",
      [
        "-f",
        "GeoJSON",
        "-clipsrc",
        laoGeojsonPath,
        "-clipsrcwhere",
        `id='${authorityId}'`,
        clippedPath,
        subsetPath,
      ],
      { stdio: "ignore" },
    );
  } catch {
    return {};
  }
  if (!existsSync(clippedPath)) return {};
  const clipped = readGeoJson(clippedPath);
  const entries = clipped.features
    .map((f) => {
      const highwayClass = (f.properties.highway as string | undefined) ?? "unknown";
      const geom = f.geometry;
      const parts: [number, number][][] =
        geom.type === "LineString"
          ? [(geom.coordinates as unknown as [number, number][])]
          : geom.type === "MultiLineString"
            ? (geom.coordinates as unknown as [number, number][][])
            : [];
      return parts.map((coords) => ({ highwayClass, km: lineLengthKm(coords) }));
    })
    .flat();
  return groupRoadLengthByClass(entries);
}

// ─────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────

export async function run(): Promise<void> {
  const worldpopMeta = await fetchWorldPop();
  const pbfPath = await fetchThailandOsm();
  const osmPublishedAt = await readOsmPublishedAt(pbfPath);
  const osmFetchedAt = isoUtc(statSync(pbfPath).mtimeMs);
  const rasterInfo = await readWorldPopRasterInfo(worldpopMeta.path);

  mkdirSync(WORK_DIR, { recursive: true });
  mkdirSync(COVERAGE_DIR, { recursive: true });

  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice("--only=".length).split(",") : null;

  const allProvinceCodes = readdirSync(AOI_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((code) => existsSync(path.join(AOI_DIR, code, "local-authorities.geojson")))
    .sort();
  // --only=<code,code,...> จำกัดจังหวัดที่ประมวลผล — ใช้ตอนไพลอตทดสอบ (เช่น
  // สงขลา/หาดใหญ่) ก่อนรันเต็ม 46 จังหวัด ไม่กระทบผลลัพธ์ของรันเต็ม (แพตเทิร์น
  // เดียวกับ buildAllProvinces.ts)
  const provinceCodes = only ? allProvinceCodes.filter((c) => only.includes(c)) : allProvinceCodes;

  console.log(
    `[lao-exposure] ${provinceCodes.length}/${allProvinceCodes.length} จังหวัดมีขอบเขต อปท. จาก E11.2${only ? ` (--only=${only.join(",")})` : ""}`,
  );

  const exposures: LocalAuthorityBaselineExposure[] = [];
  const failures: { id: string; nameTh: string; reason: string }[] = [];
  let zeroPopulationCount = 0;
  const buildingCountsForSummary: number[] = [];

  const computedAt = isoUtc(Date.now());
  const populationDescriptor: HazardLayerDescriptor = {
    id: "local-authority-population",
    epistemicClass: "static-reference",
    liveOrStatic: "static",
    publishedAt: worldpopMeta.publishedAt,
    fetchedAt: worldpopMeta.fetchedAt,
    sourceIds: ["worldpop"],
  };
  const buildingsDescriptor: HazardLayerDescriptor = {
    id: "local-authority-buildings",
    epistemicClass: "static-reference",
    liveOrStatic: "static",
    publishedAt: osmPublishedAt,
    fetchedAt: osmFetchedAt,
    sourceIds: ["osm"],
  };
  const roadsDescriptor: HazardLayerDescriptor = { ...buildingsDescriptor, id: "local-authority-roads" };
  const facilitiesDescriptor: HazardLayerDescriptor = {
    ...buildingsDescriptor,
    id: "local-authority-facilities",
  };

  let i = 0;
  for (const provinceCode of provinceCodes) {
    const laoGeojsonPath = path.join(AOI_DIR, provinceCode, "local-authorities.geojson");
    const fc = readGeoJson(laoGeojsonPath);
    const authorities: AuthorityFeature[] = fc.features.map((f) => ({
      id: String(f.properties.id),
      nameTh: String(f.properties.nameTh ?? ""),
      geometry: f.geometry,
      bbox: geometryBbox(f.geometry),
    }));
    if (authorities.length === 0) continue;

    const provinceBbox = authorities.reduce(
      (acc, a) => ({
        minLon: Math.min(acc.minLon, a.bbox.minLon),
        minLat: Math.min(acc.minLat, a.bbox.minLat),
        maxLon: Math.max(acc.maxLon, a.bbox.maxLon),
        maxLat: Math.max(acc.maxLat, a.bbox.maxLat),
      }),
      { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity },
    );

    const osmData = await extractProvinceOsm(provinceCode, provinceBbox, pbfPath);

    for (const authority of authorities) {
      i++;
      const tag = `[${i}] ${authority.id} ${authority.nameTh}`;
      const rings = geometryToFlatRings(authority.geometry);
      const scratchPrefix = path.join(WORK_DIR, `a${authority.id}`);

      const popResult = await zonalPopulationSum(
        worldpopMeta.path,
        laoGeojsonPath,
        authority.id,
        rasterInfo,
        scratchPrefix,
      );
      if (popResult.estimate === null) {
        failures.push({ id: authority.id, nameTh: authority.nameTh, reason: popResult.reason ?? "unknown" });
      }
      if (popResult.estimate === 0) zeroPopulationCount++;

      const buildingCount = osmData.buildingCentroids.filter(([lon, lat]) => pointInRings(lon, lat, rings)).length;
      buildingCountsForSummary.push(buildingCount);

      const byClass = await clippedRoadLengthByClass(
        osmData.roadLines,
        authority.bbox,
        laoGeojsonPath,
        authority.id,
        scratchPrefix,
      );
      const totalKm = Object.values(byClass).reduce((a, b) => a + b, 0);

      const facilitiesOf = (kind: "hospitals" | "schools" | "fireStations"): LocalAuthorityFacility[] =>
        osmData.facilityCandidates[kind]
          .filter((c) => pointInRings(c.lon, c.lat, rings))
          .map((c) => ({
            osmId: c.osmId,
            nameTh: c.nameTh,
            lat: Math.round(c.lat * 1e5) / 1e5,
            lon: Math.round(c.lon * 1e5) / 1e5,
          }));

      // popResult.estimate is null only when the zonal crop genuinely failed
      // (gdalwarp/gdal_translate error, or no valid pixel) — never coerced to
      // 0, which would be indistinguishable from a real zero-population result.
      const exposure: LocalAuthorityBaselineExposure = {
        localAuthorityId: authority.id,
        population: {
          estimate: popResult.estimate === null ? null : Math.round(popResult.estimate * 100) / 100,
          datasetId: "worldpop_tha_2020_UNadj",
          resolutionM: 100,
          vintage: "2020",
          descriptor: populationDescriptor,
        },
        buildings: {
          count: buildingCount,
          perThousandPop:
            popResult.estimate === null ? null : buildingsPerThousandPop(buildingCount, popResult.estimate),
          osmExtractDate: osmPublishedAt,
          descriptor: buildingsDescriptor,
        },
        roads: {
          totalKm: Math.round(totalKm * 1000) / 1000,
          byClass: Object.fromEntries(
            Object.entries(byClass).map(([k, v]) => [k, Math.round(v * 1000) / 1000]),
          ),
          descriptor: roadsDescriptor,
        },
        facilities: {
          hospitals: facilitiesOf("hospitals"),
          schools: facilitiesOf("schools"),
          fireStations: facilitiesOf("fireStations"),
          descriptor: facilitiesDescriptor,
        },
        computedAt,
      };
      exposures.push(exposure);
      console.log(
        `${tag} — pop=${popResult.estimate ?? "FAILED"} buildings=${buildingCount} roads=${totalKm.toFixed(1)}km facilities=${exposure.facilities.hospitals.length}/${exposure.facilities.schools.length}/${exposure.facilities.fireStations.length}`,
      );
    }
  }

  const artefact: LocalAuthorityExposureArtefact = {
    generatedAt: computedAt,
    recordCount: exposures.length,
    exposures,
  };
  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  const json = JSON.stringify(artefact);
  writeFileSync(OUT_PATH, json);
  console.log(`[lao-exposure] wrote ${OUT_PATH} (${(Buffer.byteLength(json) / 1024).toFixed(1)} KB)`);

  writeFileSync(
    path.join(COVERAGE_DIR, "coverage.json"),
    JSON.stringify(
      {
        generatedAt: computedAt,
        worldpopSha256: worldpopMeta.sha256,
        worldpopFetchedAt: worldpopMeta.fetchedAt,
        worldpopPublishedAt: worldpopMeta.publishedAt,
        osmPublishedAt,
        recordCount: exposures.length,
        zeroPopulationCount,
        populationFailures: failures,
        buildingCountDistribution: {
          min: Math.min(...buildingCountsForSummary),
          max: Math.max(...buildingCountsForSummary),
          median: [...buildingCountsForSummary].sort((a, b) => a - b)[Math.floor(buildingCountsForSummary.length / 2)],
        },
      },
      null,
      2,
    ),
  );

  console.log(
    `[lao-exposure] done — ${exposures.length} records, ${failures.length} population failures, ${zeroPopulationCount} zero-population`,
  );
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
