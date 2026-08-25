# SIAHRA — คู่มือ deploy ขึ้น Cloudflare

**deploy ครั้งแรกแล้ว 2026-08-17** ที่ account `Flukelaster` / zone `siahra-radar.co`: `siahra-web`
(Custom Domain, 709 asset) + `siahra-api` (route `/api/*`, DO migrations v1–v6, cron ทุกนาที) และ
R2 bucket `siahra-geodata` ตรวจแล้วว่า `/api/v1/health` คืน JSON, `/` กับ deep link คืน HTML ของ SPA,
`/aoi/{code}/manifest.json` คืน static asset — เอกสารนี้ใช้เป็นขั้นตอนสำหรับ deploy รอบถัดไป

## 0. สิ่งที่ต้องมี
- Cloudflare account ที่เปิด **Workers Paid** ($5/เดือน — จำเป็นเพราะใช้ Durable Objects)
- โดเมน `siahra-radar.co` เป็น zone ใน account เดียวกัน (route ของทั้งสอง Worker ผูกกับ zone นี้)
- `npx wrangler login` ในเครื่องที่จะ deploy
- Node 20+, gdal/osmium (เฉพาะถ้าจะสร้าง tile ใหม่)
- **secret ของ `siahra-api` ตั้งครบก่อน deploy** (ไม่ได้อยู่ใน `wrangler.jsonc` แล้ว — ดู §3):
  ```bash
  cd apps/api
  npx wrangler secret put TMD_UID     # ลงทะเบียนที่ data.tmd.go.th
  npx wrangler secret put TMD_UKEY
  npx wrangler secret put TMD_NWP_TOKEN   # คนละระบบกับสองตัวบน — ดู §3
  ```
  ยังไม่ตั้งก็ deploy ผ่าน แต่จะเสื่อมให้เห็นทีละแหล่ง: ไม่มี `TMD_UID`/`TMD_UKEY` เฉพาะฟีดแผ่นดินไหวจะรายงานที่
  `/api/v1/health` ว่า source `earthquakes` เป็น `degraded` พร้อม `lastError: "TMD credentials not configured"`
  ส่วนไม่มี `TMD_NWP_TOKEN` จะทำให้ source `tmd-nwp` เป็น `degraded` พร้อม `lastError: "TMD NWP token not
  configured"` (USGS/EMSC และแหล่งที่เหลือทำงานตามปกติในทั้งสองกรณี) — ตั้งใจให้เห็นชัดแทนที่จะแอบใช้คีย์สาธารณะร่วมกับคนอื่น
  เครื่อง dev ใช้ `apps/api/.dev.vars` (gitignored) โดยคัดลอกจาก `apps/api/.dev.vars.example`

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
ไม่ต้องอัปโหลด asset bundle ~98 MiB ซ้ำ **และตอนนี้ `.github/workflows/deploy.yml` ทำให้อัตโนมัติแล้ว**
— merge เข้า `main` แล้ว job จะ diff ไฟล์ที่เปลี่ยนกับ `HEAD^` แล้วสั่ง deploy เฉพาะ Worker ที่แตะ
(ต้องตั้ง repo secret `CLOUDFLARE_API_TOKEN` และ `CLOUDFLARE_ACCOUNT_ID` ก่อนถึงจะรันผ่าน) รันมือได้เหมือนเดิมถ้าต้องการ:
```bash
npm run deploy:web    # check:aoi → build apps/web → wrangler deploy ใน apps/web
npm run deploy:api    # wrangler deploy ใน apps/api (ไม่ต้องมี dist)
```
`deploy:web` เริ่มด้วย `npm run check:aoi` (= `node scripts/check-building-tiles.mjs`) เสมอ —
ด่านของ E8.3 ที่ยืนยันว่าทั้ง 77 จังหวัดยังมี `buildings.tiles` (อย่างน้อย 1 level) ใน manifest
ก่อนจะ deploy ชุดข้อมูลที่ไม่มี `buildings.geojson` แล้ว และยืนยันว่า AOI ที่ยังใช้ geojson อยู่
(`chiangmai-old-city`) ยังมีไฟล์ที่ `buildings.url` ชี้อยู่จริง — manifest ที่โฆษณา url ไปยังไฟล์
ที่ไม่ได้ ship คือแหล่งข้อมูลตาย จึงถือว่าสอบตก รันมือได้ตลอด: `npm run check:aoi`
(ตั้งใจไม่ทำเป็น job ใน `ci.yml` — นี่คือ invariant ของชุดข้อมูลใน working tree ไม่ใช่ของโค้ด)
ทั้งสองตัวตั้ง `"workers_dev": false` — มีแต่ host เดียวคือ `siahra-radar.co` เพราะ same-origin guard
ใน `apps/api/src/rateLimit.ts` คิดบนสมมติฐานนั้น (ถ้าอยากให้ `www` ใช้ได้ด้วย ให้ redirect www → apex
ที่ระดับ DNS/Redirect Rules ไม่ใช่เพิ่ม route ให้ Worker)

