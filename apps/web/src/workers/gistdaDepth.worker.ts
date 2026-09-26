/// <reference lib="webworker" />
import { estimateGistdaDepth } from "../lib/gistdaDepth";

/**
 * FwDET บนขอบเขตน้ำท่วม GISTDA (E16 B-2, `lib/gistdaDepth.ts`) นอก main thread
 *
 * อยู่ตลอดอายุของชั้นในจังหวัดหนึ่ง (`scene/GistdaSheet.ts` เป็นเจ้าของ ส่ง `abort` แล้ว terminate
 * ตอน dispose) — ความสูง + มาสก์จังหวัดส่งครั้งเดียวด้วย `init` แล้วแต่ละงานส่งมาแค่มาสก์ท่วม
 * (rasterise ไม่เบลอจาก `scene/floodMask.ts`) ไม่มี fetch ไม่มี console.* — ข้อผิดพลาดไปอยู่ในผล
 */
export type GistdaDepthWorkerMessage =
  | {
      type: "init";
      grid: { width: number; height: number };
      /** สำเนาของ heightfield — ตัวจริงยังถูกใช้โดย `sample()` บน main thread */
      heights: Float32Array;
      inside: Uint8Array | null;
    }
  | { type: "job"; jobId: number; flooded: Uint8Array }
  | { type: "abort" };

export type GistdaDepthWorkerResult =
  | {
      ok: true;
      jobId: number;
      cls: Uint8Array;
      depthCm: Uint16Array;
      floodedCells: number;
      boundaryCells: number;
      maxDepthCm: number | null;
      ms: number;
    }
  | { ok: false; jobId: number; error: string };

let grid: { width: number; height: number } | null = null;
let heights: Float32Array | null = null;
let inside: Uint8Array | null = null;

const post = (msg: GistdaDepthWorkerResult, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = (ev: MessageEvent<GistdaDepthWorkerMessage>) => {
  const msg = ev.data;
  switch (msg.type) {
    case "init":
      grid = msg.grid;
      heights = msg.heights;
      inside = msg.inside;
      return;
    case "abort":
      self.close();
      return;
    case "job":
      try {
        if (!grid || !heights) throw new Error("gistda depth worker received a job before init");
        const t0 = performance.now();
        const res = estimateGistdaDepth(grid, heights, msg.flooded, inside);
        post(
          {
            ok: true,
            jobId: msg.jobId,
            cls: res.cls,
            depthCm: res.depthCm,
            floodedCells: res.floodedCells,
            boundaryCells: res.boundaryCells,
            maxDepthCm: res.maxDepthCm,
            ms: Math.round(performance.now() - t0),
          },
          [res.cls.buffer, res.depthCm.buffer],
        );
      } catch (err) {
        post({ ok: false, jobId: msg.jobId, error: String(err) });
      }
      return;
  }
};
