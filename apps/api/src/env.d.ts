/**
 * Secrets are invisible to `wrangler types`: they live in `wrangler secret`
 * (and `.dev.vars` locally, which is gitignored), not in `wrangler.jsonc`, so
 * the generated `worker-configuration.d.ts` cannot know about them. Declare
 * them here instead — optional on purpose, because "the secret was never set"
 * is a state the code must handle (the TMD feed degrades, see
 * src/ingestion/tmd.ts), not a state we can type away.
 *
 * Merged into `__BaseEnv_Env`, the generated interface that BOTH the global
 * `Env` (used by `src/**` and the Durable Objects) and `Cloudflare.Env` (used
 * by `import { env } from "cloudflare:workers"`, i.e. the tests) extend — one
 * declaration, both views. It survives the next `wrangler types` run; if a
 * future wrangler renames that base interface, this file is what has to follow.
 */
interface __BaseEnv_Env {
  /** TMD open-data API user id — `wrangler secret put TMD_UID`. */
  TMD_UID?: string;
  /** TMD open-data API key — `wrangler secret put TMD_UKEY`. */
  TMD_UKEY?: string;
  /**
   * TMD NWP API bearer token — `wrangler secret put TMD_NWP_TOKEN` (คนละกุญแจ
   * กับ TMD_UID/TMD_UKEY ข้างบน ซึ่งเป็นของฟีดแผ่นดินไหว) ไม่มี = ForecastNwpDO
   * รายงาน `lastError: "TMD NWP token not configured"` แหล่งอื่นไม่กระทบ
   */
  TMD_NWP_TOKEN?: string;
}
