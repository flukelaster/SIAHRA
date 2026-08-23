/**
 * Vite's `?raw` import (the file's text as a string) — used by
 * `sqlQueryPlans.test.ts` to read the Durable Object sources. The test tsconfig
 * is the only project that includes this file, so the Worker build never sees it.
 */
declare module "*?raw" {
  const text: string;
  export default text;
}
