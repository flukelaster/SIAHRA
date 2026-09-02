"""ค่าคงที่ของสัญญาข้อมูล — ก๊อปมาจาก `packages/shared-types/src/flood.ts` **ที่เดียว**

ตัวเลขทุกตัวในไฟล์นี้ต้องตรงกับ `FloodFieldClass` / `FLOOD_FIELD_*` ใน flood.ts ตัวต่อตัว
โมดูลอื่น (fwdet, encode, cli) ห้ามพิมพ์เลขคลาสหรือค่า sentinel เอง — import จากที่นี่เท่านั้น
ถ้า flood.ts เปลี่ยน ให้แก้ที่นี่ก่อนแล้วค่อยแก้ผู้ใช้ (กฎ "shared-types ก่อน" ของ AGENTS.md)
"""

from __future__ import annotations

# flood.ts: FLOOD_FIELD_MAGIC — u32 little-endian อ่านเป็นตัวอักษร "SFLD"
FLOOD_FIELD_MAGIC = 0x444C4653
# flood.ts: FLOOD_FIELD_VERSION
FLOOD_FIELD_VERSION = 1
# flood.ts: FLOOD_FIELD_HEADER_BYTES (u32 magic + u16 version + u16 width + u16 height)
FLOOD_FIELD_HEADER_BYTES = 10
# flood.ts: FLOOD_FIELD_CELL_BYTES (u8 class + u16 depthCm + u8 likelihood)
FLOOD_FIELD_CELL_BYTES = 4

# flood.ts: FloodFieldClass
CLASS_NO_OBSERVATION = 0
CLASS_DRY = 1
CLASS_FLOODED = 2
CLASS_REFERENCE_WATER = 3
CLASS_EXCLUDED = 4
CLASS_FLOODED_DEPTH_NOT_ESTIMATED = 5

# flood.ts: FLOOD_FIELD_NO_DEPTH — "ไม่มีค่าความลึก" ไม่ใช่ 0 ม.
NO_DEPTH = 0xFFFF
# flood.ts: FLOOD_FIELD_NO_LIKELIHOOD — GFM ไม่ได้ให้ค่า
NO_LIKELIHOOD = 255

# flood.ts: FloodSceneMeta.methodology — พารามิเตอร์ที่ใช้จริง บันทึกลง meta.json ทุกฉาก
DEPTH_CAP_CM = 1000
BOUNDARY_SMOOTHING_CELLS = 3
MASKED_WORLDCOVER_CLASSES = (50, 10)  # สิ่งปลูกสร้าง, ต้นไม้ (= grid.WORLDCOVER_MASKED)

# docs/dataset.md §8: sceneId = `\d{8}T\d{6}-[A-Z]{2}\d{3}M`
SCENE_ID_RE = r"^\d{8}T\d{6}-[A-Z]{2}\d{3}M$"

# flood.ts: FloodSceneIndex.scenes จำกัดราว 1,500 รายการ
INDEX_MAX_SCENES = 1500

# id / sourceIds ของ descriptor ทั้งสองชั้น (SourceId `copernicus-gfm` ถูกลงทะเบียนใน F3 —
# roadmap E14: id ของแหล่ง live ลงทะเบียนพร้อม health collector ไม่ใช่ก่อนหน้า)
EXTENT_LAYER_ID = "copernicus-gfm-flood-extent"
DEPTH_LAYER_ID = "flood-depth-illustrative"
SOURCE_ID_GFM = "copernicus-gfm"
SOURCE_ID_DEM = "copernicus-dem"
# หน้า methodology ใน SPA ใช้รูป `/methodology/<slug>` (ดู LOWLAND_METHODOLOGY_URL,
# FLOOD_EXPOSURE_METHODOLOGY_URL) — F4 ลงทะเบียน slug `flood-depth` ใน MethodologyPage.tsx
DEPTH_METHODOLOGY_URL = "/methodology/flood-depth"
