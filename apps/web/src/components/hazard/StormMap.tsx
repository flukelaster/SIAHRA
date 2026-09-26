import { useEffect, useMemo, useState } from "react";
import type { StormTrack } from "@siahra/shared-types";
import { aoiIdForProvince } from "../../data/types";
import type { Lang, TFunction } from "../../i18n";
import { extractRings, type BoundaryGeoJson } from "../../scene/boundaryMask";
import { formatDateTime } from "../../lib/time";
import {
  beyondBasemap,
  createProjection,
  fitBounds,
  geometryRings,
  placeLabels,
  polylinePath,
  ringsBounds,
  ringsPath,
  stormColor,
  stormContentBounds,
  type LabelBox,
} from "../../lib/stormMap";
import { isPastValidTime } from "../../lib/storms";

const WIDTH = 320;
const FONT = 8;
/** ความกว้างโดยประมาณต่ออักขระที่ขนาด 8 px — พอสำหรับเลี่ยงป้ายชนกัน ไม่ต้องวัดจริง */
const CHAR_W = 4.4;

interface OutlineFeature {
  properties: { iso: string; name: string; thailand: boolean };
  geometry: { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };
}
interface RegionOutlineJson {
  features: OutlineFeature[];
}

// แผนที่ฐานเป็นไฟล์คงที่ไฟล์เดียว (`public/geo/region-outline.json`, สคริปต์ ETL
// `build-region-outline.ts`) — โหลดครั้งเดียวต่อหน้า แม้แผงจะถูกเปิด-ปิดซ้ำ
let outlinePromise: Promise<RegionOutlineJson> | null = null;
function loadOutline(): Promise<RegionOutlineJson> {
  if (!outlinePromise) {
    outlinePromise = fetch("/geo/region-outline.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<RegionOutlineJson>;
      })
      .catch((err: unknown) => {
        outlinePromise = null; // ลองใหม่ได้ครั้งหน้าที่เปิดแผง
        throw err;
      });
  }
  return outlinePromise;
}

/**
 * ขอบจังหวัดที่เลือก — **ไฟล์เดียวกับที่ฉาก 3 มิติโหลด** (`/aoi/{code}/boundary.geojson`
 * ผ่าน `scene/boundaryMask.ts`) ฉากไม่ได้ส่ง ring ออกมา (และงานนี้ไม่แตะฉาก) จึงขอ URL
 * เดิมซ้ำ ซึ่งปกติเบราว์เซอร์ตอบจาก HTTP cache ขอเฉพาะตอนแผงพายุเปิดอยู่ (ทะเบียนแผง
 * mount เฉพาะแผงที่เปิด) — โหลดไม่ได้ก็แค่ไม่วาดขอบจังหวัด แผงบอกไว้ ไม่เดาตำแหน่ง
 */