## 1. R2 สำหรับ tile และคลังถาวร
```bash
npx wrangler r2 bucket create siahra-geodata
```
อัปโหลด tile (~5.6 GB, ~190k ไฟล์) จาก `apps/etl/data/tiles/{code}/(terrain|buildings|features|landcover)/...`
แนะนำ rclone (เร็วกว่า wrangler มาก):
ห่อไว้ใน `scripts/upload-tiles.sh` แล้ว (ตั้ง remote ผ่าน env ไม่ต้อง `rclone config` คีย์จึงไม่ตกค้าง):
```bash
brew install rclone
# สร้าง R2 API token (Object Read & Write) ที่ Dashboard → R2 → Manage API Tokens
cat > scripts/.env.r2 <<'EOF'   # gitignored
CLOUDFLARE_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
EOF
scripts/upload-tiles.sh --smoke   # อัปไฟล์เดียวแล้ว HEAD ดูบน prod ก่อนลงทุน 5.6 GB
scripts/upload-tiles.sh           # อัปทั้งหมด (~1–3 ชม.; ข้ามของที่มีแล้ว, resume ได้, ไม่ลบอะไรบน R2)
scripts/upload-tiles.sh 11 12     # หรือทีละจังหวัด
scripts/verify-tiles.sh           # ตรวจ 77 จังหวัด × 4 ชนิด × (z ตื้นสุด+ลึกสุด) × 2 prefix
```
key ที่ได้จะเป็น `aoi/{code}/terrain/{z}/{x}_{y}.bin` ตรงกับ URL `/aoi/{code}/terrain/...` ที่ client เรียก

ตั้งแต่ E9.2 มี prefix แบบมีรุ่นเพิ่มมาอีกชุด (`aoi/{code}/v/{ver}/{layer}/...`) ซึ่งสร้างด้วย
server-side copy ในฝั่ง R2 ไม่ต้องดึงไบต์ผ่านเครื่องที่รัน:
```bash
scripts/upload-tiles.sh --version=2026-08-17 --copy --smoke   # ก๊อปไฟล์เดียวแล้ว HEAD ดูก่อน
scripts/upload-tiles.sh --version=2026-08-17 --copy           # ก๊อปทั้งชุด
```
แต่ปกติ **ไม่ต้องเรียกสองคำสั่งนี้เองตอนปล่อยรุ่น**: `scripts/release-dataset.sh` เป็นตัวเรียงให้
ทั้ง build → checksum → upload → verify → manifest diff และหยุดทันทีที่ขั้นไหนไม่ผ่าน — ขั้นตอน
เต็มกับวิธีถอยอยู่ที่ [`docs/dataset-release.md`](./dataset-release.md) ส่วนนโยบาย "prefix เดิม
ห้ามลบ" อยู่ที่ [`docs/dataset.md` §7](./dataset.md) — สคริปต์ทั้งสองโหมดเป็น append-only
(`rclone copy` ไม่มี `sync` แล้ว) จึงไม่ลบไฟล์บน R2 ให้เองไม่ว่ากรณีใด

