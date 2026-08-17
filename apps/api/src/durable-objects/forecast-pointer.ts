import { DurableObject } from "cloudflare:workers";

interface LatestPointer {
  runId: string;
  manifestKey: string;
  publishedAt: string;
}

const LATEST_KEY = "latest";

/**
 * Strongly-consistent "latest forecast run" pointer for one province.
 * Deliberately a Durable Object, not KV — a stale flood pointer during a
 * live event is a correctness problem, not a UX nit (see plan Workstream B).
 * Stub for now: no forecast pipeline exists yet to call setLatest().
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
      if (!pointer) return new Response("No forecast published for this province yet", { status: 404 });
      return Response.json(pointer);
    }
    return new Response("Not found", { status: 404 });
  }
}
