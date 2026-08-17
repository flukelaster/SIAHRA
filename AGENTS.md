# SIAHRA — คู่มือสำหรับ agent/ผู้ร่วมพัฒนา

**SIAHRA** (Spatial Intelligence Atlas for Hazard & Resilience Analytics) — แผนที่ 3 มิติรายจังหวัดของไทยที่ซ้อนข้อมูลภัยพิบัติ*ที่ตรวจวัดจริง* (ThaiWater/สสน., GISTDA, TMD, USGS/EMSC) บน Three.js + React (Vite) และ Cloudflare Worker (Durable Objects, R2). แผนภาพรวมอยู่ใน `SIAHRA-implement-plan.md`, ขั้นตอน deploy ใน `docs/deploy.md`.

## กติกาที่ห้ามละเมิด (data honesty)
- ทุกชั้นข้อมูลต้องประกาศ `HazardLayerDescriptor` (`packages/shared-types/src/hazard-layer.ts`): observed / static-reference / illustrative / probabilistic และ UI ต้องบอกเวลาข้อมูล (`fetchedAt`/`observedAt`) เสมอ
- **ห้ามสร้างตัวเลขพยากรณ์เอง** — ไม่มี "% โอกาสน้ำท่วม" ที่ไม่ได้มาจากโมเดลที่มีการอ้างอิง; ชั้น "พื้นที่ลุ่มต่ำ" เป็น *illustrative* จาก DEM และเขียนไว้ใน legend เช่นนั้น
- ข้อมูลค้าง/แหล่งล่มต้องมองเห็นได้ (จุดจาง, ป้าย, แถบสถานะจาก `/api/v1/health`) ไม่ใช่เงียบหาย; `fetchedAt` เป็น null เมื่อไม่เคยดึงสำเร็จ — ห้ามแทนด้วย "ตอนนี้"
- ค่าย้อนหลัง (timeline) ไม่มี `situationLevel` ของ ThaiWater → สีคิดจากระยะต่ำกว่าตลิ่งและบอกไว้ชัด

## โครงสร้าง
- `apps/web` — React 19 + Vite + Tailwind 4 + three r185 (raw scene graph ไม่ใช้ R3F): `src/scene/*` (TerrainTiles LOD, BuildingTiles, FeatureTiles, VegetationTiles, RadarOverlay, floodMask, terrainMaterial shader), `src/components/layout/Map3DCanvas.tsx` เป็นตัวประกอบทุกชั้น, workers ใน `src/workers/*`
- `apps/api` — Cloudflare Worker: `src/router.ts` (ตาราง route + rate limit + same-origin guard), DOs ใน `src/durable-objects/*` (ObservationCacheDO = ThaiWater + history + dams + archive, FloodExtentDO, RadarDO, EarthquakeFeedDO), ingestion ใน `src/ingestion/*`, คลังถาวรใน `src/archive.ts`
- `apps/etl` — gdal/osmium pipelines: `build:all`, `build:tiles`, `build:building-tiles`, `build:feature-tiles`, `build:landcover-tiles` → ผลลัพธ์เล็ก (manifest/overview) ใน `apps/web/public/aoi/{code}` (tracked) และ tile ใหญ่ใน `apps/etl/data/tiles` (gitignored, ~5.6 GB, เสิร์ฟใน dev ด้วย middleware ใน `apps/web/vite.config.ts`, prod = R2)
- `packages/shared-types` — สัญญาข้อมูลระหว่าง api/web/etl (แก้ที่นี่ก่อนเสมอ)

## รัน
- `npm run dev` (root) = vite :5173 + wrangler :8787 (ใน worktree ใช้พอร์ตจาก `.env.worktree`) — **wrangler ต้องมี `apps/web/dist`** (สร้างด้วย `npm run build -w apps/web`) ไม่งั้นไม่ขึ้น
- ตรวจ: `npx tsc -b` ใน apps/web, `npx tsc --noEmit` ใน apps/api และ apps/etl, `npx oxlint src` ใน apps/web
- ดูภาพจริง: `playwright-cli -s=<session> open http://localhost:5173` แล้ว `screenshot` (wheel zoom ไม่ทำงาน headless — ใช้ปุ่มซูม/ลาก) ; มี `window.__siahraHandles` ใน dev สำหรับสั่งกล้อง
- cron ไม่ยิงใน wrangler dev — DO ทุกตัวตั้ง alarm เอง; ยิงมือได้ที่ `GET /__scheduled?cron=*+*+*+*+*`

## Orca worktree
`orca.yaml` → `.orca/setup.sh` → `scripts/setup-worktree.sh` (symlink dataset, copy state, จองพอร์ต, npm ci, build web) ; Quick Command รัน `.orca/run.sh`; archive hook หยุด dev server ของ worktree นั้นเท่านั้น
