import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BasinDam, BasinStation, BasinsResponse, HealthResponse } from "@siahra/shared-types";
import type { BasinsState } from "../../hooks/useBasins";
import { translator, type Lang } from "../../i18n";
import { LanguageContext } from "../../i18n/context";
import type { BasinSelection } from "../../lib/basinView";
import { BasinCard } from "./BasinCard";

/**
 * เรนเดอร์การ์ดลุ่มน้ำจริงด้วย react-dom/server แล้วอ่านข้อความที่ผู้ใช้เห็น — สถานะที่ต้องเป็นคนละประโยค:
 * ยังไม่เคยดึง (fetchedAt null) / ถาม API ไม่ได้ / ค้าง / ดูย้อนหลัง (ไม่แสดงค่า); เขื่อนไม่เคยดึง ≠ ไม่มีเขื่อน;
 * นอกประเทศไทยไม่ใช่ลุ่มน้ำ; ไม่มีสีเขียว และไม่มีคำที่อ่านเป็นการพยากรณ์
 */
const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;

function station(id: number, over: Partial<BasinStation> = {}): BasinStation {
  return {
    id,
    nameTh: `สถานี${id}`,
    provinceCode: "50",
    lat: 18.8,
    lon: 99,
    waterlevelMsl: 300.5,
    freeboardM: 2,
    situationLevel: 3,
    dischargeM3s: null,
    qmaxM3s: null,
    observedAt: iso(NOW - 30 * MIN),
    ...over,
  };
}
function dam(id: number): BasinDam {
  return { id, nameTh: "ภูมิพล", nameEn: "BHUMIBOL DAM", kind: "large", provinceCode: "63", storagePercent: 61, storageMcm: 8000, observedAt: iso(NOW - 60 * MIN) };
}
function response(over: Partial<BasinsResponse> = {}): BasinsResponse {
  const fetchedAt = iso(NOW - 2 * MIN);
  return {
    layer: { id: "thaiwater-basins", epistemicClass: "observed", liveOrStatic: "live", publishedAt: null, fetchedAt, staleAfterSeconds: 900, sourceIds: ["thaiwater"] },
    fetchedAt,
    damsFetchedAt: null,
    basins: [
      { key: "ปิง", nameTh: "ลุ่มน้ำปิง", stations: [station(1, { situationLevel: 5 }), station(2), station(3, { provinceCode: "51" })], dams: [dam(9)] },
      { key: "ยม", nameTh: "ลุ่มน้ำยม", stations: [station(4)], dams: [] },
    ],
    outsideThailand: { stations: [station(7, { provinceCode: null })], dams: [] },
    unassigned: { stations: [], dams: [] },
    ...over,
  };
}
const ok = (data: BasinsResponse | null, extra: Partial<BasinsState> = {}): BasinsState => ({ data, loading: false, error: null, errorSince: null, ...extra });

function render(
  state: BasinsState,
  o: { selection?: BasinSelection | null; atIso?: string | null; health?: HealthResponse | null; apiDown?: boolean; lang?: Lang } = {},
): string {
  const lang = o.lang ?? "th";
  return renderToStaticMarkup(
    createElement(
      LanguageContext.Provider,
      { value: { lang, setLang: () => {}, t: translator(lang) } },
      createElement(BasinCard, {
        state,
        selection: o.selection ?? null,
        onSelect: () => {},
        atIso: o.atIso ?? null,
        health: o.health ?? null,
        apiDown: o.apiDown ?? false,
        onFocusStation: () => {},
      }),
    ),
  );
}

