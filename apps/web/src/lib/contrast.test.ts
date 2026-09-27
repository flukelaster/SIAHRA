import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compositeOver, contrastRatio, parseHex, relativeLuminance, type Rgb } from "./contrast";

/*
 * ล็อกโทเคนสีใน src/index.css (E18.5) — อ่านไฟล์ CSS จริง ไม่ใช่สำเนาค่า ถ้าใครปรับสีจน
 * ตัวอักษรต่ำกว่า WCAG AA หรือเส้นขอบกลืนไปกับแผง เทสต์นี้แดง
 */
const CSS = readFileSync(fileURLToPath(new URL("../index.css", import.meta.url)), "utf8");

function themeTokens(): Record<string, string> {
  const block = /@theme\s*\{([\s\S]*?)\n\}/.exec(CSS)?.[1];
  if (!block) throw new Error("no @theme block in index.css");
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/g)) out[m[1]] = m[2];
  return out;
}

/** พื้นหลังของคลาสกระจก (`.glass`, `.glass-soft`) = rgba(r, g, b, a) */
function glassBackground(cls: string): { rgb: Rgb; alpha: number } {
  const re = new RegExp(`\\.${cls}\\s*\\{[^}]*?background:\\s*rgba\\((\\d+),\\s*(\\d+),\\s*(\\d+),\\s*([\\d.]+)\\)`);
  const m = re.exec(CSS);
  if (!m) throw new Error(`no rgba background for .${cls}`);
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: Number(m[4]) };
}

const T = themeTokens();
const c = (name: string): Rgb => {
  const hex = T[name];
  if (!hex) throw new Error(`--color-${name} missing from @theme`);
  return parseHex(hex);
};

/*
 * พื้นผิวที่ตัวอักษรวางอยู่จริง: โทเคนทึบสี่ตัว + แผงกระจกสองแบบ แผงกระจกโปร่งแสง (alpha 0.94 /
 * 0.88) ข้างหลังจริงคือแผนที่ ซึ่งเทสต์จำลองไม่ได้ — สมมติว่าวางบน --color-bg (สีฟ้าของ
 * `.map-sky` เข้มกว่านั้น) และเพราะกระจกเข้มกว่า bg อยู่แล้ว มันจึงไม่ใช่กรณีที่กำหนดเกณฑ์:
 * panel-2 ที่สว่างที่สุดต่างหาก
 */
const SOLID = ["bg", "bg-elevated", "panel", "panel-2"] as const;
function surfaces(): Array<[string, Rgb]> {
  const out: Array<[string, Rgb]> = SOLID.map((s) => [s, c(s)]);
  for (const cls of ["glass", "glass-soft"]) {
    const g = glassBackground(cls);
    out.push([`.${cls} over bg`, compositeOver(g.rgb, g.alpha, c("bg"))]);
  }
  return out;
}

describe("contrast — ตัวช่วย WCAG", () => {
  it("ค่าอ้างอิง: ดำ/ขาว = 21, สีเดียวกัน = 1", () => {
    expect(contrastRatio(parseHex("#000"), parseHex("#fff"))).toBeCloseTo(21, 5);
    expect(contrastRatio(parseHex("#3b82f6"), parseHex("#3b82f6"))).toBe(1);
    expect(relativeLuminance(parseHex("#ffffff"))).toBeCloseTo(1, 6);
  });

  it("ค่าที่รู้จากเครื่องมือทั่วไป: #767676 บนขาว ≈ 4.54", () => {
    expect(contrastRatio(parseHex("#767676"), parseHex("#ffffff"))).toBeCloseTo(4.54, 2);
  });

  it("กระจกทับ bg ได้สีเข้มกว่า bg (จึงไม่ใช่กรณีที่กำหนดเกณฑ์)", () => {
    const g = glassBackground("glass");
    expect(relativeLuminance(compositeOver(g.rgb, g.alpha, c("bg")))).toBeLessThan(relativeLuminance(c("bg")));
  });
});

describe("โทเคนสีใน index.css", () => {
  it.each(["fg", "fg-muted", "fg-subtle"])("--color-%s ≥ 4.5:1 บนทุกพื้นผิว (WCAG AA ตัวอักษรปกติ)", (fg) => {
    for (const [name, bg] of surfaces()) {
      expect(contrastRatio(c(fg), bg), `${fg} on ${name}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("ลำดับชั้นตัวอักษรยังแยกกันได้: fg > fg-muted > fg-subtle", () => {
    const l = (n: string) => relativeLuminance(c(n));
    expect(l("fg")).toBeGreaterThan(l("fg-muted"));
    expect(l("fg-muted")).toBeGreaterThan(l("fg-subtle"));
  });

  it("เส้นขอบมองเห็นบนแผง: border ≥ 1.5:1, border-strong ≥ 2:1 (เทียบ panel และ panel-2)", () => {
    for (const bg of ["panel", "panel-2"]) {
      expect(contrastRatio(c("border"), c(bg)), `border on ${bg}`).toBeGreaterThanOrEqual(1.5);
      expect(contrastRatio(c("border-strong"), c(bg)), `border-strong on ${bg}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("accent ≥ 3:1 บน panel (องค์ประกอบที่ไม่ใช่ตัวอักษร) และ accent-fg บน accent ≥ 4.5:1", () => {
    expect(contrastRatio(c("accent"), c("panel"))).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(c("accent-fg"), c("accent"))).toBeGreaterThanOrEqual(4.5);
  });

  it("สีความหมาย (ความเสี่ยง/สถานะ) และ accent ที่ป้าย forecast อ้างถึง — ห้ามเปลี่ยนโดยไม่ตั้งใจ", () => {
    // EPISTEMIC_BADGE.forecast (lib/layerFreshness.ts) และ `.range-slider-forecast` ใช้ --color-accent
    // สเกลความเสี่ยงใช้ร่วมกันทั้งตำนานน้ำท่วมและแผ่นดินไหว — การปรับโทนกลาง (E18.5) ไม่แตะกลุ่มนี้
    expect({
      accent: T.accent,
      "risk-low": T["risk-low"],
      "risk-medium": T["risk-medium"],
      "risk-high": T["risk-high"],
      "risk-extreme": T["risk-extreme"],
      success: T.success,
      danger: T.danger,
    }).toEqual({
      accent: "#3b82f6",
      "risk-low": "#38bdf8",
      "risk-medium": "#eab308",
      "risk-high": "#f97316",
      "risk-extreme": "#ef4444",
      success: "#22c55e",
      danger: "#ef4444",
    });
  });
});