function useProvinceRings(provinceCode: string): { rings: number[][][] | null; failed: boolean } {
  const [state, setState] = useState<{ code: string; rings: number[][][] | null; failed: boolean }>({
    code: provinceCode,
    rings: null,
    failed: false,
  });
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/aoi/${aoiIdForProvince(provinceCode)}/boundary.geojson`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<BoundaryGeoJson>;
      })
      .then((json) => {
        const rings = extractRings(json);
        setState({ code: provinceCode, rings: rings.length > 0 ? rings : null, failed: rings.length === 0 });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ code: provinceCode, rings: null, failed: true });
      });
    return () => controller.abort();
  }, [provinceCode]);
  // ขอบของจังหวัดก่อนหน้าห้ามค้างอยู่ใต้ชื่อจังหวัดใหม่แม้เฟรมเดียว
  return state.code === provinceCode ? state : { rings: null, failed: false };
}

export interface StormMapProps {
  storms: readonly StormTrack[];
  provinceCode: string;
  provinceName: string;
  nowMs: number;
  lang: Lang;
  t: TFunction;
  /** แจ้งแผงว่าเนื้อหาเลยขอบแผนที่ฐาน / โหลดแผนที่ฐานหรือขอบจังหวัดไม่ได้ */
  onNotes?: (notes: { beyondBasemap: boolean; outlineFailed: boolean; provinceFailed: boolean }) => void;
}

/**
 * แผนที่ภูมิภาค 2 มิติของแผงพายุ (SVG ล้วน ไม่มี dependency ใหม่) — เส้นขอบประเทศ
 * (Natural Earth) ไทยเน้น ขอบจังหวัดที่เลือก เส้นทางที่ผ่านมา (เส้นทึบ) เส้นทางพยากรณ์
 * (เส้นประ + ลำดับ/เวลาใช้ได้ของทุกจุด) วงกลม 70 % ของ JMA (โปร่ง) และกรวยของ GDACS
 */
export function StormMap({ storms, provinceCode, provinceName, nowMs, lang, t, onNotes }: StormMapProps) {
  const [outline, setOutline] = useState<RegionOutlineJson | null>(null);
  const [outlineFailed, setOutlineFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    loadOutline()
      .then((o) => !cancelled && setOutline(o))
      .catch(() => !cancelled && setOutlineFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);
  const province = useProvinceRings(provinceCode);

  const content = useMemo(() => stormContentBounds(storms), [storms]);
  const view = useMemo(() => fitBounds(content), [content]);
  const proj = useMemo(() => createProjection(view, WIDTH), [view]);
  const beyond = beyondBasemap(content);

  useEffect(() => {
    onNotes?.({ beyondBasemap: beyond, outlineFailed, provinceFailed: province.failed });
  }, [onNotes, beyond, outlineFailed, province.failed]);

  const H = proj.height;

  // เส้นกริดทุก 10° — ตำแหน่งอ้างอิงเมื่อแผนที่ฐานโหลดไม่ได้หรือเนื้อหาเลยขอบของมัน
  const grid = useMemo(() => {
    const lons: number[] = [];
    const lats: number[] = [];
    for (let x = Math.ceil(view.minLon / 10) * 10; x <= view.maxLon; x += 10) lons.push(x);
    for (let y = Math.ceil(view.minLat / 10) * 10; y <= view.maxLat; y += 10) lats.push(y);
    return { lons, lats };
  }, [view]);

  // จุดบนแผนที่เป็นสิ่งกีดขวางของป้าย (ป้ายห้ามทับจุดของพายุลูกอื่นหรือจุดพยากรณ์ถัดไป)
  const obstacles: LabelBox[] = storms.flatMap((s) =>
    [...s.past.slice(-1), ...s.forecast].map((p) => {
      const c = proj.project(p.lon, p.lat);
      return { x: c.x - 3, y: c.y - 3, w: 6, h: 6 };
    }),
  );
  // ชื่อพายุที่จุดล่าสุดวางก่อน (ตัวใหญ่กว่า) แล้วป้ายเวลาของจุดพยากรณ์หลบทั้งจุดและชื่อ
  const nameAnchors = storms.flatMap((s, si) => {
    const last = s.past[s.past.length - 1] ?? null;
    if (!last) return [];
    const c = proj.project(last.lon, last.lat);
    const text = s.name ?? t("storm.unnamed");
    const w = text.length * (CHAR_W + 1);
    return [{ si, text, x: c.x, y: c.y, fullWidth: w, shortWidth: w }];
  });
  const names = placeLabels(nameAnchors, { width: WIDTH, height: H }, 11, obstacles);
  const anchors = storms.flatMap((s, si) =>
    s.forecast.map((f, fi) => {
      const p = proj.project(f.lon, f.lat);
      const full = `${fi + 1} ${formatDateTime(lang, f.validAt)}`;
      return {
        si,
        fi,
        x: p.x,
        y: p.y,
        full,
        fullWidth: full.length * CHAR_W,
        shortWidth: String(fi + 1).length * CHAR_W + 2,
      };
    }),
  );
  const labels = placeLabels(anchors, { width: WIDTH, height: H }, 10, [...obstacles, ...names.map((n) => n.box)]);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${H.toFixed(1)}`}
      className="w-full rounded-lg"
      role="img"
      aria-label={t("storm.map.aria", { province: provinceName })}
    >
      <rect x={0} y={0} width={WIDTH} height={H} fill="#0a1422" />
      {grid.lons.map((lon) => {
        const { x } = proj.project(lon, view.minLat);
        return (
          <g key={`lon${lon}`}>
            <line x1={x} x2={x} y1={0} y2={H} stroke="#ffffff" strokeOpacity={0.06} />
            <text x={x + 2} y={H - 3} fontSize={7} fill="#64748b">
              {lon}°E
            </text>
          </g>
        );
      })}
      {grid.lats.map((lat) => {
        const { y } = proj.project(view.minLon, lat);
        return (
          <g key={`lat${lat}`}>
            <line x1={0} x2={WIDTH} y1={y} y2={y} stroke="#ffffff" strokeOpacity={0.06} />
            <text x={2} y={y - 2} fontSize={7} fill="#64748b">
              {lat < 0 ? `${-lat}°S` : `${lat}°N`}
            </text>
          </g>
        );
      })}

      {outline?.features.map((f) => (
        <path
          key={f.properties.iso}
          d={ringsPath(geometryRings(f.geometry), proj)}
          fillRule="evenodd"
          fill={f.properties.thailand ? "#334155" : "#1c2636"}
          stroke={f.properties.thailand ? "#cbd5e1" : "#3b4a60"}
          strokeWidth={f.properties.thailand ? 0.9 : 0.5}
        />
      ))}

      {province.rings ? (
        <ProvinceMark rings={province.rings} proj={proj} />
      ) : null}

      {storms.map((s, si) => {
        const color = stormColor(si);
        const cone = geometryRings(s.gdacsCone);
        const last = s.past[s.past.length - 1] ?? null;
        const fcLine = [...(last ? [last] : []), ...s.forecast];
        return (
          <g key={s.id}>
            {cone.length > 0 ? (
              <path
                d={ringsPath(cone, proj)}
                fillRule="evenodd"
                fill={color}
                fillOpacity={0.14}
                stroke={color}
                strokeOpacity={0.6}
                strokeWidth={0.7}
                strokeDasharray="2 2"
              />
            ) : null}
            {s.forecast.map((f, fi) => {
              if (!f.circleRadiusKm || f.circleRadiusKm <= 0) return null;
              const c = proj.project(f.lon, f.lat);
              const r = proj.radiusPx(f.circleRadiusKm, f.lat);
              return (
                <ellipse
                  key={`c${fi}`}
                  cx={c.x}
                  cy={c.y}
                  rx={r.rx}
                  ry={r.ry}
                  fill={color}
                  fillOpacity={0.08}
                  stroke={color}
                  strokeOpacity={0.45}
                  strokeWidth={0.6}
                />
              );
            })}
            <path d={polylinePath(s.past, proj)} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
            {s.past.map((p, pi) => {
              const c = proj.project(p.lon, p.lat);
              return <circle key={`p${pi}`} cx={c.x} cy={c.y} r={1.1} fill={color} />;
            })}
            <path
              d={polylinePath(fcLine, proj)}
              fill="none"
              stroke={color}
              strokeWidth={1.3}
              strokeDasharray="4 3"
              strokeLinejoin="round"
            />
            {s.forecast.map((f, fi) => {
              const c = proj.project(f.lon, f.lat);
              const passed = isPastValidTime(f.validAt, nowMs);
              return (
                <circle
                  key={`f${fi}`}
                  cx={c.x}
                  cy={c.y}
                  r={2.3}
                  fill="#0a1422"
                  stroke={passed ? "#94a3b8" : color}
                  strokeWidth={1.1}
                />
              );
            })}
            {last ? (
              <circle
                cx={proj.project(last.lon, last.lat).x}
                cy={proj.project(last.lon, last.lat).y}
                r={3.6}
                fill={color}
                stroke="#0a1422"
                strokeWidth={1}
              />
            ) : null}
          </g>
        );
      })}

      {labels.map((l) => {
        const a = anchors[l.index];
        return (
          <g key={`l${a.si}-${a.fi}`}>
            {l.leader ? <Leader from={a} box={l.box} /> : null}
            <text
              x={l.x}
              y={l.y}
              fontSize={FONT}
              textAnchor={l.anchor}
              fill="#e2e8f0"
              stroke="#0a1422"
              strokeWidth={2.2}
              paintOrder="stroke"
            >
              {l.full ? a.full : String(a.fi + 1)}
            </text>
          </g>
        );
      })}
      {names.map((l) => {
        const a = nameAnchors[l.index];
        return (
          <g key={`n${a.si}`}>
            {l.leader ? <Leader from={a} box={l.box} /> : null}
            <text
              x={l.x}
              y={l.y}
              fontSize={9}
              fontWeight={600}
              textAnchor={l.anchor}
              fill={stormColor(a.si)}
              stroke="#0a1422"
              strokeWidth={2.4}
              paintOrder="stroke"
            >
              {a.text}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** เส้นนำจากจุดไปยังขอบที่ใกล้ที่สุดของกล่องป้ายที่ถูกย้ายออกไป */
function Leader({ from, box }: { from: { x: number; y: number }; box: LabelBox }) {
  const x = Math.min(Math.max(from.x, box.x), box.x + box.w);
  const y = Math.min(Math.max(from.y, box.y), box.y + box.h);
  return <line x1={from.x} y1={from.y} x2={x} y2={y} stroke="#94a3b8" strokeOpacity={0.7} strokeWidth={0.5} />;
}

/** ขอบจังหวัด + จุดกลางกรอบ — ที่ย่อทั้งภูมิภาค จังหวัดเล็กกว่าพิกเซลเดียว จุดจึงจำเป็น */
function ProvinceMark({ rings, proj }: { rings: number[][][]; proj: ReturnType<typeof createProjection> }) {
  const b = ringsBounds(rings);
  if (!b) return null;
  const c = proj.project((b.minLon + b.maxLon) / 2, (b.minLat + b.maxLat) / 2);
  return (
    <g>
      <path d={ringsPath(rings, proj)} fill="#fbbf24" fillOpacity={0.35} stroke="#fbbf24" strokeWidth={0.8} />
      <circle cx={c.x} cy={c.y} r={3} fill="none" stroke="#fbbf24" strokeWidth={1.2} />
    </g>
  );
}
