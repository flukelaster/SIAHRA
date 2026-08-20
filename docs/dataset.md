# ชุดข้อมูล AOI: ที่มา (provenance) และการตรวจความถูกต้อง

เอกสารนี้อธิบายฟิลด์ `provenance` ใน `apps/web/public/aoi/{code}/manifest.json`
(งาน E9.1) — มันบอกอะไร **ไม่**บอกอะไร และเมื่อลายเซ็นของ `terrain.bin` ไม่ตรง
แล้วชั้นข้อมูลไหนถูกปิดบ้าง

สัญญาของชนิดข้อมูลอยู่ที่ `packages/shared-types/src/aoi.ts`
(`AoiProvenance`, `AoiLayerProvenance`, `AoiProvenanceLayer`)

---

## 1. รูปร่างของ `provenance`

```jsonc
"provenance": {
  "datasetVersion": "2026-08-17",           // รุ่นของชุดข้อมูล (E9.2 จะใช้เป็น prefix ของ tile URL)
  "generatedAt": "2026-08-20T03:46:11.000Z", // เวลาที่ "ไฟล์ manifest นี้" ถูกเขียน
  "sources": {
    "terrain":   { "builtAt": "2026-08-17T02:51:03.000Z", "sourceIds": ["copernicus-dem"] },
    "buildings": { "builtAt": "2026-08-17T03:16:06.000Z", "publishedAt": "2026-08-15T20:21:20.000Z", "sourceIds": ["osm"] },
    "roads":     { "builtAt": "2026-08-17T03:32:44.000Z", "publishedAt": "2026-08-15T20:21:20.000Z", "sourceIds": ["osm"] },
    "water":     { "builtAt": "2026-08-17T03:32:44.000Z", "publishedAt": "2026-08-15T20:21:20.000Z", "sourceIds": ["osm"] },
    "trees":     { "builtAt": "2026-08-17T05:00:43.000Z", "sourceIds": ["worldcover"] }
  },
  "checksums": { "terrain.bin": "…64 hex…" }
}
```

ทั้งก้อนเป็น **optional**: manifest ที่สร้างก่อน E9.1 ไม่มีฟิลด์นี้ และฝั่ง client
ต้องทำงานได้เหมือนเดิมทุกประการเมื่อมันหายไป — ตลอดไป ไม่ใช่ชั่วคราว

### `generatedAt` ≠ `builtAt`

- `generatedAt` = manifest ถูกเขียนเมื่อไหร่
- `builtAt` = artefact **ของชั้นนั้นเอง** ถูกผลิตเมื่อไหร่

การรีเฟรช manifest วันนี้ทับ artefact ที่ build เมื่อสามวันก่อนเป็นเรื่องปกติ
สองเวลานี้จึงต่างกันได้ และความต่างนั้นคือเหตุผลทั้งหมดที่ต้องมี provenance รายชั้น
ห้ามยุบให้เหลือค่าเดียว

### ข้อควรระวังของ `datasetVersion` (สำคัญกับ E9.2)

ค่าเริ่มต้นของ `datasetVersion` คือ `manifest.version` ซึ่งสคริปต์ tile รายชั้น
(`buildTerrainTiles`, `buildFeatureTiles`) **เขียนทับเป็นวันที่ปัจจุบันทุกครั้งที่
rebuild ชั้นใดชั้นหนึ่ง** ค่านี้จึงเป็น "วันที่ชั้นใดชั้นหนึ่งถูก build ล่าสุด" ราย
จังหวัด ไม่ใช่รหัสรุ่นของชุดข้อมูลทั้งชุด

E9.2 จะเอาฟิลด์นี้ไปทำ prefix ของ tile URL (`/aoi/{code}/v/{ver}/...`) ซึ่งต้องการ
รหัสที่ **นิ่ง** — ตอนนั้นต้องกำหนดค่าให้ชัดด้วย `--dataset-version=` (ทั้ง 77
จังหวัดค่าเดียวกัน) แทนที่จะปล่อยให้ derive จาก `manifest.version`

