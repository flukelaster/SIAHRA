# SIAHRA — คู่มือ deploy ขึ้น Cloudflare (เตรียมไว้; ยังไม่ได้ deploy)

## 0. สิ่งที่ต้องมี
- Cloudflare account ที่เปิด **Workers Paid** ($5/เดือน — จำเป็นเพราะใช้ Durable Objects)
- `npx wrangler login` ในเครื่องที่จะ deploy
- Node 20+, gdal/osmium (เฉพาะถ้าจะสร้าง tile ใหม่)

## 1. R2 สำหรับ tile และคลังถาวร
```bash
npx wrangler r2 bucket create siahra-geodata
```
อัปโหลด tile (~5.6 GB, ~190k ไฟล์) จาก `apps/etl/data/tiles/{code}/(terrain|buildings|features|landcover)/...`
แนะนำ rclone (เร็วกว่า wrangler มาก):
```bash
rclone config      # remote ชนิด s3, provider Cloudflare, endpoint https://<ACCOUNT_ID>.r2.cloudflarestorage.com
rclone sync apps/etl/data/tiles r2:siahra-geodata/aoi --transfers 32 --checksum \
  --header-upload "Cache-Control: public, max-age=31536000, immutable"
```
key ที่ได้จะเป็น `aoi/{code}/terrain/{z}/{x}_{y}.bin` ตรงกับ URL `/aoi/{code}/terrain/...` ที่ client เรียก

## 2. Worker route สำหรับ tile (งานที่ยังต้องเขียน)
- เพิ่ม route ใน `apps/api/src/index.ts`: `^/aoi/(\d{2})/(terrain|buildings|features|landcover)/(\d+)/(\d+)_(\d+)\.bin$` → `env.HAZARD_BUCKET.get("aoi/...")` + `Cache-Control: public, max-age=31536000, immutable` + `Content-Type: application/octet-stream`; ใช้ Cache API (`caches.default`) กัน R2 reads
- เพิ่ม `/aoi/*` ใน `assets.run_worker_first` ของ `apps/api/wrangler.jsonc` (ตอนนี้มีแค่ `/api/*`, `/__scheduled`) — manifest/overview ยังมาจาก static assets ตามเดิม (`apps/web/public/aoi/**`)

## 3. wrangler.jsonc / secrets
- `kv_namespaces.CONFIG` มี id placeholder — ลบออกหรือสร้างจริงด้วย `npx wrangler kv namespace create CONFIG`
- ตั้งค่า `TMD_UID`, `TMD_UKEY` (ลงทะเบียนที่ data.tmd.go.th) ผ่าน `npx wrangler secret put TMD_UKEY` แล้วลบ default ออกจาก `vars`
- `ALLOWED_ORIGINS`: ว่าง = same-origin เท่านั้น (Worker เดียวเสิร์ฟทั้ง SPA และ API จึงไม่ต้องตั้ง)
- migrations v1–v4 (DO SQLite) มีครบ, cron `* * * * *` มีแล้ว

## 4. Build + deploy
```bash
npm run build -w apps/web          # -> apps/web/dist (~310 MB, < 20,000 ไฟล์, ไฟล์ใหญ่สุด < 25 MiB)
cd apps/api && npx wrangler deploy
```

## 5. WAF / Rate limiting rules (Security → WAF → Rate limiting rules; แผน Free ก็ใช้ได้)
Worker มี token-bucket ต่อ IP อยู่แล้ว (`apps/api/src/rateLimit.ts`) แต่กติกาที่ edge กันได้ก่อนถึง Worker และไม่กิน request quota:

| ชื่อ | Expression | จำกัด | การกระทำ |
|---|---|---|---|
| api-general | `(http.request.uri.path contains "/api/v1/")` | 300 req / 1 นาที ต่อ IP | Block 60 วินาที |
| api-history | `(http.request.uri.path contains "/api/v1/stations/")` | 60 req / 1 นาที ต่อ IP | Block 60 วินาที |
| api-archive | `(http.request.uri.path contains "/api/v1/archive/")` | 60 req / 1 นาที ต่อ IP | Block 60 วินาที |
| api-ws | `(http.request.uri.path eq "/api/v1/earthquakes/live")` | 10 req / 1 นาที ต่อ IP | Block 60 วินาที |

เพิ่ม Cache Rule: `http.request.uri.path matches "^/aoi/.*\.bin$"` → Cache eligible, Edge TTL 1 ปี

## 6. หลัง deploy ตรวจ
- `curl https://<host>/api/v1/health` → ทุก source `ok` ภายใน 5 นาที (alarm ของ DO เริ่มเอง)
- เปิดเว็บ → tile โหลดจาก `/aoi/...` (Network tab: `cf-cache-status: HIT` ในรอบสอง)
- ดู R2: `archive/snapshots/<day>/<HH>.json.gz` เกิดทุกชั่วโมง, `archive/waterlevel/<day>/<province>.json.gz` เกิดตอนตี 0:20 (เวลาไทย)

## ค่าใช้จ่ายโดยประมาณ
Workers Paid $5 + R2 (< 10 GB ฟรี; เกินคิด $0.015/GB) + คลังถาวร ~0.5–1 GB/เดือน → รวม ≈ $5–8/เดือนที่ traffic ระดับหลักพัน–หมื่น session
