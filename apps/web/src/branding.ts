/**
 * Product identity. Single source of truth — the plan (docs/SIAHRA-implement-plan.md,
 * "System naming and preliminary uniqueness screening") screened this name but
 * explicitly notes that is NOT a trademark, company-registry or domain
 * clearance, so treat it as provisional.
 */
/** คำโปรยของแบรนด์ย้ายไปอยู่ใน `i18n/{th,en}.ts` คีย์ `brand.tagline` (E7.1) */
export const BRAND = {
  name: "SIAHRA",
  expansion: "Spatial Intelligence Atlas for Hazard & Resilience Analytics",
  /** Browser tab / document title. */
  documentTitle: "SIAHRA — Spatial Intelligence Atlas for Hazard & Resilience Analytics",
  copyrightYear: 2026,
} as const;

/**
 * Upstream data providers. This is an attribution line, NOT a statement of
 * authorship or endorsement — these agencies supply the data, they did not
 * build or endorse this application.
 */
export const DATA_ATTRIBUTION_TH =
  "ข้อมูลจาก สสน. (ThaiWater), กรมอุตุนิยมวิทยา, USGS, EMSC, Copernicus DEM และ OpenStreetMap";