`manifest.version` เป็นค่าตั้งต้น **เฉพาะครั้งแรกที่เติม provenance** เท่านั้น: ลำดับ
ของเส้นทางรีเฟรชคือ `--dataset-version=` → `provenance.datasetVersion` เดิม →
`manifest.version` ดังนั้นเมื่อชั้นใดชั้นหนึ่งถูก rebuild แล้ว `manifest.version`
ขยับ การรัน `refresh:manifests` ซ้ำจะ **ไม่** ลาก `datasetVersion` ตามไปด้วย
ต้องสั่ง `--dataset-version=` เองถ้าตั้งใจให้เปลี่ยน

### `builtAt` มาจากไหน

จาก mtime ล่าสุดของโฟลเดอร์ tile ใน `apps/etl/data/tiles/{code}/{layer}/`
(หรือจากเวลาที่จดไว้ตอน build เมื่อรันนั้นเป็นคนสร้าง artefact เอง)

| ชั้นใน manifest | โฟลเดอร์ artefact |
|---|---|
| `terrain` | `tiles/{code}/terrain` |
| `buildings` | `tiles/{code}/buildings` |
| `roads`, `water` | `tiles/{code}/features` (build เดียวกัน จึงมีเวลาเดียวกันจริง ๆ) |
| `trees` | `tiles/{code}/landcover` |

**ห้ามใช้ mtime ของไฟล์ใน `apps/web/public/aoi/**`** โฟลเดอร์นั้นถูก track ใน git
ทุกไฟล์จึงมี mtime เท่ากับตอน `git checkout` ไม่ใช่ตอนสร้าง artefact การเขียนค่านั้น
ลง manifest คือการ ship เวลาที่แต่งขึ้น

`terrain.bin` (overview), `hillshade.png` และ `boundary.geojson` ถูก track เหมือนกัน
เวลาสร้างจริงของทั้งสามหายไปแล้ว — `hillshade.png` กับ `boundary.geojson` จึง **ไม่มี
provenance entry เลย** ส่วน `terrain.builtAt` คือเวลาของ **build run** ที่ผลิต tile
pyramid ชุดนั้น (ไฟล์ overview ออกมาจากรันเดียวกัน) ไม่ใช่ timestamp ของตัวไฟล์เอง

### ชั้นที่ไม่มี entry — โดยตั้งใจ

- **`imagery` ไม่อยู่ใน `AoiProvenanceLayer` เลย** ภาพดาวเทียม (Esri World Imagery /
  EOX Sentinel-2 cloudless) เป็น tile service ที่ client ดึงสดรายไทล์ ไม่มี artefact
  ในชุดข้อมูลให้จดเวลา — จะจดก็ได้แต่ต้องแต่งขึ้น (แผนงานใน `docs/roadmap.md` เขียน
  imagery รวมไว้ด้วย นี่คือการตัดสินใจว่ามันไม่มีอยู่จริง ไม่ใช่การลืม)
- **ไม่มีโฟลเดอร์ tile → ไม่มี entry** เครื่องที่ไม่ได้ symlink ชุดข้อมูล 5.6 GB
  (เช่น clone ใหม่ หรือ CI) จะไม่มีโฟลเดอร์นั้น ชั้นนั้นต้องหายไปทั้ง entry
  **ห้ามแทนด้วย `generatedAt`, `manifest.version` หรือเวลาปัจจุบัน** — ฝั่ง web จะแสดง
  "ไม่ได้บันทึกเวลาที่ดึงข้อมูล" (`freshness.missing.staticReference`) ซึ่งเป็นความจริง

### `publishedAt` — เฉพาะแหล่งที่ประกาศเวลาไว้เอง

