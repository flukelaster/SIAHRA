#!/usr/bin/env node
/**
 * Build the Open Graph share image (`apps/web/public/og-image.jpg`, 2400×1260 = 1200×630 @2x).
 *
 *   node apps/web/og/build.mjs            # write .out/og-image.html and render it
 *   node apps/web/og/build.mjs --html     # only write .out/og-image.html (open it in a browser to tweak)
 *
 * The right-hand map is Thailand assembled from the 77 province boundaries the
 * app already ships (`public/aoi/{code}/boundary.geojson`) — projected to Web
 * Mercator, radially simplified to sub-pixel tolerance, and inlined into the
 * design template (`og-image.template.html`) as SVG paths. Nothing on the image
 * is data: the rings, sweep and glow are decoration; no hazard values are drawn.
 *
 * Rendering needs the globally installed `playwright-cli` (the same tool the
 * repo uses for visual checks — see AGENTS.md "Running it"); the JPEG encode
 * uses macOS `sips`, falling back to `sharp` if one happens to be resolvable.
 * Without playwright-cli the script stops after writing the HTML.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const aoiDir = resolve(webRoot, "public/aoi");
const outDir = resolve(here, ".out");
const outHtml = resolve(outDir, "og-image.html");
const outPng = resolve(outDir, "og-image@2x.png");
const outJpg = resolve(webRoot, "public/og-image.jpg");
const htmlOnly = process.argv.includes("--html");

/** Canvas in CSS px (the Open Graph 1.91:1 standard) and the render scale/quality. */
const WIDTH = 1200, HEIGHT = 630, SCALE = 2, JPEG_QUALITY = 82;

// ---------------------------------------------------------------------------
// 1. Thailand from the province boundaries
// ---------------------------------------------------------------------------

/** Map box on the 1200×630 canvas (page px = SVG user units). */
const MAP = { left: 700, top: 22, width: 460, height: 586, pad: 24 };
const RAD = Math.PI / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2)) / RAD;

const provinces = readdirSync(aoiDir)
  .filter((d) => /^\d{2}$/.test(d) && existsSync(resolve(aoiDir, d, "boundary.geojson")))
  .sort()
  .map((code) => {
    const fc = JSON.parse(readFileSync(resolve(aoiDir, code, "boundary.geojson"), "utf8"));
    const rings = [];
    for (const f of fc.features) {
      const g = f.geometry;
      const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
      for (const poly of polys) for (const ring of poly) rings.push(ring);
    }
    return { code, rings };
  });

if (provinces.length === 0) throw new Error(`no province boundaries under ${aoiDir}`);

let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
for (const p of provinces)
  for (const ring of p.rings)
    for (const [lon, lat] of ring) {
      const y = mercY(lat);
      if (lon < minX) minX = lon;
      if (lon > maxX) maxX = lon;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

const innerW = MAP.width - MAP.pad * 2;
const innerH = MAP.height - MAP.pad * 2;
const scale = Math.min(innerW / (maxX - minX), innerH / (maxY - minY));
const drawnW = (maxX - minX) * scale;
const drawnH = (maxY - minY) * scale;
const offX = (MAP.width - drawnW) / 2;
const offY = (MAP.height - drawnH) / 2;
const px = (lon) => offX + (lon - minX) * scale;
const py = (lat) => offY + (maxY - mercY(lat)) * scale;
const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, "");

/** Radial-distance simplification in output pixels; drops islets smaller than ~1.5 px. */
function ringToPath(ring, tol = 0.6) {
  const pts = [];
  let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
  for (const [lon, lat] of ring) {
    const x = px(lon), y = py(lat);
    if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(x - last[0], y - last[1]) >= tol) pts.push([x, y]);
  }
  if (bx1 - bx0 < 1.5 && by1 - by0 < 1.5) return "";
  if (pts.length < 3) return "";
  return "M" + pts.map(([x, y]) => `${f1(x)} ${f1(y)}`).join("L") + "Z";
}

const provincePaths = provinces
  .map((p) => {
    const d = p.rings.map((r) => ringToPath(r)).filter(Boolean).join("");
    return d ? `<path data-p="${p.code}" d="${d}"/>` : "";
  })
  .filter(Boolean)
  .join("\n");

