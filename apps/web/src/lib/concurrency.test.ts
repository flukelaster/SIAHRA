import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./concurrency";

describe("mapWithConcurrency", () => {
  it("ผลลัพธ์เรียงตามลำดับ items เดิม ไม่ใช่ตามลำดับที่ตอบกลับมาก่อน-หลัง", async () => {
    const delays = [30, 10, 20, 0];
    const out = await mapWithConcurrency(delays, 4, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3]);
  });

  it("ไม่รันเกิน limit งานพร้อมกัน", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await mapWithConcurrency(items, 3, async (i) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return i;
    });
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it("limit มากกว่าจำนวน items ก็ยังรันครบทุกตัว", async () => {
    const out = await mapWithConcurrency([1, 2, 3], 10, async (n) => n * 2);
    expect(out).toEqual([2, 4, 6]);
  });

  it("รายการว่าง คืน [] โดยไม่ throw", async () => {
    const out = await mapWithConcurrency([], 5, async (n: number) => n);
    expect(out).toEqual([]);
  });
});
