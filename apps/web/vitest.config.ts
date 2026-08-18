import { defineConfig } from "vitest/config";

/**
 * เทสฝั่ง web เป็น pure module ล้วน (no DOM, no RTL) — environment: "node"
 * จึงพอ และทำให้ไม่ต้องลง jsdom เพิ่มในรอบ npm ci ของ CI
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