// Graticule (every 2°) with tiny labels — cartographic texture, not data.
const gratLines = [];
const gratLabels = [];
for (let lon = Math.ceil(minX / 2) * 2 - 2; lon <= maxX + 2; lon += 2) {
  const x = px(lon);
  if (x < 4 || x > MAP.width - 4) continue;
  gratLines.push(`<line x1="${f1(x)}" y1="0" x2="${f1(x)}" y2="${MAP.height}"/>`);
  gratLabels.push(`<text x="${f1(x)}" y="${MAP.height - 6}" text-anchor="middle">${lon}°E</text>`);
}
for (let lat = Math.ceil(minY / 2) * 2 - 2; lat <= 22; lat += 2) {
  const y = py(lat);
  if (y < 8 || y > MAP.height - 14) continue;
  gratLines.push(`<line x1="0" y1="${f1(y)}" x2="${MAP.width}" y2="${f1(y)}"/>`);
  gratLabels.push(`<text x="${MAP.width - 6}" y="${f1(y - 4)}" text-anchor="end">${lat}°N</text>`);
}

// Radar motif centred on Bangkok (the domain is siahra-radar.co).
const BKK = { lon: 100.5018, lat: 13.7563 };
const bx = px(BKK.lon), by = py(BKK.lat);
const pxPerKm = (scale / 111.32) / Math.cos(BKK.lat * RAD);
const rings = [120, 240, 360].map((km) => `<circle cx="${f1(bx)}" cy="${f1(by)}" r="${f1(km * pxPerKm)}"/>`).join("");
const sweepR = 420 * pxPerKm;
const wedges = [];
const SWEEP_DEG = 110, STEPS = 40, HEAD = -28; // trailing fade ends at HEAD (deg, 0 = east, clockwise on screen)
for (let i = 0; i < STEPS; i++) {
  const a0 = HEAD - (i + 1) * (SWEEP_DEG / STEPS);
  const a1 = HEAD - i * (SWEEP_DEG / STEPS);
  const t = 1 - i / STEPS; // 1 at leading edge → 0 at tail
  const o = 0.42 * t * t;
  const x0 = bx + sweepR * Math.cos(a0 * RAD), y0 = by + sweepR * Math.sin(a0 * RAD);
  const x1 = bx + sweepR * Math.cos(a1 * RAD), y1 = by + sweepR * Math.sin(a1 * RAD);
  wedges.push(`<path d="M${f1(bx)} ${f1(by)}L${f1(x0)} ${f1(y0)}A${f1(sweepR)} ${f1(sweepR)} 0 0 1 ${f1(x1)} ${f1(y1)}Z" opacity="${o.toFixed(3)}"/>`);
}
const headX = bx + sweepR * Math.cos(HEAD * RAD), headY = by + sweepR * Math.sin(HEAD * RAD);
const sweepHead = `<line x1="${f1(bx)}" y1="${f1(by)}" x2="${f1(headX)}" y2="${f1(headY)}"/>`;

// ---------------------------------------------------------------------------
// 2. Fill the template
// ---------------------------------------------------------------------------
const template = readFileSync(resolve(here, "og-image.template.html"), "utf8");
// The card must use the same self-hosted faces as the app (E4.1), so the
// @font-face block is the app's own src/fonts.css inlined verbatim — one source
// of truth for which files exist and what their unicode-ranges are. The `url()`
// paths stay absolute (/fonts/...) and are answered by the server below.
const fontFaces = readFileSync(resolve(webRoot, "src/fonts.css"), "utf8");
const html = template
  .replaceAll("{{FONT_FACES}}", fontFaces)
  .replaceAll("{{MAP_LEFT}}", String(MAP.left))
  .replaceAll("{{MAP_TOP}}", String(MAP.top))
  .replaceAll("{{MAP_W}}", String(MAP.width))
  .replaceAll("{{MAP_H}}", String(MAP.height))
  .replaceAll("{{BKK_X}}", f1(bx))
  .replaceAll("{{BKK_Y}}", f1(by))
  .replaceAll("{{GLOW_CX}}", f1(MAP.left + drawnW / 2 + offX))
  .replaceAll("{{GLOW_CY}}", f1(MAP.top + drawnH / 2 + offY))
  .replaceAll("{{PROVINCE_PATHS}}", provincePaths)
  .replaceAll("{{GRATICULE_LINES}}", gratLines.join(""))
  .replaceAll("{{GRATICULE_LABELS}}", gratLabels.join(""))
  .replaceAll("{{RADAR_RINGS}}", rings)
  .replaceAll("{{RADAR_SWEEP}}", wedges.join(""))
  .replaceAll("{{RADAR_HEAD}}", sweepHead);
