/**
 * Long-term archive on R2. Durable Object SQLite stays a hot 7–8 day cache;
 * everything older lives here as gzip JSON, one object per (day, province)
 * for water levels, hourly nationwide snapshots, daily dam files and one
 * file per GISTDA flood scene. Days are Bangkok days (+07:00).
 */
export const BKK_OFFSET_MS = 7 * 60 * 60 * 1000;

export function bangkokDay(ms: number): string {
  return new Date(ms + BKK_OFFSET_MS).toISOString().slice(0, 10);
}
export function bangkokHour(ms: number): string {
  return new Date(ms + BKK_OFFSET_MS).toISOString().slice(11, 13);
}
/** UTC ms of the start of a Bangkok day "YYYY-MM-DD". */
export function dayStartMs(day: string): number {
  return Date.parse(`${day}T00:00:00+07:00`);
}
export function addDays(day: string, n: number): string {
  return bangkokDay(dayStartMs(day) + n * 86400000 + 12 * 3600000) ;
}

export const keys = {
  waterlevelDay: (day: string, province: string) => `archive/waterlevel/${day}/${province}.json.gz`,
  snapshot: (day: string, hour: string) => `archive/snapshots/${day}/${hour}.json.gz`,
  dams: (day: string) => `archive/dams/${day}.json.gz`,
  flood: (iso: string) => `archive/flood/${iso.replace(/[:.]/g, "-")}.json.gz`,
  index: (day: string) => `archive/index/${day}.json`,
};

async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}
async function gunzip(body: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(body.pipeThrough(new DecompressionStream("gzip"))).text();
}

export async function putJsonGz(bucket: R2Bucket, key: string, value: unknown): Promise<void> {
  const body = await gzip(JSON.stringify(value));
  await bucket.put(key, body, {
    httpMetadata: { contentType: "application/json", contentEncoding: "gzip" },
  });
}

export async function getJsonGz<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  const obj = await bucket.get(key);
  if (!obj) return null;
  return JSON.parse(await gunzip(obj.body)) as T;
}

export async function putJson(bucket: R2Bucket, key: string, value: unknown): Promise<void> {
  await bucket.put(key, JSON.stringify(value), { httpMetadata: { contentType: "application/json" } });
}
export async function getJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  const obj = await bucket.get(key);
  return obj ? ((await obj.json()) as T) : null;
}

/** Shape of archive/waterlevel/{day}/{province}.json.gz */
export interface WaterlevelDayFile {
  day: string;
  provinceCode: string;
  generatedAt: string;
  stations: {
    stationId: number;
    datum: "msl" | "local" | "unknown";
    /** [tMs, value, discharge] — 10-minute points where warmed, hourly otherwise. */
    points: [number, number | null, number | null][];
  }[];
}

export interface ArchiveDayIndex {
  day: string;
  waterlevelProvinces: string[];
  snapshotHours: string[];
  dams: boolean;
  generatedAt: string;
}
