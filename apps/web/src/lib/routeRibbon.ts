/**
 * เรขาคณิตล้วนของเส้นลำน้ำเส้นทางน้ำเหนือบนแผนที่ 3 มิติ (`scene/NorthRouteRivers.ts`,
 * E16 B-1) — ตัดเส้นให้เหลือเฉพาะส่วนในกรอบจังหวัด, นับระยะตามลำน้ำ และหาสถานีที่คุมแต่ละจุด
 *
 * ระยะตามลำน้ำ (กม.) นับจากจุดแรกของ `polyline` (ต้นน้ำ) ด้วยระยะวงกลมใหญ่ — แบบเดียวกับที่
 * `build-north-route.ts` ใช้ตอนฉายสถานีลงเส้น (`chainageKm`) บนเส้นที่ลดรูปแล้วชุดเดียวกัน
 * ส่วนต่างที่เหลือ (ถ้ามี) ถูกปรับด้วยสัดส่วน `lengthKm / ความยาวที่นับได้` ใน `reachKmScale`
 */

export type LonLat = [number, number];

export interface Bbox {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

const EARTH_R_KM = 6371.0088;

export function haversineKm(a: LonLat, b: LonLat): number {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** ระยะสะสม (กม.) ของทุกจุดบนเส้น — จุดแรก = 0 */
export function cumulativeKm(polyline: readonly LonLat[]): number[] {
  const out = new Array<number>(polyline.length);
  let acc = 0;
  for (let i = 0; i < polyline.length; i++) {
    if (i > 0) acc += haversineKm(polyline[i - 1], polyline[i]);
    out[i] = acc;
  }
  return out;
}

/** ช่วงต่อเนื่องหนึ่งของเส้นที่อยู่ในกรอบ — `km[i]` = ระยะตามลำน้ำของ `points[i]` จากต้นเส้นเดิม */
export interface ClippedRun {
  points: LonLat[];
  km: number[];
}

/**
 * ตัดเส้นด้วยกรอบ lon/lat (Liang–Barsky ต่อช่วง) — คืนช่วงต่อเนื่องที่อยู่ในกรอบ เรียงจากต้นน้ำ
 * ไปท้ายน้ำ จุดตัดขอบถูกแทรกพร้อมระยะที่ประมาณเชิงเส้นในช่วงนั้น เส้นที่ออกนอกกรอบแล้ววกกลับ
 * เข้ามาได้หลายช่วง; ช่วงที่เหลือจุดเดียว (แตะมุมกรอบ) ถูกทิ้ง
 */
export function clipPolylineToBbox(polyline: readonly LonLat[], bbox: Bbox): ClippedRun[] {
  const km = cumulativeKm(polyline);
  const runs: ClippedRun[] = [];
  let cur: ClippedRun | null = null;
  const push = (p: LonLat, k: number) => {
    if (!cur) {
      cur = { points: [], km: [] };
      runs.push(cur);
    }
    const last = cur.points[cur.points.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) return;
    cur.points.push(p);
    cur.km.push(k);
  };
  for (let i = 0; i + 1 < polyline.length; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    let t0 = 0;
    let t1 = 1;
    let visible = true;
    const edges: [number, number][] = [
      [-dx, a[0] - bbox.minLon],
      [dx, bbox.maxLon - a[0]],
      [-dy, a[1] - bbox.minLat],
      [dy, bbox.maxLat - a[1]],
    ];
    for (const [p, q] of edges) {
      if (p === 0) {
        if (q < 0) {
          visible = false;
          break;
        }
        continue;
      }
      const r = q / p;
      if (p < 0) {
        if (r > t1) {
          visible = false;
          break;
        }
        if (r > t0) t0 = r;
      } else {
        if (r < t0) {
          visible = false;
          break;
        }
        if (r < t1) t1 = r;
      }
    }
    if (!visible) {
      cur = null;
      continue;
    }
    const segKm = km[i + 1] - km[i];
    const at = (t: number): LonLat => [a[0] + dx * t, a[1] + dy * t];
    // ช่วงก่อนหน้าถูกตัดออกที่ปลาย (t1 < 1 รอบที่แล้ว) หรือช่วงนี้เริ่มกลางทาง = เริ่มช่วงใหม่
    if (t0 > 0) cur = null;
    push(at(t0), km[i] + segKm * t0);
    push(at(t1), km[i] + segKm * t1);
    if (t1 < 1) cur = null;
  }
  return runs.filter((r) => r.points.length >= 2);
}

export interface ReachStop {
  ridCode: string;
  chainageKm: number;
}

/** สถานีที่คุมจุดหนึ่งบนลำน้ำ — ตรรกะช่วงเดียวกับ `SchematicSegment` ของผังในแผง */
export interface RouteSpan {
  /** สถานีที่ใกล้ที่สุดตามลำน้ำ (ใช้ระบายสี แบบ `nodeColor`) — null = reach นี้ไม่มีสถานี */
  nearestCode: string | null;
  /** สถานีแรกท้ายน้ำของจุดนี้ — null = จุดนี้อยู่เลยสถานีสุดท้ายไปแล้ว (ถึงปาก/ปลายเส้น) */
  downstreamCode: string | null;
  /** สถานีสุดท้ายต้นน้ำของจุดนี้ — null = จุดนี้อยู่ก่อนสถานีแรก (หัวเส้น/จุดบรรจบ) */
  upstreamCode: string | null;
}

/** `stops` ต้องเรียงตาม chainage จากน้อยไปมาก */
export function routeSpanAt(km: number, stops: readonly ReachStop[]): RouteSpan {
  if (stops.length === 0) return { nearestCode: null, downstreamCode: null, upstreamCode: null };
  let down = -1;
  for (let i = 0; i < stops.length; i++) {
    if (stops[i].chainageKm >= km) {
      down = i;
      break;
    }
  }
  const up = down === -1 ? stops.length - 1 : down - 1;
  let nearest = stops[0];
  for (const s of stops) if (Math.abs(s.chainageKm - km) < Math.abs(nearest.chainageKm - km)) nearest = s;
  return {
    nearestCode: nearest.ridCode,
    downstreamCode: down === -1 ? null : stops[down].ridCode,
    upstreamCode: up < 0 ? null : stops[up].ridCode,
  };
}

/** สัดส่วนแปลงระยะที่นับได้ → `lengthKm` ของ ETL (ป้องกันสถานีเลื่อนตำแหน่งจากการปัดเศษ) */
export function reachKmScale(polyline: readonly LonLat[], lengthKm: number): number {
  const km = cumulativeKm(polyline);
  const total = km[km.length - 1] ?? 0;
  return total > 0 && lengthKm > 0 ? lengthKm / total : 1;
}

/**
 * แทรกจุดให้ช่วงห่างไม่เกิน `maxStepM` (เมตร ในพิกัดฉาก) — เส้นที่ลดรูปราว 200 ม. จะได้เกาะ
 * ภูมิประเทศตามตารางความสูงแทนการพาดข้ามเนิน ระยะ `km` ถูกแทรกเชิงเส้นตามไปด้วย
 */
export function densify(
  xz: readonly [number, number][],
  km: readonly number[],
  maxStepM: number,
): { xz: [number, number][]; km: number[] } {
  const outXz: [number, number][] = [];
  const outKm: number[] = [];
  for (let i = 0; i < xz.length; i++) {
    if (i > 0) {
      const [x0, z0] = xz[i - 1];
      const [x1, z1] = xz[i];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / Math.max(1, maxStepM)));
      for (let k = 1; k < n; k++) {
        const t = k / n;
        outXz.push([x0 + (x1 - x0) * t, z0 + (z1 - z0) * t]);
        outKm.push(km[i - 1] + (km[i] - km[i - 1]) * t);
      }
    }
    outXz.push([xz[i][0], xz[i][1]]);
    outKm.push(km[i]);
  }
  return { xz: outXz, km: outKm };
}

/**
 * ความเร็วของลายไหลบนแผนที่ (ม./วินาที ของฉาก) — ใช้ `flowDurationS` ตัวเดียวกับเส้นประในแผง:
 * ลายหนึ่งรอบ (`periodM`) เคลื่อนครบในเวลาที่แผงใช้เลื่อนเส้นประหนึ่งรอบ เป็นสัญลักษณ์ของ
 * % ความจุลำน้ำที่วัดได้ ไม่ใช่ความเร็วกระแสน้ำ — null / ≤ 0 = ไม่เคลื่อน
 */
export function flowSpeedMPerS(durationS: number | null, periodM: number): number {
  if (durationS === null || !Number.isFinite(durationS) || durationS <= 0) return 0;
  return periodM / durationS;
}
