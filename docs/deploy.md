# SIAHRA — คู่มือ deploy ขึ้น Cloudflare

**deploy ครั้งแรกแล้ว 2026-08-17** ที่ account `Flukelaster` / zone `siahra-radar.co`: `siahra-web`
(Custom Domain, 709 asset) + `siahra-api` (route `/api/*`, DO migrations v1–v4, cron ทุกนาที) และ
R2 bucket `siahra-geodata` ตรวจแล้วว่า `/api/v1/health` คืน JSON, `/` กับ deep link คืน HTML ของ SPA,
`/aoi/{code}/manifest.json` คืน static asset — เอกสารนี้ใช้เป็นขั้นตอนสำหรับ deploy รอบถัดไป

## 0. สิ่งที่ต้องมี
- Cloudflare account ที่เปิด **Workers Paid** ($5/เดือน — จำเป็นเพราะใช้ Durable Objects)
- โดเมน `siahra-radar.co` เป็น zone ใน account เดียวกัน (route ของทั้งสอง Worker ผูกกับ zone นี้)
- `npx wrangler login` ในเครื่องที่จะ deploy
- Node 20+, gdal/osmium (เฉพาะถ้าจะสร้าง tile ใหม่)

## 0.1 สอง Worker แยก deploy กัน
| Worker | config | เนื้อหา | ผูกกับโดเมนแบบ |
|---|---|---|---|
| `siahra-web` | `apps/web/wrangler.jsonc` | SPA ที่ build แล้ว (static assets ล้วน ไม่มี `main`) | **Custom Domain** `siahra-radar.co` (ทุก path) |
| `siahra-api` | `apps/api/wrangler.jsonc` | Worker + Durable Objects + cron + R2 | **Route** `siahra-radar.co/api/*` |

ทำไมไม่ใช้ route ทั้งคู่: route ต้องมี DNS record ที่ **proxied (เมฆส้ม)** ของ hostname นั้นอยู่ก่อน
และเว็บนี้ไม่มี origin server จริง — เอกสาร Cloudflare บอกตรง ๆ ว่ากรณีนี้ให้ใช้ Custom Domain แทนการ
ปั้ม `AAAA → 100::` หลอก ๆ ; Custom Domain สร้าง DNS record ที่ proxied ให้เองตอน deploy

แล้ว `/api/*` ไปถึง api ได้ยังไง: Custom Domain ทำให้ siahra-web เป็น **origin**, และ Worker
ที่ผูกด้วย *route* จะรัน **ก่อน** origin เสมอ → request ที่เข้าแพตเทิร์น `/api/*` ถูก siahra-api ตอบจบ
ไม่เคยไปถึง siahra-web ส่วน path อื่นตกไปที่ SPA ตามปกติ

