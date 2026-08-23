import { useEffect, useState } from "react";
import type { LocalAuthorityImpact, LocalAuthorityImpactResponse } from "@siahra/shared-types";
import { aoiIdForProvince } from "../data/types";
import { errorMessage, type ErrorMessage } from "../lib/errorMessage";
import { nextReconnectDelayMs } from "../lib/feed/backoff";
import { mapWithConcurrency } from "../lib/concurrency";
import {
  rankAffectedAuthorities,
  type AffectedAuthorityCandidate,
  type RankedAffectedAuthority,
} from "../lib/affectedAuthorityRanking";
import { loadAoiManifest, AoiNotBuiltError } from "../scene/loadAoiManifest";
import { loadLocalAuthorityBoundaries } from "../scene/localAuthorityBoundaries";

export interface AffectedAuthoritiesState {
  /** จัดอันดับแล้ว — ดู `lib/affectedAuthorityRanking.ts` */
  entries: RankedAffectedAuthority[];
  loading: boolean;
  /**
   * ตั้งเมื่อขั้นตอนโหลดรายชื่อผู้สมัคร (manifest/geojson) ล้มเหลวจริง ๆ —
   * **ไม่ได้ตั้ง** เมื่อจังหวัดนี้ไม่มีขอบเขต อปท. เลย (นั่นคือ `entries: []`
   * แบบปกติ ไม่ใช่ error — ดู `coverage`)
   */
  error: ErrorMessage | null;
  /**
   * `"none"` = จังหวัดนี้ไม่มี อปท. รายใดมีขอบเขต E11.2 จริงเลย (พบได้ปกติ ส่วน
   * ใหญ่ของประเทศยังไม่มีขอบเขต — ดู `apps/etl/data/sources/osm-admin/COVERAGE.md`)
   * `"covered"` = มีอย่างน้อยหนึ่งราย `"unknown"` = ยังโหลดไม่เสร็จ/ไม่เคยลองเลย
   */
  coverage: "unknown" | "none" | "covered";
}

const EMPTY: AffectedAuthoritiesState = { entries: [], loading: false, error: null, coverage: "unknown" };

// impact ขึ้นกับฉาก GISTDA ปัจจุบัน — คาบเดียวกับ useFloodExtent.ts/useLocalAuthorityImpact.ts
const REFRESH_MS = 10 * 60 * 1000;
// จำนวนคำขอ /impact พร้อมกันสูงสุดต่อจังหวัด — จังหวัดที่มากที่สุด (14) มี ~144
// รายการที่มีขอบเขตจริง ยิงพร้อมกันหมดเป็นการถล่มโควตา rate-limit ของหน้าเดียวกัน
// โดยไม่จำเป็น (ดู `apps/api/src/rateLimit.ts`: 300/นาที + burst — 144 ยังอยู่ใน
// งบ แต่ไม่ควรยิงพร้อมกันทั้งหมดในคำขอเดียว)
const CONCURRENCY = 6;

/**
 * รายชื่อ อปท. ที่ได้รับผลกระทบในจังหวัดที่กำลังดู เรียงลำดับแล้ว (E11.6)
 *
 * ที่มาของ "ผู้สมัคร" (อปท. ที่ควรลอง `/impact`) คือไฟล์ GeoJSON เดียวกับที่
 * `scene/LocalAuthorityOutline.ts` ใช้วาดขอบเขต 3 มิติ (`loadLocalAuthorityBoundaries`)
 * — ไม่ใช่ทะเบียนทั้งหมดของจังหวัด (`GET /local-authorities?province=NN`) ซึ่งมี
 * อปท. ที่ไม่มีขอบเขตจริงปนอยู่มาก (เช่น สงขลามี 141 รายการในทะเบียน แต่มีขอบเขต
 * จริงแค่ 2) การไล่ยิง `/impact` ทั้งทะเบียนจะได้ 404 เกือบทั้งหมดโดยเดาได้ล่วงหน้า
 * อยู่แล้วว่าจะพลาด ซึ่งไม่มีประโยชน์และสิ้นเปลืองโควตาคำขอ
 */
export function useAffectedAuthorities(provinceCode: string | null): AffectedAuthoritiesState {
  const [state, setState] = useState<AffectedAuthoritiesState>(EMPTY);

  useEffect(() => {
    setState({ ...EMPTY, loading: provinceCode !== null });
    if (!provinceCode) return;

    let cancelled = false;
    let timer: number | null = null;
    let attempt = 0;
    const controller = new AbortController();

    const load = async () => {
      try {
        const manifest = await loadAoiManifest(aoiIdForProvince(provinceCode));
        const candidates = await loadLocalAuthorityBoundaries(manifest);
        if (cancelled || controller.signal.aborted) return;

        if (!candidates || candidates.length === 0) {
          setState({ entries: [], loading: false, error: null, coverage: "none" });
          timer = window.setTimeout(load, REFRESH_MS);
          return;
        }

        const built: AffectedAuthorityCandidate[] = await mapWithConcurrency(
          candidates,
          CONCURRENCY,
          async (c): Promise<AffectedAuthorityCandidate> => {
            try {
              const res = await fetch(`/api/v1/local-authorities/${c.id}/impact`, {
                signal: controller.signal,
              });
              if (!res.ok) return { id: c.id, nameTh: c.nameTh, type: c.type, impact: null, unavailable: true };
              const body = (await res.json()) as LocalAuthorityImpactResponse;
              const impact: LocalAuthorityImpact = body.impact;
              return { id: c.id, nameTh: c.nameTh, type: c.type, impact, unavailable: false };
            } catch {
              return { id: c.id, nameTh: c.nameTh, type: c.type, impact: null, unavailable: true };
            }
          },
        );
        if (cancelled || controller.signal.aborted) return;

        attempt = 0;
        setState({ entries: rankAffectedAuthorities(built), loading: false, error: null, coverage: "covered" });
        timer = window.setTimeout(load, REFRESH_MS);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        if (err instanceof AoiNotBuiltError) {
          // จังหวัดนี้ยังไม่มี artefact ของ terrain เลย — เกิดได้เฉพาะระหว่าง
          // ทดสอบ/พัฒนา ไม่ใช่ในโปรดักชัน แต่ไม่ใช่ความล้มเหลวของชั้นนี้เอง
          setState({ entries: [], loading: false, error: null, coverage: "none" });
          return;
        }
        setState((s) => ({ ...s, loading: false, error: errorMessage(err, "error.loadFailed") }));
        const delay = nextReconnectDelayMs(attempt);
        attempt += 1;
        timer = window.setTimeout(load, delay);
      }
    };
    void load();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [provinceCode]);

  return state;
}
