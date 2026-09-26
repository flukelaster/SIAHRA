import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { AoiManifest, WaterLevelObservation } from "@siahra/shared-types";
import type { StationSheetWorkerMessage } from "../workers/stationSheet.worker";
import { SHEET_JOB_DEBOUNCE_MS, StationSheetLayer, type StationSheetInfo } from "./StationSheet";
import type { TerrainField } from "./TerrainMesh";

/**
 * devops C1: งบ 48 คำขอไทล์ 30 ม. เป็นของ "จังหวัด" ไม่ใช่ของ worker — worker ที่ล้มแล้วถูกสร้างใหม่
 * ต้องไม่ได้งบใหม่ (คำขอที่ตัวเก่าเริ่มหลังผลล่าสุดนับไม่ได้) และ legend ต้องบอกเหตุ
 */
class FakeWorker {
  static all: FakeWorker[] = [];
  messages: StationSheetWorkerMessage[] = [];
  terminated = false;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(msg: StationSheetWorkerMessage) {
    this.messages.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
}

const NOW = Date.parse("2026-09-26T06:00:00Z");

function obs(): WaterLevelObservation {
  return {
    station: { id: 1, nameTh: "ทดสอบ", nameEn: null, lat: 14.3, lon: 100.5 } as WaterLevelObservation["station"],
    waterlevelMsl: 3,
    waterlevelLocalM: null,
    minBankMsl: 2,
    groundLevelMsl: null,
    freeboardM: -1,
    situationLevel: 5,
    storagePercent: null,
    dischargeM3s: null,
    qmaxM3s: null,
    criticalLevelMsl: null,
    observedAt: "2026-09-26T05:50:00.000Z",
  };
}

const W = 8;
const H = 8;
const terrain = {
  heights: new Float32Array(W * H),
  insideMask: null,
  projection: {
    gridWidthM: W * 100,
    gridHeightM: H * 100,
    lonLatToLocal: () => [0, 0],
    insideGrid: () => true,
  },
  material: { uniforms: { uHatchPx: { value: 6 } } },
} as unknown as TerrainField;

const manifest = {
  aoiId: "14",
  originEasting: 0,
  originNorthing: 0,
  terrain: { width: W, height: H, cellSizeM: 100, tiles: { levels: [], tileSize: 256 } },
  landcover: null,
} as unknown as AoiManifest;

const inits = () =>
  FakeWorker.all.flatMap((w) => w.messages.filter((m): m is Extract<StationSheetWorkerMessage, { type: "init" }> => m.type === "init"));

describe("StationSheetLayer — worker ล้ม", () => {
  beforeEach(() => {
    FakeWorker.all = [];
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("worker ตัวใหม่หลังล้มไม่ขอไทล์ 30 ม. อีก (งบ C1 ไม่รีเซ็ต) และ info บอกเหตุ", () => {
    const infos: (StationSheetInfo | null)[] = [];
    const layer = new StationSheetLayer(new THREE.Group(), terrain, manifest, { value: 0 }, (i) => infos.push(i));

    layer.update([obs()], NOW);
    vi.advanceTimersByTime(SHEET_JOB_DEBOUNCE_MS);
    expect(FakeWorker.all).toHaveLength(1);
    expect(inits()[0].leaf).not.toBeNull();

    FakeWorker.all[0].onerror!({ message: "boom" });
    expect(FakeWorker.all[0].terminated).toBe(true);
    const afterCrash = infos.at(-1)!;
    expect(afterCrash.workerError).toBe("boom");
    expect(afterCrash.drawn).toBe(false);

    // ค่าตรวจวัดรอบถัดไป (อาร์เรย์ใหม่) → worker ใหม่ — ทำแค่กริดภาพรวม
    layer.update([obs()], NOW);
    vi.advanceTimersByTime(SHEET_JOB_DEBOUNCE_MS);
    expect(FakeWorker.all).toHaveLength(2);
    expect(inits()[1].leaf).toBeNull();
    expect(FakeWorker.all[1].messages.some((m) => m.type === "job")).toBe(true);

    // ล้มซ้ำก็ยังคงเหตุแรกไว้ ไม่หายไปเมื่อ worker ใหม่เริ่มสำเร็จ
    FakeWorker.all[1].onerror!({ message: "again" });
    expect(infos.at(-1)!.workerError).toBe("boom");
    layer.dispose();
  });
});
