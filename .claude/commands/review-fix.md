---
description: Address Codex review on a PR in ONE batch — fix P1/P2 only, then react 👍 + reply + resolve every thread. Prevents endless review loops.
---

ปิดวงจร Codex review ของ PR: `$ARGUMENTS` (ไม่ระบุ = PR ของสาขาปัจจุบัน)

Codex รีวิวทุก push การแก้ทีละคอมเมนต์แล้ว push ทีละครั้ง = ลูปไม่จบ คำสั่งนี้บังคับ **หนึ่ง batch ต่อหนึ่ง push**

## 1. ดึง unresolved review threads (GraphQL เท่านั้น)
`gh pr view --comments` และ `reviewDecision` **ไม่เห็น**คอมเมนต์ Codex เพราะมันเป็น inline review comment ในรีวิวชนิด `COMMENTED`

```bash
gh api graphql -f query='
query($o:String!,$r:String!,$n:Int!,$c:String){
  repository(owner:$o,name:$r){
    pullRequest(number:$n){
      reviewThreads(first:100, after:$c){
        totalCount
        pageInfo{ hasNextPage endCursor }
        nodes{
          id isResolved isOutdated path line
          comments(first:1){ nodes{ databaseId author{login} createdAt body } } } } } } }' \
  -f o=<owner> -f r=<repo> -F n=<pr>
```
- `id` = thread node id → ใช้กับ `resolveReviewThread`
- `comments.nodes[0].databaseId` = comment id → ใช้กับ REST reactions/replies
- คอมเมนต์ของ Codex คือ `author.login == "chatgpt-codex-connector"` (ยืนยันจาก PR #21) — ใช้กรองแยกจากคอมเมนต์ของคน
- **ต้องอ่าน `totalCount` + `pageInfo.hasNextPage` แล้ววนจนหมดก่อนสรุป** — thread เรียงตามเวลาสร้าง ของใหม่อยู่ท้าย การใช้ `first: N` ตายตัวเคยทำให้รายงาน "0 findings" ผิดมาแล้ว

## 2. คัดตาม rubric (หัวข้อ "Codex PR review — severity policy" ใน `AGENTS.md`)
- **P1/P2** → แก้
- **P3** → ไม่แก้โค้ด แต่ยังต้องปิด thread ตามข้อ 4

## 3. แก้ทั้งชุดในรอบเดียว — commit/push **เฉพาะเมื่อ QA เขียว**
**ถ้าไม่มีอะไรต้องแก้เลย** (เหลือแต่ P3 หรือปฏิเสธทุกข้อโดยมีเหตุผล) → **ข้ามข้อ 3 ทั้งข้อ** ไม่ commit ไม่ push แล้วไปข้อ 4 เลย โดย reply อ้างเหตุผลแทน sha (`No code change — <เหตุผล>`) ; ห้ามค้างอยู่ตรงนี้เพราะไม่มี commit ให้สร้าง

มีของต้องแก้ → `Agent(senior-se)` (ส่ง finding ทั้งชุด) → `Agent(qa-verifier)` → **แยกทางตาม `verdict`**:
- `pass` → commit → **push ครั้งเดียว** → เก็บ sha ไว้ใช้ข้อ 4
- `fail` → ส่ง findings กลับให้ senior-se แก้ (ไม่เกิน 2 รอบ) แล้วให้ QA ตรวจใหม่ ; ครบ 2 รอบยัง fail → **หยุด ไม่ commit ไม่ push ไม่ resolve thread** แล้วรายงานผู้ใช้
- `blocked` → หยุดทันที บอกว่าต้องทำอะไรถึงตรวจต่อได้ ไม่ commit ไม่ push

ห้าม push งานที่ QA ยังไม่รับรอง — มันจะจุด CI/Codex รอบใหม่ แล้วเผลอไป resolve thread เดิมราวกับแก้สำเร็จ

## 4. ปิดทุก thread — react → reply → resolve (ครบสามอย่างเสมอ ทำหลัง push ที่ QA รับรองแล้วเท่านั้น)
```bash
# 4.1 react 👍
gh api -X POST repos/<owner>/<repo>/pulls/comments/<comment_id>/reactions -f content=+1

# 4.2 reply ในเธรดเดิม (ไม่ใช่คอมเมนต์ลอย)
gh api -X POST repos/<owner>/<repo>/pulls/<pr>/comments/<comment_id>/replies \
  -f body='Fixed in <sha> — <what changed, which file>.'

# 4.3 resolve
gh api graphql -f query='mutation($t:ID!){ resolveReviewThread(input:{threadId:$t}){ thread{ isResolved } } }' -f t=<thread_id>
```
- reply เป็น**ภาษาอังกฤษ** สั้น บอกว่าแก้อะไรที่ไฟล์ไหน + `Fixed in <sha>` (ถ้าเป็นเส้นทางไม่มีการแก้ ให้ขึ้นต้นว่า `No code change —` แล้วตามด้วยเหตุผล)
- P3 หรือไม่เห็นด้วย → reply บอกเหตุผลตรง ๆ ว่าทำไม won't fix (อ้าง rubric ข้อไหน) แล้วค่อย resolve — **ห้ามเงียบแล้ว resolve**
- ลำดับสำคัญ: react + reply **ก่อน** resolve
- ตรวจว่า mutation คืน `isResolved: true` จริง ถ้าล้มเหลว (สิทธิ์ไม่พอ / thread outdated) ให้รายงานผู้ใช้ ห้ามนับว่าเสร็จ

## 5. สรุปแล้วหยุด
พิมพ์ตาราง: `thread | severity | action | sha | resolved?`
ทำได้อีกไม่เกิน 1 รอบ — ถ้า Codex ยกเรื่องเดิมเป็นรอบที่ 3 ให้หยุดแล้วถามผู้ใช้ ห้ามวนต่อเอง

## Non-goals
- ห้าม merge
- ห้ามแก้เรื่องที่ไม่มีใครคอมเมนต์ (การ refactor แถมทำให้รอบรีวิวยาวขึ้น)
