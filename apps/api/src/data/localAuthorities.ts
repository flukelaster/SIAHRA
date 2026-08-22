import type {
  HazardLayerDescriptor,
  LocalAuthoritiesRegistry,
  LocalAuthorityRef,
  LocalAuthorityType,
} from "@siahra/shared-types";
import raw from "./localAuthorities.json";

/**
 * ทะเบียน อปท. ทั้งประเทศที่ถูก bake เข้า bundle ของ Worker (E11.1) — สร้างใหม่ด้วย
 * `npm run build:local-authorities -w apps/etl` (อ่าน apps/etl/src/buildLocalAuthorities.ts)
 *
 * cast ที่ขอบเดียวจุดนี้โดยตั้งใจ เหมือน `apps/api/src/geo/provinceRings.ts` —
 * ปล่อยให้ TypeScript อนุมานชนิดของ record เกือบแปดพันตัวจะทำให้ typecheck ช้าโดยไม่ได้อะไรกลับมา
 */
const registry = raw as unknown as LocalAuthoritiesRegistry;

export const LOCAL_AUTHORITIES: readonly LocalAuthorityRef[] = registry.localAuthorities;
export const LOCAL_AUTHORITIES_DESCRIPTOR: HazardLayerDescriptor = registry.descriptor;

export interface LocalAuthorityFilter {
  provinceCode?: string;
  type?: LocalAuthorityType;
  query?: string;
}

/** ค้นหาแบบ substring บน nameTh — ไม่ตัดตัวพิมพ์เพราะเป็นภาษาไทยล้วน */
export function queryLocalAuthorities(filter: LocalAuthorityFilter = {}): LocalAuthorityRef[] {
  return LOCAL_AUTHORITIES.filter((a) => {
    if (filter.provinceCode && a.provinceCode !== filter.provinceCode) return false;
    if (filter.type && a.type !== filter.type) return false;
    if (filter.query && !a.nameTh.includes(filter.query)) return false;
    return true;
  });
}

/** รับได้ทั้ง id เต็ม (`TH-LAO-5810401`) และรหัส อปท. เปล่า ๆ (`5810401`) */
export function getLocalAuthorityById(idOrDlaCode: string): LocalAuthorityRef | null {
  return (
    LOCAL_AUTHORITIES.find((a) => a.id === idOrDlaCode || a.dlaCode === idOrDlaCode) ?? null
  );
}