**คอขวดคือจำนวนไฟล์ ไม่ใช่ขนาด** — 302,689 ไฟล์ / 5.6 GB ; write อยู่ในโควตาฟรี (< 1M Class A
writes/เดือน แม้ตอนก๊อปทั้งชุด) แต่ **storage ไม่อยู่แล้วตั้งแต่รุ่นที่สอง**: prefix เดิมห้ามลบ
(`docs/dataset.md` §7) สองชุดจึงกินราว 10.3 GiB ทะลุ 10 GB ฟรีของ R2 ส่วนที่เกินคิด $0.015/GB/เดือน
(รวมอยู่ในประมาณการท้ายเอกสารแล้ว) ; เครื่องที่อยู่หลัง FortiGate อาจอัปไม่ผ่าน (ดู §6) — ถ้า `--smoke` ล้ม
ให้รันจากเครือข่ายอื่น หรือส่ง CA ขององค์กรเข้าไปด้วย `--ca-cert`

## 2. Worker route สำหรับ tile (เขียนแล้ว — อยู่ที่ **siahra-web** ไม่ใช่ api)
prefix `/aoi/` มีทั้ง manifest/overview ที่เป็น static asset (`apps/web/public/aoi/**`) และ tile `.bin`
ก้อนใหญ่ใน R2 และ route ของ Cloudflare **แยกตามนามสกุลไฟล์ไม่ได้** → ทั้ง prefix ต้องอยู่ใน Worker
เดียวกัน และตัวที่ถือ static asset อยู่แล้วคือ `siahra-web` (พลอยได้: งาน DO/cron ไม่ต้องมาเสิร์ฟ tile)

`apps/web/worker/index.ts` อ่าน path ด้วย `apps/web/worker/tilePath.ts` (ตัวเดียวกับที่ middleware
ตอน dev ใน `apps/web/vite.config.ts` ใช้) ซึ่งรับสองรูปแบบ: `/aoi/{code}/v/{ver}/{layer}/{z}/{x}_{y}.bin`
แบบมีรุ่น (E9.2) และ `/aoi/{code}/{layer}/{z}/{x}_{y}.bin` แบบเดิมที่ยังต้องเสิร์ฟตลอดไป —
URL แบบมีรุ่นแปลงเป็น key แบบมีรุ่นเสมอ ไม่มีการตัด `v/{ver}` ทิ้งไปหยิบไฟล์ของ prefix เดิมมาตอบ
(ไม่มีไฟล์ในรุ่นนั้น = 404 ดู `docs/dataset.md` §7)
→ `env.HAZARD_BUCKET.get("aoi/...")` + `Cache-Control: public, max-age=31536000, immutable` +
`Content-Type: application/octet-stream` และแคชด้วย Cache API (`caches.default`) กัน R2 reads ;
path อื่นส่งต่อ `env.ASSETS.fetch(request)` ; tile ที่ไม่มีใน R2 ตอบ **404** (ห้ามปล่อยให้ตกไป SPA
fallback — loader จะได้ HTML มาแทน binary แล้วพังเงียบ ๆ ซึ่งเป็นอาการที่เจอบน prod ตอนแรก)

**ไม่ต้องตั้ง `run_worker_first`** — เก็บไว้เพราะ manifest/hillshade ที่ track ไว้ใต้ `/aoi/` ยัง
มาจาก asset layer โดยไม่กิน Worker invocation ส่วนพฤติกรรมของ SPA fallback มี **สองผลการวัดที่ไม่
ตรงกัน เก็บไว้ทั้งคู่** (อย่าลบอันใดอันหนึ่งทิ้ง):

- `wrangler dev` (ตอนที่เขียนบรรทัดนี้): `not_found_handling: "single-page-application"` ตอบเฉพาะ
  request ที่เป็น *navigation* (wrangler log ว่า `Sec-Fetch-Mode: navigate`) ส่วน `fetch()` ของ
  tile ที่ไม่ใช่ asset ตกมาถึง Worker เอง
- **prod วัดจริง 2026-08-20 (`curl -I`)**: ไม่เป็นแบบนั้น — path ที่ Worker ที่ deploy อยู่ไม่รับ
  (เช่น `/aoi/11/v/2026-08-17/terrain/0/0_0.bin`) ตอบ `200 text/html` คือ `index.html`
  **ไม่ใช่ 404** แม้จะส่ง `Accept: application/octet-stream` มาก็ตาม ส่วน path ที่ Worker รับ
  ยังมาถึง Worker ปกติ (`/aoi/11/terrain/0/9999_9999.bin` → `404 text/plain` จาก Worker เอง)

