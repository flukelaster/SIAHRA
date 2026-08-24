import { createRouter, type Route } from "./router.js";
import { runScheduledTick } from "./scheduledTick.js";
import { handleActiveAlerts, handleAlertRules } from "./routes/alerts.js";
import { handleEarthquakesLive, handleEarthquakesRecent } from "./routes/earthquakes.js";
import { handleExposureRun, handleProvinceExposureLatest } from "./routes/exposure.js";
import { handleFloodExtentSummary, handleProvinceFloodExtent } from "./routes/flood.js";
import { handleForecastAvailability, handleProvinceForecast } from "./routes/forecast.js";
import { handleHealth } from "./routes/health.js";
import {
  handleLocalAuthorityDetail,
  handleLocalAuthorityExposure,
  handleLocalAuthorityImpact,
  handleLocalAuthoritiesList,
} from "./routes/localAuthorities.js";
import { handleObservations } from "./routes/observations.js";
import { handleRadarFrame, handleRadarFrames } from "./routes/radar.js";
import { handleDams, handleStationHistory } from "./routes/stations.js";
import { handleArchiveDays, handleArchiveSnapshot } from "./routes/archive.js";
import type { AppEnv } from "./types.js";

export { AlertEngineDO } from "./durable-objects/alert-engine.js";
export { EarthquakeFeedDO } from "./durable-objects/earthquake-feed.js";
export { FloodExtentDO } from "./durable-objects/flood-extent.js";
export { ForecastNwpDO } from "./durable-objects/forecast-nwp.js";
export { ForecastPointerDO } from "./durable-objects/forecast-pointer.js";
export { ObservationCacheDO } from "./durable-objects/observation-cache.js";
export { RadarDO } from "./durable-objects/radar.js";

/**
 * Every route declares its own limit — no endpoint inherits the router's
 * DEFAULT_LIMIT any more, so raising or lowering a budget is a visible edit
 * here rather than an invisible side effect somewhere else. The numbers and
 * the reasoning behind them are in docs/api.md.
 */
