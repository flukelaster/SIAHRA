import type { LocalAuthorityRef, LocalAuthorityType } from "@siahra/shared-types";

/**
 * Curated Canonical Local Administrative Organizations (อปท.) for Thailand.
 * Keyed by unique DLA Code / Canonical ID.
 */
export const LOCAL_AUTHORITIES: readonly LocalAuthorityRef[] = [
  // Bangkok & Pattaya (Special)
  {
    id: "TH-LAO-100000",
    dlaCode: "100000",
    nameTh: "กรุงเทพมหานคร",
    nameEn: "Bangkok Metropolitan Administration",
    type: "special_admin_area",
    provinceCode: "10",
    districtCode: "1001",
    centerLat: 13.7563,
    centerLon: 100.5018,
    areaKm2: 1568.7,
  },
  {
    id: "TH-LAO-200401",
    dlaCode: "200401",
    nameTh: "เมืองพัทยา",
    nameEn: "Pattaya City",
    type: "special_admin_area",
    provinceCode: "20",
    districtCode: "2004",
    centerLat: 12.9276,
    centerLon: 100.8771,
    areaKm2: 208.1,
  },
  // Songkhla / Hat Yai Pilot Basin
  {
    id: "TH-LAO-901101",
    dlaCode: "901101",
    nameTh: "เทศบาลนครหาดใหญ่",
    nameEn: "Hat Yai City Municipality",
    type: "city_municipality",
    provinceCode: "90",
    districtCode: "9011",
    centerLat: 7.0084,
    centerLon: 100.4767,
    areaKm2: 21.0,
  },
  {
    id: "TH-LAO-900101",
    dlaCode: "900101",
    nameTh: "เทศบาลนครสงขลา",
    nameEn: "Songkhla City Municipality",
    type: "city_municipality",
    provinceCode: "90",
    districtCode: "9001",
    centerLat: 7.1897,
    centerLon: 100.5954,
    areaKm2: 9.27,
  },
  {
    id: "TH-LAO-901102",
    dlaCode: "901102",
    nameTh: "เทศบาลเมืองคลองแห",
    nameEn: "Khlong Hae Town Municipality",
    type: "town_municipality",
    provinceCode: "90",
    districtCode: "9011",
    centerLat: 7.0422,
    centerLon: 100.4786,
    areaKm2: 25.5,
  },
  {
    id: "TH-LAO-901103",
    dlaCode: "901103",
    nameTh: "เทศบาลเมืองควนลัง",
    nameEn: "Khuan Lang Town Municipality",
    type: "town_municipality",
    provinceCode: "90",
    districtCode: "9011",
    centerLat: 6.9944,
    centerLon: 100.4289,
    areaKm2: 68.2,
  },
  {
    id: "TH-LAO-901104",
    dlaCode: "901104",
    nameTh: "เทศบาลเมืองคอหงส์",
    nameEn: "Kho Hong Town Municipality",
    type: "town_municipality",
    provinceCode: "90",
    districtCode: "9011",
    centerLat: 7.0167,
    centerLon: 100.5167,
    areaKm2: 34.5,
  },
  // Nakhon Ratchasima Pilot / Upper Basin
  {
    id: "TH-LAO-300101",
    dlaCode: "300101",
    nameTh: "เทศบาลนครนครราชสีมา",
    nameEn: "Nakhon Ratchasima City Municipality",
    type: "city_municipality",
    provinceCode: "30",
    districtCode: "3001",
    centerLat: 14.9799,
    centerLon: 102.0978,
    areaKm2: 37.5,
  },
  {
    id: "TH-LAO-300102",
    dlaCode: "300102",
    nameTh: "เทศบาลตำบลหัวทะเล",
    nameEn: "Hua Thale Subdistrict Municipality",
    type: "subdistrict_municipality",
    provinceCode: "30",
    districtCode: "3001",
    centerLat: 14.9653,
    centerLon: 102.1584,
    areaKm2: 15.6,
  },
  // Chiang Mai (Ping Basin)
  {
    id: "TH-LAO-500101",
    dlaCode: "500101",
    nameTh: "เทศบาลนครเชียงใหม่",
    nameEn: "Chiang Mai City Municipality",
    type: "city_municipality",
    provinceCode: "50",
    districtCode: "5001",
    centerLat: 18.7883,
    centerLon: 98.9853,
    areaKm2: 40.2,
  },
  // Surat Thani (Tapi Basin)
  {
    id: "TH-LAO-840101",
    dlaCode: "840101",
    nameTh: "เทศบาลนครสุราษฎร์ธานี",
    nameEn: "Surat Thani City Municipality",
    type: "city_municipality",
    provinceCode: "84",
    districtCode: "8401",
    centerLat: 9.1382,
    centerLon: 99.3331,
    areaKm2: 68.97,
  },
  // Ubon Ratchathani (Mun Basin)
  {
    id: "TH-LAO-340101",
    dlaCode: "340101",
    nameTh: "เทศบาลนครอุบลราชธานี",
    nameEn: "Ubon Ratchathani City Municipality",
    type: "city_municipality",
    provinceCode: "34",
    districtCode: "3401",
    centerLat: 15.2287,
    centerLon: 104.8564,
    areaKm2: 29.04,
  },
  {
    id: "TH-LAO-341501",
    dlaCode: "341501",
    nameTh: "เทศบาลเมืองวารินชำราบ",
    nameEn: "Warin Chamrap Town Municipality",
    type: "town_municipality",
    provinceCode: "34",
    districtCode: "3415",
    centerLat: 15.1925,
    centerLon: 104.8622,
    areaKm2: 12.8,
  },
];

const LOCAL_AUTHORITIES_BY_ID = new Map<string, LocalAuthorityRef>(
  LOCAL_AUTHORITIES.map((lao) => [lao.id, lao]),
);

const LOCAL_AUTHORITIES_BY_DLA = new Map<string, LocalAuthorityRef>(
  LOCAL_AUTHORITIES.map((lao) => [lao.dlaCode, lao]),
);

export interface LocalAuthorityFilter {
  provinceCode?: string;
  type?: LocalAuthorityType;
  query?: string;
}

/**
 * Look up local authorities matching optional filter criteria.
 */
export function queryLocalAuthorities(filter?: LocalAuthorityFilter): LocalAuthorityRef[] {
  if (!filter) return [...LOCAL_AUTHORITIES];

  return LOCAL_AUTHORITIES.filter((lao) => {
    if (filter.provinceCode && lao.provinceCode !== filter.provinceCode) {
      return false;
    }
    if (filter.type && lao.type !== filter.type) {
      return false;
    }
    if (filter.query) {
      const q = filter.query.trim().toLowerCase();
      const matchNameTh = lao.nameTh.toLowerCase().includes(q);
      const matchNameEn = lao.nameEn.toLowerCase().includes(q);
      const matchDla = lao.dlaCode.includes(q);
      if (!matchNameTh && !matchNameEn && !matchDla) return false;
    }
    return true;
  });
}

/**
 * Get a single local authority by canonical ID or DLA code.
 */
export function getLocalAuthorityById(idOrDla: string): LocalAuthorityRef | undefined {
  return LOCAL_AUTHORITIES_BY_ID.get(idOrDla) ?? LOCAL_AUTHORITIES_BY_DLA.get(idOrDla);
}
