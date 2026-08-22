import type { HistoricalFloodEvent, HistoricalFloodResponse } from "@siahra/shared-types";

export const HISTORICAL_FLOOD_EVENTS: readonly HistoricalFloodEvent[] = [
  {
    id: "EVENT-2011-CHAOPHRAYA",
    nameTh: "มหาอุทกภัยลุ่มน้ำเจ้าพระยา พ.ศ. 2554",
    nameEn: "2011 Great Chao Phraya Basin Flood",
    year: 2011,
    peakDate: "2011-10-25",
    basin: "BASIN-CHAOPHRAYA",
    affectedProvinces: ["10", "13", "14", "60", "65", "66"],
    peakFloodAreaKm2: 14800,
    estimatedTotalExposedPop: 3200000,
    descriptionTh: "อุทกภัยครั้งประวัติศาสตร์จากอิทธิพลพายุ 5 ลูกต่อเนื่อง น้ำล้นตลิ่งแม่น้ำเจ้าพระยาและทุ่งรับน้ำแผ่กว้างครอบคลุมภาคกลางและกรุงเทพมหานคร",
    descriptionEn: "Historic nationwide flood event from multiple consecutive tropical storms causing catastrophic inundation across central Thailand and Bangkok.",
  },
  {
    id: "EVENT-2021-KORAT-MUN",
    nameTh: "อุทกภัยลุ่มน้ำมูล-ลำตะคอง นครราชสีมา พ.ศ. 2564",
    nameEn: "2021 Korat Lam Takhong & Mun River Flood",
    year: 2021,
    peakDate: "2021-10-18",
    basin: "BASIN-MUN-01",
    affectedProvinces: ["30", "31", "32"],
    peakFloodAreaKm2: 850,
    estimatedTotalExposedPop: 185000,
    descriptionTh: "พายุคมปาซุและเตี้ยนหมู่ส่งผลให้ระดับน้ำในลำตะคองและแม่น้ำมูลเอ่อท้นเข้าท่วมพื้นที่ อปท. ในเขตเมืองนครราชสีมาและอำเภอตอนล่าง",
    descriptionEn: "Severe flooding in Nakhon Ratchasima and lower Mun sub-basins triggered by storms Kompasu and Dianmu.",
  },
  {
    id: "EVENT-2022-UBON-M7",
    nameTh: "อุทกภัยน้ำมูลล้นตลิ่งวิกฤต อุบลราชธานี พ.ศ. 2565",
    nameEn: "2022 Ubon Ratchathani Mun River Peak Flood",
    year: 2022,
    peakDate: "2022-10-06",
    basin: "BASIN-MUN-04",
    affectedProvinces: ["34", "33"],
    peakFloodAreaKm2: 1200,
    estimatedTotalExposedPop: 240000,
    descriptionTh: "ระดับน้ำแม่น้ำมูลที่สถานี M.7 สะพานเสรีประชาธิปไตย สูงกว่าระดับตลิ่งถึง 4.51 เมตร เข้าท่วมพื้นที่ อปท. เทศบาลเมืองวารินชำราบและเทศบาลนครอุบลราชธานี",
    descriptionEn: "Extreme water level at Mun river gauge M.7 exceeding bank level by 4.51m, inundating Warin Chamrap and Ubon Ratchathani municipalities.",
  },
  {
    id: "EVENT-2024-CHIANGMAI-PING",
    nameTh: "อุทกภัยแม่น้ำปิงล้นตลิ่ง เทศบาลนครเชียงใหม่ พ.ศ. 2567",
    nameEn: "2024 Chiang Mai Ping River Flood (Station P.1)",
    year: 2024,
    peakDate: "2024-10-04",
    basin: "BASIN-PING-01",
    affectedProvinces: ["50", "51"],
    peakFloodAreaKm2: 320,
    estimatedTotalExposedPop: 95000,
    descriptionTh: "ระดับน้ำแม่น้ำปิงที่สถานี P.1 สะพานนวรัฐ ทำสถิติสูงสุด 5.30 เมตร เอ่อล้นเข้าท่วมย่านเศรษฐกิจและชุมชนริมน้ำนครเชียงใหม่",
    descriptionEn: "Record-high water level at Ping River station P.1 (5.30m) inundating key commercial and residential areas of Chiang Mai.",
  },
  {
    id: "EVENT-2024-HATYAI-UTAPAO",
    nameTh: "เหตุการณ์น้ำหลากลุ่มน้ำคลองอู่ตะเภา หาดใหญ่ พ.ศ. 2567",
    nameEn: "2024 Hat Yai U-Tapao Basin Flood Event",
    year: 2024,
    peakDate: "2024-11-28",
    basin: "BASIN-SOUTHERN-EAST-01",
    affectedProvinces: ["90"],
    peakFloodAreaKm2: 180,
    estimatedTotalExposedPop: 78000,
    descriptionTh: "มรสุมตะวันออกเฉียงเหนือพัดปกคลุมภาคใต้ตอนล่างทำให้มีฝนตกหนักสะสมในเทือกเขาบรรทัด น้ำระบายผ่านคลองอู่ตะเภาและคลอง ร.1",
    descriptionEn: "Intense monsoon rainfall in the southern basin causing rapid stage rise in Khlong U-Tapao and floodway diversion canals.",
  },
];

export function getHistoricalEventById(id: string): HistoricalFloodEvent | null {
  return HISTORICAL_FLOOD_EVENTS.find((e) => e.id === id) ?? null;
}

export function queryHistoricalEvents(provinceCode?: string): HistoricalFloodResponse {
  let events = [...HISTORICAL_FLOOD_EVENTS];
  if (provinceCode) {
    events = events.filter((e) => e.affectedProvinces.includes(provinceCode));
  }
  return {
    total: events.length,
    events,
  };
}