describe("BasinCard", () => {
  it("มีป้ายตรวจวัดจริงเสมอ และบอกว่าเป็นป้ายลุ่มน้ำของ ThaiWater ไม่ใช่ขอบเขตของ SIAHRA + ไม่มีลำดับต้นน้ำ/เวลาน้ำมาถึง", () => {
    const html = render(ok(response()));
    expect(html).toContain("ตรวจวัดจริง");
    expect(html).toContain("ไม่ใช่ขอบเขตลุ่มน้ำของ SIAHRA");
    expect(html).toContain("ไม่มีลำดับต้นน้ำ–ปลายน้ำ");
    expect(html).toContain("ไม่มีเวลาที่น้ำจะมาถึง");
  });

  it("ตัวเลือกแสดงชื่อ + จำนวน; นอกประเทศไทยอยู่ใต้ 'ไม่ใช่ลุ่มน้ำ' ไม่ปนในรายการลุ่มน้ำ", () => {
    const html = render(ok(response()));
    expect(html).toContain("ลุ่มน้ำปิง");
    expect(html).toContain("3 สถานี · 1 เขื่อน");
    const others = html.indexOf("ไม่ใช่ลุ่มน้ำ (แสดงแยกไว้");
    expect(others).toBeGreaterThan(0);
    expect(html.indexOf("นอกประเทศไทย")).toBeGreaterThan(others);
    expect(html.slice(0, others)).not.toContain("นอกประเทศไทย");
  });

  it("เลือกลุ่ม: สรุป + จังหวัดแย่สุดก่อน + สถานี; เขื่อนที่ไม่เคยดึง = บอกว่าไม่เคยดึง (ไม่ใช่ไม่มีเขื่อน) และหรี่", () => {
    const html = render(ok(response()), { selection: { kind: "basin", key: "ปิง" } });
    expect(html).toContain("data-basin-detail");
    expect(html).toContain("1 สถานีเกินเกณฑ์");
    expect(html).toContain("data-basin-provinces");
    expect(html.indexOf('data-station="1"')).toBeGreaterThan(0);
    expect(html).toContain("API ยังไม่เคยดึงข้อมูลเขื่อน");
    expect(html).not.toContain("ไม่มีเขื่อนในกลุ่มนี้ตามข้อมูล");
    expect(html).toContain("opacity-60");
    expect(html).toContain('data-dam="9"');
  });

  it("เขื่อนที่ดึงแล้วและไม่ค้าง = ไม่หรี่ และแสดงเวลาดึง; ลุ่มที่ไม่มีเขื่อน = ไม่มีเขื่อนตามข้อมูลที่ถืออยู่", () => {
    const fresh = response({ damsFetchedAt: iso(NOW - 10 * MIN) });
    const withDam = render(ok(fresh), { selection: { kind: "basin", key: "ปิง" } });
    expect(withDam).toContain("ข้อมูลเขื่อนดึงล่าสุด:");
    expect(withDam).not.toContain("opacity-60");
    const none = render(ok(fresh), { selection: { kind: "basin", key: "ยม" } });
    expect(none).toContain("ไม่มีเขื่อนในกลุ่มนี้ตามข้อมูล ThaiWater ที่ถืออยู่");
  });

  it("เขื่อนที่ดึงนานเกิน 3 ชม. = หรี่ + บอกว่าเก่า", () => {
    const html = render(ok(response({ damsFetchedAt: iso(NOW - 4 * 3_600_000) })), { selection: { kind: "basin", key: "ปิง" } });
    expect(html).toContain("เก่ากว่า 3 ชม.");
    expect(html).toContain("opacity-60");
  });

  it("นอกประเทศไทย: เรียกว่าไม่ใช่ลุ่มน้ำ, สถานีที่ไม่มีจังหวัดยังอยู่แต่เปิดบนแผนที่ไม่ได้ (disabled)", () => {
    const html = render(ok(response()), { selection: { kind: "outside" } });
    expect(html).toContain("ไม่ใช่ลุ่มน้ำ จึงแยกไว้");
    expect(html).toContain('data-station="7"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="ต้นทางไม่ระบุจังหวัด/);
  });

  it("สถานีที่ต้นทางให้รหัส 10499 (ไม่ใช่จังหวัด): ปุ่ม disabled + คำอธิบาย 'ไม่ระบุจังหวัด' ไม่พิมพ์รหัสดิบ ทั้งแถวสถานีและแถวจังหวัด", () => {
    const data = response({ outsideThailand: { stations: [station(7, { provinceCode: "10499" })], dams: [] } });
    for (const lang of ["th", "en"] as const) {
      const html = render(ok(data), { selection: { kind: "outside" }, lang });
      expect(html).toContain('data-station="7"');
      expect(html).not.toContain("10499");
      expect(html).not.toMatch(/<button[^>]*data-station/);
      // ทั้งปุ่มของแถวสถานีและของแถวจังหวัด (กลุ่ม null) ต้อง disabled
      expect((html.match(/<button[^>]*disabled=""/g) ?? []).length).toBe(2);
    }
    const th = render(ok(data), { selection: { kind: "outside" } });
    expect(th).toContain("ไม่ระบุจังหวัด");
    expect(th).toContain("ต้นทางไม่ระบุจังหวัด — เปิดบนแผนที่ไม่ได้");
    // เขื่อนที่ให้รหัสไม่ใช่จังหวัดก็ไม่พิมพ์รหัสดิบ
    const damHtml = render(
      ok(response({ damsFetchedAt: iso(NOW), outsideThailand: { stations: [], dams: [{ ...dam(5), provinceCode: "10499" }] } })),
      { selection: { kind: "outside" } },
    );
    expect(damHtml).toContain('data-dam="5"');
    expect(damHtml).not.toContain("10499");
  });

  it("ระยะถึงตลิ่ง: ติดลบ = น้ำอยู่เหนือตลิ่ง (ไม่พิมพ์ '-0.97' ใต้ 'ต่ำกว่าตลิ่ง'), บวก = ต่ำกว่าตลิ่ง, ศูนย์ = ระดับเท่าตลิ่ง", () => {
    const at = (freeboardM: number, lang: Lang = "th") =>
      render(ok(response({ basins: [{ key: "ปิง", nameTh: "ลุ่มน้ำปิง", stations: [station(1, { freeboardM, situationLevel: null })], dams: [] }] })), {
        selection: { kind: "basin", key: "ปิง" },
        lang,
      });
    const neg = at(-0.97);
    expect(neg).toContain("สูงกว่าตลิ่ง 0.97 ม.");
    expect(neg).not.toContain("ต่ำกว่าตลิ่ง -");
    expect(neg).not.toContain("-0.97");
    expect(neg).not.toMatch(/ต่ำกว่าตลิ่ง 0\.97/);
    expect(at(-0.97, "en")).toContain("0.97 m above the bank");
    const pos = at(1.5);
    expect(pos).toContain("ต่ำกว่าตลิ่ง 1.5 ม.");
    expect(pos).not.toContain("สูงกว่าตลิ่ง");
    expect(at(1.5, "en")).toContain("1.5 m below the bank");
    const zero = at(0);
    expect(zero).toContain("ระดับเท่าตลิ่ง");
    expect(zero).not.toContain("สูงกว่าตลิ่ง");
    expect(zero).not.toMatch(/ต่ำกว่าตลิ่ง 0\.00/);
  });

  it("ไม่มีคำตอบจาก API (โหลดอยู่ / คำขอพลาด / ดูย้อนหลังโดยไม่มีข้อมูล): ไม่พูดว่า 'ยังไม่เคยได้รับข้อมูล' — ไม่ได้ถาม/ถามไม่ได้ ไม่ใช่ไม่เคยได้", () => {
    const never = "ยังไม่เคยได้รับข้อมูล";
    const loading = render(ok(null, { loading: true }));
    expect(loading).not.toContain(never);
    expect(loading).not.toContain("ThaiWater ดึงล่าสุด");
    const failed = render(ok(null, { error: { raw: "HTTP 503" }, errorSince: iso(NOW) }));
    expect(failed).not.toContain(never);
    expect(failed).not.toContain("ThaiWater ดึงล่าสุด");
    const historical = render(ok(null), { atIso: iso(NOW - 3_600_000) });
    expect(historical).toContain("แผงนี้แสดงเฉพาะค่าปัจจุบัน");
    expect(historical).not.toContain(never);
    expect(historical).not.toContain("ThaiWater ดึงล่าสุด");
    // คำตอบจริงของ API ที่ fetchedAt = null ยังเป็น "ยังไม่เคยได้รับข้อมูล" (ดูเทสถัดไป)
    const answered = render(ok(response({ fetchedAt: null, basins: [] })));
    expect(answered).toContain(never);
  });

  it("ท่อที่ปกติดี: อายุ 14 นาที 59 วิ และ 25 นาที ไม่หรี่ ไม่บอกว่าเก่า; 31 นาที หรี่และบอก", () => {
    const withAge = (ms: number) => {
      const f = iso(NOW - ms);
      return render(ok(response({ fetchedAt: f, layer: { ...response().layer, fetchedAt: f } })));
    };
    for (const ms of [14 * MIN + 59_000, 25 * MIN]) {
      const html = withAge(ms);
      expect(html).not.toContain("opacity-60");
      expect(html).not.toContain("หรี่ไว้");
    }
    const old = withAge(31 * MIN);
    expect(old).toContain("opacity-60");
    expect(old).toContain("เก่ากว่า 31 นาที");
  });

  it("ยังไม่เคยดึง (fetchedAt null): ข้อความเฉพาะ ไม่มีตัวเลือก ไม่ใช่ 'ไม่มีลุ่มน้ำ' และไม่ใช่เวลาปัจจุบัน", () => {
    const html = render(ok(response({ fetchedAt: null, basins: [], outsideThailand: { stations: [], dams: [] }, unassigned: { stations: [], dams: [] } })));
    expect(html).toContain("API ยังไม่เคยดึงระดับน้ำจาก ThaiWater สำเร็จ");
    expect(html).toContain("ยังไม่เคยได้รับข้อมูล");
    expect(html).not.toContain("เลือกลุ่มน้ำ");
  });

  it("ถาม API ไม่ได้และยังไม่มีข้อมูล: ข้อความของตัวเอง (ไม่ใช่ 'ยังไม่เคยดึง')", () => {
    const html = render(ok(null, { error: { raw: "HTTP 503" }, errorSince: iso(NOW) }));
    expect(html).toContain("ติดต่อ API ไม่ได้ จึงยังไม่มีข้อมูลลุ่มน้ำในเบราว์เซอร์นี้: HTTP 503");
    expect(html).not.toContain("API ยังไม่เคยดึงระดับน้ำ");
  });

  it("คำขอล่าสุดพลาดแต่ยังมีชุดเดิม: บอกและหรี่ ไม่ซ่อน", () => {
    const html = render(ok(response(), { error: { raw: "HTTP 503" }, errorSince: iso(NOW - MIN) }));
    expect(html).toContain("รอบล่าสุดที่เว็บขอข้อมูลลุ่มน้ำไม่สำเร็จ (HTTP 503)");
    expect(html).toContain("ลุ่มน้ำปิง");
    expect(html).toContain("opacity-60");
  });

  it("ข้อมูลที่ API ถือเก่าเกิน staleAfterSeconds: บอกอายุและหรี่", () => {
    const old = iso(NOW - 40 * MIN);
    const html = render(ok(response({ fetchedAt: old, layer: { ...response().layer, fetchedAt: old } })));
    expect(html).toContain("เก่ากว่า 40 นาที");
    expect(html).toContain("opacity-60");
  });

  it("สด ไม่ค้าง ไม่มี error = ไม่หรี่และไม่มีข้อความเตือน", () => {
    const html = render(ok(response()));
    expect(html).not.toContain("opacity-60");
    expect(html).not.toContain("หรี่ไว้");
  });

  it("ดูย้อนหลัง (atIso ตั้ง): บอกว่าแสดงเฉพาะปัจจุบัน และไม่แสดงค่าของสถานีใด", () => {
    const html = render(ok(response()), { atIso: iso(NOW - 3_600_000), selection: { kind: "basin", key: "ปิง" } });
    expect(html).toContain("แผงนี้แสดงเฉพาะค่าปัจจุบัน");
    expect(html).not.toContain("data-station");
    expect(html).not.toContain("ลุ่มน้ำปิง");
  });

  it("ลุ่มที่เลือกหายไปจากข้อมูลชุดใหม่: บอกตรง ๆ ไม่เดาแทน", () => {
    const html = render(ok(response()), { selection: { kind: "basin", key: "ไม่มีลุ่มนี้" } });
    expect(html).toContain("กลุ่มนี้ไม่อยู่ในข้อมูลชุดล่าสุด");
  });

  it("สถานะแหล่ง ThaiWater ไม่ปกติ / ถาม /health ไม่ได้ — สองข้อความที่แยกกัน", () => {
    const health = {
      ok: false,
      sources: [{ id: "thaiwater", labelTh: "ThaiWater", labelEn: "ThaiWater", health: "stale", fetchedAt: iso(NOW), latestObservedAt: null, lastAttemptAt: null, lastError: null, detail: {}, staleAfterSeconds: 900, observedLagSeconds: null, nextAttemptAt: null }],
    } as unknown as HealthResponse;
    const bad = render(ok(response()), { health });
    expect(bad).toContain("สถานะ ThaiWater: ข้อมูลค้าง");
    expect(bad).toContain("opacity-60");
    const down = render(ok(response()), { apiDown: true });
    expect(down).toContain("ถามสถานะของ API ไม่ได้");
    expect(down).not.toContain("สถานะ ThaiWater:");
  });

  it("ไม่มีสีเขียวและไม่มีคำที่อ่านเป็นการพยากรณ์ (สองภาษา)", () => {
    for (const lang of ["th", "en"] as const) {
      const html = render(ok(response({ damsFetchedAt: iso(NOW) })), { lang, selection: { kind: "basin", key: "ปิง" } });
      // สีเขียวมีที่เดียวคือป้าย "ตรวจวัดจริง" (ชนิดความรู้ ไม่ใช่สถานะความปลอดภัย); ไม่มีชิป/ข้อความสถานะใดเป็นเขียว
      const withoutBadge = html.replace(/<span class="inline-flex w-fit items-center rounded-md px-1\.5 py-0\.5 text-\[10px\] leading-none ring-1[^"]*"/, "");
      expect(html).not.toBe(withoutBadge);
      expect(withoutBadge).not.toMatch(/color-success/);
      expect(html).not.toMatch(/color-risk-low/);
      expect(html).not.toMatch(/forecast|probabilit|likely|predict|พยากรณ์|คาดการณ์|ความน่าจะเป็น/i);
    }
  });
});
