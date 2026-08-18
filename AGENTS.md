# SIAHRA — คู่มือสำหรับ agent/ผู้ร่วมพัฒนา

**SIAHRA** (Spatial Intelligence Atlas for Hazard & Resilience Analytics) — แผนที่ 3 มิติรายจังหวัดของไทยที่ซ้อนข้อมูลภัยพิบัติ*ที่ตรวจวัดจริง* (ThaiWater/สสน., GISTDA, TMD, USGS/EMSC) บน Three.js + React (Vite) และ Cloudflare Worker (Durable Objects, R2). แผนภาพรวมอยู่ใน `SIAHRA-implement-plan.md`, ขั้นตอน deploy ใน `docs/deploy.md`.

## กติกาที่ห้ามละเมิด (data honesty)
- ทุกชั้นข้อมูลต้องประกาศ `HazardLayerDescriptor` (`packages/shared-types/src/hazard-layer.ts`): observed / static-reference / illustrative / probabilistic และ UI ต้องบอกเวลาข้อมูล (`fetchedAt`/`observedAt`) เสมอ
- **ห้ามสร้างตัวเลขพยากรณ์เอง** — ไม่มี "% โอกาสน้ำท่วม" ที่ไม่ได้มาจากโมเดลที่มีการอ้างอิง; ชั้น "พื้นที่ลุ่มต่ำ" เป็น *illustrative* จาก DEM และเขียนไว้ใน legend เช่นนั้น
- ข้อมูลค้าง/แหล่งล่มต้องมองเห็นได้ (จุดจาง, ป้าย, แถบสถานะจาก `/api/v1/health`) ไม่ใช่เงียบหาย; `fetchedAt` เป็น null เมื่อไม่เคยดึงสำเร็จ — ห้ามแทนด้วย "ตอนนี้"
- ค่าย้อนหลัง (timeline) ไม่มี `situationLevel` ของ ThaiWater → สีคิดจากระยะต่ำกว่าตลิ่งและบอกไว้ชัด

## โครงสร้าง
- `apps/web` — **deploy unit ที่ 1** (Worker `siahra-web`, `wrangler.jsonc` เป็น assets-only ไม่มี `main`): React 19 + Vite + Tailwind 4 + three r185 (raw scene graph ไม่ใช้ R3F): `src/scene/*` (TerrainTiles LOD, BuildingTiles, FeatureTiles, VegetationTiles, RadarOverlay, floodMask, terrainMaterial shader), `src/components/layout/Map3DCanvas.tsx` เป็นตัวประกอบทุกชั้น, workers ใน `src/workers/*`
- `apps/api` — **deploy unit ที่ 2** (Worker `siahra-api`, ไม่มี `assets` block แล้ว): `src/router.ts` (ตาราง route + rate limit + same-origin guard), DOs ใน `src/durable-objects/*` (ObservationCacheDO = ThaiWater + history + dams + archive, FloodExtentDO, RadarDO, EarthquakeFeedDO), ingestion ใน `src/ingestion/*`, คลังถาวรใน `src/archive.ts`
- `apps/etl` — gdal/osmium pipelines: `build:all`, `build:tiles`, `build:building-tiles`, `build:feature-tiles`, `build:landcover-tiles` → ผลลัพธ์เล็ก (manifest/overview) ใน `apps/web/public/aoi/{code}` (tracked) และ tile ใหญ่ใน `apps/etl/data/tiles` (gitignored, ~5.6 GB, เสิร์ฟใน dev ด้วย middleware ใน `apps/web/vite.config.ts`, prod = R2)
- `packages/shared-types` — สัญญาข้อมูลระหว่าง api/web/etl (แก้ที่นี่ก่อนเสมอ)
- สอง Worker อยู่บน host เดียว (`siahra-radar.co`): web ถือ Custom Domain (ทุก path), api ผูก route `/api/*` ซึ่งรัน**ก่อน** origin จึงกิน `/api/*` ไปก่อน — ยัง same-origin (relative `fetch("/api/v1/...")`, WS ใช้ `location.host`, `ALLOWED_ORIGINS` ว่าง) — **deploy แยกกัน**: `npm run deploy:web` / `npm run deploy:api` (ดู `docs/deploy.md` §0.1)

