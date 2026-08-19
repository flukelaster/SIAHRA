/**
 * The 77 Thai province codes (the numeric tail of ISO 3166-2:TH), as used by
 * every province-scoped path in this project — `/api/v1/provinces/{NN}/...`,
 * the AOI directory names under `apps/web/public/aoi/{NN}`, and the
 * `provinceCode` ThaiWater puts on a station record.
 *
 * WHY THE CODES LIVE HERE AND THE NAMES DO NOT: a Worker cannot read
 * `apps/web/public/aoi/*` at runtime, so the API needs the *set* of real codes
 * baked into its bundle to answer "unknown province" with a 404 rather than
 * inferring existence from whatever data happens to be loaded — a province
 * with no stations in a given run is a real province with nothing to report,
 * not an unknown one, and that distinction must not change from day to day.
 * The display names stay in `apps/web/src/data/provinces.ts`; a test there
 * asserts the two lists carry exactly the same code set, so they cannot drift.
 */
export const PROVINCE_CODES: readonly string[] = [
  "10", "11", "12", "13", "14", "15", "16", "17", "18", "19",
  "20", "21", "22", "23", "24", "25", "26", "27",
  "30", "31", "32", "33", "34", "35", "36", "37", "38", "39",
  "40", "41", "42", "43", "44", "45", "46", "47", "48", "49",
  "50", "51", "52", "53", "54", "55", "56", "57", "58",
  "60", "61", "62", "63", "64", "65", "66", "67",
  "70", "71", "72", "73", "74", "75", "76", "77",
  "80", "81", "82", "83", "84", "85", "86",
  "90", "91", "92", "93", "94", "95", "96",
];

const PROVINCE_CODE_SET = new Set(PROVINCE_CODES);

/** True only for a code that names a real province — never a shape check alone. */
export function isProvinceCode(code: string): boolean {
  return PROVINCE_CODE_SET.has(code);
}
