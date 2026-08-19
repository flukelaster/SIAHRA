/**
 * `HazardLayerDescriptor` ของชั้นข้อมูลที่ไม่ได้มาจาก API — ชั้นที่ฝังอยู่ในชุดข้อมูล
 * ของ ETL (ภาพดาวเทียม ถนน แหล่งน้ำ อาคาร ต้นไม้) และชั้นที่ฝั่ง client คำนวณเอง
 * (พื้นที่ลุ่มต่ำ)
 *
 * **ห้ามใช้ `AoiManifest.version` เป็น `fetchedAt`** — `version` คือวันที่ build
 * ทั้งชุดครั้งเดียว ถ้า rebuild artefact เดียวทุกแหล่งจะอ้างว่าเพิ่งถูกดึงมาใหม่หมด
 * ซึ่งเป็นเวลาการดึงที่ไม่จริง วันนี้ manifest ยังไม่ได้บันทึกที่มารายชั้น (per-layer
 * provenance) ดังนั้นห้าชั้นนี้จึงส่ง `fetchedAt: null` ตามความจริง และ legend จะ
 * แสดงว่า "ไม่ได้บันทึกเวลาที่ดึงข้อมูล" — งาน E9.1 คือคนที่เพิ่ม provenance รายชั้น
 * ลงใน manifest แล้วกลับมาเติมค่าที่นี่
 *
 * `publishedAt` ก็เป็น null เช่นกัน: "WorldCover 2021" หรือวันที่ของ OSM extract
 * เป็นยุคของข้อมูล ไม่ใช่ timestamp — การแปลงปีเป็น `2021-01-01T00:00:00Z` คือการ
 * สร้างความละเอียดที่ต้นทางไม่เคยบอก ปีของผลิตภัณฑ์อยู่ในชื่อแหล่งข้อมูลใน
 * `SOURCES` อยู่แล้ว
 */
import type { HazardLayerDescriptor } from "@siahra/shared-types";
import type { MapLayers } from "../components/layout/Map3DCanvas";

/** URL ของหน้าอธิบายวิธีคำนวณ (หน้าใน SPA ที่เรนเดอร์ `docs/methodology/`) */
export const LOWLAND_METHODOLOGY_URL = "/methodology/lowland";

export const STATIC_LAYER_DESCRIPTORS: Partial<Record<keyof MapLayers, HazardLayerDescriptor>> = {
  // ชั้นเดียวที่เป็น "ภาพประกอบ": เราคำนวณจากความสูงภูมิประเทศเอง ไม่มีใครวัดมา
  // และไม่ใช่การพยากรณ์ — วิธีคำนวณอยู่ที่ docs/methodology/lowland.md
  lowland: {
    id: "lowland",
    epistemicClass: "illustrative",
    liveOrStatic: "static",
    publishedAt: null,
    fetchedAt: null,
    methodologyUrl: LOWLAND_METHODOLOGY_URL,
    sourceIds: ["copernicus-dem"],
  },
  imagery: {
    id: "imagery",
    epistemicClass: "static-reference",
    liveOrStatic: "static",
    publishedAt: null,
    fetchedAt: null,
    sourceIds: ["esri-world-imagery", "eox-s2cloudless"],
  },
  roads: {
    id: "roads",
    epistemicClass: "static-reference",
    liveOrStatic: "static",
    publishedAt: null,
    fetchedAt: null,
    sourceIds: ["osm"],
  },
  water: {
    id: "water",
    epistemicClass: "static-reference",
    liveOrStatic: "static",
    publishedAt: null,
    fetchedAt: null,
    sourceIds: ["osm"],
  },
  buildings: {
    id: "buildings",
    epistemicClass: "static-reference",
    liveOrStatic: "static",
    publishedAt: null,
    fetchedAt: null,
    sourceIds: ["osm"],
  },
  trees: {
    id: "trees",
    epistemicClass: "static-reference",
    liveOrStatic: "static",
    publishedAt: null,
    fetchedAt: null,
    sourceIds: ["worldcover"],
  },
  // `sunlight` ไม่ใช่ข้อมูล แต่เป็นการจัดแสงตามตำแหน่งดวงอาทิตย์ที่คำนวณจากเวลา
  // จึงไม่มี descriptor และไม่ต้องมีป้ายชนิดความรู้
};
