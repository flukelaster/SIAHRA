---
description: Feature loop for SIAHRA — senior-se implements, qa-verifier gates, loop until green, docs-sync updates docs, then ASK before opening a PR (never automatic).
---

รันลูปพัฒนาฟีเจอร์: **senior-se → qa-verifier → (วนจนเขียว) → docs-sync → ถามผู้ใช้ → PR**

งานที่ขอ: `$ARGUMENTS`

คำสั่งนี้ต้องรันใน main session เท่านั้น (จุดถามผู้ใช้ก่อนเปิด PR ใช้ `AskUserQuestion` ซึ่ง subagent เรียกไม่ได้)

## 0. Preflight
- `git branch --show-current` — ถ้าอยู่บน `main` ให้ `git switch -c <type>/<slug>` ก่อน (ห้าม commit ลง main เด็ดขาด)
- `git status --porcelain` — ถ้ามีของค้างที่ไม่เกี่ยวกับงานนี้ ให้ถามผู้ใช้ก่อนไปต่อ
- อ่านพอร์ตจาก `.env.worktree` (fallback 5173/8787) แล้ว `curl -sf http://localhost:<port>` — ถ้า dev server ไม่รันและงานนี้แตะ UI ให้บอกผู้ใช้ให้เปิด `npm run dev` (อย่าเปิดเอง)

## 1. Spec
แปลงคำขอเป็น **acceptance criteria 3–7 ข้อที่ตรวจได้จริง** แล้วพิมพ์ให้ผู้ใช้เห็นก่อนเริ่ม
ทุกงานที่แตะข้อมูลภัยพิบัติต้องมีข้อ data-honesty จาก `AGENTS.md` ติดไปด้วยเสมอ (descriptor ถูกประเภท, ไม่มีตัวเลขที่สร้างเอง, `fetchedAt` แสดงตรง, แหล่งล่มมองเห็นได้)

## 2. Loop (สูงสุด 3 รอบ)
วนแบบนี้:
1. `Agent(senior-se)` — ส่ง `{task, acceptance_criteria, qa_verdict?, screenshots?}`
2. `Agent(qa-verifier)` — ส่ง `{acceptance_criteria, สรุปสิ่งที่ SE ทำ}`
3. อ่าน `verdict` จาก JSON ที่ QA คืน:
   - `pass` → ออกจากลูป (findings ระดับ `minor` เก็บไว้รายงานตอนจบ ไม่ต้องวนแก้)
   - `fail` และยังไม่ครบ 3 รอบ → ส่ง findings + screenshots กลับเข้ารอบใหม่
   - `fail` ครบ 3 รอบ → **หยุด** สรุป finding ที่เหลือให้ผู้ใช้ ไม่ commit ไม่เปิด PR
   - `blocked` → หยุดทันที บอกผู้ใช้ว่าต้องทำอะไร (เช่นเปิด dev server) — ไม่นับเป็นรอบ

พิมพ์ผลแต่ละรอบสั้น ๆ: `รอบ N: verdict=... blocker=x major=y minor=z`

## 3. Docs
`Agent(docs-sync)` — ให้ diff ทั้งหมดของสาขานี้

## 4. Commit
commit เดียวครอบทั้งโค้ดและเอกสาร **ข้อความเป็นภาษาอังกฤษ** (subject + body) แล้ว **หยุด**

## 5. ถามก่อนเปิด PR — บังคับ
ใช้ `AskUserQuestion`: "เปิด PR เลยไหม?"
- `เปิดเลย`
- `commit ไว้ก่อน` (จบที่นี่ ไม่ push)
- `แก้เพิ่ม` (กลับไปข้อ 1 พร้อมโจทย์ใหม่)

**ห้ามเปิด PR โดยไม่ถาม ไม่ว่าผู้ใช้จะเคยพูดว่า "push" ไว้ก่อนหน้าหรือไม่** — มี hook `guard-pr.sh` ดักอีกชั้น แต่ hook เป็นตาข่าย ไม่ใช่ข้ออ้าง

## 6. เปิด PR (เฉพาะเมื่อผู้ใช้ตอบ "เปิดเลย")
1. `git push -u origin <branch>`
2. ถ้า diff แตะ UI → `scripts/pr-media.sh "$(git branch --show-current)" <png จาก QA>` แล้วเอา Markdown ที่มันพิมพ์ไปวางใน body
3. เขียน title/body **ภาษาอังกฤษ**
4. **Self-check ก่อนยิง** (ไม่มี CI คอยรับแล้ว — พลาดตรงนี้คือหลุดเลย):
   - ภาษา: `printf '%s' "$TITLE$BODY" | LC_ALL=C.UTF-8 grep -Pq '[\x{0E00}-\x{0E7F}]'` (title/body) **และ** `git log main..HEAD --format='%s%n%b' | LC_ALL=C.UTF-8 grep -Pq '[\x{0E00}-\x{0E7F}]'` (commit ทุกอันในสาขา) → เจออักษรไทยที่ไหนให้เขียนใหม่ที่นั่น
   - ภาพ: ถ้า `git diff --name-only main...HEAD` แตะ `apps/web/index.html`, `apps/web/src/App.tsx`, `apps/web/src/main.tsx`, `apps/web/src/index.css`, `apps/web/src/branding.ts`, `apps/web/src/components/**`, `apps/web/src/scene/**`, `apps/web/public/*` → body ต้องมีรูปอย่างน้อย 1 รูป มิฉะนั้นติดป้าย `no-screenshot` (ใช้เมื่อไม่มีผลทางตาจริง เช่น types/comment/refactor — ห้ามปั้นภาพขึ้นมา)
5. `gh pr create` (hook จะขออนุมัติอีกครั้ง)
6. หลังเปิดแล้ว บอกผู้ใช้ว่า Codex จะรีวิวทุก push และแก้รอบถัดไปด้วย `/review-fix <n>`

## Non-goals
- ห้าม merge เอง
- ห้ามแก้ `.github/rulesets/main.json` หรือ `ci.yml` ระหว่างทำฟีเจอร์
