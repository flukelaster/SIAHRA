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
  /**
   * Public source repository. The app is open source, so the header carries a
   * link back to it — one URL, declared here with the rest of the identity
   * rather than typed into a component. (Unrelated to `methodologyUrl`, which
   * stays on the in-app `/methodology` page by the decision in
   * docs/roadmap.md §4.)
   */
  repoUrl: "https://github.com/flukelaster/SIAHRA",
} as const;

/**
 * Upstream data providers. This is an attribution line, NOT a statement of
 * authorship or endorsement — these agencies supply the data, they did not
 * build or endorse this application.
 */
export const DATA_ATTRIBUTION_TH =
  "ข้อมูลจาก สสน. (ThaiWater), กรมอุตุนิยมวิทยา, USGS, EMSC, Copernicus DEM และ OpenStreetMap";
