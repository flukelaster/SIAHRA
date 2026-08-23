import type { LocalAuthorityType } from "@siahra/shared-types";
import type { MessageKey } from "../i18n";

/** คีย์ป้ายชื่อประเภท อปท. หกชนิด — ใช้ร่วมกันทุกจุดที่แสดงประเภทของ อปท. */
export const LOCAL_AUTHORITY_TYPE_KEY: Record<LocalAuthorityType, MessageKey> = {
  provincial_admin_org: "localAuthority.type.provincial_admin_org",
  city_municipality: "localAuthority.type.city_municipality",
  town_municipality: "localAuthority.type.town_municipality",
  subdistrict_municipality: "localAuthority.type.subdistrict_municipality",
  subdistrict_admin_org: "localAuthority.type.subdistrict_admin_org",
  special_admin_area: "localAuthority.type.special_admin_area",
};
