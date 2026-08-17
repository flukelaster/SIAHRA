import type { AoiManifest } from "@siahra/shared-types";

export class AoiNotBuiltError extends Error {
  constructor(aoiId: string) {
    super(`AOI "${aoiId}" has no generated terrain artifacts`);
    this.name = "AoiNotBuiltError";
  }
}

export async function loadAoiManifest(aoiId: string): Promise<AoiManifest> {
  const res = await fetch(`/aoi/${aoiId}/manifest.json`);
  if (res.status === 404) throw new AoiNotBuiltError(aoiId);
  if (!res.ok) {
    throw new Error(`Failed to load AOI manifest for "${aoiId}": ${res.status}`);
  }
  // A dev server may answer a missing static file with the SPA shell, so
  // confirm we actually parsed a manifest rather than HTML.
  const text = await res.text();
  try {
    return JSON.parse(text) as AoiManifest;
  } catch {
    throw new AoiNotBuiltError(aoiId);
  }
}
