import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * รันเทสของ API ในรันไทม์เดียวกับ production (workerd ผ่าน miniflare) โดยอ่าน
 * binding ทั้งหมด (R2 + Durable Object ห้าตัว) จาก wrangler.jsonc — รอบนี้ยัง
 * เป็นเทสของ pure module เป็นหลัก แต่ตั้ง pool ไว้ตั้งแต่ต้นเพื่อให้ E5.5 (เทส
 * Durable Object ด้วย runInDurableObject) เสียบเข้ามาได้โดยไม่ต้องขยับเวอร์ชัน
 *
 * หมายเหตุเวอร์ชัน: ตั้งแต่ @cloudflare/vitest-pool-workers 0.22 (vitest 4)
 * ไม่มี export `/config` และ defineWorkersConfig อีกแล้ว — ตัว pool มาในรูป
 * Vite plugin `cloudflareTest()` แทน
 *
 * **storage isolation ใน 0.22** — ออปชัน `isolatedStorage` ถูกถอดออกแล้ว
 * (`WorkersPoolOptionsSchema` ใน dist/pool/index.d.mts รับแค่ main, remoteBindings,
 * verbose, additionalExports, miniflare, wrangler — ที่เหลือถูก strip ทิ้งเงียบ ๆ)
 * วัดจริงในเวอร์ชันนี้ด้วย DO ชื่อเดียวกันสองไฟล์แล้วได้ว่า:
 *   - ข้าม *ไฟล์* เทส storage แยกกันอยู่แล้ว (ไฟล์ B อ่านคีย์ที่ไฟล์ A เขียนไม่เจอ)
 *   - ภายใน *ไฟล์เดียวกัน* state อยู่ยาวข้าม test block (อ่านเจอค่าที่บล็อกก่อนเขียน)
 * ดังนั้น E5.5: จัดกลุ่มเทส DO เป็นไฟล์ ๆ ได้เลย แต่ถ้าต้องการเริ่มจากศูนย์ในแต่ละ
 * test block ให้เรียก `reset()` (ล้างข้อมูลทุก binding) หรือ `abortAllDurableObjects()`
 * (รีเซ็ตเฉพาะ instance ไม่ลบข้อมูล) จาก "cloudflare:test" ใน afterEach เอง
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