const unfilled = html.match(/{{[A-Z_]+}}/);
if (unfilled) throw new Error(`unfilled token in template: ${unfilled[0]}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(outHtml, html);
console.log(`wrote ${outHtml} (${provinces.length} provinces, ${(provincePaths.length / 1024).toFixed(0)} KB of paths)`);

// ---------------------------------------------------------------------------
// 3. Render with playwright-cli, then encode as JPEG
// ---------------------------------------------------------------------------
if (htmlOnly) process.exit(0);

try {
  execFileSync("playwright-cli", ["--version"], { stdio: "ignore" });
} catch {
  console.error(
    "playwright-cli not found — install it (npm i -g @playwright/cli), or open .out/og-image.html over http\n" +
      "(playwright-cli refuses file:// URLs) and screenshot it at 1200×630 by hand.",
  );
  process.exit(2);
}

// playwright-cli blocks file:// URLs, so serve the rendered HTML from a throwaway local server.
const server = createServer((req, res) => {
  if (req.url?.startsWith("/og-image.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(html);
    return;
  }
  // The self-hosted woff2 files the inlined @font-face rules point at. The
  // regexp is the whole allow-list: only a plain filename under public/fonts/.
  const font = /^\/fonts\/([A-Za-z0-9._-]+\.woff2)$/.exec(req.url ?? "");
  if (font && existsSync(resolve(webRoot, "public/fonts", font[1]))) {
    res.writeHead(200, { "content-type": "font/woff2", "cache-control": "no-store" });
    res.end(readFileSync(resolve(webRoot, "public/fonts", font[1])));
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
// playwright-cli always screenshots in CSS pixels, so a retina-sharp 2400×1260
// comes from zooming the page 2× (handled by the template) in a 2× viewport.
const url = `http://127.0.0.1:${server.address().port}/og-image.html?scale=${SCALE}`;

// Async on purpose: the page is served by *this* process, so a blocking exec
// would deadlock the navigation (playwright-cli waits for a response that the
// event loop cannot send).
const session = "siahra-og";
const run = promisify(execFile);
const pw = async (...args) => {
  const { stdout } = await run("playwright-cli", [`-s=${session}`, ...args], { cwd: outDir, encoding: "utf8", timeout: 90_000 });
  return stdout.trim();
};
try {
  await pw("close").catch(() => {});
  await pw("open", url);
  await pw("resize", String(WIDTH * SCALE), String(HEIGHT * SCALE));
  // The fonts must be in before the screenshot, otherwise Sarabun falls back to the system sans.
  const fonts = await pw(
    "eval",
    "() => document.fonts.ready.then(() => Array.from(document.fonts).filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight).join(', '))",
  );
  const loaded = fonts.split("\n").find((l) => l.includes("Sarabun"));
  if (!loaded) throw new Error("Sarabun did not load from public/fonts/ — the render would fall back to a system font; check that the woff2 files are present");
  console.log("fonts:", loaded);
  await pw("screenshot", `--filename=${outPng}`);
  await pw("close");
} finally {
  server.close();
}
console.log(`rendered ${outPng} (${(statSync(outPng).size / 1024).toFixed(0)} KB PNG)`);

// A PNG of this design is ~1.6 MB at 2×; the JPEG (quality 82) is a quarter of that with no
// visible loss at preview size. `sips` ships with macOS; `sharp` is not a declared dependency
// (it only arrives transitively via miniflare), so it is a best-effort fallback, not the plan.
let encoded = false;
if (process.platform === "darwin") {
  try {
    execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", String(JPEG_QUALITY), outPng, "--out", outJpg], { stdio: "ignore" });
    encoded = true;
  } catch { /* fall through */ }
}
if (!encoded) {
  try {
    const sharp = (await import("sharp")).default;
    await sharp(outPng).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toFile(outJpg);
    encoded = true;
  } catch { /* fall through */ }
}
if (!encoded) {
  console.error(`could not encode JPEG (no sips, no sharp) — convert ${outPng} to ${outJpg} by hand`);
  process.exit(3);
}
console.log(`wrote ${outJpg} (${(statSync(outJpg).size / 1024).toFixed(0)} KB, ${WIDTH * SCALE}×${HEIGHT * SCALE})`);
