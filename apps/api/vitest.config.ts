import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * รันเทสของ API ในรันไทม์เดียวกับ production (workerd ผ่าน miniflare) โดยอ่าน
 * binding ทั้งหมด (R2 + Durable Object ห้าตัว) จาก wrangler.jsonc — รอบนี้ยัง
 * เป็นเทสของ pure module ล้วน แต่ตั้ง pool ไว้ตั้งแต่ต้นเพื่อให้ E5.5 (เทส
 * Durable Object ด้วย runInDurableObject / isolatedStorage) เสียบเข้ามาได้
 * โดยไม่ต้องขยับเวอร์ชัน vitest
 *
 * หมายเหตุเวอร์ชัน: ตั้งแต่ @cloudflare/vitest-pool-workers 0.22 (vitest 4)
 * ไม่มี export `/config` และ defineWorkersConfig อีกแล้ว — ตัว pool มาในรูป
 * Vite plugin `cloudflareTest()` แทน
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      isolatedStorage: true,
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
