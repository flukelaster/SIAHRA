<!--
กติกา PR ของ SIAHRA (บังคับด้วย ruleset + workflow `PR rules`):
- main รับได้เฉพาะ PR ที่ Lint / TypeScript / Build / PR screenshot ผ่าน
- แก้ UI (apps/web/src/components, scene, index.css, public/*) → ต้องมีภาพหน้าจอในคำอธิบายนี้
  ลากไฟล์ PNG มาวางที่นี่ หรือจาก CLI: scripts/pr-media.sh "$(git branch --show-current)" shot.png
  แล้ววาง Markdown ที่มันพิมพ์ออกมา  (ไม่มีอะไรเปลี่ยนตาที่มองเห็น → ติดป้าย `no-screenshot`)
-->

## What / Why


## Screenshot (required when UI changed)


## Checklist
- [ ] `npx tsc -b` (apps/web), `npx tsc --noEmit` (apps/api, apps/etl), `npx oxlint src` (apps/web) ผ่านในเครื่อง
- [ ] ชั้นข้อมูลใหม่/ที่แก้ ประกาศ `HazardLayerDescriptor` ถูกประเภท (observed / static-reference / illustrative / probabilistic) และ UI แสดง `fetchedAt`/`observedAt`
- [ ] ไม่มีตัวเลขพยากรณ์ที่สร้างเอง; ข้อมูลค้าง/แหล่งล่มยังมองเห็นได้ (ไม่เงียบหาย)
- [ ] ถ้าแก้ `packages/shared-types` → api/web/etl ที่ใช้สัญญานั้นแก้ตามครบ
