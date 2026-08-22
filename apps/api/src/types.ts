import type { AlertEngineDO } from "./durable-objects/alert-engine.js";
import type { EarthquakeFeedDO } from "./durable-objects/earthquake-feed.js";
import type { FloodExtentDO } from "./durable-objects/flood-extent.js";
import type { ForecastPointerDO } from "./durable-objects/forecast-pointer.js";
import type { ObservationCacheDO } from "./durable-objects/observation-cache.js";
import type { RadarDO } from "./durable-objects/radar.js";

/**
 * `wrangler types` leaves DurableObjectNamespace bindings untyped (see the
 * `/* ClassName *\/` comment it emits) because it can't infer the RPC surface
 * automatically. This re-declares the DO bindings with their concrete
 * class so `.getByName(...).someMethod()` type-checks; every other binding
 * is passed through unchanged from the generated ambient `Env`.
 */
export interface AppEnv
  extends Omit<
    Env,
    | "EARTHQUAKE_FEED"
    | "FORECAST_POINTER"
    | "OBSERVATION_CACHE"
    | "FLOOD_EXTENT"
    | "RADAR"
    | "ALERT_ENGINE"
  > {
  RADAR: DurableObjectNamespace<RadarDO>;
  EARTHQUAKE_FEED: DurableObjectNamespace<EarthquakeFeedDO>;
  FLOOD_EXTENT: DurableObjectNamespace<FloodExtentDO>;
  FORECAST_POINTER: DurableObjectNamespace<ForecastPointerDO>;
  OBSERVATION_CACHE: DurableObjectNamespace<ObservationCacheDO>;
  ALERT_ENGINE: DurableObjectNamespace<AlertEngineDO>;
}