| แหล่ง | มี `publishedAt` ไหม | เหตุผล |
|---|---|---|
| OpenStreetMap (roads/water/buildings) | ✅ | หัวไฟล์ pbf มี `osmosis_replication_timestamp` ซึ่งเป็น instant ที่ต้นทางประกาศเอง — อ่านด้วย `osmium fileinfo -j` **ตอนรัน** ทุกครั้ง ห้าม hardcode |
| Copernicus DEM GLO-30 (terrain) | ❌ | ต้นทางบอกเป็นรุ่นของผลิตภัณฑ์ ไม่ใช่ timestamp |
| ESA WorldCover (trees) | ❌ | "WorldCover 2021" คือยุคของผลิตภัณฑ์ การขยายเป็น `2021-01-01T00:00:00Z` คือการสร้างความละเอียดที่ต้นทางไม่เคยบอก |

อ่านหัวไฟล์ pbf ไม่ได้ (ไม่มี osmium / ไม่มีไฟล์) → **ไม่เขียนฟิลด์นี้เลย** ไม่ใช่เดา

---

## 2. `checksums` และผลตรวจ `terrainIntegrity`

`checksums` เป็น sha256 (hex) ต่อไฟล์ คีย์เป็น path เทียบกับโฟลเดอร์ AOI ตอนนี้มี
`terrain.bin` ก้อนเดียว ซึ่งเป็นไฟล์ที่ป้อนชั้นข้อมูลที่คำนวณจากภูมิประเทศทั้งหมด

ฝั่ง client แฮชบัฟเฟอร์ **ที่โหลดมาอยู่ในหน่วยความจำแล้ว** ด้วย SubtleCrypto
(`scene/TerrainMesh.ts` → `verifyTerrainIntegrity`) ไม่มีการ fetch รอบสอง แล้วได้ผล
สามค่า:

| ค่า | ความหมาย | ป้ายใน legend | ปิดชั้นอะไร |
|---|---|---|---|
| `verified` | ตรงกับลายเซ็นใน manifest | ไม่แสดงอะไร | — |
| `unknown` | manifest ไม่ได้ประกาศลายเซ็น หรือเบราว์เซอร์ไม่มี SubtleCrypto (ไม่ใช่ secure context) | "ยังตรวจความถูกต้องของภูมิประเทศไม่ได้ (manifest ไม่มีลายเซ็น)" | **ไม่ปิดอะไรเลย** |
| `mismatch` | ไฟล์ที่โหลดมาไม่ใช่ไฟล์ที่ไปป์ไลน์สร้าง | "ตรวจสอบความถูกต้องของภูมิประเทศไม่ผ่าน — ชั้นพื้นที่ลุ่มต่ำใช้งานไม่ได้" | ดูหัวข้อ 3 |

`unknown` ≠ `mismatch` — "ยังไม่ได้ตรวจ" ไม่ใช่ "ตรวจแล้วไม่ผ่าน" manifest ส่วนใหญ่
ยังไม่มี checksum การปิดชั้นข้อมูลเพราะยังไม่ได้ตรวจ คือการกล่าวหาโดยไม่มีหลักฐาน

---

## 3. เกิดอะไรขึ้นเมื่อ `mismatch`

**หลักการ: DEM ที่เชื่อไม่ได้ ห้ามผลิตค่าภัยพิบัติต่อ แต่ห้ามทำให้แผนที่หายไปเงียบ ๆ**

ถูกปิด:

- **ชั้นพื้นที่ลุ่มต่ำ (แชนแนล R ของ overlay)** — `scene/hazardOverlay.ts` ล้างแชนแนล R
  เป็นศูนย์ผ่าน `suppressLowlandChannel()` ก่อนสร้าง texture ทั้งเส้นทางซิงโครนัสและ
  เส้นทาง Web Worker เรียกจุดเดียวกัน (`wrapOverlayField`) จึงแยกกันไม่ได้