สาเหตุของความต่างยัง **ไม่ได้พิสูจน์** (อาจเป็น `env.ASSETS.fetch(request)` ของ Worker เองที่เป็น
คนคืน shell ก็ได้ — ดูคอมเมนต์ใน `apps/web/wrangler.jsonc`) แต่ผลที่ต้องยึดคือ: **สถานะอย่างเดียว
พิสูจน์ไม่ได้ว่าไทล์ถึงจริง** ทุกจุดที่ยิงไทล์จึงต้องเช็ค `application/octet-stream` ด้วย

## 3. wrangler.jsonc / secrets
ทั้งหมดนี้อยู่ที่ `apps/api/wrangler.jsonc` — `apps/web/wrangler.jsonc` ไม่มี secret และไม่มี binding
- ไม่มี KV binding แล้ว: `CONFIG` เคยมี id เป็น placeholder และไม่มีโค้ดไหนอ่านมันเลย จึงถอดออก (ถ้าวันหน้าต้องเก็บ config ที่เปลี่ยนช้า ๆ ค่อย `npx wrangler kv namespace create CONFIG` แล้วใส่ id จริงกลับมา)
- `TMD_UID`, `TMD_UKEY` เป็น **secret** ล้วน ไม่มี default ใน `vars` และไม่มี fallback ในโค้ดแล้ว
  (`apps/api/src/ingestion/tmd.ts`) — ตั้งด้วย `npx wrangler secret put TMD_UID` / `TMD_UKEY` ตาม §0
  ; ตรวจว่ามีอยู่จริงด้วย `npx wrangler secret list` (ค่าไม่ถูกแสดง แสดงแค่ชื่อ)
- **TMD มี API สองระบบที่แยกขาดจากกัน — อย่าเอา credential สลับช่องกัน**

  | API | ยืนยันตัวตน | ข้อมูล | SIAHRA ใช้ |
  |---|---|---|---|
  | `data.tmd.go.th/api/DailySeismicEvent/v1/` | `uid` + `ukey` (สมัคร `…/api/registerPre.php`) | เหตุการณ์แผ่นดินไหว | ✅ `TMD_UID`/`TMD_UKEY` |
  | `data.tmd.go.th/nwpapi/v1/` | OAuth Bearer token (สมัคร `…/nwpapi/register`) | พยากรณ์อากาศจากแบบจำลอง | ✅ `TMD_NWP_TOKEN` (E12.2) |

  ระบบ OAuth **ไม่ได้มาแทน** ระบบ `uid`/`ukey` — ทั้งคู่ยังให้บริการอยู่คนละชุดข้อมูล ถ้าจะดึง
  ข้อมูลพยากรณ์จาก `nwpapi` มาแสดง ต้องมาพร้อม `HazardLayerDescriptor` แบบ **`forecast`** ไม่ใช่
  `probabilistic` — NWP ของ TMD เป็นแบบจำลอง **เชิงกำหนด (deterministic)** ไม่ได้ให้ค่าความน่าจะเป็น
  (E12.1 เพิ่มชนิด `forecast` ลงใน `packages/shared-types/src/hazard-layer.ts` แล้ว) — และต้องอ้างอิง
  แบบจำลองที่ยกมาอ้างได้ ตามกฎ data honesty ใน `AGENTS.md` — ห้ามแสดงตัวเลขพยากรณ์ลอย ๆ

  อีกข้อที่ต้องรู้ก่อนต่อท่อ: `nwpapi` คืนมาแต่ **เวลาที่ค่ามีผล (valid time)** ไม่เคยบอกเวลารอบรัน
  ของแบบจำลอง `forecast.issuedAt` ของแหล่งนี้จึงเป็น `null` เสมอ และห้ามเอา `fetchedAt` มาใส่แทน
