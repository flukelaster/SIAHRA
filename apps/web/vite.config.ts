import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const TILES_ROOT = path.resolve(__dirname, "../etl/data/tiles");

/**
 * Serves the terrain + building tile pyramids (apps/etl/data/tiles,
 * GBs / ~100k files) at /aoi/{code}/terrain/... in dev without putting them
 * in public/ (which would be copied into dist and the Worker asset bundle).
 * Production is expected to serve the same prefix from R2.
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

// In production a single Worker serves both the SPA and /api/* (see
// apps/api/wrangler.jsonc run_worker_first). In dev they are two processes,
// so proxy /api to the local `wrangler dev` instance.
export default defineConfig({
  plugins: [react(), tailwindcss(), terrainTiles()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
