/**
 * One place where query-string input is validated, so a malformed parameter
 * always answers 400 with a message that names the parameter — never a 500
 * from a `NaN` reaching a Durable Object, and never a silently ignored value
 * that makes the response look like it honoured a filter it did not.
 *
 * Pure: takes a `URL`, returns data. Routes turn a failure into a Response.
 */

export type QueryRule =
  /** Two-digit province code (ISO 3166-2:TH numeric tail), e.g. "50". */
  | { type: "province" }
  /** ISO-8601 instant, returned as the raw string once `Date.parse` accepts it. */
  | { type: "isoInstant" }
  /** Integer clamped into [min, max]; absent → `fallback`. */
  | { type: "int"; min: number; max: number; fallback: number }
  /** Finite number; absent → null (used for optional thresholds like minMag). */
  | { type: "float" };

/**
 * The value type is a function of the rule's `type` literal only — deliberately
 * not of an extra `required` flag, which widens to `boolean` on an inline spec
 * and would collapse every branch back to `string | null`. A route that needs a
 * parameter to be present checks for `null` itself.
 */
type QueryValue<R extends QueryRule> = R extends { type: "int" }
  ? number
  : R extends { type: "float" }
    ? number | null
    : string | null;

export type QuerySpec = Record<string, QueryRule>;

export type ParsedQuery<S extends QuerySpec> =
  | { ok: true; value: { [K in keyof S]: QueryValue<S[K]> } }
  | { ok: false; param: string; error: string };

const PROVINCE_RE = /^[0-9]{2}$/;

function parseOne(param: string, raw: string | null, rule: QueryRule): { value: unknown } | { error: string } {
  switch (rule.type) {
    case "province":
      if (raw === null) return { value: null };
      return PROVINCE_RE.test(raw)
        ? { value: raw }
        : { error: `Invalid ${param} — expected two digits, e.g. 50` };
    case "isoInstant":
      if (raw === null) return { value: null };
      return Number.isFinite(Date.parse(raw))
        ? { value: raw }
        : { error: `Invalid ${param} — expected ISO-8601, e.g. 2026-08-18T09:00:00Z` };
    case "int": {
      if (raw === null) return { value: rule.fallback };
      const n = Number(raw);
      if (!Number.isFinite(n)) return { error: `Invalid ${param} — expected a number` };
      // Out of range is clamped rather than refused: asking for more than the
      // cap is a reasonable request for "as much as you have".
      return { value: Math.min(rule.max, Math.max(rule.min, Math.round(n))) };
    }
    case "float": {
      if (raw === null) return { value: null };
      const n = Number(raw);
      return Number.isFinite(n) ? { value: n } : { error: `Invalid ${param} — expected a number` };
    }
  }
}

/** Validates every parameter in `spec`; the first bad one wins. */
export function parseQuery<S extends QuerySpec>(url: URL, spec: S): ParsedQuery<S> {
  const value: Record<string, unknown> = {};
  for (const [param, rule] of Object.entries(spec)) {
    const parsed = parseOne(param, url.searchParams.get(param), rule);
    if ("error" in parsed) return { ok: false, param, error: parsed.error };
    value[param] = parsed.value;
  }
  return { ok: true, value: value as { [K in keyof S]: QueryValue<S[K]> } };
}
