import type { DamObservation, ObservationsResponse } from "@siahra/shared-types";
import type { Lang, TFunction } from "../i18n";
import { damDisplayName } from "./damName";

/** Something the search box can jump to besides a province. */
export interface SearchPlace {
  key: string;
  label: string;
  sub: string;
  kind: "amphoe" | "station" | "dam";
  lon: number;
  lat: number;
}

export interface SearchIndexInput {
  observations: ObservationsResponse | null;
  dams: DamObservation[];
  /** ชื่อจังหวัดในภาษาที่กำลังแสดง (ใช้เป็นบรรทัดรองเมื่อสถานี/เขื่อนไม่มีอำเภอ/ลุ่มน้ำ) */
  provinceName: string;
  provinceCode: string;
  lang: Lang;
  t: TFunction;
}

/**
 * Search index: amphoe centroids (from station coordinates), stations, dams of this province.
 * ย้ายมาจาก `places` memo ใน App.tsx เพื่อให้เทสได้แบบ pure (ไม่มี React)
 */
export function buildSearchIndex({ observations, dams, provinceName, provinceCode, lang, t }: SearchIndexInput): SearchPlace[] {
  const out: SearchPlace[] = [];
  const data = observations;
  if (data) {
    const byAmphoe = new Map<string, { lon: number; lat: number; n: number }>();
    const seen = new Set<string>();
    for (const st of [...data.waterlevel.map((w) => w.station), ...data.rainfall.map((r) => r.station)]) {
      if (st.amphoeNameTh) {
        const a = byAmphoe.get(st.amphoeNameTh) ?? { lon: 0, lat: 0, n: 0 };
        a.lon += st.lon;
        a.lat += st.lat;
        a.n++;
        byAmphoe.set(st.amphoeNameTh, a);
      }
      // Rain and water-level ids overlap upstream; key on name+coords instead.
      const key = `s:${st.nameTh ?? st.id}:${st.lon.toFixed(4)}:${st.lat.toFixed(4)}`;
      if (st.nameTh && !seen.has(key)) {
        seen.add(key);
        out.push({ key, label: st.nameTh, sub: st.amphoeNameTh ?? provinceName, kind: "station", lon: st.lon, lat: st.lat });
      }
    }
    for (const [name, a] of byAmphoe) {
      out.push({
        key: `a:${name}`,
        label: t(provinceCode === "10" ? "province.prefix.khet" : "province.prefix.amphoe") + name,
        sub: provinceName,
        kind: "amphoe",
        lon: a.lon / a.n,
        lat: a.lat / a.n,
      });
    }
  }
  for (const d of dams) {
    out.push({
      key: `d:${d.id}`,
      label: damDisplayName(d, lang, t),
      sub: d.basinNameTh ?? provinceName,
      kind: "dam",
      lon: d.lon,
      lat: d.lat,
    });
  }
  return out;
}
