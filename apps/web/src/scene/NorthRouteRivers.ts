import * as THREE from "three";
import type { AoiManifest, NorthRouteTopology } from "@siahra/shared-types";
import { nodeColor, segmentFlow, type NodeReading } from "../lib/northRoute";
import {
  clipPolylineToBbox,
  densify,
  flowSpeedMPerS,
  reachKmScale,
  routeSpanAt,
  type ReachStop,
  type RouteSpan,
} from "../lib/routeRibbon";
import { createLocalProjection } from "./localProjection";

/**
 * เส้นทางน้ำเหนือบนแผนที่ 3 มิติ (E16 B-1) — เส้นลำน้ำจาก `north-route.json` (OSM, ETL) เฉพาะ
 * ส่วนที่อยู่ **ในขอบเขตจังหวัด** วาดเป็นริบบิ้นเกาะภูมิประเทศ ลอยเหนือผิวน้ำเล็กน้อย
 * (ตัดสองชั้น: กรอบ lon/lat ก่อน แล้วต่อจุดด้วยมาสก์จังหวัด `terrain.insideMask` — มาสก์ชุดเดียวกับ
 * ที่ overlay ของภูมิประเทศใช้หรี่จังหวัดข้างเคียง; ไม่มีมาสก์ = ตัดที่กรอบอย่างเดียว)
 *
 * - สีต่อจุด = `nodeColor` ของสถานีบนเส้นทางที่ใกล้ที่สุดตามลำน้ำ (ตรรกะเดียวกับโหนดในแผง)
 * - ลายไหลเคลื่อนไปทางท้ายน้ำใน shader ด้วย `uTime` ตัวเดียวกับภูมิประเทศ ความเร็วต่อช่วงจาก
 *   `segmentFlow` + `flowDurationS` ของแผง (สัญลักษณ์ของ % ความจุลำน้ำที่วัดได้ ไม่ใช่ความเร็วน้ำ)
 *   ช่วงที่ไม่มีค่า → นิ่งและจาง; นอกหน้าต่าง 48 ชม. ทุกสถานีเป็น missing → นิ่งทั้งเส้น
 * - geometry สร้างครั้งเดียวต่อจังหวัด; `setReadings` เขียนทับ attribute สี/ความเร็ว/จาง
 *   เมื่อค่าตรวจวัดหรือเวลาเปลี่ยนเท่านั้น — ไม่มีลูป JS ต่อเฟรม
 */
export interface NorthRouteRiversResult {
  group: THREE.Group;
  /** จำนวน vertex ของริบบิ้น (ตัวนับดีบัก) */
  vertexCount: number;
  /** reach ที่มีส่วนในจังหวัดนี้ */
  reachIds: string[];
  setReadings: (readings: ReadonlyMap<string, NodeReading>) => { animated: number; still: number };
  dispose: () => void;
}

