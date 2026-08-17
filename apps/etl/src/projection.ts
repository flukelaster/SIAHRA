/**
 * Small, dependency-free geodesy helpers used by every map layer so that
 * imagery, boundary, buildings and station markers all agree on where a
 * lon/lat point lands in the scene.
 *
 * - WGS84 <-> UTM (Transverse Mercator, Krüger series — mm-accurate within a
 *   zone, far below anything the 30 m DEM can resolve).
 * - WGS84 -> Web Mercator tile/pixel space for basemap imagery.
 */

const A = 6378137; // WGS84 semi-major axis (m)
const F = 1 / 298.257223563;
const K0 = 0.9996;
const N = F / (2 - F);
const N2 = N * N;
const N3 = N2 * N;
const N4 = N3 * N;
// Rectifying radius.
const AA = (A / (1 + N)) * (1 + N2 / 4 + N4 / 64);
const ALPHA = [
  N / 2 - (2 / 3) * N2 + (5 / 16) * N3 + (41 / 180) * N4,
  (13 / 48) * N2 - (3 / 5) * N3 + (557 / 1440) * N4,
  (61 / 240) * N3 - (103 / 140) * N4,
  (49561 / 161280) * N4,
];
const BETA = [
  N / 2 - (2 / 3) * N2 + (37 / 96) * N3 - (1 / 360) * N4,
  (1 / 48) * N2 + (1 / 15) * N3 - (437 / 1440) * N4,
  (17 / 480) * N3 - (37 / 840) * N4,
  (4397 / 161280) * N4,
];
const FALSE_EASTING = 500000;
const DEG = Math.PI / 180;

/** UTM zone number from an EPSG code such as "32647" (zone 47 N). */
export function utmZoneNumber(epsg: string): number {
  return Number(epsg.slice(-2));
}

function centralMeridianDeg(zone: number): number {
  return zone * 6 - 183;
}

/** WGS84 lon/lat (degrees) -> UTM easting/northing (m) for a northern zone. */
export function wgs84ToUtm(lon: number, lat: number, zone: number): [number, number] {
  const phi = lat * DEG;
  const lambda = (lon - centralMeridianDeg(zone)) * DEG;
  const sinPhi = Math.sin(phi);
  const t = Math.sinh(
    Math.atanh(sinPhi) - ((2 * Math.sqrt(N)) / (1 + N)) * Math.atanh(((2 * Math.sqrt(N)) / (1 + N)) * sinPhi),
  );
  const xi0 = Math.atan2(t, Math.cos(lambda));
  const eta0 = Math.atanh(Math.sin(lambda) / Math.sqrt(1 + t * t));
  let xi = xi0;
  let eta = eta0;
  for (let j = 1; j <= 4; j++) {
    xi += ALPHA[j - 1] * Math.sin(2 * j * xi0) * Math.cosh(2 * j * eta0);
    eta += ALPHA[j - 1] * Math.cos(2 * j * xi0) * Math.sinh(2 * j * eta0);
  }
  return [FALSE_EASTING + K0 * AA * eta, K0 * AA * xi];
}

/** UTM easting/northing (m, northern zone) -> WGS84 lon/lat (degrees). */
export function utmToWgs84(easting: number, northing: number, zone: number): [number, number] {
  const xi = northing / (K0 * AA);
  const eta = (easting - FALSE_EASTING) / (K0 * AA);
  let xiP = xi;
  let etaP = eta;
  for (let j = 1; j <= 4; j++) {
    xiP -= BETA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaP -= BETA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xiP) / Math.cosh(etaP));
  // Conformal -> geodetic latitude (series in the third flattening n).
  const D1 = 2 * N - (2 / 3) * N2 - 2 * N3;
  const D2 = (7 / 3) * N2 - (8 / 5) * N3;
  const D3 = (56 / 15) * N3;
  const phi = chi + D1 * Math.sin(2 * chi) + D2 * Math.sin(4 * chi) + D3 * Math.sin(6 * chi);
  const lambda = Math.atan2(Math.sinh(etaP), Math.cos(xiP));
  return [centralMeridianDeg(zone) + lambda / DEG, phi / DEG];
}

/* ------------------------------------------------------------------------ */
/* Web Mercator                                                              */
/* ------------------------------------------------------------------------ */

const MAX_LAT = 85.05112878;

/** Lon/lat -> fractional XYZ tile coordinates at `zoom`. */
export function lonLatToTile(lon: number, lat: number, zoom: number): [number, number] {
  const n = 2 ** zoom;
  const clampedLat = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const x = ((lon + 180) / 360) * n;
  const latRad = clampedLat * DEG;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return [x, y];
}

/** Ground resolution (m/px) of a 256 px Web Mercator tile at `zoom`, `lat`. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos(lat * DEG)) / 2 ** zoom;
}