- **`TMD_NWP_TOKEN`** (E12.2) — bearer token ของ `nwpapi` ตั้งด้วย
  `npx wrangler secret put TMD_NWP_TOKEN` (เครื่อง dev อ่านจาก `apps/api/.dev.vars`)
  ยังไม่ตั้งก็ deploy ผ่าน แต่ `/api/v1/health` จะรายงาน source `tmd-nwp` เป็น `degraded` พร้อม
  `lastError: "TMD NWP token not configured"` และ `/api/v1/provinces/{NN}/forecast` จะตอบ
  `batch: null` — คือ "ยังไม่เคยได้รับข้อมูล" ไม่ใช่ "แบบจำลองบอกว่าไม่มีอะไร" แหล่งอื่นไม่กระทบ

  **token หมดอายุ** — ที่ TMD ออกให้เป็น JWT อายุ 365 วัน ตัวที่ใช้อยู่หมดอายุ **2027-08-18**
  หลังจากนั้นแหล่งนี้จะขึ้น `lastError: "TMD NWP token rejected (401)"` จนกว่าจะออก token ใหม่แล้ว
  `wrangler secret put` ทับ — เขียนไว้ตรงนี้เพื่อไม่ให้กลายเป็นเหตุขัดข้องลึกลับในอีกหนึ่งปี

  โควตาของ `nwpapi`: 100,000 datapoint/ชม. (คิดจาก `locations × duration × fields`) และ 60 คำขอ/นาที
  หนึ่งรอบของเรา = 6 ภาค × (hourly+daily) + availability = **13 คำขอ** และ 77×48×3 + 77×7×2 = **12,166
  datapoint (12%)** รอบละชั่วโมง ค่า `x-datapoint-remaining` / `x-ratelimit-remaining` ที่ต้นทางส่งกลับมา
  ถูกเก็บไว้ใน `detail` ของ `/api/v1/health` เพื่อให้เห็นทันทีถ้าโควตาถูกเปลี่ยน

  **`wrangler secret put` ในเชลล์ non-interactive อาจอัปโหลดค่าว่างได้เงียบ ๆ** — เหตุการณ์จริง
  2026-08-23/24: `TMD_NWP_TOKEN` ถูกตั้งด้วยคำสั่งที่รัน stdin ว่าง (เช่น เรียกจากสคริปต์/เอเจนต์ที่
  ไม่มี TTY โดยไม่ pipe ค่าเข้าไปจริง) แล้ว wrangler ยังพิมพ์ `✨ Success! Uploaded secret
  TMD_NWP_TOKEN` เหมือนสำเร็จปกติ — ผลคือ `env.TMD_NWP_TOKEN` เป็นสตริงว่างตลอดมา แต่
  `wrangler secret list` (แสดงแค่ชื่อ) และ `wrangler versions view` (ยืนยันแค่ว่า secret name
  ผูกกับ version) ต่างก็บอกว่า "มี secret นี้อยู่" เหมือนกันทั้งคู่ ไม่มีเครื่องมือไหนแยกความต่าง
  ระหว่าง "ชื่อ secret ผูกอยู่" กับ "ค่า secret ไม่ว่าง" ได้เลย ใช้เวลาสืบเกือบทั้งวันกว่าจะเจอด้วย
  `wrangler tail --format=json` จับ log จริงตอน retry ที่บอกว่า token ยังไม่ถูกตั้งค่า ทั้งที่ทุก
  อย่างดู "ผูกอยู่" หมด — **บทเรียน**: ตั้ง secret เสมอด้วยการ pipe ค่าจากไฟล์ที่รู้ว่าใช้ได้ เช่น
  `set -a && . ./.dev.vars && set +a && printf '%s' "$TMD_NWP_TOKEN" | npx wrangler secret put
  TMD_NWP_TOKEN` และยืนยันว่าใช้ได้จริงด้วยการดูแหล่งฟื้นตัวจริง (`/api/v1/health` ขึ้น `ok` พร้อม
  จำนวน province ที่ดึงได้) ไม่ใช่ดูแค่ข้อความ success หรือ `wrangler secret list`/`versions view`
- เรดาร์ฝน (`apps/api/src/ingestion/tmdRadar.ts`) ดึงจาก `weather.tmd.go.th/composite/` ซึ่ง**ไม่ต้อง
  ยืนยันตัวตน** — ไม่เกี่ยวกับ secret คู่บน
- `ALLOWED_ORIGINS`: ว่าง = same-origin เท่านั้น — ไม่ต้องตั้ง เพราะ route ของสอง Worker อยู่บน host
  เดียวกัน (`siahra-radar.co`) ตามหัวข้อ 0.1 ; ถ้าวันหน้าย้าย SPA ไปคนละ host ต้องใส่ origin ของ SPA ที่นี่
  **และ** เติม CORS header ใน `apps/api/src/router.ts` ด้วย ไม่ใช่ตั้งค่านี้ตัวเดียว