- **`lowlandShare` กลายเป็น `null` ไม่ใช่ 0** — 0 อ่านออกมาว่า "ไม่มีพื้นที่ลุ่มต่ำเลย"
  ซึ่งเป็นคำกล่าวอ้างที่เราไม่มีสิทธิ์พูด
- **อะไรก็ตามที่ gate อยู่บนแชนแนล R นี้** วันนี้ยังไม่มีตัวไหนฝั่ง web (ชั้น flood
  exposure ของ E10.4 ยังไม่ถูกสร้าง) เมื่อสร้างขึ้นมามันต้องอ่าน R ตัวนี้ จึงถูกปิด
  ตามไปโดยอัตโนมัติ ค่า `lowlandShare` เดินทางไปกับ `MapInfo` อยู่แล้ว (ยังไม่มี
  คอมโพเนนต์ไหนแสดงมัน) ตัวที่มาอ่านทีหลังจึงได้ `null` ติดมาด้วย ไม่ใช่ 0

**ไม่**ถูกปิด:

- **ภูมิประเทศฐาน** ยังเรนเดอร์ตามปกติ (พร้อมป้ายใน legend ว่าตรวจไม่ผ่าน) — การทำให้
  แผนที่ว่างเปล่าไม่ได้ทำให้ใครปลอดภัยขึ้น
- **แชนแนล G — ฮาโลรอบสถานีที่ตรวจวัดฝนหนัก/น้ำสูง** เป็นค่าที่ ThaiWater วัดมาจริง
  ไม่ได้มาจาก DEM
- **แชนแนล B — มาสก์ขอบเขตจังหวัด** มาจาก `boundary.geojson`
- **ภาพน้ำท่วมจากดาวเทียม GISTDA** เป็น texture คนละก้อน (`scene/floodMask.ts` →
  uniform `uFloodMask`) ไม่เกี่ยวกับ `terrain.bin` เลย
- **เรดาร์ แผ่นดินไหว เขื่อน สถานี** ทั้งหมดมาจาก API ไม่ใช่ชุดข้อมูล ETL

console จะได้ `console.error` หนึ่งบรรทัดพร้อมรหัสจังหวัด และ legend บอกเหตุผลเป็น
ข้อความ ทั้งภาษาไทยและอังกฤษ (`legend.integrity.mismatch`)

---

## 4. ที่มารายชั้นแสดงตรงไหนใน UI

- **legend** (`MapLegend.tsx`) — แถวของ ถนน / แหล่งน้ำ / อาคาร / ต้นไม้ แสดงเวลาที่
  artefact ของชั้นนั้นถูก build เป็น `fetchedAt` และแสดง `publishedAt` ของ OSM extract
  เป็นบรรทัด "ต้นทางเผยแพร่ …" ชั้นที่ manifest ไม่ได้บันทึกไว้คงข้อความ
  "ไม่ได้บันทึกเวลาที่ดึงข้อมูล" เหมือนเดิม
  - `imagery` ไม่ถูกเติม (ไม่มี artefact) และ `lowland` ไม่ถูกเติมโดยตั้งใจ: มันเป็นชั้น
    *illustrative* ที่เบราว์เซอร์คำนวณตอนเปิดแผนที่ ไม่ได้ "ดึง" มาเมื่อไหร่
- **เครดิตใต้แผนที่** (`MapAttribution.tsx`) — แสดง `ชุดข้อมูล {datasetVersion}`

---

## 5. การรันไปป์ไลน์

