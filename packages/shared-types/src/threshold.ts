/**
 * Threshold / alert engine (E11.5) — binds real ThaiWater stations to real
 * local authorities (อปท.) and reports when a station's computed exposure
 * level reaches a declared tier for real local authorities to act on.
 *
 * This is a REPLACEMENT of a fully-reverted implementation. What that version
 * got wrong, and what every type here exists to make impossible again:
 * - it invented station ids (9001, 9010, 5001…) that joined to no real
 *   ThaiWater `StationRef` — every `stationId` here must resolve against a
 *   real observation (see `apps/etl/src/buildAlertRules.ts`)
 * - it mixed MSL and local-datum water levels under one field name — this
 *   module carries no water-level numbers of its own at all: severity comes
 *   from `ExposureLevel`, the same ranking `computeExposure()` already
 *   produces from `apps/api/src/exposure/compute.ts`'s cited threshold table
 * - it invented numeric `triggerValue`/`clearValue` pairs (e.g. "4.2 MSL")
 *   with no citation — a rule's trigger condition is a tier
 *   (`AlertSeverityTier`) plus time-based hysteresis, never a bespoke number
 * - it never ran on any schedule and rendered a never-evaluated state as
 *   `evaluatedAt: <now>` — `evaluatedAt` here is genuinely nullable
 * - its only trigger was an unauthenticated `POST /api/v1/alerts/evaluate`
 *   whose empty-body path silently cleared every active alert — there is no
 *   write endpoint in this contract; evaluation is DO-`alarm()`-driven only
 */

/**
 * The two `ExposureLevel` tiers worth alerting a local authority about.
 * `low`/`elevated` are informational only in the existing exposure UI — a
 * rule cannot be configured to fire on them, so a misconfigured rule table
 * cannot flood every authority with low-tier noise.
 */
export type AlertSeverityTier = "high" | "severe";

/**
 * One binding of a real ThaiWater station to the real local authorities its
 * readings are relevant to, plus a time-based hysteresis policy.
 *
 * The station→authority mapping is a real point-in-polygon computation (a
 * station's coordinates genuinely fall inside the authority's E11.2 boundary
 * polygon) run once at build time by `apps/etl/src/buildAlertRules.ts` and
 * baked into `apps/api/src/data/alertRules.json` — not recomputed on every
 * alarm tick, and never a "nearest station" guess.
 */
export interface ThresholdRule {
  id: string;
  /** ThaiWater telemetering station id — must resolve against a real
   *  observation via `stationKind`'s own namespace (see `StationExposure`'s
   *  doc comment on why rainfall/water-level ids are not comparable). */
  stationId: number;
  stationKind: "waterlevel" | "rainfall";
  /** `TH-LAO-*` ids — every one must resolve in the real E11.1 registry
   *  (`apps/api/src/data/localAuthorities.ts`); a rule table load that
   *  references an unknown id is rejected, not silently kept. */
  affectedLocalAuthorityIds: string[];
  /** The station's computed `ExposureLevel` must reach or exceed this tier,
   *  sustained for `minimumDurationMinutes`, to trigger. */
  alertAtLevel: AlertSeverityTier;
  /** Minutes the station must stay at-or-above `alertAtLevel` before the
   *  alert actually triggers, and (symmetrically) minutes it must stay
   *  genuinely below it before the alert clears. Real, observed time — not a
   *  value-based clear-threshold gap. */
  minimumDurationMinutes: number;
  /** Minutes after a clear before this rule may trigger again — prevents a
   *  station oscillating around the tier boundary from re-alerting every
   *  evaluation tick. */
  cooldownMinutes: number;
  /** Only set when the mapping is a curated downstream list rather than a
   *  stations-within-polygon computation (roadmap: "no nearest-station
   *  mapping" without one) — absent for the auto-computed majority of rules. */
  sourceNote?: string;
  reviewerName?: string;
  version: string;
}

/**
 * One alert instance for one local authority, derived from a `ThresholdRule`
 * that has actually fired. Fanned out one-per-`affectedLocalAuthorityId` at
 * read time from the engine's per-rule evaluation state — the underlying
 * trigger/clear/stale timeline is the rule's (one station), but each
 * authority the rule names gets its own record so a consumer can filter by
 * `localAuthorityId` without re-deriving the fan-out itself.
 */
export interface AlertEvent {
  /** `${ruleId}:${localAuthorityId}` — stable across ticks for one active
   *  episode; a new episode after a real clear gets a new id. */
  id: string;
  ruleId: string;
  /** `ThresholdRule.version` at evaluation time, so a consumer can tell a
   *  live alert was produced under a rule table that has since changed. */
  ruleVersion: string;
  localAuthorityId: string;
  /** Copied verbatim from the E11.1 registry record for `localAuthorityId` —
   *  never guessed from station geometry. */
  provinceCode: string;
  level: AlertSeverityTier;
  triggeredAt: string;
  /** Null while the alert is still active. */
  clearedAt: string | null;
  /** True when the triggering station is currently missing from the latest
   *  observation batch — the alert stays HELD (not cleared) while stale; a
   *  real clear only happens once the station reports again and its
   *  computed level genuinely drops back below `alertAtLevel` for
   *  `minimumDurationMinutes`. */
  stale: boolean;
  inputSnapshot: {
    stationId: number;
    /** `ExposureLevel` at the most recent tick that actually observed this
     *  station (not necessarily the current tick, if `stale`). */
    level: string;
    observedAt: string | null;
  };
}

/** `GET /api/v1/alerts/active[?province=NN][&localAuthorityId=ID]` */
export interface ActiveAlertsResponse {
  total: number;
  /** Null until the engine's `alarm()`/`ensureFresh()` has run at least once
   *  for real — never backdated to "now". A consumer must render this as
   *  "not yet evaluated", not silently treat it as "nothing is wrong". */
  evaluatedAt: string | null;
  alerts: AlertEvent[];
}

/** `GET /api/v1/alerts/rules[?stationId=ID]` */
export interface ThresholdRulesResponse {
  total: number;
  rules: ThresholdRule[];
}
