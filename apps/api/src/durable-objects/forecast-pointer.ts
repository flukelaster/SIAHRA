import { DurableObject } from "cloudflare:workers";

interface LatestPointer {
  /** `YYYYMMDDTHHMMSSZ-<16 hex>` — see `FloodExposureRun.runId`. */
  runId: string;
  /** The R2 key the run was written to: `exposure/runs/{runId}.json.gz` (gzip JSON). */
  manifestKey: string;
  /** When this pointer was moved — NOT when the run was computed (`run.computedAt`). */
  publishedAt: string;
}

const LATEST_KEY = "latest";

/**
 * Strongly-consistent "latest published run" pointer. Deliberately a Durable
 * Object, not KV — a stale pointer during a live flood event is a correctness
 * problem, not a UX nit (see plan Workstream B).
 *
 * Since E10.3 this holds the **flood-exposure run** pointer, written by
 * `ObservationCacheDO` after every refresh whose result changed and read by
 * `GET /api/v1/provinces/{NN}/exposure/latest`. There is exactly **one**
 * instance (`EXPOSURE_POINTER_NAME` in `src/exposure/publish.ts`), because a
 * run is nationwide: the province scoping happens inside the run, on the
 * `provinceCode` each station carries, never per-province state out here.
 *
 * The class name is deliberately unchanged from its forecast-era name: renaming
 * a Durable Object class means a migration, and a careless one destroys stored
 * state. The name is history; what it stores is defined above.
 */
export class ForecastPointerDO extends DurableObject<Env> {
  async setLatest(runId: string, manifestKey: string): Promise<void> {
    const pointer: LatestPointer = { runId, manifestKey, publishedAt: new Date().toISOString() };
    await this.ctx.storage.put(LATEST_KEY, pointer);
  }

  async getLatest(): Promise<LatestPointer | null> {
    const pointer = await this.ctx.storage.get<LatestPointer>(LATEST_KEY);
    return pointer ?? null;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/latest") {
      const pointer = await this.getLatest();
      if (!pointer) return new Response("No run has been published yet", { status: 404 });
      return Response.json(pointer);
    }
    return new Response("Not found", { status: 404 });
  }
}
