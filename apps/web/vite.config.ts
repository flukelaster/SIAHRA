import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import { localTileSegments, parseTilePath } from "./worker/tilePath.ts";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const TILES_ROOT = path.resolve(import.meta.dirname, "../etl/data/tiles");

/**
 * Per-worktree dev ports written by scripts/setup-worktree.sh — parsed (never
 * sourced). Root checkout keeps 5173 (web) / 8787 (api).
 */
function worktreePorts(): { web?: number; api?: number } {
  try {
    const env = readFileSync(path.resolve(import.meta.dirname, "../../.env.worktree"), "utf8");
    const web = env.match(/^SIAHRA_WEB_DEV_PORT=(\d+)$/m);
    const api = env.match(/^SIAHRA_API_DEV_PORT=(\d+)$/m);
    return { web: web ? Number(web[1]) : undefined, api: api ? Number(api[1]) : undefined };
  } catch {
    return {};
  }
}
const PORTS = worktreePorts();

/**
 * Serves the terrain + building tile pyramids (apps/etl/data/tiles,
 * GBs / ~100k files) at /aoi/{code}/terrain/... in dev without putting them
 * in public/ (which would be copied into dist and the Worker asset bundle).
 * Production is expected to serve the same prefix from R2 through the
 * siahra-web Worker (see apps/web/wrangler.jsonc).
 *
 * Both URL shapes are served, through the same parser the Worker uses
 * (worker/tilePath.ts): the legacy `/aoi/{code}/{layer}/…` and the
 * version-addressed `/aoi/{code}/v/{version}/{layer}/…` that E9.2 puts into the
 * manifests. **The version segment is dropped when the local file path is
 * built** (`localTileSegments`), because `apps/etl/data/tiles` holds exactly one
 * build of the dataset with no version directories on disk — so in dev every
 * version resolves to the bytes that are actually there, which is the truth on
 * this machine.
 *
 * That is precisely what the Worker must **not** do: in R2 several versions
 * coexist as separate objects and are served `immutable` for a year, so
 * stripping the version there would let two dataset versions collide on one
 * object and pin a wrong answer for a year. Dev has one version, no immutable
 * caching (max-age=3600, and nothing is shared with any other client), and the
 * file on disk is by definition the current build.
 */
function terrainTiles(): Plugin {
  return {
    name: "siahra-terrain-tiles",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // req.url is the raw request target (query string included, dot segments
        // *not* normalised) — parseTilePath cuts the query and rejects anything
        // that is not a strict tile path, which is what keeps `..` out of the
        // path.join below.
        const tile = parseTilePath(req.url ?? "");
        if (!tile) return next();
        const file = path.join(TILES_ROOT, ...localTileSegments(tile));
        if (!existsSync(file)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Length", String(statSync(file).size));
        res.setHeader("Cache-Control", "public, max-age=3600");
        createReadStream(file).pipe(res);
      });
    },
  };
}

// In production the SPA and the API are two separately deployed Workers that
// share one origin through zone routes (`/api/*` → siahra-api, `/*` →
// siahra-web). Dev mirrors that single-origin view with two processes, so proxy
// /api to the local `wrangler dev` instance.
const API_TARGET = `http://127.0.0.1:${PORTS.api ?? 8787}`;

export default defineConfig({
  plugins: [react(), tailwindcss(), terrainTiles()],
  build: {
    rollupOptions: {
      output: {
        // three (~600 kB) และ react เปลี่ยนน้อยกว่าโค้ดของเราหลายเท่า แยกออกมา
        // แล้ว hash ของมันจะคงเดิมข้ามการ deploy ที่แตะแค่โค้ดแอป — ผู้ใช้เดิม
        // ดาวน์โหลดใหม่เฉพาะชิ้นเล็ก
        //
        // นี่คือกำไรด้าน **แคช** ไม่ใช่ first paint: ทั้งสองก้อนยังอยู่บนเส้นทาง
        // วิกฤติ เพราะโมดูลใน scene/* import three แบบตรง ๆ
        manualChunks: (id: string) => {
          if (!id.includes("node_modules")) return undefined;
          if (/node_modules[/\\]three[/\\]/.test(id)) return "three";
          if (/node_modules[/\\](react|react-dom|scheduler)[/\\]/.test(id)) return "react";
          return undefined;
        },
      },
    },
  },
  server: {
    port: PORTS.web,
    strictPort: PORTS.web !== undefined,
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
        ws: true,
        // `changeOrigin` rewrites Host but leaves Origin pointing at the vite
        // port, so the api Worker's same-origin guard (apps/api/src/rateLimit.ts
        // `originAllowed`) sees Origin != Host and answers 403 — which it is
        // right to do. In production both Workers share siahra-radar.co, so the
        // browser's Origin already matches; dev is the only place the two split.
        // Rewriting Origin to the proxy target restores that single-origin view
        // instead of loosening the guard. Without this the earthquake WebSocket
        // handshake, which always sends an Origin, can never connect in dev.
        headers: { Origin: API_TARGET },
      },
    },
  },
});
