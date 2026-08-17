// Renders docs/og/og-image.html → docs/images/og-image.png (1280×640 — GitHub social preview must stay under 1 MB, so 1× DPR).
// Usage: node docs/og/render.mjs   (needs playwright-core + Chrome; @playwright/cli's copy works:
//   PW_CORE=~/.npm-global/lib/node_modules/@playwright/cli/node_modules/playwright-core node docs/og/render.mjs)
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";
const here = path.dirname(fileURLToPath(import.meta.url));
const core = process.env.PW_CORE ?? "playwright-core";
const { chromium } = await import(pathToFileURL(createRequire(import.meta.url).resolve(core)).href);
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(here, "og-image.html")).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(800);
const out = path.join(here, "..", "images", "og-image.png");
await page.screenshot({ path: out });
console.log("wrote", out);
await browser.close();
