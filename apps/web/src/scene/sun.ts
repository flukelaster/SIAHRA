/**
 * Solar position (NOAA low-precision algorithm, ~0.01° accuracy) so the
 * scene's sun and sky can follow real time — or the timeline's time.
 */
export interface SunPosition {
  /** Degrees above the horizon (negative = below). */
  elevationDeg: number;
  /** Degrees clockwise from north. */
  azimuthDeg: number;
}

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export function sunPosition(date: Date, latDeg: number, lonDeg: number): SunPosition {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const Mr = M * D2R;
  const C =
    Math.sin(Mr) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * Mr) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * Mr) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * D2R);
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * D2R);
  const decl = Math.asin(Math.sin(eps * D2R) * Math.sin(lambda * D2R));
  const y = Math.tan((eps / 2) * D2R) ** 2;
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const eqTime =
    4 *
    R2D *
    (y * Math.sin(2 * L0 * D2R) -
      2 * e * Math.sin(Mr) +
      4 * e * y * Math.sin(Mr) * Math.cos(2 * L0 * D2R) -
      0.5 * y * y * Math.sin(4 * L0 * D2R) -
      1.25 * e * e * Math.sin(2 * Mr));
  const minutesUtc = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolarMin = (minutesUtc + eqTime + 4 * lonDeg) % 1440;
  const hourAngle = trueSolarMin / 4 < 0 ? trueSolarMin / 4 + 180 : trueSolarMin / 4 - 180;
  const lat = latDeg * D2R;
  const ha = hourAngle * D2R;
  const cosZenith = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZenith)));
  let azimuth =
    Math.acos(
      Math.max(-1, Math.min(1, (Math.sin(lat) * Math.cos(zenith) - Math.sin(decl)) / (Math.cos(lat) * Math.sin(zenith)))),
    ) * R2D;
  if (hourAngle > 0) azimuth = (azimuth + 180) % 360;
  else azimuth = (540 - azimuth) % 360;
  return { elevationDeg: 90 - zenith * R2D, azimuthDeg: azimuth };
}
