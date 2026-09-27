/**
 * สถานะของการ์ดหัวรายการชั้นข้อมูล (redesign PR 3) — แยกจาก `layerGroups.ts` เพราะใช้เฉพาะใน chunk ของ
 * `panelViews` (lazy) ไม่ใช่บนเส้นทางของ entry
 *
 *   following — เดินตามหัวข้อ และชั้นตรงกับชุดของหัวข้อที่เลือกอยู่ (ปุ่มคืนค่าซ่อน)
 *   pending   — เดินตามหัวข้ออยู่ แต่ยังไม่ได้ตั้งชุดของหัวข้อนี้: เกิดได้ทางเดียวคือเปิดหน้าบนหัวข้อที่จำไว้
 *               ซึ่งไม่ใช่ภาพรวม (เปิดหน้าไม่ใช้ชุดของหัวข้อ — ชั้นยังเป็น `DEFAULT_LAYERS`)
 *   custom    — ผู้ใช้กดสวิตช์ชั้นที่ชุดของหัวข้อตั้งค่าเอง (observed/illustrative ยกเว้น cctv/exposure) หรือเปิดจาก
 *               ลิงก์ที่มี `?layers=`
 */
import type { LayerPresetState } from "./defaultLayers";
import { matchesPreset } from "./layerGroups";
import type { TopicKey } from "./topics";

export type LayerPresetStatus = "following" | "pending" | "custom";

export function layerPresetStatus(state: LayerPresetState, topic: TopicKey): LayerPresetStatus {
  if (!state.following) return "custom";
  return matchesPreset(state.layers, topic) ? "following" : "pending";
}
