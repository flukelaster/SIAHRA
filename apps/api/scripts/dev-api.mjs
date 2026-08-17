// Starts `wrangler dev` on this worktree's port (SIAHRA_API_DEV_PORT in
// ../../.env.worktree, written by scripts/setup-worktree.sh; 8787 otherwise).
// The inspector port is derived from it so several worktrees can run at once.
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
let port = 8787;
try {
  const env = readFileSync(path.resolve(here, "../../../.env.worktree"), "utf8");
  const m = env.match(/^SIAHRA_API_DEV_PORT=(\d+)$/m);
  if (m) port = Number(m[1]);
} catch {
  /* no .env.worktree: root defaults */
}
const inspector = port + 1000;
const child = spawn(
  "npx",
  ["wrangler", "dev", "--port", String(port), "--inspector-port", String(inspector), "--test-scheduled"],
  { stdio: "inherit", cwd: path.resolve(here, ".."), shell: process.platform === "win32" },
);
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
