import type { AoiManifest } from "@siahra/shared-types";
import { utmToWgs84, utmZoneNumber, wgs84ToUtm } from "./projection";

/**
 * Projects raw UTM easting/northing (meters, matching manifest.utmZone) into
 * the scene's local, origin-centered coordinate space. Terrain, buildings,
 * imagery, boundary and markers all go through this so they stay
 * geometrically consistent — see Workstream A ("Three.js world coordinates:
 * local meters relative to a scene/tile origin, not raw latitude/longitude").
 *
 * Convention: +X = east, +Z = south, -Z = north (grid centered at origin).
 *
 * The heightfield is pixel-is-area (GDAL EHdr): cell (r, c) is centred at
 * easting = origin + (c + 0.5)·cell, northing = top − (r + 0.5)·cell, and the
 * mesh puts vertex c at x = c·cell − (width−1)·cell/2, so the scene origin is
 * the raster centre.
 */
export function createLocalProjection(manifest: AoiManifest) {
  const { width, height, cellSizeM } = manifest.terrain;
  const gridWidthM = (width - 1) * cellSizeM;
  const gridHeightM = (height - 1) * cellSizeM;
  const rasterWidthM = width * cellSizeM;
  const rasterHeightM = height * cellSizeM;
  const zone = utmZoneNumber(manifest.utmZone);

  function toLocal(easting: number, northing: number): [x: number, z: number] {
    const eRel = easting - manifest.originEasting;
    const nRel = northing - manifest.originNorthing;
    const x = eRel - rasterWidthM / 2;
    const z = -(nRel - rasterHeightM / 2);
    return [x, z];
  }

  function toUtm(x: number, z: number): [easting: number, northing: number] {
    return [
      x + rasterWidthM / 2 + manifest.originEasting,
      -z + rasterHeightM / 2 + manifest.originNorthing,
    ];
  }

  /** WGS84 lon/lat -> scene metres, via a true UTM projection. */
  function lonLatToLocal(lon: number, lat: number): [x: number, z: number] {
    const [e, n] = wgs84ToUtm(lon, lat, zone);
    return toLocal(e, n);
  }

  /** Scene metres -> WGS84 lon/lat. */
  function localToLonLat(x: number, z: number): [lon: number, lat: number] {
    const [e, n] = toUtm(x, z);
    return utmToWgs84(e, n, zone);
  }

  /** True when a scene point falls inside the heightfield's footprint. */
  function insideGrid(x: number, z: number): boolean {
    return Math.abs(x) <= rasterWidthM / 2 && Math.abs(z) <= rasterHeightM / 2;
  }

  return {
    toLocal,
    toUtm,
    lonLatToLocal,
    localToLonLat,
    insideGrid,
    gridWidthM,
    gridHeightM,
    rasterWidthM,
    rasterHeightM,
  };
}

export type LocalProjection = ReturnType<typeof createLocalProjection>;
