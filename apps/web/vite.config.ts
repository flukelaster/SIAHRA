import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
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
 */
function terrainTiles(): Plugin {
  return {
    name: "siahra-terrain-tiles",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /^\/aoi\/(\d{2})\/(terrain|buildings|features|landcover)\/(\d+)\/(\d+)_(\d+)\.bin$/.exec(req.url ?? "");
        if (!m) return next();
        const file = path.join(TILES_ROOT, m[1], m[2], m[3], `${m[4]}_${m[5]}.bin`);
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