## รัน
- `npm run dev` (root) = vite :5173 + wrangler :8787 (ใน worktree ใช้พอร์ตจาก `.env.worktree`) — vite เสิร์ฟ SPA และ proxy `/api` ไป wrangler; **ไม่ต้องมี `apps/web/dist`** อีกแล้ว (build เฉพาะเวลาจะ deploy web หรือเช็คขนาด asset bundle: `npm run build -w apps/web`)
- ตรวจ: `npx tsc -b` ใน apps/web, `npx tsc --noEmit` ใน apps/api และ apps/etl, `npx oxlint src` ใน apps/web
- ดูภาพจริง: `playwright-cli -s=<session> open http://localhost:5173` แล้ว `screenshot` (wheel zoom ไม่ทำงาน headless — ใช้ปุ่มซูม/ลาก) ; มี `window.__siahraHandles` ใน dev สำหรับสั่งกล้อง
- cron ไม่ยิงใน wrangler dev — DO ทุกตัวตั้ง alarm เอง; ยิงมือได้ที่ `GET /__scheduled?cron=*+*+*+*+*`

## Orca worktree
`orca.yaml` → `.orca/setup.sh` → `scripts/setup-worktree.sh` (symlink dataset, copy state, จองพอร์ต, npm ci — ไม่ build web แล้ว) ; Quick Command รัน `.orca/run.sh`; archive hook หยุด dev server ของ worktree นั้นเท่านั้น

## Git workflow (บังคับด้วย ruleset บน GitHub — `.github/rulesets/main.json`)
- **ห้าม push ตรงเข้า `main`** ไม่ว่าเล็กหรือด่วนแค่ไหน — แตก branch → เปิด PR เสมอ แม้ผู้ใช้จะพูดว่า "push" ก็ตาม (เว้นแต่สั่ง override ชัด ๆ ในตอนนั้น); ruleset ไม่มี bypass จึง push ตรงจะถูกปฏิเสธอยู่ดี
- `main` merge ได้เมื่อ status check ผ่านครบ: **Lint / TypeScript / Build** (`.github/workflows/ci.yml` — คำสั่งเดียวกับหัวข้อ "ตรวจ" ด้านบน) ; ห้ามเพิ่ม job ที่ path-filter ไว้เป็น required check (PR ที่ไม่แตะ path นั้นจะรอตลอดกาล)
- กติกา "PR เป็นอังกฤษ" และ "แก้ UI ต้องมีภาพ" **ยังบังคับใช้เหมือนเดิม แต่ไม่มี CI job คอยจับแล้ว** (`pr-rules.yml` ถูกถอดออกเพราะกิน Actions minutes) — คนตรวจคือ `/implement` ขั้นก่อนเปิด PR และตัวคุณเองเมื่อเปิด PR ด้วยมือ
- **PR และ commit message ต้องเป็นภาษาอังกฤษทั้งหมด** (subject และ body) — เช็คเองก่อนยิง:
  `printf '%s' "$TITLE$BODY" | LC_ALL=C.UTF-8 grep -Pq '[\x{0E00}-\x{0E7F}]'` เจอแล้วให้เขียนใหม่ (`gh pr edit <n> --title/--body`, `git commit --amend` ถ้ายังไม่ push)
  ; **คอมเมนต์ในโค้ดยังเขียนไทยได้ตามเดิม** — กติกานี้คุมเฉพาะสิ่งที่คนนอกอ่านก่อนใน repo สาธารณะ คือ log กับหน้ารีวิว
- **แก้ UI ต้องมีภาพหน้าจอใน PR** — ถ้า PR แตะ `apps/web/src/{components,scene}/**`, `App.tsx`, `main.tsx`, `index.css`, `branding.ts`, `index.html` หรือไฟล์ระดับบนใน `public/` (ไม่รวม `public/aoi/**`) คำอธิบาย PR ต้องมีรูปอย่างน้อย 1 รูป: ถ่ายจาก dev server ด้วย `playwright-cli` แล้ว `scripts/pr-media.sh "$(git branch --show-current)" <png...>` → วาง Markdown ที่มันพิมพ์ลงใน PR body (อัปโหลดเป็น prerelease asset `primg-<branch>` ด้วย `gh` ล้วน ๆ; `pr-image-cleanup.yml` ลบให้เมื่อ PR ปิด) ; เปลี่ยนแค่โค้ดที่ไม่มีผลทางตา → ติดป้าย `no-screenshot`
- หลัง merge: ลบ branch ทั้ง remote (`gh pr merge --delete-branch` หรือ repo ตั้ง delete-on-merge ไว้แล้ว) และ local (`git branch -d`), แล้ว `git checkout main && git pull` ก่อนเริ่มงานถัดไป
- แก้ ruleset → แก้ `.github/rulesets/main.json` แล้วรัน `scripts/apply-branch-rules.sh` (idempotent; ต้อง `gh` สิทธิ์ admin)

