---
description: Watch a SIAHRA PR — CI checks plus unresolved Codex threads — and dispatch /review-fix whenever there is something to fix. Pair with /loop for hands-off monitoring.
---

เฝ้า PR: `$ARGUMENTS` (ไม่ระบุ = PR ที่เปิดอยู่ของผู้ใช้เอง)

นี่คือตัว dispatcher ที่ทำให้ลูปรีวิวเดินต่อเองได้ — `/review-fix` ทำงานทีละ batch ส่วนคำสั่งนี้คือคนกดเรียกมันซ้ำ

## 1. สถานะ
```bash
gh pr view <n> --json state,mergeable,mergeStateStatus,headRefName,isDraft
gh pr checks <n>
```
required check ของ repo นี้มีสามตัว: `Lint` / `TypeScript` / `Build` (`.github/workflows/ci.yml`)

## 2. unresolved review threads — ดึงทุกรอบ ไม่ใช่เฉพาะตอน CI เขียว
คอมเมนต์ Codex เป็น inline review comment ในรีวิวชนิด `COMMENTED` → `gh pr view --comments` มองไม่เห็น และ `reviewDecision` ว่างเปล่า ต้องใช้ GraphQL:
```bash
gh api graphql -f query='
query($o:String!,$r:String!,$n:Int!,$c:String){
  repository(owner:$o,name:$r){
    pullRequest(number:$n){
      reviewThreads(first:100, after:$c){
        totalCount
        pageInfo{ hasNextPage endCursor }
        nodes{ id isResolved isOutdated path line
               comments(first:100){ nodes{ databaseId author{login} createdAt body } } } } } } }' \
  -f o=<owner> -f r=<repo> -F n=<n>
```
**อ่าน `totalCount` + `pageInfo.hasNextPage` แล้ววนจนหมดก่อนสรุปว่า "ไม่มี thread ค้าง"** — thread เรียงตามเวลาสร้าง ของใหม่อยู่ท้ายสุด `first:N` ตายตัวเคยทำให้รายงาน "0 findings" ผิดมาแล้ว ; Codex โพสต์ในนาม `chatgpt-codex-connector`

## 3. รายงาน
```
#<n> <title>  (<branch>)
  state: OPEN  mergeState: CLEAN
  checks: 3 ok / 0 pending / 0 fail   (failed: <list>)
  review threads: 2/7 unresolved  (Codex: 2)
    - .claude/hooks/guard-pr.sh:30 — <บรรทัดแรกของคอมเมนต์>
  url: <url>
```

## 4. มี thread ค้าง → **สั่ง `/review-fix <n>` ทันทีในรอบเดียวกัน ไม่มีเพดานรอบ**
- อย่ารอให้ผู้ใช้สั่งซ้ำ — Codex รีวิวใหม่ทุก push การมี finding รอบถัดไปคือ "มีงานให้ทำเพิ่ม" ไม่ใช่ "ลูปพัง"
- ข้อยกเว้นที่ให้แค่รายงาน (บอกด้วยว่าเข้าข้อไหน): thread เป็นคำถามจากคนจริง ๆ ไม่ใช่การแจ้ง defect / PR ไม่ใช่ของคนอื่นที่เรา push ไม่ได้
- **การที่ต้องแก้ไฟล์ที่ PR ยังไม่ได้แตะ ไม่ใช่ข้อยกเว้น** — finding ที่ถูกต้องหลายอย่างบังคับให้ต้องออกนอก diff เดิม เช่น แก้ `packages/shared-types` แล้วลืมไล่แก้ผู้ใช้ฝั่ง api/web/etl ; ถ้ากันไว้ ลูปจะค้างอยู่กับ finding นั้นตลอดไป ให้แก้ไปเลย
- สิ่งเดียวที่ไม่ถือว่าคืบหน้า: **finding เดิมซ้ำแบบไม่เปลี่ยน ทั้งที่แก้ไปแล้ว** → หยุดแล้วถามผู้ใช้ (finding ใหม่ไม่เข้าเงื่อนไขนี้)

## 5. มี check แดง → `gh run view <runId> --log-failed` แล้วยกท้าย ~40 บรรทัดมาให้ดู ไม่ต้องแก้เอง (ให้ผู้ใช้หรือรอบถัดไปตัดสิน)

## 6. เขียวหมด
- `✅ ready` เฉพาะเมื่อ **checks ผ่านครบ และ 0 unresolved thread** — ห้ามพิมพ์ ready ทับคอมเมนต์ที่ยังค้าง ให้เป็น `⏳ checks green, N review threads unresolved`
- **ห้าม merge เอง** ไม่ว่าจะเขียวแค่ไหน

## Output
- ไม่เกิน ~30 บรรทัดต่อ PR
- ถ้าไม่มีอะไรเปลี่ยนจากรอบก่อน (checks เท่าเดิม, จำนวน unresolved thread และ thread ล่าสุดเท่าเดิม) ให้พิมพ์ `no change since last run` — แต่คอมเมนต์ใหม่ถือว่าเปลี่ยน แม้ check จะเขียวเหมือนเดิม

## Non-goals
- ไม่ merge, ไม่เปิด PR, ไม่ push โค้ดเอง (การแก้เป็นงานของ `/review-fix`)