- migrations v1–v8 (DO SQLite) มีครบ, cron `* * * * *` มีแล้ว — v5 สร้าง `AlertEngineDO` ตัวเก่า
  (ทะเบียนสถานีปลอม, E11.5 revert), v6 ลบคลาสทิ้ง, v7 สร้าง `AlertEngineDO` ใหม่ทั้งหมด (E11.5 จริง —
  สถานีจริง, ระดับจาก `computeExposure()`, ไม่มี write route), v8 สร้าง `ForecastNwpDO` (E12.2, binding
  `FORECAST_NWP`) เป็นคลาสใหม่ล้วน ๆ **ไม่ได้** นำ `ForecastPointerDO` มาใช้ซ้ำทั้งที่ชื่อคล้ายกัน — ตัวนั้นคือ
  ตัวชี้ exposure run (E10.3) และการนำมาใช้ซ้ำต้องลบคลาสก่อน ซึ่งทำลายข้อมูลที่เก็บอยู่ tag ที่ apply ไปแล้วห้ามลบออกจาก
  `wrangler.jsonc` เพราะ Cloudflare เทียบ migrations กับ tag ล่าสุดที่ apply บน production
- โดเมน: `wrangler deploy` สร้าง/อัปเดต Custom Domain + route ให้เองจาก `routes` ในแต่ละ config
  แต่ zone `siahra-radar.co` ต้องอยู่ใน account เดียวกันก่อน — deploy **web ก่อน api** ในครั้งแรก
  เพราะ Custom Domain ของ web เป็นตัวสร้าง DNS record ที่ proxied ให้ apex (route ของ api ต้องมี
  record นั้นก่อนจะทำงาน)
- ถ้าวันหน้าอยากให้ apex ชี้ origin อื่น (ไม่ใช่ Worker) ค่อยเปลี่ยน web จาก Custom Domain เป็น route
  `siahra-radar.co/*` — ตอนนั้นสองอันจะเป็น route ทั้งคู่และตัวที่ชนะคือแพตเทิร์นที่เจาะจงกว่า (`/api/*`)
  ไม่ใช่ลำดับใน config

## 4. Build + deploy (สองคำสั่งอิสระ)
```bash
npm run deploy:web    # check:aoi -> build -> apps/web/dist (~98 MiB, < 20,000 ไฟล์, ไฟล์ใหญ่สุด < 25 MiB) แล้ว deploy siahra-web
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
- `curl -sk -I https://siahra-radar.co/og-image.jpg` → `200 image/jpeg` แล้วลองวางลิงก์ใน LINE/Facebook ให้เห็นการ์ดพรีวิว
  (`apps/web/index.html` ชี้ `og:image` เป็น URL เต็ม; ถ้าเปลี่ยนรูป ให้เปลี่ยนชื่อไฟล์หรือ re-scrape ที่ Facebook Sharing Debugger / LINE Poker เพราะ scraper cache ตาม URL)
- ดู R2: `archive/snapshots/<day>/<HH>.json.gz` เกิดทุกชั่วโมง, `archive/waterlevel/<day>/<province>.json.gz` เกิดตอนตี 0:20 (เวลาไทย)

## ค่าใช้จ่ายโดยประมาณ
Workers Paid $5 + R2 (< 10 GB ฟรี; เกินคิด $0.015/GB) + คลังถาวร ~0.5–1 GB/เดือน → รวม ≈ $5–8/เดือนที่ traffic ระดับหลักพัน–หมื่น session

**เพดานของทั้งบัญชีคือ $5–10/เดือน** (`AGENTS.md` "Cost budget") — งานใดที่แตะ Durable Objects, D1, R2, cron/alarm หรือ
Workers Logs ต้องผ่าน agent `devops` (`.claude/agents/devops.md`, อ่านอย่างเดียว ไม่แก้โค้ด) ก่อน senior-se จะเริ่มเขียน
(`/implement` ขั้น 1b) และอีกครั้งบน diff ที่เสร็จแล้ว (ขั้น 2b): มันคิด ความถี่ × แถวที่สแกน (หรือ ops / log events) ต่อเส้นทาง
แล้วตีราคาจากหน้า pricing ของ Cloudflare — `stop` เมื่อยอดรวมคาดการณ์เกิน $8 (กรณีปกติ) / $10 (กรณีแย่สุด) หรือค่าครั้งเดียวเกิน $2
ซึ่งเฉพาะผู้ใช้เท่านั้นที่ override ได้ โดยต้องเห็นตัวเลขก่อนตัดสินใจ

