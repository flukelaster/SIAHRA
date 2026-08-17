/**
 * SIAHRA brand mark: an isometric terrain tile with elevation contours, a flood
 * level cutting across the front faces, and a hazard/station pin at the peak.
 * Keep in sync with `public/favicon.svg` (same geometry, ids prefixed here so
 * several instances can coexist in one document).
 */
export function BrandMark({ size = 36, className }: { size?: number; className?: string }) {
  const id = "siahra-mark";
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
        <linearGradient id={`${id}-top`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4478d6" />
          <stop offset="1" stopColor="#284f9c" />
        </linearGradient>
        <linearGradient id={`${id}-left`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1c3462" />
          <stop offset="1" stopColor="#101f3d" />
        </linearGradient>
        <linearGradient id={`${id}-right`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#274a88" />
          <stop offset="1" stopColor="#172f5c" />
        </linearGradient>
        <linearGradient id={`${id}-water`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#4cc9f0" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
        <clipPath id={`${id}-topface`}>
          <rect x="0" y="0" width="28" height="28" />
        </clipPath>
        <clipPath id={`${id}-body`}>
          <path d="M32 6 L60 22.2 L60 40 L32 56.2 L4 40 L4 22.2 Z" />
        </clipPath>
      </defs>
      <path d="M4 22.2 L32 38.3 L32 56.2 L4 40 Z" fill={`url(#${id}-left)`} />
      <path d="M32 38.3 L60 22.2 L60 40 L32 56.2 Z" fill={`url(#${id}-right)`} />
      <path d="M32 6 L60 22.2 L32 38.3 L4 22.2 Z" fill={`url(#${id}-top)`} />
      <g transform="matrix(1 0.5774 -1 0.5774 32 6)" clipPath={`url(#${id}-topface)`}>
        <path
          d="M3 13 C4 5 13 -1 22 3 C29 6 31 14 27 21 C23 27 14 30 8 26 C3 23 2 18 3 13 Z"
          fill="#60a5fa"
          fillOpacity="0.22"
          stroke="#bfdbfe"
          strokeOpacity="0.5"
          strokeWidth="1.2"
        />
        <path
          d="M7 13 C8 8 14 5 19 7 C22 8 22 11 24 12 C27 14 25 19 21 21 C16 24 10 23 8 19 C6 17 6 15 7 13 Z"
          fill="#60a5fa"
          fillOpacity="0.3"
          stroke="#bfdbfe"
          strokeOpacity="0.7"
          strokeWidth="1.2"
        />
        <path
          d="M11 13 C12 10 16 9 19 11 C21 13 20 16 18 18 C15 20 12 19 11 17 C10 15 10 14 11 13 Z"
          fill="#93c5fd"
          fillOpacity="0.45"
          stroke="#e0efff"
          strokeOpacity="0.95"
          strokeWidth="1.2"
        />
      </g>
      <g clipPath={`url(#${id}-body)`}>
        <path d="M0 43.5 L64 43.5 L64 64 L0 64 Z" fill={`url(#${id}-water)`} fillOpacity="0.92" />
        <path d="M0 43.5 L64 43.5" stroke="#eaf6ff" strokeOpacity="0.85" strokeWidth="1.3" />
      </g>
      <path
        d="M32 6 L60 22.2 L60 40 L32 56.2 L4 40 L4 22.2 Z"
        fill="none"
        stroke="#bfdbfe"
        strokeOpacity="0.45"
        strokeWidth="1"
      />
      <path
        d="M60 22.2 L32 38.3 L4 22.2 M32 38.3 L32 56.2"
        fill="none"
        stroke="#bfdbfe"
        strokeOpacity="0.45"
        strokeWidth="1"
      />
      <line x1="33" y1="22.5" x2="33" y2="13" stroke="#fff7ed" strokeOpacity="0.95" strokeWidth="1.6" />
      <circle cx="33" cy="10.5" r="6.5" fill="#fb923c" fillOpacity="0.28" />
      <circle cx="33" cy="10.5" r="3.6" fill="#fb923c" />
      <circle cx="33" cy="10.5" r="1.5" fill="#fff7ed" />
    </svg>
  );
}
