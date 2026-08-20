// Renders docs/diagrams/*.svg → docs/images/*.png at 2× (crisp on a HiDPI README).
// Usage: node docs/diagrams/render.mjs   (needs playwright-core + Chrome; @playwright/cli's copy works:
//   PW_CORE=~/.npm-global/lib/node_modules/@playwright/cli/node_modules/playwright-core node docs/diagrams/render.mjs)
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const core = process.env.PW_CORE ?? "playwright-core";
const pw = await import(pathToFileURL(createRequire(import.meta.url).resolve(core)).href);
const chromium = pw.chromium ?? pw.default?.chromium;

const browser = await chromium.launch({ headless: true, channel: "chrome" });
for (const file of readdirSync(here).filter((f) => f.endsWith(".svg"))) {
  const svg = readFileSync(path.join(here, file), "utf8");
  const [, w, h] = svg.match(/width="(\d+)"\s+height="(\d+)"/) ?? [];
  const page = await browser.newPage({
    viewport: { width: Number(w), height: Number(h) },
    deviceScaleFactor: 2,
  });
  // ไม่ใช้ file:// ตรง ๆ กับ .svg — โหลดเป็น HTML ที่ inline ตัว svg ไว้ ฟอนต์ระบบจึงใช้ได้ตามปกติ
  await page.setContent(`<!doctype html><meta charset="utf-8">
    <style>html,body{margin:0;padding:0;background:#fff}svg{display:block}</style>${svg}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const out = path.join(here, "..", "images", file.replace(/\.svg$/, ".png"));
  await page.screenshot({ path: out });
  await page.close();
  console.log("wrote", out, `(${w}×${h} @2×)`);
}
await browser.close();