const VERT = /* glsl */ `
attribute float aDist;
attribute float aSide;
attribute vec3 aColor;
attribute float aSpeed;
attribute float aDim;
varying float vDist;
varying float vSide;
varying vec3 vColor;
varying float vSpeed;
varying float vDim;
void main() {
  vDist = aDist;
  vSide = aSide;
  vColor = aColor;
  vSpeed = aSpeed;
  vDim = aDim;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uPeriod;
varying float vDist;
varying float vSide;
varying vec3 vColor;
varying float vSpeed;
varying float vDim;
void main() {
  // ลายเคลื่อนไปทาง vDist ที่มากขึ้น = ทิศท้ายน้ำ (เส้นเรียงจากต้นน้ำ)
  float phase = fract((vDist - uTime * vSpeed) / uPeriod);
  float stripe = smoothstep(0.0, 0.12, phase) * (1.0 - smoothstep(0.42, 0.58, phase));
  float moving = step(0.0001, vSpeed);
  vec3 col = vColor * mix(0.78, 1.0, moving * stripe) + vec3(0.45) * moving * stripe;
  float edge = 1.0 - smoothstep(0.7, 1.0, abs(vSide));
  // จาง = ทึบน้อยลง + มืดลงเล็กน้อย แต่ยังอ่านสีได้บนผิวน้ำสีน้ำเงิน (ไม่ใช่หายไป)
  float alpha = mix(0.95, 0.72, vDim) * (0.6 + 0.4 * edge);
  col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), vDim * 0.2) * mix(1.0, 0.8, vDim);
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;

/** ริบบิ้นลอยเหนือความสูงที่ sample ได้เท่านี้ (ม.) + polygonOffset กัน z-fight กับผิวน้ำ OSM */
const LIFT_M = 10;

function hexToRgb(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

export function buildNorthRouteRivers(
  manifest: AoiManifest,
  topology: NorthRouteTopology,
  /** มาสก์จังหวัดบนกริด overview (แถว 0 = เหนือ, 1 = ในจังหวัด) — null = ไม่มีขอบเขต */
  insideMask: Uint8Array | null,
  sampleGround: (x: number, z: number) => number,
  uTime: { value: number },
): NorthRouteRiversResult | null {
  const proj = createLocalProjection(manifest);
  const extent = Math.max(proj.gridWidthM, proj.gridHeightM);
  const widthM = Math.min(520, Math.max(120, extent / 260));
  const periodM = widthM * 10;
  const stepM = Math.max(manifest.terrain.cellSizeM * 2, 60);
  const { width: gw, height: gh, cellSizeM } = manifest.terrain;
  /** จุดอยู่ในจังหวัดตามมาสก์ (เซลล์ใกล้ที่สุด — vertex c อยู่ที่ x = c·cell − W/2) */
  const insideProvince = (x: number, z: number): boolean => {
    if (!insideMask) return true;
    const c = Math.round((x + proj.gridWidthM / 2) / cellSizeM);
    const r = Math.round((z + proj.gridHeightM / 2) / cellSizeM);
    if (c < 0 || c >= gw || r < 0 || r >= gh) return false;
    return insideMask[r * gw + c] === 1;
  };

  const positions: number[] = [];
  const dist: number[] = [];
  const side: number[] = [];
  const indices: number[] = [];
  /** ต่อ vertex: สถานีที่คุมจุดนั้น — ใช้ตอน `setReadings` */
  const spans: RouteSpan[] = [];
  const reachIds: string[] = [];

  for (const reach of topology.reaches) {
    const runs = clipPolylineToBbox(reach.polyline, manifest.bbox);
    if (runs.length === 0) continue;
    const scale = reachKmScale(reach.polyline, reach.lengthKm);
    const stops: ReachStop[] = topology.stations
      .filter((s) => s.reachId === reach.id)
      .map((s) => ({ ridCode: s.ridCode, chainageKm: s.chainageKm }))
      .sort((a, b) => a.chainageKm - b.chainageKm);
    let used = false;
    for (const run of runs) {
      const xz = run.points.map(([lon, lat]) => proj.lonLatToLocal(lon, lat));
      const d = densify(xz, run.km.map((k) => k * scale), stepM);
      // ตัดจุดนอกตารางความสูง (กรอบ lon/lat กว้างกว่ากริด UTM ตรงมุม) และนอกขอบเขตจังหวัด —
      // แบ่งเป็นช่วงย่อย (ลำน้ำที่ไหลออกแล้วกลับเข้าจังหวัดได้สองช่วง ไม่ใช่เส้นลากข้ามจังหวัดข้างเคียง)
      let strip: { x: number; z: number; km: number }[] = [];
      const flush = () => {
        if (strip.length >= 2) {
          emitStrip(strip);
          used = true;
        }
        strip = [];
      };
      const emitStrip = (pts: { x: number; z: number; km: number }[]) => {
        const base = positions.length / 3;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const prev = pts[Math.max(0, i - 1)];
          const next = pts[Math.min(pts.length - 1, i + 1)];
          let tx = next.x - prev.x;
          let tz = next.z - prev.z;
          const len = Math.hypot(tx, tz) || 1;
          tx /= len;
          tz /= len;
          // ตั้งฉากในระนาบ xz
          const nx = -tz * (widthM / 2);
          const nz = tx * (widthM / 2);
          const y = sampleGround(p.x, p.z) + LIFT_M;
          const span = routeSpanAt(p.km, stops);
          positions.push(p.x + nx, y, p.z + nz, p.x - nx, y, p.z - nz);
          dist.push(p.km * 1000, p.km * 1000);
          side.push(1, -1);
          spans.push(span, span);
          if (i > 0) {
            const a = base + (i - 1) * 2;
            const b = a + 1;
            const c2 = a + 2;
            const d2 = a + 3;
            indices.push(a, b, c2, b, d2, c2);
          }
        }
      };
      for (let i = 0; i < d.xz.length; i++) {
        const [x, z] = d.xz[i];
        if (!proj.insideGrid(x, z) || !insideProvince(x, z)) {
          flush();
          continue;
        }
        strip.push({ x, z, km: d.km[i] });
      }
      flush();
    }
    if (used) reachIds.push(reach.id);
  }
  if (positions.length === 0) return null;

  const vCount = positions.length / 3;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aDist", new THREE.Float32BufferAttribute(dist, 1));
  geometry.setAttribute("aSide", new THREE.Float32BufferAttribute(side, 1));
  const colorAttr = new THREE.Float32BufferAttribute(new Float32Array(vCount * 3), 3);
  const speedAttr = new THREE.Float32BufferAttribute(new Float32Array(vCount), 1);
  const dimAttr = new THREE.Float32BufferAttribute(new Float32Array(vCount).fill(1), 1);
  geometry.setAttribute("aColor", colorAttr);
  geometry.setAttribute("aSpeed", speedAttr);
  geometry.setAttribute("aDim", dimAttr);
  geometry.setIndex(vCount > 65535 ? new THREE.Uint32BufferAttribute(indices, 1) : new THREE.Uint16BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();

  const material = new THREE.ShaderMaterial({
    uniforms: { uTime, uPeriod: { value: periodM } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "north-route:ribbon";
  mesh.renderOrder = 9;
  const group = new THREE.Group();
  group.name = "north-route";
  group.add(mesh);

  const grey = hexToRgb("#64748b");
  return {
    group,
    vertexCount: vCount,
    reachIds,
    setReadings: (readings) => {
      const col = colorAttr.array as Float32Array;
      const spd = speedAttr.array as Float32Array;
      const dim = dimAttr.array as Float32Array;
      // ช่วงเดียวกันใช้ค่าเดียวกัน — แคชต่อคู่สถานีกันคิดซ้ำทุก vertex
      const flowCache = new Map<string, ReturnType<typeof segmentFlow>>();
      const colorCache = new Map<string, [number, number, number]>();
      let animated = 0;
      let still = 0;
      for (let i = 0; i < spans.length; i++) {
        const s = spans[i];
        let rgb = grey;
        if (s.nearestCode) {
          const hit = colorCache.get(s.nearestCode);
          if (hit) rgb = hit;
          else {
            const r = readings.get(s.nearestCode);
            rgb = r ? hexToRgb(nodeColor(r)) : grey;
            colorCache.set(s.nearestCode, rgb);
          }
        }
        const key = `${s.upstreamCode ?? "head"}>${s.downstreamCode ?? "mouth"}`;
        let flow = flowCache.get(key);
        if (flow === undefined) {
          flow = segmentFlow(s, readings);
          flowCache.set(key, flow);
        }
        col[i * 3] = rgb[0];
        col[i * 3 + 1] = rgb[1];
        col[i * 3 + 2] = rgb[2];
        spd[i] = flow ? flowSpeedMPerS(flow.durationS, periodM) : 0;
        dim[i] = !flow || flow.stale ? 1 : 0;
        if (spd[i] > 0) animated++;
        else still++;
      }
      colorAttr.needsUpdate = true;
      speedAttr.needsUpdate = true;
      dimAttr.needsUpdate = true;
      return { animated, still };
    },
    dispose: () => {
      group.parent?.remove(group);
      geometry.dispose();
      material.dispose();
    },
  };
}
