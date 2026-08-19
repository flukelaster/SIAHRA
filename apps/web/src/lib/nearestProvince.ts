import type { NearestProvince } from "@siahra/shared-types";
import type { Lang, TFunction } from "../i18n";
import { formatNumber } from "./number";

/**
 * ข้อความ "จังหวัดใกล้เคียง" ของเหตุการณ์แผ่นดินไหว
 *
 * สองแบบเท่านั้น และแยกกันด้วย `inside` ไม่ใช่ด้วยตัวเลขที่ปัดแล้ว:
 *   - อยู่ในเขต → "ในเขต X" / "within X"
 *   - ไม่อยู่ในเขต → "ห่างจาก X ≈ N กม." / "≈ N km from X"
 *
 * ระยะต่ำกว่า 10 กม. แสดงทศนิยมหนึ่งตำแหน่ง มิฉะนั้นจุดที่อยู่ห่างขอบ 400 เมตร
 * จะกลายเป็น "≈ 0 กม." ซึ่งผู้อ่านจะเข้าใจว่า "อยู่ในเขต" ทั้งที่ไม่ใช่
 */
export function nearestProvinceLabel(
  t: TFunction,
  lang: Lang,
  nearest: NearestProvince | undefined,
): string | null {
  if (!nearest) return null;
  const province = lang === "th" ? nearest.nameTh : (nearest.nameEn || nearest.nameTh);
  if (nearest.inside) return t("quake.nearest.inside", { province });
  return t("quake.nearest.distance", {
    province,
    n: formatNumber(lang, nearest.distanceKm, nearest.distanceKm < 10 ? 1 : 0),
  });
}
