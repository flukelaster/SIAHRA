import type { LocalAuthorityImpactResponse } from "@siahra/shared-types";

/**
 * Exports Local Authority Impact assessment into standard GeoJSON for GIS integration.
 */
export function exportIncidentGeoJson(impact: LocalAuthorityImpactResponse): void {
  const geojson = {
    type: "FeatureCollection",
    properties: {
      generatedAt: new Date().toISOString(),
      runId: impact.runId,
      classification: impact.classification,
      severity: impact.severity,
      localAuthorityId: impact.localAuthority.id,
      nameTh: impact.localAuthority.nameTh,
      nameEn: impact.localAuthority.nameEn,
      dlaCode: impact.localAuthority.dlaCode,
      populationExposed: impact.exposure.populationExposed,
      buildingsExposed: impact.exposure.buildingsExposed,
      roadKmExposed: impact.exposure.roadKmExposed,
      economicLossThb: impact.exposure.buildingDamage?.estimatedEconomicLossThb ?? 0,
      livestockExposed: impact.exposure.livestockExposed,
      cropsExposed: impact.exposure.cropsExposed,
    },
    features: [
      {
        type: "Feature",
        id: impact.localAuthority.id,
        geometry: {
          type: "Point",
          coordinates: [impact.localAuthority.centerLon, impact.localAuthority.centerLat],
        },
        properties: {
          name: impact.localAuthority.nameTh,
          severity: impact.severity,
        },
      },
      ...impact.exposure.exposedFacilityList.map((fac) => ({
        type: "Feature",
        id: fac.id,
        geometry: {
          type: "Point",
          coordinates: [fac.lon, fac.lat],
        },
        properties: {
          name: fac.name,
          type: fac.type,
          isExposed: fac.isExposed,
        },
      })),
    ],
  };

  const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: "application/geo+json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `siahra-impact-${impact.localAuthority.dlaCode}-${new Date().toISOString().slice(0, 10)}.geojson`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Exports operational situation report for Local Authority officers in formatted text.
 */
export function exportSituationReport(
  impact: LocalAuthorityImpactResponse,
  lang: "th" | "en",
): void {
  const { localAuthority, exposure, severity, layer } = impact;
  const now = new Date().toLocaleString(lang === "th" ? "th-TH" : "en-US");

  const title =
    lang === "th"
      ? `รายงานสรุปสถานการณ์ผลกระทบอุทกภัย — ${localAuthority.nameTh}`
      : `Operational Flood Impact Situation Brief — ${localAuthority.nameEn}`;

  const content = `# ${title}
**รหัส อปท. (DLA Code):** ${localAuthority.dlaCode}
**ระดับความรุนแรง (Severity):** ${severity.toUpperCase()}
**เวลาที่ออกรายงาน (Generated):** ${now}
**ข้อมูลตรวจวัดโดย (Source):** GISTDA Satellite + WorldPop 100m + OSM (${layer.epistemicClass})

---

## 1. ผลกระทบต่อประชาชนและอาคารบ้านเรือน
- **ประชากรที่ได้รับผลกระทบ:** ${exposure.populationExposed.toLocaleString()} คน (จากประชากรรวม ${exposure.populationTotal.toLocaleString()} คน)
- **อาคารที่อยู่ในพื้นที่น้ำท่วม:** ${exposure.buildingsExposed.toLocaleString()} หลัง (จากอาคารรวม ${exposure.buildingsTotal.toLocaleString()} หลัง)
- **ความยาวถนนที่ได้รับผลกระทบ:** ${exposure.roadKmExposed.toLocaleString()} กม.
- **ประเมินความเสียหายทางเศรษฐกิจ (อาคาร/ทรัพย์สิน):** ${(exposure.buildingDamage?.estimatedEconomicLossThb ?? 0).toLocaleString()} บาท

## 2. สถานพยาบาลและโครงสร้างพื้นฐานวิกฤต
- **โรงพยาบาล/รพ.สต. ในพื้นที่น้ำท่วม:** ${exposure.criticalFacilities.hospitals} แห่ง
- **สถานศึกษา/โรงเรียน ในพื้นที่น้ำท่วม:** ${exposure.criticalFacilities.schools} แห่ง
- **หน่วยบริการฉุกเฉิน/กู้ภัย:** ${exposure.criticalFacilities.emergencyStations} แห่ง

## 3. ภาคการเกษตรและปศุสัตว์
- **พื้นที่การเกษตรที่ถูกน้ำท่วม:** ${exposure.agriculturalHaExposed.toLocaleString()} เฮกตาร์ (~${Math.round(exposure.agriculturalHaExposed * 6.25)} ไร่)
- **โค/กระบือ ในพื้นที่กระทบ:** ${(exposure.livestockExposed?.cattle ?? 0) + (exposure.livestockExposed?.buffalo ?? 0)} ตัว
- **สุกร/สัตว์ปีก ในพื้นที่กระทบ:** ${(exposure.livestockExposed?.pigs ?? 0) + (exposure.livestockExposed?.poultry ?? 0)} ตัว

## 4. ข้อแนะนำการปฏิบัติการฉุกเฉิน (Action Checklist)
1. จัดตั้งศูนย์บัญชาการเหตุการณ์ท้องถิ่น (EOC) ตามระดับความรุนแรง
2. เตรียมศูนย์พักพิงชั่วคราวและระบบสำรองไฟฟ้า/ยาสำหรับสถานพยาบาลที่ได้รับผลกระทบ
3. ตรวจสอบเส้นทางสัญจรและปิดกั้นถนนที่มีน้ำท่วมขังสูงเกิน 30 ซม.
4. ประสานสำนักงานปศุสัตว์อำเภอเพื่ออพยพสัตว์เลี้ยงขึ้นที่ดอน

---
*ออกโดยระบบ SIAHRA — Spatial Intelligence Atlas for Hazard & Resilience Analytics (siahra-radar.co)*
`;

  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `siahra-brief-${localAuthority.dlaCode}-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