export const routes: Route[] = [
  { method: "GET", pattern: /^\/api\/v1\/health$/, handler: handleHealth, limit: { perMinute: 300 } },
  { method: "GET", pattern: /^\/api\/v1\/earthquakes\/recent$/, handler: handleEarthquakesRecent, limit: { perMinute: 300 } },
  { method: "GET", pattern: /^\/api\/v1\/earthquakes\/live$/, handler: handleEarthquakesLive, limit: { perMinute: 10, burst: 5 } },
  { method: "GET", pattern: /^\/api\/v1\/observations$/, handler: handleObservations, limit: { perMinute: 120 } },
  { method: "GET", pattern: /^\/api\/v1\/flood-extent\/summary$/, handler: handleFloodExtentSummary, limit: { perMinute: 300 } },
  { method: "GET", pattern: /^\/api\/v1\/dams$/, handler: handleDams, limit: { perMinute: 300 } },
  {
    method: "GET",
    pattern: /^\/api\/v1\/local-authorities$/,
    handler: (req) => handleLocalAuthoritiesList(req),
    limit: { perMinute: 300 },
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/local-authorities\/([A-Za-z0-9-]+)$/,
    handler: (_req, _env, [id]) => handleLocalAuthorityDetail(id),
    limit: { perMinute: 300 },
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/local-authorities\/([A-Za-z0-9-]+)\/exposure$/,
    handler: (_req, _env, [id]) => handleLocalAuthorityExposure(id),
    limit: { perMinute: 300 },
  },
  {
    // ต่างจากสองเส้นทาง /local-authorities ด้านบน: อ่าน FloodExtentDO ต่อคำขอ
    // (turf intersect กับฉาก GISTDA ปัจจุบัน) ไม่ใช่ artefact นิ่ง ๆ ที่ bake
    // เข้า bundle — จำกัดอัตราเท่ากับเส้นทางอื่นที่พึ่งพา flood extent
    method: "GET",
    pattern: /^\/api\/v1\/local-authorities\/([A-Za-z0-9-]+)\/impact$/,
    handler: (_req, env, [id]) => handleLocalAuthorityImpact(id, env),
    limit: { perMinute: 300 },
  },
  { method: "GET", pattern: /^\/api\/v1\/archive\/days$/, handler: handleArchiveDays, limit: { perMinute: 300 } },
  { method: "GET", pattern: /^\/api\/v1\/archive\/snapshot$/, handler: handleArchiveSnapshot, limit: { perMinute: 60 } },
  { method: "GET", pattern: /^\/api\/v1\/radar\/frames$/, handler: handleRadarFrames, limit: { perMinute: 300 } },
  {
    method: "GET",
    pattern: /^\/api\/v1\/radar\/frame\/([0-9]+)\.png$/,
    handler: (_req, env, [ts]) => handleRadarFrame(ts, env),
    limit: { perMinute: 600 },
    limitScope: "radar-frame",
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/stations\/([0-9]+)\/history$/,
    handler: (req, env, [id]) => handleStationHistory(id, req, env),
    limit: { perMinute: 60, burst: 20 },
    limitScope: "history",
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/provinces\/([0-9]{2})\/flood-extent$/,
    handler: (_req, env, [province]) => handleProvinceFloodExtent(province, env),
    limit: { perMinute: 300 },
  },
  {
    // อ่านแถวเดียวด้วย primary key ไม่ปลุกการดึงต้นทาง — ถูกกว่า
    // `/exposure/latest` (อ่าน R2 หนึ่งก้อน) จึงตั้งงบเท่ากันได้อย่างสบาย
    method: "GET",
    pattern: /^\/api\/v1\/provinces\/([0-9]{2})\/forecast$/,
    handler: (_req, env, [province]) => handleProvinceForecast(province, env),
    limit: { perMinute: 300 },
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/forecast\/availability$/,
    handler: (_req, env) => handleForecastAvailability(env),
    limit: { perMinute: 300 },
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/provinces\/([0-9]{2})\/exposure\/latest$/,
    handler: (_req, env, [province]) => handleProvinceExposureLatest(province, env),
    limit: { perMinute: 300 },
  },
  {
    // รูปของ runId ถูกบังคับตั้งแต่ในตารางเส้นทาง (`YYYYMMDDTHHMMSSZ-<16 hex>`)
    // ขยะจึงกลายเป็น 404 ของ router และไม่มี input ของผู้ใช้เดินไปถึงคีย์ R2
    method: "GET",
    pattern: /^\/api\/v1\/exposure\/runs\/([0-9]{8}T[0-9]{6}Z-[0-9a-f]{16})$/,
    handler: (_req, env, [runId]) => handleExposureRun(runId, env),
    // 120/นาที สูงกว่า `/archive/snapshot` (60/นาที) ทั้งที่ทั้งคู่อ่าน R2 หนึ่งก้อน
    // ต่อคำขอ เพราะก้อนนี้เล็กกว่ามาก: run ทั้งประเทศเก็บเป็น gzip ~103 KB (ดิบ 1.29 MB)
    // และเป็น artefact แช่แข็งที่ CDN แคชได้หนึ่งปี คำขอที่ถึง origin จริงจึงมีน้อย
    limit: { perMinute: 120 },
    limitScope: "exposure-run",
  },
  {
    // อ่านอย่างเดียว — ไม่มี POST /api/v1/alerts/evaluate ในตารางนี้เลย (E11.5)
    method: "GET",
    pattern: /^\/api\/v1\/alerts\/active$/,
    handler: (req, env) => handleActiveAlerts(req, env),
    limit: { perMinute: 300 },
  },
  {
    method: "GET",
    pattern: /^\/api\/v1\/alerts\/rules$/,
    handler: (req, env) => handleAlertRules(req, env),
    limit: { perMinute: 300 },
  },
];

const route = createRouter(routes);