ตั้งแต่ E12.2 มีอีกมิติที่ขยับ: `/api/v1/health` กระจายไปหา Durable Object **7 คำขอต่อครั้ง แทนที่จะเป็น 6**
(หก instance — `ObservationCacheDO` ถูกถามสองครั้ง) จำนวน DO requests จึงเพิ่มราว 17% กรณีแย่สุดประมาณ 1.2M
เทียบกับโควตาที่รวมมา 1M ต่อรอบบิล = ราว **$0.03–0.10/เดือน** ส่วนตัว `ForecastNwpDO` เองเขียนราว 66k–130k
แถว/รอบบิล (0.13–0.26% ของ 50M) เพราะเก็บหนึ่งแถวต่อจังหวัด ไม่มีตารางประวัติ และไม่มี `DELETE` ตามอายุ
(ดู `docs/ops.md` §9)

E14.F1 (`/api/v1/provinces/{NN}/flood-extent?at=`) เพิ่มเส้นทางย้อนหลังโดยไม่เพิ่ม DO write ต่อคำขอ: ตาราง `flood_scenes`
เขียนหนึ่งแถวต่อฉากที่ archive (ไม่กี่ร้อยแถว/ปี) บนเส้นทาง refresh เท่านั้น คำขอ `at` ภายใน 30 วันอ่านตาราง hot ผ่านดัชนี
จังหวัด เก่ากว่านั้นอ่าน R2 หนึ่งครั้งต่อฉากต่อชั่วโมง (แคชในหน่วยความจำของ DO สูงสุด 8 ฉาก ไม่มี `list()`) และตอบด้วย
`public, max-age=3600, s-maxage=86400` เมื่อหาฉากได้ (ฝั่งเว็บปัด `at` เป็นช่วง 10 นาทีและ debounce การลาก จึงหนึ่ง gesture =
หนึ่งคำขอ) — `devops` ประเมินไว้ราว **+$0.01/เดือน** กรณีปกติ, $0.10 กรณีแย่สุด

**รายการที่สี่ที่ประมาณการข้างบนไม่ได้นับ และเป็นตัวที่ทำให้บิลบานจริง: Durable Objects SQL rows read**
— คิดตามแถวที่ถูก *สแกน* ไม่ใช่แถวที่ถูกคืนหรือถูกลบ (Workers Paid รวมมาให้ 25B แถว/รอบบิล)
วัด**ก่อนแก้** (คอมมิต `2e2ecf5`) บนโปรดักชันรอบ 2026-08-18..23: **72.38B rows read เทียบกับ 4.16M rows written** บนสตอเรจ SQL
รวมเพียง 64.57 MB — ทะลุโควตาที่รวมมา คิดเงินไปแล้ว $20.31 และคาดการณ์ทั้งรอบที่ $104.95
ปริมาณข้อมูลจึงไม่ใช่ตัวปัญหา แต่เป็นคิวรีที่สแกนทั้งตารางซ้ำ ๆ: PK ของ `waterlevel_history` และ
`hourly_levels` คือ `(station_id, ts_ms)` การกรองหรือเรียงด้วย `ts_ms` เดี่ยว ๆ จึงใช้ PK ไม่ได้และกลาย
เป็น full scan ถ้าไม่มีดัชนี `ts_ms` มารับ กติกาที่กันไม่ให้มันกลับมาอยู่ใน
`apps/api/src/durable-objects/observation-cache.ts`: การกวาดแถวพ้นอายุอยู่ที่ `pruneRetention()`
ซึ่งวิ่ง**ชั่วโมงละครั้งบนเส้นทาง refresh** ไม่ใช่ท้าย `pullHistory()` ที่ถูกเรียกรายสถานี (การดูหนึ่งจังหวัด
วอร์มได้ถึง 24 สถานี) และ `exposureHistory()` `ORDER BY ts_ms` โดยตั้งใจ ไม่ใช่ตาม PK
