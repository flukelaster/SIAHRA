/**
 * `HazardLayerDescriptor` ของชั้นข้อมูลที่ไม่ได้มาจาก API — ชั้นที่ฝังอยู่ในชุดข้อมูล
 * ของ ETL (ภาพดาวเทียม ถนน แหล่งน้ำ อาคาร ต้นไม้) และชั้นที่ฝั่ง client คำนวณเอง
 * (พื้นที่ลุ่มต่ำ)
 *
 * **ห้ามใช้ `AoiManifest.version` เป็น `fetchedAt`** — `version` คือวันที่ build
 * ทั้งชุดครั้งเดียว ถ้า rebuild artefact เดียวทุกแหล่งจะอ้างว่าเพิ่งถูกดึงมาใหม่หมด
 * ซึ่งเป็นเวลาการดึงที่ไม่จริง
 *
 * ค่าที่ประกาศในไฟล์นี้จึงเป็น **ค่าตั้งต้นที่ยังไม่รู้เวลา** (`fetchedAt: null`)
 * ทุกชั้น และ E9.1 ทำให้ `hooks/useLayerDescriptors.ts` เติมทับตอนรันไทม์จาก
 * `manifest.provenance.sources[layer]` ของจังหวัดที่กำลังแสดง — ทีละชั้น จาก
 * เวลาที่ artefact ของชั้นนั้นเองถูกสร้าง manifest ที่ยังไม่มี provenance (หรือ
 * ชั้นที่ไม่มี artefact ให้จดเวลา) จะไม่ถูกเติม แล้ว legend แสดงว่า "ไม่ได้บันทึก
 * เวลาที่ดึงข้อมูล" ตามความจริงเหมือนเดิม
 *
 * สองชั้นที่ **ไม่ถูกเติมโดยตั้งใจ**:
 * - `imagery` — Esri/EOX เป็น tile service ที่ client ดึงสดรายไทล์ ไม่มี artefact
 *   ในชุดข้อมูลให้จดเวลา
 * - `lowland` — เป็นชั้น *illustrative* ที่เบราว์เซอร์คำนวณจาก DEM ตอนเปิดแผนที่
 *   ไม่ได้ "ดึง" มาเมื่อไหร่ การใส่เวลา build ของ terrain จะอ่านผิดเป็นรอบดึง
 *
 * `publishedAt` เติมได้เฉพาะต้นทางที่ประกาศเวลาไว้เอง — วันนี้มีแหล่งเดียวคือ OSM
 * (`osmosis_replication_timestamp` ในหัวไฟล์ pbf) ส่วน "WorldCover 2021" หรือ
 * Copernicus DEM เป็นยุคของข้อมูล ไม่ใช่ timestamp — การแปลงปีเป็น
 * `2021-01-01T00:00:00Z` คือการสร้างความละเอียดที่ต้นทางไม่เคยบอก ปีของผลิตภัณฑ์
 * อยู่ในชื่อแหล่งข้อมูลใน `SOURCES` อยู่แล้ว
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