**เส้นทาง build** — `npm run build:all -w apps/etl` (= `apps/etl/src/buildAllProvinces.ts`)
จดเวลาของแต่ละชั้นตอนที่ชั้นนั้นถูกเขียนเสร็จ และสคริปต์ tile รายชั้น
(`build:tiles`, `build:building-tiles`, `build:feature-tiles`,
`build:landcover-tiles`) เลื่อน `builtAt` เฉพาะชั้นที่ตัวเองเพิ่ง rebuild ผ่าน
`touchLayerProvenance()` ซึ่ง (ก) คำนวณ `checksums` ใหม่จากไฟล์ที่ ship อยู่จริงเสมอ
ไม่หิ้วค่าเก่ามาต่อ และ (ข) ปล่อย manifest ที่ **ยังไม่มี** provenance ไว้เหมือนเดิม
เพราะที่นั่นไม่รู้ `datasetVersion` ที่ถูกต้อง — ให้ `refresh:manifests` เป็นคนเติมทีเดียว

**เส้นทางรีเฟรช** — เติม provenance ลง manifest ที่ build ไปแล้ว โดยไม่ rebuild อะไร:

```bash
npm run refresh:manifests -w apps/etl -- --dry-run          # พิมพ์ว่าจะเปลี่ยนอะไร ไม่เขียนไฟล์
npm run refresh:manifests -w apps/etl                       # เขียนจริง
npm run refresh:manifests -w apps/etl -- --only=11,50        # เฉพาะบางจังหวัด
npm run refresh:manifests -w apps/etl -- --dataset-version=2026-08-20
```

สคริปต์นี้ **idempotent**: ถ้า provenance ที่คำนวณได้เท่าของเดิมทุกฟิลด์ยกเว้น
`generatedAt` มันจะไม่เขียนไฟล์และคง `generatedAt` เดิมไว้ — `generatedAt` คือ
"เวลาที่เนื้อหานี้ถูกเขียน" การเลื่อนมันทั้งที่เนื้อหาไม่เปลี่ยนคือการรายงานงานที่ไม่ได้เกิดขึ้น

สคริปต์นี้ไม่ดาวน์โหลด OSM extract เอง ไม่มีไฟล์ = ไม่มี `publishedAt`

**ทั้งสองเส้นทางเรียกโมดูลเดียวกัน** (`apps/etl/src/provenance.ts`) จึงให้รูปร่างและ
กฎเดียวกันเสมอ เทสอยู่ที่ `apps/etl/src/provenance.test.ts` (รันด้วย `npm test` ที่ root
ซึ่งรวม `apps/etl` แล้ว)

## 6. สถานะปัจจุบัน และการตรวจซ้ำด้วยตัวเอง

รันรีเฟรชไปแล้วทั้งชุด: manifest ทั้ง **78 ไฟล์** ใน `apps/web/public/aoi/` มี
`provenance` ครบ (77 จังหวัด + AOI สาธิต `chiangmai-old-city` ซึ่ง `sources` เป็น `{}`
เพราะไม่มี tile pyramid — ตรงตามกฎ "ไม่มี artefact = ไม่มี entry" ไม่ใช่ข้อผิดพลาด)
ทุกไฟล์มี `checksums["terrain.bin"]`

ลายเซ็นตรวจซ้ำได้โดยไม่ต้องเชื่อไปป์ไลน์ — `terrain.bin` กับ `manifest.json` ถูก track
ใน git และ ship ไปด้วยกันใน deploy unit เดียว (`apps/web`):

```bash
shasum -a 256 apps/web/public/aoi/30/terrain.bin
jq -r '.provenance.checksums["terrain.bin"]' apps/web/public/aoi/30/manifest.json
```

ในเบราว์เซอร์ (dev) ดูผลตรวจและตัวนับแชนแนลได้จาก
`window.__siahraHandles.debug.snapshot().overlay` ซึ่งคืน `{ integrity, lowlandShare,
nonZeroR, nonZeroG, nonZeroB }` — เมื่อ `mismatch` ค่า `nonZeroR` ต้องเป็น 0 ขณะที่
`nonZeroB` (มาสก์จังหวัด) ยังไม่เป็นศูนย์ ส่วน `nonZeroG` ขึ้นกับว่าตอนนั้นมีสถานี
เตือนภัยอยู่จริงหรือไม่