export default {
  fetch: (request: Request, env: AppEnv, ctx: ExecutionContext) => route(request, env, ctx),

  /**
   * One tick refreshes four independent sources. They run concurrently and in
   * isolation (see src/scheduledTick.ts): a source that throws or hangs is
   * logged and the other three still refresh — a dead GISTDA scene must never
   * be the reason ThaiWater levels went stale.
   */
  async scheduled(_controller: ScheduledController, env: AppEnv): Promise<void> {
    await runScheduledTick([
      {
        id: "earthquakes",
        run: async () => ({ ...(await env.EARTHQUAKE_FEED.getByName("global").pollAndBroadcast()) }),
      },
      // Keep the observation cache warm too, so the first browser request after
      // a quiet period never pays the 2-4 MB upstream fetch inline.
      { id: "thaiwater", run: () => env.OBSERVATION_CACHE.getByName("thaiwater").ensureFresh() },
      { id: "gistda-flood", run: () => env.FLOOD_EXTENT.getByName("gistda").ensureFresh() },
      { id: "tmd-radar", run: () => env.RADAR.getByName("tmd").ensureFresh() },
      // พยากรณ์ NWP รีเฟรชรายชั่วโมง — ensureFresh() ตรวจอายุเองแล้วข้ามรอบที่ยังสด
      // จึงเรียกได้ทุกนาทีเหมือนงานอื่น ในทางที่ดีคือชั่วโมงละครั้ง ส่วนตอนต้นทางล่ม
      // (รอบพังทั้งรอบ = ไม่เขียน fetchedAt) ตัวกั้น lastAttemptAt ใน ensureFresh()
      // คือสิ่งที่ทำให้ยังห่างกันอย่างน้อย RETRY_MS ไม่ใช่ยิงใหม่ทุกนาที
      //
      // ชื่อ instance เป็น "primary" ไม่ใช่ "tmd" เหมือนเรดาร์ข้างบน — ตอนแรกสงสัยว่า
      // instance เดิมชื่อ "tmd" ค้าง env เก่าที่ยังไม่มี TMD_NWP_TOKEN (secret ถูกตั้ง
      // ช้ากว่าโค้ด 436 มิลลิวินาทีตอน deploy แรก) จึงลองเปลี่ยนชื่อ instance เมื่อ
      // 2026-08-24 เพื่อบังคับให้สร้างใหม่ (แทนการลบ+สร้างคลาสด้วย migration ซึ่ง
      // Cloudflare ปฏิเสธ เพราะ binding ยังอยู่ในดีพลอยเดียวกัน — ต่างจาก AlertEngineDO
      // v6/v7 ที่ binding ถูกถอดพร้อมกันตอน revert ทั้งฟีเจอร์)
      //
      // **แต่การเปลี่ยนชื่อไม่ใช่ตัวแก้จริง**: instance "primary" ที่สร้างใหม่ล้วน ๆ
      // ยังพังด้วย error เดิมทุกตัวอักษร ยืนยันด้วย wrangler tail สด ๆ ตอน retry จริง
      // (03:40:22Z) ทั้งที่ `wrangler versions view` ยืนยันว่า secret ผูกอยู่กับ
      // version ที่ deploy อยู่จริง สาเหตุจริงคือ **ค่า secret เป็นสตริงว่างตั้งแต่
      // ต้น**: `wrangler secret put TMD_NWP_TOKEN` เคยถูกรันในเชลล์ non-interactive
      // ที่รับ stdin ว่างได้เงียบ ๆ แล้วยังพิมพ์ "✨ Success!" เหมือนสำเร็จปกติ — ไม่มี
      // เครื่องมือไหน (`secret list`, `versions view`, dashboard) แยกความต่างระหว่าง
      // "ชื่อ secret ผูกอยู่" กับ "ค่า secret ไม่ว่าง" ได้เลย แก้จริงคือ re-upload
      // ค่าจาก .dev.vars ที่รู้ว่าใช้ได้ (ยืนยันความยาว 1075 ตัวอักษรก่อนอัป) ไม่ใช่
      // การเปลี่ยนชื่อ instance นี้ — ชื่อ "primary" จึงคงไว้เฉย ๆ (เปลี่ยนกลับเป็น
      // "tmd" ไม่มีประโยชน์และจะทิ้งข้อมูลที่เพิ่งดึงสำเร็จ) ดู docs/deploy.md §3 สำหรับ
      // วิธีป้องกันไม่ให้เกิดซ้ำ
      { id: "tmd-nwp", run: () => env.FORECAST_NWP.getByName("primary").ensureFresh() },
      // ประเมิน rule เทียบกับ ObservationCacheDO — งานทุกตัวในลิสต์นี้รันพร้อมกัน
      // ไม่ใช่ตามลำดับ (ดู scheduledTick.ts) แต่ไม่เป็นปัญหา: evaluate() เรียก
      // ObservationCacheDO.getObservations() เอง ซึ่ง refresh ตัวเองถ้าของเก่าหมดอายุ
      { id: "alert-engine", run: () => env.ALERT_ENGINE.getByName("primary").ensureFresh() },
    ]);
  },
} satisfies ExportedHandler<AppEnv>;
