/**
 * แคชภาพ CCTV (E15) — แยกจาก `cctv.ts` เพื่อให้ entry chunk (Map3DCanvas ถือแคช) ไม่ต้องลาก
 * ตัวดึงภาพ/ฟังก์ชันของ popup ทั้งไฟล์มาด้วย: โมดูลที่ entry กับ chunk lazy ใช้ร่วมกันถูกวาง
 * ใน entry ทั้งก้อน (`cctv.ts` re-export คลาสนี้ ผู้เรียกเดิมไม่ต้องเปลี่ยน)
 */
import type { SnapshotResult } from "./cctv";

export type OkSnapshot = Extract<SnapshotResult, { kind: "ok" }>;

/**
 * แคชภาพในหน่วยความจำ 5 นาทีต่อกล้อง — แคชเป็น **เจ้าของ** object URL: ทุกทางที่รายการ
 * ออกจากแคช (หมดอายุ, ถูกแทนด้วยภาพใหม่, เกินเพดาน, `clear()`) เรียก `revoke` เสมอ
 *
 * popup ที่ปิดไม่ได้ revoke เอง — ไม่งั้นเปิดกล้องเดิมซ้ำภายใน 5 นาทีจะได้ URL ที่ตายแล้ว
 * ผู้ถือแคช (Map3DCanvas) `clear()` ตอนปิดชั้น/ถอดแผนที่
 */
export class SnapshotCache {
  private readonly entries = new Map<string, { snap: OkSnapshot; storedAt: number }>();

  private readonly opts: {
    ttlMs?: number;
    maxEntries?: number;
    now?: () => number;
    revoke?: (url: string) => void;
  };

  constructor(opts: SnapshotCache["opts"] = {}) {
    this.opts = opts;
  }

  private get ttl() {
    return this.opts.ttlMs ?? 5 * 60 * 1000;
  }
  private now() {
    return (this.opts.now ?? Date.now)();
  }
  private revoke(url: string) {
    (this.opts.revoke ?? ((u: string) => URL.revokeObjectURL(u)))(url);
  }

  get(id: string): OkSnapshot | null {
    const e = this.entries.get(id);
    if (!e) return null;
    if (this.now() - e.storedAt > this.ttl) {
      this.evict(id);
      return null;
    }
    return e.snap;
  }

  set(id: string, snap: OkSnapshot): void {
    const prev = this.entries.get(id);
    if (prev && prev.snap.blobUrl !== snap.blobUrl) this.revoke(prev.snap.blobUrl);
    this.entries.delete(id);
    this.entries.set(id, { snap, storedAt: this.now() });
    const max = this.opts.maxEntries ?? 12;
    while (this.entries.size > max) {
      const oldest = this.entries.keys().next().value as string;
      this.evict(oldest);
    }
  }

  evict(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    this.entries.delete(id);
    this.revoke(e.snap.blobUrl);
  }

  clear(): void {
    for (const id of [...this.entries.keys()]) this.evict(id);
  }

  get size(): number {
    return this.entries.size;
  }
}
