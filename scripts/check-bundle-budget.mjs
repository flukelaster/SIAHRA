#!/usr/bin/env node
/**
 * Bundle budget for apps/web (roadmap E8.2).
 *
 * Runs from the `postbuild` hook in apps/web/package.json, so every
 * `npm run build -w apps/web` — including the one in .github/workflows/ci.yml —
 * enforces it without ci.yml having to know this script exists.
 *
 * What it checks
 *   1. entry + vendor, gzipped, stays under the roadmap's 900 KB ceiling
 *   2. the same total stays under a tighter regression guard, so a bundle that
 *      doubles is caught long before it reaches a ceiling three times its size
 *   3. the vendor split is still in effect — a `manualChunks` config that
 *      silently stops applying is churn with no caching benefit, and the size
 *      totals alone would never notice
 *
 * Usage:  node scripts/check-bundle-budget.mjs [distDir]
 * Env:    SIAHRA_BUNDLE_BUDGET_KB=<n>  override both budgets (used to
 *         demonstrate the failure path; not set in CI)
 */
import { gzipSync } from "node:zlib";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Roadmap E8.2: "the build fails when entry plus vendor exceeds 900 KB gzipped". */
const CEILING_KB = 900;
/**
 * Tighter tripwire, chosen from the measured bundle (277 KB gzipped after the
 * three/react split) with roughly 25 % headroom. It **warns, it does not fail**.
 *
 * The roadmap contracted exactly one build-breaking budget, the ceiling above.
 * Making this a second one would leave 83 kB of room, and a single ordinary
 * dependency — a chart or date library is 30–80 kB gzipped by itself — would
 * turn a bloat detector into a tripwire that blocks a PR which did nothing
 * wrong, forcing whoever hits it to edit this script to get unblocked. The
 * job here is to make growth *visible* in the build log; blocking is the
 * ceiling's job.
 */
const GUARD_KB = 360;
/** Chunk name prefixes that must exist, or the vendor split has stopped working. */
const REQUIRED_VENDOR = ["three", "react"];

const distDir = path.resolve(process.argv[2] ?? "dist");
const assetsDir = path.join(distDir, "assets");

let entries;
try {
  entries = readdirSync(assetsDir).filter((f) => f.endsWith(".js"));
} catch (err) {
  console.error(`bundle budget: cannot read ${assetsDir} — did the build run?`);
  console.error(String(err));
  process.exit(1);
}

const kb = (bytes) => bytes / 1024;
const fmt = (bytes) => `${kb(bytes).toFixed(2)} kB`;

/**
 * Everything the browser must download before the map can render is "critical":
 * the entry chunk plus the vendor chunks it statically imports. Lazily imported
 * routes and the Web Workers are counted and printed, but not budgeted — they
 * are not on the first-paint path.
 */
const groupOf = (file) => {
  const name = file.replace(/-[A-Za-z0-9_-]{6,}\.js$/, "");
  if (name === "index") return "entry";
  if (REQUIRED_VENDOR.includes(name)) return `vendor:${name}`;
  if (name.endsWith(".worker")) return "worker";
  return "deferred";
};

const rows = entries
  .map((file) => {
    const buf = readFileSync(path.join(assetsDir, file));
    return {
      file,
      group: groupOf(file),
      raw: statSync(path.join(assetsDir, file)).size,
      gzip: gzipSync(buf, { level: 9 }).length,
    };
  })
  .sort((a, b) => b.gzip - a.gzip);

const critical = rows.filter((r) => r.group === "entry" || r.group.startsWith("vendor:"));
const criticalGzip = critical.reduce((s, r) => s + r.gzip, 0);
const criticalRaw = critical.reduce((s, r) => s + r.raw, 0);

console.log("bundle budget — apps/web");
for (const r of rows) {
  console.log(`  ${r.group.padEnd(14)} ${r.file.padEnd(38)} ${fmt(r.raw).padStart(11)}  gzip ${fmt(r.gzip).padStart(10)}`);
}
console.log(`  entry + vendor: ${fmt(criticalRaw)} raw, ${fmt(criticalGzip)} gzipped`);

const failures = [];

const missing = REQUIRED_VENDOR.filter((name) => !rows.some((r) => r.group === `vendor:${name}`));
if (missing.length > 0) {
  failures.push(
    `vendor chunk(s) missing: ${missing.join(", ")} — manualChunks in apps/web/vite.config.ts is no longer splitting them, so every deploy re-downloads all of three/react`,
  );
}

const override = process.env.SIAHRA_BUNDLE_BUDGET_KB;
// The override may only ever make the check STRICTER. Letting it replace the
// ceiling would mean anyone who can set an env var in a build can switch the
// E8.2 contract off silently — the failure mode where the guard reports "ok"
// precisely when it should have fired.
const budgets = override
  ? [
      {
        label: `override (SIAHRA_BUNDLE_BUDGET_KB)`,
        limitKb: Math.min(Number(override), CEILING_KB),
        hard: true,
      },
    ]
  : [
      { label: "regression guard (warning only)", limitKb: GUARD_KB, hard: false },
      { label: "roadmap E8.2 ceiling", limitKb: CEILING_KB, hard: true },
    ];

if (override && !Number.isFinite(budgets[0].limitKb)) {
  console.error(`bundle budget: SIAHRA_BUNDLE_BUDGET_KB=${override} is not a number`);
  process.exit(1);
}

for (const b of budgets) {
  const used = ((kb(criticalGzip) / b.limitKb) * 100).toFixed(1);
  if (kb(criticalGzip) > b.limitKb) {
    const line = `entry + vendor is ${fmt(criticalGzip)} gzipped, over the ${b.label} of ${b.limitKb} kB`;
    if (b.hard) failures.push(line);
    else console.error(`bundle budget WARNING: ${line}`);
  } else {
    console.log(`  ok: ${b.label} ${b.limitKb} kB — ${used} % used`);
  }
}

if (failures.length > 0) {
  for (const f of failures) console.error(`bundle budget FAILED: ${f}`);
  process.exit(1);
}
