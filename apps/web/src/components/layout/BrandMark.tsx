/**
 * SIAHRA brand mark — flat institutional emblem: a solid blue disc carrying a
 * white terrain-contour line, a light-blue water line beneath it, and an orange
 * observation-station marker where the contour begins.
 * Keep in sync with `public/favicon.svg` (same geometry; ids prefixed here so
 * several instances can coexist in one document).
 */
export function BrandMark({ size = 36, className }: { size?: number; className?: string }) {
  const clipId = "siahra-mark-disc";
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx="32" cy="32" r="30" />
        </clipPath>
      </defs>
      <circle cx="32" cy="32" r="30" fill="#1d4ed8" />
      <g clipPath={`url(#${clipId})`} fill="none" strokeWidth="5" strokeLinecap="round">
        <path d="M-2 30 C10 16 22 16 32 26 C42 36 54 36 66 24" stroke="#ffffff" />
        <path d="M-2 46 C10 32 22 32 32 42 C42 52 54 52 66 40" stroke="#7dd3fc" />
      </g>
      <circle cx="14" cy="19" r="6.5" fill="#1d4ed8" />
      <circle cx="14" cy="19" r="4.5" fill="#fb923c" />
    </svg>
  );
}