รูปนี้เป็นเคสที่เอกสาร Cloudflare ยกตัวอย่างตรง ๆ (route + Custom Domain บน hostname เดียวกัน):
> "A Custom Domain for `api.example.com` points to your `api-worker` Worker. A route added to
> `api.example.com/auth` points to your `auth-worker` Worker. A request to `api.example.com/auth`
> will trigger your `auth-worker` Worker."
> — [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

ถ้าวันหน้าจะให้ api เรียก web เอง (`fetch(request)`) ก็ทำได้เพราะ Custom Domain ถูกมองเป็น origin —
ข้อจำกัด "route เรียก route ในโซนเดียวกันไม่ได้ถ้าไม่มี service binding" ไม่มีผลกับ Custom Domain

ผลคือเบราว์เซอร์เห็น **origin เดียว** เหมือนเดิม: โค้ดใน `apps/web` ยังเรียก `fetch("/api/v1/...")`
แบบ relative และ WebSocket ยังใช้ `location.host` ได้โดยไม่ต้องแก้ และ `ALLOWED_ORIGINS`
ยังปล่อยว่าง (same-origin เท่านั้น) ได้ตามเดิม

deploy แยกกันได้จริง — แก้ UI แล้ว deploy web ไม่แตะ Durable Objects, แก้ API แล้ว deploy api
ไม่ต้องอัปโหลด asset bundle ~310 MB ซ้ำ **และตอนนี้ `.github/workflows/deploy.yml` ทำให้อัตโนมัติแล้ว**
— merge เข้า `main` แล้ว job จะ diff ไฟล์ที่เปลี่ยนกับ `HEAD^` แล้วสั่ง deploy เฉพาะ Worker ที่แตะ
(ต้องตั้ง repo secret `CLOUDFLARE_API_TOKEN` และ `CLOUDFLARE_ACCOUNT_ID` ก่อนถึงจะรันผ่าน) รันมือได้เหมือนเดิมถ้าต้องการ:
```bash
npm run deploy:web    # build apps/web แล้ว wrangler deploy ใน apps/web
npm run deploy:api    # wrangler deploy ใน apps/api (ไม่ต้องมี dist)
```
ทั้งสองตัวตั้ง `"workers_dev": false` — มีแต่ host เดียวคือ `siahra-radar.co` เพราะ same-origin guard
ใน `apps/api/src/rateLimit.ts` คิดบนสมมติฐานนั้น (ถ้าอยากให้ `www` ใช้ได้ด้วย ให้ redirect www → apex
ที่ระดับ DNS/Redirect Rules ไม่ใช่เพิ่ม route ให้ Worker)

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

## 2. Worker route สำหรับ tile (เขียนแล้ว — อยู่ที่ **siahra-web** ไม่ใช่ api)
prefix `/aoi/` มีทั้ง manifest/overview ที่เป็น static asset (`apps/web/public/aoi/**`) และ tile `.bin`
ก้อนใหญ่ใน R2 และ route ของ Cloudflare **แยกตามนามสกุลไฟล์ไม่ได้** → ทั้ง prefix ต้องอยู่ใน Worker
เดียวกัน และตัวที่ถือ static asset อยู่แล้วคือ `siahra-web` (พลอยได้: งาน DO/cron ไม่ต้องมาเสิร์ฟ tile)

`apps/web/worker/index.ts` จับ `^/aoi/(\d{2})/(terrain|buildings|features|landcover)/(\d+)/(\d+)_(\d+)\.bin$`
→ `env.HAZARD_BUCKET.get("aoi/...")` + `Cache-Control: public, max-age=31536000, immutable` +
`Content-Type: application/octet-stream` และแคชด้วย Cache API (`caches.default`) กัน R2 reads ;
path อื่นส่งต่อ `env.ASSETS.fetch(request)` ; tile ที่ไม่มีใน R2 ตอบ **404** (ห้ามปล่อยให้ตกไป SPA
fallback — loader จะได้ HTML มาแทน binary แล้วพังเงียบ ๆ ซึ่งเป็นอาการที่เจอบน prod ตอนแรก)

**ไม่ต้องตั้ง `run_worker_first`** — ทดสอบใน `wrangler dev` แล้วว่า `not_found_handling:
"single-page-application"` ตอบเฉพาะ request ที่เป็น *navigation* (wrangler log ว่า
`Sec-Fetch-Mode: navigate`) ส่วน `fetch()` ของ tile ที่ไม่ใช่ asset ตกมาถึง Worker เอง จึงได้ทั้ง
สองอย่าง: SPA route ลึก ๆ ยังคืน `index.html` และ manifest ยังมาจาก asset layer โดยไม่กิน Worker
invocation (ถ้าเจอ tile ตอบ `200 text/html` แปลว่ากติกานี้เปลี่ยน ให้กลับมาใส่ `run_worker_first`)

## 3. wrangler.jsonc / secrets
ทั้งหมดนี้อยู่ที่ `apps/api/wrangler.jsonc` — `apps/web/wrangler.jsonc` ไม่มี secret และไม่มี binding
- ไม่มี KV binding แล้ว: `CONFIG` เคยมี id เป็น placeholder และไม่มีโค้ดไหนอ่านมันเลย จึงถอดออก (ถ้าวันหน้าต้องเก็บ config ที่เปลี่ยนช้า ๆ ค่อย `npx wrangler kv namespace create CONFIG` แล้วใส่ id จริงกลับมา)
- ตั้งค่า `TMD_UID`, `TMD_UKEY` (ลงทะเบียนที่ data.tmd.go.th) ผ่าน `npx wrangler secret put TMD_UKEY` แล้วลบ default ออกจาก `vars`
- `ALLOWED_ORIGINS`: ว่าง = same-origin เท่านั้น — ไม่ต้องตั้ง เพราะ route ของสอง Worker อยู่บน host
  เดียวกัน (`siahra-radar.co`) ตามหัวข้อ 0.1 ; ถ้าวันหน้าย้าย SPA ไปคนละ host ต้องใส่ origin ของ SPA ที่นี่
  **และ** เติม CORS header ใน `apps/api/src/router.ts` ด้วย ไม่ใช่ตั้งค่านี้ตัวเดียว
- migrations v1–v4 (DO SQLite) มีครบ, cron `* * * * *` มีแล้ว
- โดเมน: `wrangler deploy` สร้าง/อัปเดต Custom Domain + route ให้เองจาก `routes` ในแต่ละ config
  แต่ zone `siahra-radar.co` ต้องอยู่ใน account เดียวกันก่อน — deploy **web ก่อน api** ในครั้งแรก
  เพราะ Custom Domain ของ web เป็นตัวสร้าง DNS record ที่ proxied ให้ apex (route ของ api ต้องมี
  record นั้นก่อนจะทำงาน)
- ถ้าวันหน้าอยากให้ apex ชี้ origin อื่น (ไม่ใช่ Worker) ค่อยเปลี่ยน web จาก Custom Domain เป็น route
  `siahra-radar.co/*` — ตอนนั้นสองอันจะเป็น route ทั้งคู่และตัวที่ชนะคือแพตเทิร์นที่เจาะจงกว่า (`/api/*`)
  ไม่ใช่ลำดับใน config

## 4. Build + deploy (สองคำสั่งอิสระ)
```bash
npm run deploy:web    # build -> apps/web/dist (~310 MB, < 20,000 ไฟล์, ไฟล์ใหญ่สุด < 25 MiB) แล้ว deploy siahra-web
npm run deploy:api    # deploy siahra-api เท่านั้น — ไม่แตะ asset bundle, ไม่ต้องมี dist ในเครื่อง
```
ครั้งแรกต้องรันทั้งคู่ (คนละ Worker คนละ route) หลังจากนั้นรันเฉพาะฝั่งที่แก้
CI (`.github/workflows/ci.yml` job `Build`) รัน `wrangler deploy --dry-run` ทั้งสอง config ทุก PR

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
> เครื่องที่ใช้ deploy อยู่หลัง TLS-inspecting filter (FortiGate) — `curl` ธรรมดาจะฟ้อง
> `unable to get local issuer certificate` กับ **ทุก** โฮสต์ และ GET body จะถูกแทนด้วยหน้า
> `403 Web Filter Violation` ของตัว filter เอง ใช้ `curl -sk -I` (HEAD) ตรวจ status/content-type
> แทน แล้วเช็ค cert จริงจากเครือข่ายอื่น ; ดูผู้ออกใบด้วย
> `echo | openssl s_client -connect siahra-radar.co:443 -servername siahra-radar.co | openssl x509 -noout -issuer`

- `curl https://siahra-radar.co/api/v1/health` → ทุก source `ok` ภายใน 5 นาที (alarm ของ DO เริ่มเอง)
  ตอบ 200 = route `/api/*` ชี้ไป siahra-api ถูกแล้ว; ถ้าได้ HTML ของ SPA แทน = route ไม่ทำงาน
- `curl -I https://siahra-radar.co/` → HTML จาก siahra-web (deploy คนละครั้งกับ api ได้)
- เปิดเว็บ → tile โหลดจาก `/aoi/...` (Network tab: `cf-cache-status: HIT` ในรอบสอง)
- ดู R2: `archive/snapshots/<day>/<HH>.json.gz` เกิดทุกชั่วโมง, `archive/waterlevel/<day>/<province>.json.gz` เกิดตอนตี 0:20 (เวลาไทย)

## ค่าใช้จ่ายโดยประมาณ
Workers Paid $5 + R2 (< 10 GB ฟรี; เกินคิด $0.015/GB) + คลังถาวร ~0.5–1 GB/เดือน → รวม ≈ $5–8/เดือนที่ traffic ระดับหลักพัน–หมื่น session
