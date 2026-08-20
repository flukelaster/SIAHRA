import { describe, expect, it } from "vitest";
import { runScheduledTick, type SourceTask } from "../src/scheduledTick";

/**
 * เทสของ orchestrator ใน cron tick (E5.1) — โจทย์คือ "ต้นทางเจ๊งหนึ่งตัว ห้าม
 * ทำให้อีกสามตัวไม่ได้รีเฟรช" จึงเทสเป็น pure unit ด้วย thunk ธรรมดา ไม่ต้องพึ่ง
 * Durable Object จริง (roadmap E5.1 ข้อ 4 อนุญาตทั้งสองแบบ)
 */
function task(id: string, run: SourceTask["run"]): SourceTask {
  return { id, run };
}

describe("runScheduledTick", () => {
  it("รันต้นทางที่เหลือครบ แม้ตัวหนึ่งจะ throw", async () => {
    const ran: string[] = [];
    const results = await runScheduledTick(
      [
        task("earthquakes", async () => {
          throw new Error("DO exploded");
        }),
        task("thaiwater", async () => {
          ran.push("thaiwater");
        }),
        task("gistda-flood", async () => {
          ran.push("gistda-flood");
        }),
        task("tmd-radar", async () => {
          ran.push("tmd-radar");
        }),
      ],
      { log: () => {} },
    );

    expect(ran).toEqual(["thaiwater", "gistda-flood", "tmd-radar"]);
    expect(results.map((r) => r.outcome)).toEqual(["error", "ok", "ok", "ok"]);
    expect(results[0]?.error).toContain("DO exploded");
  });

  it("ไม่ throw ออกมาข้างนอก แม้ทุกต้นทางจะพัง", async () => {
    const results = await runScheduledTick(
      [
        task("a", () => Promise.reject(new Error("a"))),
        task("b", () => {
          throw new Error("b ล้มแบบ synchronous");
        }),
      ],
      { log: () => {} },
    );
    expect(results.every((r) => r.outcome === "error")).toBe(true);
  });

  it("ตัดต้นทางที่ค้างด้วย timeout โดยไม่รอตัวที่ค้าง", async () => {
    const results = await runScheduledTick(
      [
        task("hangs", () => new Promise<void>(() => {})),
        task("quick", async () => ({ frames: 3 })),
      ],
      { log: () => {}, timeoutMs: 10 },
    );
    expect(results[0]?.outcome).toBe("timeout");
    expect(results[1]).toMatchObject({ outcome: "ok", detail: { frames: 3 } });
  });

  it("ใช้ค่า default 25 วินาทีเมื่อไม่ได้ระบุ timeout", async () => {
    // งานที่จบทันทีต้องไม่ถูก timeout ตัด และ tick ต้องไม่ค้างรอ timer 25 วิ
    const results = await runScheduledTick([task("quick", async () => {})], { log: () => {} });
    expect(results[0]?.outcome).toBe("ok");
  });

  it("ออก log 1 บรรทัดต่อ 1 ต้นทางต่อ tick พร้อม detail ที่ต้นทางคืนมา", async () => {
    const lines: Record<string, unknown>[] = [];
    await runScheduledTick(
      [
        task("earthquakes", async () => ({ inserted: 2, broadcast: 1 })),
        task("thaiwater", async () => {}),
        task("gistda-flood", async () => {
          throw new Error("upstream 502");
        }),
        task("tmd-radar", () => new Promise<void>(() => {})),
      ],
      { log: (line) => lines.push(line), timeoutMs: 10 },
    );

    expect(lines).toHaveLength(4);
    expect(lines.map((l) => l.source)).toEqual([
      "earthquakes",
      "thaiwater",
      "gistda-flood",
      "tmd-radar",
    ]);
    expect(lines[0]).toMatchObject({ level: "info", outcome: "ok", inserted: 2, broadcast: 1 });
    expect(lines[2]).toMatchObject({ level: "error", outcome: "error" });
    expect(String(lines[2]?.error)).toContain("upstream 502");
    // timeout ต้องแยกจาก error: timer ไม่ได้ยกเลิก RPC และไม่ได้แปลว่าต้นทางตอบพัง
    expect(lines[3]).toMatchObject({ level: "error", outcome: "timeout" });
    for (const line of lines) expect(typeof line.durationMs).toBe("number");
  });

  it("detail จากต้นทางเขียนทับฟิลด์ของ orchestrator ไม่ได้", async () => {
    const lines: Record<string, unknown>[] = [];
    await runScheduledTick([task("earthquakes", async () => ({ source: "usgs", outcome: "weird", durationMs: -1 }))], {
      log: (line) => lines.push(line),
    });
    expect(lines[0]).toMatchObject({ source: "earthquakes", outcome: "ok" });
    expect(lines[0]?.durationMs).not.toBe(-1);
  });
});