## Loop engineering (`.claude/`)
ลูปมาตรฐานของงานเขียนโค้ด: `/implement <งาน>` → **senior-se** เขียน → **qa-verifier** ตรวจ → วนแก้สูงสุด 3 รอบจน verdict = pass → **docs-sync** อัปเดตเอกสาร → commit → **ถามผู้ใช้ก่อนเปิด PR เสมอ**
- นิยาม agent อยู่ใน `.claude/agents/{senior-se,qa-verifier,docs-sync}.md` ; คำสั่งอยู่ใน `.claude/commands/{implement,review-fix}.md`
- `qa-verifier` **ไม่มี Write/Edit โดยเจตนา** — QA แก้โค้ดเองไม่ได้ นั่นคือสิ่งที่ทำให้ลูปเป็นลูปจริง; มันคืน JSON `{verdict, findings[], screenshots[]}` เพื่อให้เงื่อนไขวนลูปเช็คได้ด้วยเครื่อง ไม่ใช่ด้วยการตีความ
- QA รันคำสั่งชุดเดียวกับ `ci.yml` เป๊ะ ๆ (ถ้าไม่ตรง QA จะเขียวแต่ CI แดง) บวก visual acceptance ด้วย `playwright-cli` — **ห้ามสตาร์ท dev server เอง** (มีได้ตัวเดียวต่อ worktree; ถ้าไม่รันให้คืน `blocked`)
- **agent ไม่เปิด PR เอง** ไม่ว่าผู้ใช้จะเคยพูดว่า "push" ไว้ก่อนหน้าหรือไม่ — `.claude/hooks/guard-pr.sh` (PreToolUse) ดัก `gh pr create/merge/ready` และ `git push … main` แล้วบังคับให้ถามผู้ใช้ ; hook เป็นตาข่าย ไม่ใช่ข้ออ้างที่จะไม่ถาม
- `.claude/settings.json` (tracked) เก็บ hook + allow-list ; `.claude/settings.local.json` เป็นของเครื่องใครเครื่องมัน (gitignored)

## Codex PR review — severity policy
Codex reviews this repo on every push. **Comment only on P1 and P2.** Anything below that is noise:
it lengthens the review loop without making the product more honest or more correct.

**P1 — comment, blocking**
- Data-honesty violation: a self-invented forecast number, a hazard layer without the right `HazardLayerDescriptor` kind, `fetchedAt: null` rendered as a real time ("ตอนนี้"), stale data or a dead source disappearing silently instead of degrading visibly
- Correctness bug a user would hit: crash, wrong hazard value, wrong units/CRS, GPU or memory leak in the render loop
- A `packages/shared-types` contract change whose api/web/etl consumers were not updated
- Leaked secret or credential
- Same-origin guard or rate limiting in `apps/api/src/router.ts` weakened or bypassed
- Durable Object / R2 change that loses or corrupts stored observations
- Config change that breaks a deploy (`wrangler.jsonc`, routes, bindings, environments)

**P2 — comment, non-blocking but should fix**
- Error handling that swallows failures instead of surfacing them
- Stale / degraded source state not shown in the UI
- Race or missed reschedule in a DO alarm
- Measurable performance regression, or an asset bundle growing toward the `ci.yml` limits

**P3 and below — do not comment at all**
Naming, style, comment wording, micro-optimisation, personal preference, and anything `oxlint` or
`tsc` already catches.

**Loop discipline**
- At most 10 comments per review
- Never re-raise a thread that is already resolved, or a point the author answered with a reason
- If a push introduces no new P1/P2, post nothing — no "LGTM" re-review
- Codex review is **advisory**: never add it as a required status check in `.github/rulesets/main.json`

**ฝั่งผู้แก้** (`/review-fix <pr>`): ดึง unresolved threads ด้วย GraphQL `reviewThreads` (คอมเมนต์ Codex เป็น inline review comment — `gh pr view --comments` และ `reviewDecision` มองไม่เห็น) แก้ P1/P2 ทั้งชุด**ในรอบเดียว** push ครั้งเดียว แล้วปิดทุก thread ให้ครบสามอย่าง: **react 👍 → reply บอกว่าแก้อะไรพร้อม sha → resolve** ; `/babysit-prs` จะเรียกให้เองทุกครั้งที่เจอ thread ค้าง และวนแบบนี้ได้ไม่จำกัดรอบ — หยุดเฉพาะเมื่อ finding เดิมซ้ำทั้งที่แก้ไปแล้ว (P3 ก็ต้องปิด แต่ตอบเหตุผลว่าทำไมไม่แก้ — ห้ามเงียบแล้ว resolve)
