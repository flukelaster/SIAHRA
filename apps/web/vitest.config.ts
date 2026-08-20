import { defineConfig } from "vitest/config";

/**
 * เทสฝั่ง web เป็น pure module ล้วน (no DOM, no RTL) — environment: "node"
 * จึงพอ และทำให้ไม่ต้องลง jsdom เพิ่มในรอบ npm ci ของ CI
 */
export default defineConfig({
  test: {
    environment: "node",
    // worker/ อยู่นอก src เพราะเป็นโค้ดฝั่ง Worker (ถูก bundle ด้วย wrangler) —
    // เทสของมัน (worker/tilePath.test.ts) เป็น pure module เหมือนกัน จึงรันที่นี่
    include: ["src/**/*.test.ts", "worker/**/*.test.ts"],
  },
});
