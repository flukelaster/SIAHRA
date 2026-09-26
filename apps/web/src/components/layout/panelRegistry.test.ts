import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChunkBoundary } from "../ui/ChunkBoundary";
import { lazyView } from "../ui/lazyView";
import { PANEL_KEYS, PANELS, panelByKey } from "./panelRegistry";

describe("panelRegistry — ทุกแผงเป็น chunk แยก", () => {
  it("มีครบทุกคีย์ ตามลำดับเดิม", () => {
    expect(PANELS.map((p) => p.key)).toEqual([...PANEL_KEYS]);
    for (const key of PANEL_KEYS) expect(panelByKey(key).key).toBe(key);
  });

  it.each(PANELS.map((p) => [p.key, p] as const))("แผง %s โหลด chunk ได้ และได้คอมโพเนนต์กลับมา", async (_key, def) => {
    const loaded = await def.view.preload();
    expect(typeof loaded).toBe("function");
  });
});

describe("lazyView + ChunkBoundary", () => {
  const Hello = ({ name }: { name: string }) => createElement("p", null, `hello ${name}`);

  it("ก่อนโหลดเสร็จ: วงหมุน 'กำลังโหลด...' (ไม่ใช่กล่องว่าง / ไม่ใช่ข้อความไม่มีข้อมูล)", () => {
    const View = lazyView(() => new Promise<typeof Hello>(() => {}));
    const html = renderToStaticMarkup(createElement(ChunkBoundary, null, createElement(View, { name: "x" })));
    expect(html).toContain('role="status"');
    expect(html).toContain("กำลังโหลด");
    expect(html).not.toContain("hello");
  });

  it("หลังโหลดเสร็จ: เรนเดอร์ของจริงทันทีโดยไม่ suspend อีก", async () => {
    const View = lazyView(async () => Hello);
    await View.preload();
    const html = renderToStaticMarkup(createElement(ChunkBoundary, null, createElement(View, { name: "x" })));
    expect(html).toBe("<p>hello x</p>");
  });
});
